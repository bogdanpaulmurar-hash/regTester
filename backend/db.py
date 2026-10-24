"""SQLite storage for regTester.

Everything the app keeps lives in one file (regtester.db): records of every
section, their full change history, imports, users, sessions and settings.
By default the file is in the local data folder; with a shared folder the
common data lives there instead (see shared.py) and this machine keeps only
its sessions and machine settings locally. Only the Python standard library
is used.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
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
    # sign out after this many minutes without activity
    "session_idle_minutes": 30,
    # folder on a Windows network share with the common database; empty = data only on this computer
    "shared_path": "",
    # single sign-on, prepared for Microsoft Entra ID; the sign-in flow itself comes later
    "sso": {"provider": "entra", "tenant_id": "", "client_id": "", "enabled": False},
    "autostart": False,
    "start_minimized": True,
    "open_browser_on_start": True,
    "log_level": "INFO",
    "log_retention_days": 30,
    "backup_on_start": True,
    "backup_keep": 10,
    # folder chosen on this computer for backups and exports; empty = the default place
    "backup_dir": "",
    # full JSON export (all data + settings) written next to the backups at every start
    "export_on_start": False,
    "export_keep": 10,
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

# Settings that belong to one computer. With a shared folder they stay in the local database.
LOCAL_KEYS = frozenset({"port", "lan_access", "autostart", "start_minimized", "open_browser_on_start",
                        "log_level", "log_retention_days", "shared_path", "backup_dir", "export_on_start",
                        "export_keep"})

EXPORT_FORMAT = "regtester-export"
EXPORT_VERSION = 1
# record fields compared and written back by a JSON restore
RESTORE_FIELDS = ("kind", "key", "title", "body", "data", "tags")

# Images in text fields (screenshots). Stored once per content (sha256) and referenced from the HTML as
# /api/att/<id>, so the history keeps only the reference and a restored version still shows its images.
ATT_RE = re.compile(r"/api/att/([0-9a-f]{64})")
ATT_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
ATT_MAX = 8 * 1024 * 1024
# Notes written in regTester on imported records (errors, test cases, features): never changed by an import.
KEEP_ON_IMPORT = ("notes",)


class ReadOnlyError(Exception):
    """The data is open read-only (shared folder unreachable, working on the local copy)."""


class BusyError(Exception):
    """Another computer kept the shared folder locked for too long."""


def now() -> float:
    return time.time()


def new_id() -> str:
    return uuid.uuid4().hex[:12]


class Database:
    def __init__(self, path: Path, readonly: bool = False):
        self.path = Path(path)
        self.readonly = readonly
        self._lock = threading.RLock()
        if not readonly:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = self._connect(self.path, readonly)
        if not readonly:
            self._migrate()

    @staticmethod
    def _connect(path: Path, readonly: bool, journal: str = "WAL") -> sqlite3.Connection:
        if readonly:
            conn = sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True,
                                   check_same_thread=False, isolation_level=None)
        else:
            conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None, timeout=15)
            conn.execute(f"PRAGMA journal_mode={journal}")
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=15000")
        return conn

    # ------------------------------------------------------------------ infra
    @contextmanager
    def write_guard(self, user: str = ""):
        """Held around every write. The shared database adds the lock file of the shared folder."""
        if self.readonly:
            raise ReadOnlyError("read only")
        with self._lock:
            yield

    @contextmanager
    def tx(self, user: str = ""):
        with self.write_guard(user):
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield self._conn
                self._conn.execute("COMMIT")
            except Exception:
                try:
                    self._conn.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise

    def q(self, sql: str, args: Iterable = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._conn.execute(sql, tuple(args)))

    def close(self):
        with self._lock:
            self._conn.close()

    def restore_from_file(self, src_path: Path, user: str) -> None:
        """Replace the whole content with a backup file, in place (other connections stay valid)."""
        src = sqlite3.connect(f"{Path(src_path).resolve().as_uri()}?mode=ro", uri=True)
        try:
            with self.write_guard(user):
                src.backup(self._conn)
        finally:
            src.close()
        self._migrate()
        with self.tx(user) as c:
            c.execute(
                "INSERT INTO history(ts,user,section,record_id,action,summary) VALUES(?,?,?,?,?,?)",
                (now(), user, "admin", Path(src_path).name, "backup-restore", Path(src_path).name),
            )

    def data_stamp(self) -> dict[str, Any]:
        """Newest history entry: lets open pages notice changes saved from another computer."""
        rows = self.q("SELECT id, ts, user FROM history ORDER BY id DESC LIMIT 1")
        return dict(rows[0]) if rows else {"id": 0, "ts": None, "user": None}

    def _migrate(self):
        with self.write_guard("migrate"):
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
                CREATE TABLE IF NOT EXISTS attachments(
                    id TEXT PRIMARY KEY, mime TEXT, size INTEGER, data BLOB,
                    created_at REAL, created_by TEXT
                );
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
        with self.tx(user) as c:
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
        with self.tx(user) as c:
            created = self._insert(c, section, rec, user, None)
        return self.get_record(created["id"])  # type: ignore[return-value]

    def update(self, rid: str, rec: dict[str, Any], user: str, expected_version: int | None = None) -> dict[str, Any]:
        with self.tx(user) as c:
            # read inside the write transaction: another computer may have saved a moment ago
            rows = c.execute("SELECT * FROM records WHERE id=?", (rid,)).fetchall()
            if not rows:
                raise KeyError(rid)
            current = self.row_to_record(rows[0])
            if expected_version is not None and int(expected_version) != current["version"]:
                raise ConflictError(current)
            merged = {**{k: current[k] for k in ("kind", "key", "title", "body", "data", "tags")}, **rec}
            clean = self._clean(merged)
            before = {k: current[k] for k in ("kind", "key", "title", "body", "data", "tags")}
            if clean == before:
                return current
            changed = [k for k in clean if clean[k] != before[k]]
            ts = now()
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
        with self.tx(user) as c:
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
            with self.tx(user) as c:
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
        with self.tx(user) as c:
            kept = self._kept_by_key(c, section)
            records = [self._with_kept(rec, kept) for rec in records]
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

    @staticmethod
    def _kept_by_key(c, section: str) -> dict[str, dict[str, Any]]:
        """Fields written in regTester (KEEP_ON_IMPORT) of the current records, by key."""
        out: dict[str, dict[str, Any]] = {}
        for r in c.execute("SELECT key, data FROM records WHERE section=? AND deleted=0 AND key<>''", (section,)).fetchall():
            data = json.loads(r["data"] or "{}")
            keep = {k: data[k] for k in KEEP_ON_IMPORT if data.get(k)}
            if keep:
                out[r["key"]] = keep
        return out

    @staticmethod
    def _with_kept(rec: dict[str, Any], kept: dict[str, dict[str, Any]]) -> dict[str, Any]:
        keep = kept.get(str(rec.get("key") or ""))
        if not keep or not isinstance(rec, dict):
            return rec
        data = rec.get("data") if isinstance(rec.get("data"), dict) else {}
        return {**rec, "data": {**data, **{k: v for k, v in keep.items() if not data.get(k)}}}

    # ------------------------------------------------------------ attachments
    def put_attachment(self, raw: bytes, mime: str, user: str) -> str:
        mime = (mime or "").lower()
        if mime not in ATT_TYPES:
            raise ValueError("att_type")
        if not raw:
            raise ValueError("att_empty")
        if len(raw) > ATT_MAX:
            raise ValueError("att_too_large")
        aid = hashlib.sha256(raw).hexdigest()
        if self.q("SELECT 1 FROM attachments WHERE id=?", (aid,)):
            return aid
        with self.tx(user) as c:
            c.execute("INSERT OR IGNORE INTO attachments VALUES(?,?,?,?,?,?)", (aid, mime, len(raw), raw, now(), user))
        return aid

    def put_data_url(self, data_url: str, user: str) -> str:
        m = re.match(r"^data:(image/[\w.+-]+);base64,(.*)$", str(data_url or ""), re.S)
        if not m:
            raise ValueError("att_type")
        try:
            raw = base64.b64decode(m.group(2), validate=False)
        except ValueError as exc:
            raise ValueError("att_type") from exc
        return self.put_attachment(raw, m.group(1), user)

    def get_attachment(self, aid: str) -> tuple[str, bytes]:
        try:
            rows = self.q("SELECT mime, data FROM attachments WHERE id=?", (aid,))
        except sqlite3.OperationalError:  # an old read-only copy without the table
            rows = []
        if not rows:
            raise KeyError(aid)
        return rows[0]["mime"], bytes(rows[0]["data"])

    @staticmethod
    def att_refs(*texts: Any) -> set[str]:
        out: set[str] = set()
        for t in texts:
            if t:
                out.update(ATT_RE.findall(t if isinstance(t, str) else json.dumps(t, ensure_ascii=False)))
        return out

    def _used_attachments(self) -> set[str]:
        """Images still shown by a record (deleted ones too) or by any version in the history."""
        used: set[str] = set()
        for r in self.q("SELECT body, data FROM records"):
            used |= self.att_refs(r["body"], r["data"])
        for r in self.q("SELECT before, after FROM history WHERE before LIKE '%/api/att/%' OR after LIKE '%/api/att/%'"):
            used |= self.att_refs(r["before"], r["after"])
        return used

    def attachment_stats(self) -> dict[str, Any]:
        try:
            rows = self.q("SELECT id, size FROM attachments")
        except sqlite3.OperationalError:
            rows = []
        used = self._used_attachments()
        unused = [r for r in rows if r["id"] not in used]
        return {"count": len(rows), "bytes": sum(r["size"] or 0 for r in rows),
                "unused": len(unused), "unused_bytes": sum(r["size"] or 0 for r in unused)}

    def cleanup_attachments(self, user: str) -> dict[str, Any]:
        """Remove images nothing refers to any more (not even an old version in the history)."""
        with self.tx(user) as c:
            used = self._used_attachments()
            rows = c.execute("SELECT id, size FROM attachments").fetchall()
            gone = [r for r in rows if r["id"] not in used]
            for r in gone:
                c.execute("DELETE FROM attachments WHERE id=?", (r["id"],))
            size = sum(r["size"] or 0 for r in gone)
            if gone:
                c.execute(
                    "INSERT INTO history(ts,user,section,record_id,action,summary) VALUES(?,?,?,?,?,?)",
                    (now(), user, "admin", "attachments", "att-cleanup", f"{len(gone)} images, {size} bytes"))
        return {"removed": len(gone), "bytes": size}

    def _export_attachments(self, ids: set[str]) -> dict[str, dict[str, str]]:
        out: dict[str, dict[str, str]] = {}
        for aid in sorted(ids):
            try:
                mime, raw = self.get_attachment(aid)
            except KeyError:
                continue
            out[aid] = {"mime": mime, "data": base64.b64encode(raw).decode("ascii")}
        return out

    @staticmethod
    def _file_attachments(data: dict[str, Any]) -> dict[str, tuple[str, bytes]]:
        """Valid images of an export file (the id must match the content)."""
        out: dict[str, tuple[str, bytes]] = {}
        atts = data.get("attachments") if isinstance(data.get("attachments"), dict) else {}
        for aid, a in atts.items():
            if not isinstance(a, dict) or a.get("mime") not in ATT_TYPES:
                continue
            try:
                raw = base64.b64decode(str(a.get("data") or ""))
            except ValueError:
                continue
            if raw and len(raw) <= ATT_MAX and hashlib.sha256(raw).hexdigest() == aid:
                out[aid] = (a["mime"], raw)
        return out

    def _missing_attachments(self, ids: Iterable[str]) -> set[str]:
        ids = set(ids)
        if not ids:
            return set()
        try:
            have = {r["id"] for r in self.q("SELECT id FROM attachments")}
        except sqlite3.OperationalError:
            have = set()
        return ids - have

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

    # ------------------------------------------------------- JSON export / restore
    def export_data(self, user: str, app_version: str) -> dict[str, Any]:
        """Everything needed to rebuild the team data: all records (deleted ones too), settings, import log.
        Users and passwords stay out; the full history is kept in the .db copies."""
        rows = self.q("SELECT * FROM records ORDER BY section, created_at")
        records: dict[str, list[dict[str, Any]]] = {s: [] for s in SECTIONS}
        for r in rows:
            if r["section"] in records:
                records[r["section"]].append({**self.row_to_record(r), "deleted": bool(r["deleted"])})
        settings = {k: v for k, v in self.get_settings().items() if k not in LOCAL_KEYS}
        imports = [dict(r) for r in self.q("SELECT * FROM imports ORDER BY ts")]
        refs = self.att_refs(*(x for recs in records.values() for r in recs for x in (r["body"], r["data"])))
        return {"format": EXPORT_FORMAT, "version": EXPORT_VERSION, "app_version": app_version,
                "exported_at": now(), "exported_by": user, "settings": settings, "records": records, "imports": imports,
                "attachments": self._export_attachments(refs)}

    @staticmethod
    def _check_export(data: Any) -> dict[str, list[dict[str, Any]]]:
        if not isinstance(data, dict) or data.get("format") != EXPORT_FORMAT:
            raise ValueError("export_invalid")
        if int(data.get("version") or 0) > EXPORT_VERSION:
            raise ValueError("export_newer")
        recs = data.get("records")
        if not isinstance(recs, dict):
            raise ValueError("export_invalid")
        return {s: [r for r in v if isinstance(r, dict) and r.get("id")] for s, v in recs.items()
                if s in SECTIONS and isinstance(v, list)}

    def _restore_plan(self, c, section: str, file_recs: list[dict[str, Any]]):
        """Compare one section with the file: (to_create, to_update, to_delete, unchanged)."""
        current = {r["id"]: r for r in c.execute("SELECT * FROM records WHERE section=?", (section,)).fetchall()}
        create, update, delete, same = [], [], [], 0
        wanted = set()
        for rec in file_recs:
            rid = str(rec["id"])
            wanted.add(rid)
            clean = self._clean(rec)
            gone = bool(rec.get("deleted"))
            row = current.get(rid)
            if row is None:
                if not gone:
                    create.append((rid, clean, rec))
                continue
            before = {k: v for k, v in self.row_to_record(row).items() if k in RESTORE_FIELDS}
            if gone:
                if not row["deleted"]:
                    delete.append(row)
                else:
                    same += 1
            elif clean != before or row["deleted"]:
                update.append((row, before, clean))
            else:
                same += 1
        delete += [r for rid, r in current.items() if rid not in wanted and not r["deleted"]]
        return create, update, delete, same

    def restore_preview(self, data: Any) -> dict[str, Any]:
        recs = self._check_export(data)
        out: dict[str, Any] = {}
        c = self._conn
        with self._lock:
            for section in SECTIONS:
                if section not in recs:
                    continue
                cr, up, de, same = self._restore_plan(c, section, recs[section])
                out[section] = {"in_file": sum(1 for r in recs[section] if not r.get("deleted")),
                                "create": len(cr), "update": len(up), "delete": len(de), "same": same}
        file_settings = data.get("settings") if isinstance(data.get("settings"), dict) else {}
        current = self.get_settings()
        changed = sorted(k for k, v in file_settings.items() if k in DEFAULT_SETTINGS and k not in LOCAL_KEYS and current.get(k) != v)
        file_atts = self._file_attachments(data)
        return {"sections": out, "settings": changed, "images": len(self._missing_attachments(file_atts)),
                "exported_at": data.get("exported_at"),
                "exported_by": data.get("exported_by"), "app_version": data.get("app_version")}

    def restore_export(self, data: Any, sections: Iterable[str], with_settings: bool, user: str, label: str) -> dict[str, Any]:
        """Make the chosen sections match the file. Every change is a normal history entry, so it can be undone."""
        recs = self._check_export(data)
        chosen = [s for s in SECTIONS if s in set(sections) and s in recs]
        totals = {"created": 0, "updated": 0, "deleted": 0}
        ts = now()
        hist = "INSERT INTO history(ts,user,section,record_id,action,summary,before,after) VALUES(?,?,?,?,?,?,?,?)"
        file_atts = self._file_attachments(data)
        wanted = self.att_refs(*(x for s in chosen for r in recs[s] for x in (r.get("body"), r.get("data"))))
        images = 0
        with self.tx(user) as c:
            for aid in sorted(wanted & set(file_atts)):
                mime, raw = file_atts[aid]
                images += c.execute("INSERT OR IGNORE INTO attachments VALUES(?,?,?,?,?,?)",
                                    (aid, mime, len(raw), raw, ts, user)).rowcount
            for section in chosen:
                cr, up, de, _ = self._restore_plan(c, section, recs[section])
                for rid, clean, rec in cr:
                    created_at = rec.get("created_at") if isinstance(rec.get("created_at"), (int, float)) else ts
                    c.execute(
                        "INSERT INTO records(id,section,kind,key,title,body,data,tags,version,deleted,created_at,updated_at,created_by,updated_by,import_id)"
                        " VALUES(?,?,?,?,?,?,?,?,1,0,?,?,?,?,NULL)",
                        (rid, section, clean["kind"], clean["key"], clean["title"], clean["body"],
                         json.dumps(clean["data"], ensure_ascii=False), json.dumps(clean["tags"], ensure_ascii=False),
                         created_at, ts, str(rec.get("created_by") or user), user))
                    c.execute(hist, (ts, user, section, rid, "create", clean["title"][:200], None,
                                     json.dumps({"id": rid, **clean}, ensure_ascii=False)))
                for row, before, clean in up:
                    c.execute(
                        "UPDATE records SET kind=?,key=?,title=?,body=?,data=?,tags=?,deleted=0,version=version+1,updated_at=?,updated_by=? WHERE id=?",
                        (clean["kind"], clean["key"], clean["title"], clean["body"],
                         json.dumps(clean["data"], ensure_ascii=False), json.dumps(clean["tags"], ensure_ascii=False),
                         ts, user, row["id"]))
                    c.execute(hist, (ts, user, section, row["id"], "update", f"{label}: " + ", ".join(k for k in clean if clean[k] != before[k]) or label,
                                     json.dumps(before, ensure_ascii=False), json.dumps(clean, ensure_ascii=False)))
                for row in de:
                    c.execute("UPDATE records SET deleted=1, updated_at=?, updated_by=? WHERE id=?", (ts, user, row["id"]))
                    c.execute(hist, (ts, user, section, row["id"], "delete", f"{label}: {row['title'][:180]}",
                                     json.dumps(self.row_to_record(row), ensure_ascii=False), None))
                totals["created"] += len(cr); totals["updated"] += len(up); totals["deleted"] += len(de)
                c.execute(hist, (ts, user, section, label, "import",
                                 f"{label}: +{len(cr)} ~{len(up)} -{len(de)} (restore)", None, None))
        changed_settings: list[str] = []
        if with_settings and isinstance(data.get("settings"), dict):
            values = {k: v for k, v in data["settings"].items() if k in DEFAULT_SETTINGS and k not in LOCAL_KEYS}
            before = self.get_settings()
            changed_settings = sorted(k for k, v in values.items() if before.get(k) != v)
            if changed_settings:
                self.set_settings(values, user)
        return {**totals, "sections": chosen, "settings": changed_settings, "images": images}

    @staticmethod
    def _check_section(section: str):
        if section not in SECTIONS:
            raise ValueError(f"unknown section: {section}")


class ConflictError(Exception):
    def __init__(self, current: dict[str, Any]):
        super().__init__("record changed meanwhile")
        self.current = current
