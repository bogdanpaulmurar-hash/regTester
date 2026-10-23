"""SQLite storage for regTester.

Everything the app keeps lives in one file (regtester.db) in the data folder:
records of every section, their full change history, imports, users,
sessions and settings. Only the Python standard library is used.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 1

SECTIONS = (
    "timeline",      # sprints, planning, deployments, regtest, Q&A ...
    "features",      # new functions from release notes
    "tests",         # export of test cases from the regtest tool
    "runs",          # regtest result runs (one record per run)
    "known",         # known errors list used by triage
    "errors",        # error items from the regtest tool (Error Management export)
    "errsnaps",      # one snapshot per Error Management import, for change tracking
    "transcripts",   # cleaned PO session transcripts
    "glossary",      # wrong term -> correct term
    "docs",          # generated documentation
    "templates",     # documentation templates
    "specs",         # specifications, bugs, issues, procedures
)

DEFAULT_SETTINGS: dict[str, Any] = {
    "language": "ro",
    "theme": "auto",
    "app_name": "regTester",
    "port": 8765,
    "lan_access": False,
    "require_login": True,
    # single sign-on, prepared for Microsoft Entra ID; the sign-in flow itself comes later
    "sso": {"provider": "entra", "tenant_id": "", "client_id": "", "enabled": False},
    "autostart": False,
    "start_minimized": True,
    "open_browser_on_start": True,
    "log_level": "INFO",
    "log_retention_days": 30,
    "backup_on_start": True,
    "backup_keep": 10,
    "feature_code_regex": r"\b[A-Z]{2,5}-\d{2,6}\b",
    "match_threshold": 0.5,
    "flaky_window": 5,
    "filler_words": "uh, um, uhm, ähm, äh, hmm, basically, you know, like, so so, yeah yeah, okay okay, also also, sozusagen",
    "ai_prompt": (
        "From the transcript below extract, for every new function:\n"
        "1. Function name 2. What it does 3. Who can use it\n"
        "4. Preconditions 5. What must be tested 6. Open questions\n"
        "Answer in {language}. Do not invent anything that is not in the text."
    ),
    "timeline_colors": {
        "sprint": "#2F6FB0", "planning": "#7A5AA6", "review": "#0F7C7C",
        "deployment": "#B4441F", "regtest": "#B07A12", "qa": "#3B8B3B",
        "freeze": "#5B6470", "holiday": "#9AA3AE", "other": "#6B7280",
        "integration": "#2E8A6E", "performance": "#A3456B", "documentation": "#56708F", "protocol": "#7C6A3E",
    },
    # pages left out of the menu (data is kept) and custom menu names
    "hidden_pages": ["transcripts"],
    "page_labels": {},
}

ROLES = ("admin", "editor", "viewer")


def now() -> float:
    return time.time()


def new_id() -> str:
    return uuid.uuid4().hex[:12]


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._migrate()

    # ------------------------------------------------------------------ infra
    @contextmanager
    def tx(self):
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                yield self._conn
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def q(self, sql: str, args: Iterable = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._conn.execute(sql, tuple(args)))

    def close(self):
        with self._lock:
            self._conn.close()

    def _migrate(self):
        with self._lock:
            c = self._conn
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
                CREATE TABLE IF NOT EXISTS records(
                    id TEXT PRIMARY KEY,
                    section TEXT NOT NULL,
                    kind TEXT DEFAULT '',
                    key TEXT DEFAULT '',
                    title TEXT DEFAULT '',
                    body TEXT DEFAULT '',
                    data TEXT DEFAULT '{}',
                    tags TEXT DEFAULT '[]',
                    version INTEGER DEFAULT 1,
                    deleted INTEGER DEFAULT 0,
                    created_at REAL, updated_at REAL,
                    created_by TEXT, updated_by TEXT,
                    import_id TEXT
                );
                CREATE INDEX IF NOT EXISTS ix_records_section ON records(section, deleted);
                CREATE TABLE IF NOT EXISTS history(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts REAL, user TEXT, section TEXT, record_id TEXT,
                    action TEXT, summary TEXT, before TEXT, after TEXT
                );
                CREATE INDEX IF NOT EXISTS ix_history_rec ON history(record_id);
                CREATE INDEX IF NOT EXISTS ix_history_sec ON history(section, ts);
                CREATE TABLE IF NOT EXISTS imports(
                    id TEXT PRIMARY KEY, ts REAL, user TEXT, section TEXT,
                    filename TEXT, mode TEXT, count INTEGER
                );
                CREATE TABLE IF NOT EXISTS users(
                    username TEXT PRIMARY KEY, display TEXT, role TEXT,
                    sections TEXT DEFAULT '["*"]', pw_hash TEXT, pw_salt TEXT,
                    active INTEGER DEFAULT 1, must_change INTEGER DEFAULT 0,
                    created_at REAL, last_login REAL
                );
                CREATE TABLE IF NOT EXISTS sessions(
                    token TEXT PRIMARY KEY, username TEXT, created_at REAL, last_seen REAL
                );
                CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
                """
            )
            c.execute("INSERT OR REPLACE INTO meta VALUES('schema', ?)", (str(SCHEMA_VERSION),))

    # --------------------------------------------------------------- settings
    def get_settings(self) -> dict[str, Any]:
        out = json.loads(json.dumps(DEFAULT_SETTINGS))
        for row in self.q("SELECT key, value FROM settings"):
            try:
                val = json.loads(row["value"])
            except ValueError:
                val = row["value"]
            default = DEFAULT_SETTINGS.get(row["key"])
            # keep defaults for keys added in later versions (e.g. colours of new timeline kinds)
            out[row["key"]] = {**default, **val} if isinstance(default, dict) and default and isinstance(val, dict) else val
        return out

    def set_settings(self, values: dict[str, Any], user: str) -> dict[str, Any]:
        before = self.get_settings()
        changed = {k: v for k, v in values.items() if k in DEFAULT_SETTINGS and before.get(k) != v}
        if not changed:
            return before
        with self.tx() as c:
            for k, v in changed.items():
                c.execute("INSERT OR REPLACE INTO settings VALUES(?, ?)", (k, json.dumps(v)))
            c.execute(
                "INSERT INTO history(ts,user,section,record_id,action,summary,before,after) VALUES(?,?,?,?,?,?,?,?)",
                (now(), user, "settings", "settings", "update", ", ".join(sorted(changed)),
                 json.dumps({k: before.get(k) for k in changed}), json.dumps(changed)),
            )
        return self.get_settings()

    # ---------------------------------------------------------------- records
    @staticmethod
    def row_to_record(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"], "section": row["section"], "kind": row["kind"], "key": row["key"],
            "title": row["title"], "body": row["body"], "data": json.loads(row["data"] or "{}"),
            "tags": json.loads(row["tags"] or "[]"), "version": row["version"],
            "created_at": row["created_at"], "updated_at": row["updated_at"],
            "created_by": row["created_by"], "updated_by": row["updated_by"],
            "import_id": row["import_id"],
        }

    def list_records(self, section: str) -> list[dict[str, Any]]:
        rows = self.q("SELECT * FROM records WHERE section=? AND deleted=0 ORDER BY created_at", (section,))
        return [self.row_to_record(r) for r in rows]

    def get_record(self, rid: str) -> dict[str, Any] | None:
        rows = self.q("SELECT * FROM records WHERE id=?", (rid,))
        return self.row_to_record(rows[0]) if rows else None

    @staticmethod
    def _clean(rec: dict[str, Any]) -> dict[str, Any]:
        tags = rec.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        return {
            "kind": str(rec.get("kind") or ""), "key": str(rec.get("key") or ""),
            "title": str(rec.get("title") or ""), "body": str(rec.get("body") or ""),
            "data": rec.get("data") if isinstance(rec.get("data"), dict) else {},
            "tags": [str(t) for t in tags],
        }

    def _insert(self, c, section: str, rec: dict[str, Any], user: str, import_id: str | None) -> dict[str, Any]:
        clean = self._clean(rec)
        rid = str(rec.get("id") or new_id())
        ts = now()
        c.execute(
            "INSERT INTO records(id,section,kind,key,title,body,data,tags,version,deleted,created_at,updated_at,created_by,updated_by,import_id)"
            " VALUES(?,?,?,?,?,?,?,?,1,0,?,?,?,?,?)",
            (rid, section, clean["kind"], clean["key"], clean["title"], clean["body"],
             json.dumps(clean["data"], ensure_ascii=False), json.dumps(clean["tags"], ensure_ascii=False),
             ts, ts, user, user, import_id),
        )
        after = {"id": rid, **clean}
        c.execute(
            "INSERT INTO history(ts,user,section,record_id,action,summary,before,after) VALUES(?,?,?,?,?,?,?,?)",
            (ts, user, section, rid, "create", clean["title"][:200], None, json.dumps(after, ensure_ascii=False)),
        )
        return after

    def create(self, section: str, rec: dict[str, Any], user: str) -> dict[str, Any]:
        self._check_section(section)
        with self.tx() as c:
            created = self._insert(c, section, rec, user, None)
        return self.get_record(created["id"])  # type: ignore[return-value]

    def update(self, rid: str, rec: dict[str, Any], user: str, expected_version: int | None = None) -> dict[str, Any]:
        current = self.get_record(rid)
        if not current:
            raise KeyError(rid)
        if expected_version is not None and int(expected_version) != current["version"]:
            raise ConflictError(current)
        merged = {**{k: current[k] for k in ("kind", "key", "title", "body", "data", "tags")}, **rec}
        clean = self._clean(merged)
        before = {k: current[k] for k in ("kind", "key", "title", "body", "data", "tags")}
        if clean == before:
            return current
        changed = [k for k in clean if clean[k] != before[k]]
        ts = now()
        with self.tx() as c:
            c.execute(
                "UPDATE records SET kind=?,key=?,title=?,body=?,data=?,tags=?,version=version+1,updated_at=?,updated_by=? WHERE id=?",
                (clean["kind"], clean["key"], clean["title"], clean["body"],
                 json.dumps(clean["data"], ensure_ascii=False), json.dumps(clean["tags"], ensure_ascii=False),
                 ts, user, rid),
            )
            c.execute(
                "INSERT INTO history(ts,user,section,record_id,action,summary,before,after) VALUES(?,?,?,?,?,?,?,?)",
                (ts, user, current["section"], rid, "update", ", ".join(changed),
                 json.dumps(before, ensure_ascii=False), json.dumps(clean, ensure_ascii=False)),
            )
        return self.get_record(rid)  # type: ignore[return-value]

    def delete(self, rid: str, user: str) -> None:
        current = self.get_record(rid)
        if not current:
            raise KeyError(rid)
        with self.tx() as c:
            c.execute("UPDATE records SET deleted=1, updated_at=?, updated_by=? WHERE id=?", (now(), user, rid))
            c.execute(
                "INSERT INTO history(ts,user,section,record_id,action,summary,before,after) VALUES(?,?,?,?,?,?,?,?)",
                (now(), user, current["section"], rid, "delete", current["title"][:200],
                 json.dumps(current, ensure_ascii=False), None),
            )

    def restore(self, history_id: int, user: str) -> dict[str, Any]:
        """Bring a record back to the state stored in one history entry."""
        rows = self.q("SELECT * FROM history WHERE id=?", (history_id,))
        if not rows:
            raise KeyError(history_id)
        h = rows[0]
        if h["section"] not in SECTIONS or h["action"] == "import":
            raise ValueError("this history entry cannot be restored")
        state = json.loads(h["after"] or h["before"] or "{}")
        rid = h["record_id"]
        exists = self.q("SELECT deleted FROM records WHERE id=?", (rid,))
        if exists and exists[0]["deleted"]:
            with self.tx() as c:
                c.execute("UPDATE records SET deleted=0 WHERE id=?", (rid,))
                c.execute(
                    "INSERT INTO history(ts,user,section,record_id,action,summary,before,after) VALUES(?,?,?,?,?,?,?,?)",
                    (now(), user, h["section"], rid, "restore", f"from #{history_id}", None, None),
                )
        if not exists:
            return self.create(h["section"], {**state, "id": rid}, user)
        return self.update(rid, {k: state.get(k) for k in ("kind", "key", "title", "body", "data", "tags") if k in state}, user)

    def import_records(self, section: str, filename: str, records: list[dict[str, Any]], mode: str, user: str) -> dict[str, Any]:
        self._check_section(section)
        if mode not in ("append", "replace", "upsert"):
            raise ValueError("mode must be append, replace or upsert")
        import_id = new_id()
        created = updated = removed = 0
        ts = now()
        with self.tx() as c:
            if mode == "replace":
                for r in c.execute("SELECT * FROM records WHERE section=? AND deleted=0", (section,)).fetchall():
                    c.execute("UPDATE records SET deleted=1, updated_at=?, updated_by=? WHERE id=?", (ts, user, r["id"]))
                    c.execute(
                        "INSERT INTO history(ts,user,section,record_id,action,summary,before,after) VALUES(?,?,?,?,?,?,?,?)",
                        (ts, user, section, r["id"], "delete", f"replaced by import {filename}",
                         json.dumps(self.row_to_record(r), ensure_ascii=False), None),
                    )
                    removed += 1
            existing_by_key: dict[str, sqlite3.Row] = {}
            if mode == "upsert":
                for r in c.execute("SELECT * FROM records WHERE section=? AND deleted=0 AND key<>''", (section,)).fetchall():
                    existing_by_key[r["key"]] = r
            for rec in records:
                key = str(rec.get("key") or "")
                if mode == "upsert" and key and key in existing_by_key:
                    r = existing_by_key[key]
                    before = {k: v for k, v in self.row_to_record(r).items() if k in ("kind", "key", "title", "body", "data", "tags")}
                    clean = self._clean({**before, **rec})
                    if clean != before:
                        c.execute(
                            "UPDATE records SET kind=?,key=?,title=?,body=?,data=?,tags=?,version=version+1,updated_at=?,updated_by=?,import_id=? WHERE id=?",
                            (clean["kind"], clean["key"], clean["title"], clean["body"],
                             json.dumps(clean["data"], ensure_ascii=False), json.dumps(clean["tags"], ensure_ascii=False),
                             ts, user, import_id, r["id"]),
                        )
                        c.execute(
                            "INSERT INTO history(ts,user,section,record_id,action,summary,before,after) VALUES(?,?,?,?,?,?,?,?)",
                            (ts, user, section, r["id"], "import-update", filename,
                             json.dumps(before, ensure_ascii=False), json.dumps(clean, ensure_ascii=False)),
                        )
                        updated += 1
                else:
                    self._insert(c, section, rec, user, import_id)
                    created += 1
            c.execute("INSERT INTO imports VALUES(?,?,?,?,?,?,?)", (import_id, ts, user, section, filename, mode, len(records)))
            c.execute(
                "INSERT INTO history(ts,user,section,record_id,action,summary,before,after) VALUES(?,?,?,?,?,?,?,?)",
                (ts, user, section, import_id, "import",
                 f"{filename}: +{created} ~{updated} -{removed} ({mode})", None, None),
            )
        return {"import_id": import_id, "created": created, "updated": updated, "removed": removed}

    def list_imports(self, section: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        if section:
            rows = self.q("SELECT * FROM imports WHERE section=? ORDER BY ts DESC LIMIT ?", (section, limit))
        else:
            rows = self.q("SELECT * FROM imports ORDER BY ts DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows]

    def history(self, section: str | None = None, record_id: str | None = None,
                user: str | None = None, limit: int = 300) -> list[dict[str, Any]]:
        where, args = [], []
        if section:
            where.append("section=?"); args.append(section)
        if record_id:
            where.append("record_id=?"); args.append(record_id)
        if user:
            where.append("user=?"); args.append(user)
        sql = "SELECT * FROM history" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY id DESC LIMIT ?"
        args.append(int(limit))
        out = []
        for r in self.q(sql, args):
            d = dict(r)
            d["before"] = json.loads(d["before"]) if d["before"] else None
            d["after"] = json.loads(d["after"]) if d["after"] else None
            out.append(d)
        return out

    def counts(self) -> dict[str, int]:
        rows = self.q("SELECT section, COUNT(*) n FROM records WHERE deleted=0 GROUP BY section")
        out = {s: 0 for s in SECTIONS}
        out.update({r["section"]: r["n"] for r in rows})
        return out

    @staticmethod
    def _check_section(section: str):
        if section not in SECTIONS:
            raise ValueError(f"unknown section: {section}")


class ConflictError(Exception):
    def __init__(self, current: dict[str, Any]):
        super().__init__("record changed meanwhile")
        self.current = current
