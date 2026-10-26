"""HTTP server: JSON API under /api and the PWA from /web. Standard library only."""
from __future__ import annotations

import base64
import json
import logging
import mimetypes
import os
import platform
import re
import socket
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, unquote, urlparse

from . import __version__, system
from .auth import Auth
from .db import SECTIONS, BusyError, ConflictError, Database, ReadOnlyError
from .shared import SharedDatabase, SharedUnavailable, check_folder, create_shared

LOG = logging.getLogger("regtester.server")
MAX_BODY = 60 * 1024 * 1024

# Which page (permission unit) a storage section belongs to.
PAGE_OF = {
    "timeline": "timeline", "features": "coverage", "tests": "coverage", "runs": "triage",
    "known": "triage", "errors": "triage", "errsnaps": "triage", "transcripts": "transcripts", "glossary": "transcripts",
    "docs": "docs", "templates": "docs", "specs": "specs",
}
PAGES = ("dashboard", "reports", "timeline", "coverage", "triage", "transcripts", "docs", "specs")

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")


class ApiError(Exception):
    def __init__(self, status: int, message: str, extra: dict | None = None):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra or {}


def _must(value, key):
    if value is None:
        raise KeyError(key)
    return value


class AppContext:
    """Shared state for request handlers.

    `local` is the database in this computer's data folder: sessions and machine settings, and all
    data when no shared folder is set. `db` is where the data lives: `local`, or the shared database.
    """

    def __init__(self, data_dir: Path, web_dir: Path):
        self.data_dir = data_dir
        self.web_dir = web_dir
        self.local_path = data_dir / "regtester.db"
        self.local_backup_dir = data_dir / "backups"
        self.log_dir = data_dir / "logs"
        self.local = Database(self.local_path)
        self.switch_lock = threading.RLock()
        self.shared_error = ""
        self.db: Database = self.local
        self._open_data()
        self.auth = Auth(self.db, self.local)
        settings = self.db.get_settings()
        self.log_file = system.setup_logging(self.log_dir, settings["log_level"], settings["log_retention_days"])
        self.started = time.time()
        self.on_logo_changed: Callable[[], None] | None = None
        self.on_quit: Callable[[], None] | None = None
        self.bound_host = "127.0.0.1"
        self.bound_port = settings["port"]

    # ------------------------------------------------------------ data location
    def _open_data(self) -> None:
        """Open the shared folder from the machine settings, or fall back as well as possible."""
        path = str(self.local.get_settings().get("shared_path") or "")
        self.shared_error = ""
        if not path:
            self.db = self.local
            return
        try:
            self.db = SharedDatabase(Path(path), self.local)
        except SharedUnavailable as exc:
            # never connected from here, so no copy yet: show this computer's data, read-only
            self.shared_error = str(exc)
            LOG.error("Shared folder %s not reachable and no local copy: %s", path, exc)
            self.db = Database(self.local_path, readonly=True)

    @property
    def shared(self) -> SharedDatabase | None:
        return self.db if isinstance(self.db, SharedDatabase) else None

    @property
    def db_path(self) -> Path:
        return self.shared.path if self.shared else self.local_path

    @property
    def backup_dir(self) -> Path:
        """Team copies: the shared folder when connected, otherwise this computer's default place."""
        return self.shared.folder / "backups" if self.shared else self.local_backup_dir

    @property
    def chosen_backup_dir(self) -> Path | None:
        """Folder chosen on this computer (Administration › Backups), if any."""
        path = str(self.db.get_settings().get("backup_dir") or "").strip()
        return Path(path) if path else None

    @property
    def user_backup_dir(self) -> Path:
        """Where manual copies and exports go: the chosen folder, otherwise the team place."""
        return self.chosen_backup_dir or self.backup_dir

    def backup_places(self) -> dict[str, Path]:
        places = {"team": self.backup_dir}
        chosen = self.chosen_backup_dir
        if chosen and chosen.resolve() != self.backup_dir.resolve():
            places["chosen"] = chosen
        return places

    def shared_status(self, admin: bool = False) -> dict[str, Any]:
        if self.shared:
            st = self.shared.status()
            if admin:
                st["machines"] = self.shared.presence()
        elif self.shared_error:
            st = {"mode": "unavailable", "path": self.local.get_settings().get("shared_path"), "online": False,
                  "copy_ts": None, "writer": None, "error": self.shared_error}
        else:
            st = {"mode": "local", "online": True}
        try:
            st["stamp"] = self.db.data_stamp()
        except Exception:  # noqa: BLE001
            st["stamp"] = None
        return st

    def _swap(self, db: Database) -> None:
        with self.switch_lock:
            old, self.db = self.db, db
            self.auth = Auth(db, self.local)
            if old is not self.local and old is not db:
                try:
                    old.close()
                except Exception:  # noqa: BLE001
                    pass

    def connect_shared(self, path: str, init: str | None, user: str) -> dict[str, Any]:
        info = check_folder(path)
        if not info["exists"]:
            raise ValueError("shared_not_found")
        if not info["writable"]:
            raise ValueError("shared_not_writable")
        folder = Path(info["path"])
        if not info["has_db"]:
            if init not in ("copy", "empty"):
                raise ValueError("shared_init_required")
            system.backup_database(self.db_path, self.local_backup_dir, 1000)  # safety copy first
            source = self.db if not self.db.readonly else self.local
            create_shared(folder, source, init, user)
        db = SharedDatabase(folder, self.local)
        if not db.online:
            raise ValueError(db.last_error or "shared_not_found")
        self._swap(db)
        self.shared_error = ""
        self.local.set_settings({"shared_path": str(folder)}, user)
        with db.tx(user) as c:
            c.execute("INSERT INTO history(ts,user,section,record_id,action,summary) VALUES(?,?,?,?,?,?)",
                      (time.time(), user, "admin", "shared", "shared-connect", f"{db.host}: {folder}"))
        self.auth.drop_sessions()  # accounts may differ: everyone signs in again with the shared ones
        db.report_presence([])
        LOG.warning("%s connected this computer to the shared folder %s", user, folder)
        return self.shared_status(True)

    def disconnect_shared(self, user: str) -> None:
        if self.shared and self.shared.online:
            try:
                with self.shared.tx(user) as c:
                    c.execute("INSERT INTO history(ts,user,section,record_id,action,summary) VALUES(?,?,?,?,?,?)",
                              (time.time(), user, "admin", "shared", "shared-disconnect", self.shared.host))
            except (ReadOnlyError, BusyError):
                pass
        self.local.set_settings({"shared_path": ""}, user)
        self._swap(self.local)
        self.shared_error = ""
        self.auth.drop_sessions()
        LOG.warning("%s switched this computer back to local data", user)

    def unlock_shared(self, user: str) -> dict[str, Any] | None:
        if not self.shared:
            raise ValueError("not connected to a shared folder")
        held = self.shared.lock.force_release()
        LOG.warning("%s removed the lock of the shared folder (held by %s)", user, held)
        with self.shared.tx(user) as c:
            c.execute("INSERT INTO history(ts,user,section,record_id,action,summary) VALUES(?,?,?,?,?,?)",
                      (time.time(), user, "admin", "shared", "shared-unlock",
                       f"{(held or {}).get('user') or '-'} @ {(held or {}).get('host') or '-'}"))
        if held:
            held.pop("token", None)
        return held

    def startup_backup(self, settings: dict[str, Any]) -> None:
        """Local data: every start. Shared folder: the first start of the day on any computer.
        A folder chosen on this computer gets its own daily copy and, if enabled, a daily JSON export."""
        if self.db.readonly:
            return
        today = time.strftime("%Y%m%d")
        done_today = lambda folder, ext: folder.exists() and any(folder.glob(f"regtester-{today}-*.{ext}"))  # noqa: E731
        if settings["backup_on_start"]:
            if self.shared:
                if not done_today(self.backup_dir, "db"):
                    with self.shared.lock.held("backup"):
                        system.backup_database(self.db_path, self.backup_dir, settings["backup_keep"])
            else:
                system.backup_database(self.db_path, self.backup_dir, settings["backup_keep"])
            chosen = self.backup_places().get("chosen")
            if chosen and not done_today(chosen, "db"):
                try:
                    system.backup_database(self.db_path, chosen, settings["backup_keep"])
                except OSError as exc:
                    LOG.error("Backup to the chosen folder %s failed: %s", chosen, exc)
        if settings.get("export_on_start") and not done_today(self.user_backup_dir, "json"):
            try:
                system.write_export(self.db.export_data("startup", __version__), self.user_backup_dir, settings["export_keep"])
            except OSError as exc:
                LOG.error("Export on start to %s failed: %s", self.user_backup_dir, exc)

    def start_monitor(self) -> None:
        threading.Thread(target=self._monitor, name="shared-monitor", daemon=True).start()

    def _monitor(self) -> None:
        tick = 0
        while True:
            time.sleep(10)
            tick += 10
            try:
                if self.shared:
                    self.shared.check()
                    if tick % 60 == 10:
                        self.shared.report_presence(self.auth.active_users())
                    if tick % 600 == 0:
                        self.shared.refresh_copy()
                elif self.shared_error and tick % 30 == 0:
                    path = str(self.local.get_settings().get("shared_path") or "")
                    if path:
                        try:
                            db = SharedDatabase(Path(path), self.local)
                        except SharedUnavailable:
                            continue
                        self._swap(db)
                        self.shared_error = ""
                        LOG.info("Shared folder reachable: %s", path)
            except Exception:  # noqa: BLE001
                LOG.exception("Shared folder check failed")

    @property
    def logo_path(self) -> Path:
        custom = self.data_dir / "logo.png"
        return custom if custom.exists() else self.web_dir / "icons" / "icon-512.png"


def make_handler(ctx: AppContext):
    class Handler(BaseHTTPRequestHandler):
        server_version = f"regTester/{__version__}"
        protocol_version = "HTTP/1.1"

        # ----------------------------------------------------------- plumbing
        def log_message(self, fmt, *args):  # route http.server noise to DEBUG
            LOG.debug("%s %s", self.address_string(), fmt % args)

        def _send(self, status: int, body: bytes, ctype: str, headers: dict | None = None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, payload: Any, status: int = 200):
            self._send(status, json.dumps(payload, ensure_ascii=False, default=str).encode(), "application/json; charset=utf-8",
                       {"Cache-Control": "no-store"})

        def _body(self) -> Any:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                raise ApiError(413, "payload too large")
            raw = self.rfile.read(length) if length else b""
            if not raw:
                return {}
            try:
                return json.loads(raw)
            except ValueError as exc:
                raise ApiError(400, "invalid JSON") from exc

        def _token(self) -> str | None:
            h = self.headers.get("Authorization") or ""
            if h.startswith("Bearer "):
                return h[7:]
            # <img> tags cannot send the header: images in text fields use a cookie limited to /api/att/
            if self.command in ("GET", "HEAD") and getattr(self, "_path", "").startswith("/api/att/"):
                for part in (self.headers.get("Cookie") or "").split(";"):
                    name, _, value = part.strip().partition("=")
                    if name == "rt_token" and value:
                        return value
            return None

        def _is_local(self) -> bool:
            return self.client_address[0] in ("127.0.0.1", "::1")

        def _user(self, required: bool = True, touch: bool = True) -> dict | None:
            user = ctx.auth.user_for_token(self._token(), touch)
            if user:
                return user
            settings = ctx.db.get_settings()
            if not settings["require_login"] and self._is_local():
                return {"username": "local", "display": "Local", "role": "admin", "sections": ["*"],
                        "active": True, "must_change": False}
            if required:
                raise ApiError(401, "login required")
            return None

        def _need(self, user: dict, section: str, write: bool = False):
            page = PAGE_OF.get(section, section)
            if not ctx.auth.can(user, page, write):
                raise ApiError(403, "forbidden")

        def _admin(self, user: dict):
            if user["role"] != "admin":
                raise ApiError(403, "admin only")

        # ------------------------------------------------------------- verbs
        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            self._dispatch("GET")

        def do_POST(self):
            self._dispatch("POST")

        def do_PUT(self):
            self._dispatch("PUT")

        def do_DELETE(self):
            self._dispatch("DELETE")

        def _dispatch(self, method: str):
            url = urlparse(self.path)
            path = unquote(url.path)
            self._path = path
            query = {k: v[-1] for k, v in parse_qs(url.query).items()}
            try:
                if path.startswith("/api/"):
                    self._api(method, path[5:].strip("/").split("/"), query)
                elif method in ("GET", "HEAD"):
                    self._static(path)
                else:
                    raise ApiError(405, "method not allowed")
            except ApiError as exc:
                if exc.status >= 500:
                    LOG.error("%s %s -> %s", method, path, exc.message)
                self._json({"error": exc.message, **exc.extra}, exc.status)
            except ConflictError as exc:
                self._json({"error": "conflict", "current": exc.current}, 409)
            except ReadOnlyError:
                self._json({"error": "read_only", "code": "read_only"}, 503)
            except BusyError as exc:
                LOG.warning("%s %s -> %s", method, path, exc)
                self._json({"error": "busy", "code": "busy"}, 503)
            except SharedUnavailable:
                self._json({"error": "shared_unavailable", "code": "shared_unavailable"}, 503)
            except KeyError as exc:
                self._json({"error": f"not found: {exc}"}, 404)
            except ValueError as exc:
                self._json({"error": str(exc)}, 400)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as exc:  # noqa: BLE001
                LOG.exception("Unhandled error on %s %s", method, path)
                self._json({"error": f"server error: {exc}"}, 500)

        # ------------------------------------------------------------ static
        def _static(self, path: str):
            if path in ("/logo.png", "/favicon.png"):
                self._send(200, ctx.logo_path.read_bytes(), "image/png", {"Cache-Control": "no-cache"})
                return
            rel = path.lstrip("/") or "index.html"
            target = (ctx.web_dir / rel).resolve()
            if ctx.web_dir.resolve() not in target.parents and target != ctx.web_dir.resolve():
                raise ApiError(404, "not found")
            if not target.is_file():
                target = ctx.web_dir / "index.html"  # single page app fallback
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype.endswith(("javascript", "json", "manifest+json")):
                ctype += "; charset=utf-8"
            cache = "no-cache"
            self._send(200, target.read_bytes(), ctype, {"Cache-Control": cache})

        # --------------------------------------------------------------- API
        def _api(self, method: str, parts: list[str], q: dict[str, str]):
            head = parts[0] if parts else ""
            arg = parts[1] if len(parts) > 1 else None

            if head == "health":
                self._json({"ok": True, "app": "regTester", "version": __version__}); return

            if head == "handover" and method == "POST":
                # a newer/other copy started on this computer wants the port: leave only for a different version
                if not self._is_local():
                    self._json({"error": "forbidden"}, 403); return
                other = str(self._body().get("version", ""))
                if not other or other == __version__ or not ctx.on_quit:
                    self._json({"ok": False, "version": __version__}); return
                LOG.info("Handing the port over to regTester %s started on this computer", other)
                self._json({"ok": True, "version": __version__})
                threading.Timer(0.3, ctx.on_quit).start()
                return

            if head == "login" and method == "POST":
                body = self._body()
                res = ctx.auth.login(body.get("username", ""), body.get("password", ""))
                if not res:
                    LOG.warning("Failed login for '%s' from %s", body.get("username"), self.client_address[0])
                    raise ApiError(401, "wrong username or password")
                LOG.info("Login: %s from %s", res[1]["username"], self.client_address[0])
                self._json({"token": res[0], "user": res[1]}); return

            if head == "logout" and method == "POST":
                tok = self._token()
                if tok:
                    ctx.auth.logout(tok)
                self._json({"ok": True}); return

            if head == "shared" and arg == "setup" and method == "POST":
                # first start on a colleague's computer: join an existing shared folder from the login screen
                if not self._is_local():
                    raise ApiError(403, "only on the computer running regTester")
                if ctx.shared:
                    raise ApiError(400, "already connected to a shared folder")
                path = str(self._body().get("path") or "")
                info = check_folder(path)
                if info["exists"] and info["writable"] and not info["has_db"]:
                    raise ValueError("shared_no_db")
                self._json(ctx.connect_shared(path, None, f"setup@{system.lan_host()}")); return

            if head == "public-settings":
                s = ctx.db.get_settings()
                out = {k: s[k] for k in ("language", "theme", "app_name", "require_login")}
                out["shared_mode"] = ctx.shared_status()["mode"]
                self._json(out); return

            user = self._user(touch=not ((head == "shared" and method == "GET") or (head == "att" and method in ("GET", "HEAD"))))
            assert user is not None

            if head == "shared":
                if method == "GET":
                    self._json(ctx.shared_status(user["role"] == "admin")); return
                self._admin(user)
                body = self._body()
                if arg == "check":
                    self._json(check_folder(body.get("path", ""))); return
                if arg == "connect":
                    self._json(ctx.connect_shared(str(body.get("path") or ""), body.get("init"), user["username"])); return
                if arg == "disconnect":
                    ctx.disconnect_shared(user["username"]); self._json({"ok": True}); return
                if arg == "unlock":
                    self._json({"held": ctx.unlock_shared(user["username"])}); return

            if head == "me":
                if method == "PUT":  # own password / display name
                    body = self._body()
                    if user["username"] == "local":
                        raise ApiError(400, "no account")
                    if body.get("password"):
                        rows = ctx.db.q("SELECT * FROM users WHERE username=?", (user["username"],))
                        from .auth import check_password
                        if not check_password(body.get("old_password", ""), rows[0]["pw_hash"], rows[0]["pw_salt"]):
                            raise ApiError(400, "wrong current password")
                    upd = {k: body[k] for k in ("display", "password") if body.get(k)}
                    if "password" in upd:
                        upd["must_change"] = False
                    user = ctx.auth.update_user(user["username"], upd, user["username"])
                self._json({"user": user, "pages": [p for p in PAGES if ctx.auth.can(user, p)]}); return

            if head == "att":
                if method in ("GET", "HEAD") and arg and arg != "stats":
                    if not re.fullmatch(r"[0-9a-f]{64}", arg):
                        raise ApiError(404, "not found")
                    mime, raw = ctx.db.get_attachment(arg)
                    self._send(200, raw, mime, {"Cache-Control": "private, max-age=31536000, immutable"}); return
                if method == "GET" and arg == "stats":
                    self._admin(user)
                    self._json(ctx.db.attachment_stats()); return
                if method == "POST" and arg == "cleanup":
                    self._admin(user)
                    res = ctx.db.cleanup_attachments(user["username"])
                    LOG.info("%s removed %s unused images (%s bytes)", user["username"], res["removed"], res["bytes"])
                    self._json(res); return
                if method == "POST" and not arg:
                    if user["role"] == "viewer":
                        raise ApiError(403, "forbidden")
                    aid = ctx.db.put_data_url(str(self._body().get("data_url") or ""), user["username"])
                    self._json({"id": aid, "url": f"/api/att/{aid}"}, 201); return

            if head == "records":
                if method == "GET":
                    section = q.get("section", "")
                    if section not in SECTIONS:
                        raise ApiError(400, "unknown section")
                    self._need(user, section)
                    self._json(ctx.db.list_records(section)); return
                if method == "POST":
                    body = self._body()
                    section = body.get("section", "")
                    self._need(user, section, True)
                    rec = ctx.db.create(section, body.get("record") or {}, user["username"])
                    LOG.info("%s created %s/%s '%s'", user["username"], section, rec["id"], rec["title"][:60])
                    self._json(rec, 201); return
                if arg and method == "PUT":
                    cur = _must(ctx.db.get_record(arg), arg)
                    self._need(user, cur["section"], True)
                    body = self._body()
                    rec = ctx.db.update(arg, body.get("record") or {}, user["username"], body.get("version"))
                    LOG.info("%s updated %s/%s v%s", user["username"], rec["section"], arg, rec["version"])
                    self._json(rec); return
                if arg and method == "DELETE":
                    cur = _must(ctx.db.get_record(arg), arg)
                    self._need(user, cur["section"], True)
                    ctx.db.delete(arg, user["username"])
                    LOG.info("%s deleted %s/%s", user["username"], cur["section"], arg)
                    self._json({"ok": True}); return

            if head == "import" and method == "POST":
                body = self._body()
                section = body.get("section", "")
                self._need(user, section, True)
                recs = body.get("records") or []
                if not isinstance(recs, list):
                    raise ApiError(400, "records must be a list")
                res = ctx.db.import_records(section, str(body.get("filename") or "upload"), recs,
                                            body.get("mode") or "append", user["username"])
                LOG.info("%s imported %s into %s: %s", user["username"], body.get("filename"), section, res)
                self._json(res); return

            if head == "imports":
                section = q.get("section")
                if section:
                    self._need(user, section)
                self._json(ctx.db.list_imports(section)); return

            if head == "history":
                if method == "POST" and arg == "restore":
                    body = self._body()
                    hid = int(body.get("history_id"))
                    h = ctx.db.q("SELECT section FROM history WHERE id=?", (hid,))
                    if not h:
                        raise KeyError(hid)
                    self._need(user, h[0]["section"], True)
                    rec = ctx.db.restore(hid, user["username"])
                    LOG.info("%s restored record %s from history #%s", user["username"], rec["id"], hid)
                    self._json(rec); return
                section = q.get("section")
                if section and section not in ("settings", "admin"):
                    self._need(user, section)
                elif section in ("settings", "admin") or not section:
                    if user["role"] != "admin" and not section:
                        entries = [h for h in ctx.db.history(None, q.get("record_id"), q.get("user"), int(q.get("limit", 300)))
                                   if ctx.auth.can(user, PAGE_OF.get(h["section"], h["section"]))]
                        self._json(entries); return
                    if section in ("settings", "admin"):
                        self._admin(user)
                self._json(ctx.db.history(section, q.get("record_id"), q.get("user"), int(q.get("limit", 300)))); return

            if head == "settings":
                if method == "GET":
                    s = ctx.db.get_settings()
                    s["autostart"] = system.autostart_enabled() if system.is_windows() else s["autostart"]
                    self._json(s); return
                if method == "PUT":
                    body = self._body()
                    body.pop("shared_path", None)  # only through /api/shared/connect
                    sensitive = {"port", "lan_access", "require_login", "sso", "log_retention_days", "backup_keep",
                                 "session_idle_minutes", "backup_dir", "export_on_start", "export_keep"}
                    if user["role"] != "admin" and sensitive.intersection(body):
                        raise ApiError(403, "admin only")
                    if user["role"] == "viewer":
                        raise ApiError(403, "forbidden")
                    before = ctx.db.get_settings()
                    if str(body.get("backup_dir") or "").strip():
                        chk = system.check_backup_folder(str(body["backup_dir"]))
                        if not chk["ok"]:
                            raise ApiError(400, chk["error"])
                        body["backup_dir"] = chk["path"]
                    if isinstance(body.get("sso"), dict):
                        body["sso"]["enabled"] = False  # sign-in with Microsoft is not available yet
                    if "autostart" in body:
                        system.set_autostart(bool(body["autostart"]))
                    s = ctx.db.set_settings(body, user["username"])
                    if s["log_level"] != before["log_level"]:
                        system.set_log_level(s["log_level"])
                    restart = any(s[k] != before[k] for k in ("port", "lan_access"))
                    LOG.info("%s changed settings: %s", user["username"], ", ".join(k for k in body if before.get(k) != s.get(k)) or "-")
                    self._json({"settings": s, "restart_required": restart}); return

            if head == "logs":
                if method == "POST":  # client side events
                    body = self._body()
                    lvl = getattr(logging, str(body.get("level", "INFO")).upper(), logging.INFO)
                    logging.getLogger("regtester.client").log(lvl, "[%s] %s", user["username"], str(body.get("message", ""))[:2000])
                    self._json({"ok": True}); return
                self._json(system.read_log(ctx.log_file, int(q.get("limit", 500)), q.get("level"), q.get("q"))); return

            if head == "system":
                if arg == "quit" and method == "POST":
                    self._admin(user)
                    LOG.info("Shutdown requested by %s", user["username"])
                    self._json({"ok": True})
                    if ctx.on_quit:
                        threading.Timer(0.3, ctx.on_quit).start()
                    return
                self._json({
                    "version": __version__, "python": sys.version.split()[0], "platform": platform.platform(),
                    "windows": system.is_windows(), "autostart": system.autostart_enabled(),
                    "data_dir": str(ctx.data_dir), "log_file": str(ctx.log_file),
                    "uptime": time.time() - ctx.started, "counts": ctx.db.counts(),
                    "host": ctx.bound_host, "port": ctx.bound_port,
                    "lan_urls": [f"http://{ip}:{ctx.bound_port}" for ip in system.lan_addresses()]
                    if ctx.bound_host == "0.0.0.0" else [],
                    "tray": ctx.on_logo_changed is not None,
                    "shared": ctx.shared_status(user["role"] == "admin"),
                }); return

            if head == "logo" and method == "POST":
                if user["role"] == "viewer":
                    raise ApiError(403, "forbidden")
                body = self._body()
                data = str(body.get("data_url") or "")
                if body.get("reset"):
                    (ctx.data_dir / "logo.png").unlink(missing_ok=True)
                else:
                    if not data.startswith("data:image/png;base64,"):
                        raise ApiError(400, "logo must be a PNG")
                    raw = base64.b64decode(data.split(",", 1)[1])
                    if len(raw) > 2 * 1024 * 1024:
                        raise ApiError(400, "logo too large")
                    (ctx.data_dir / "logo.png").write_bytes(raw)
                LOG.info("%s changed the logo", user["username"])
                if ctx.on_logo_changed:
                    ctx.on_logo_changed()
                self._json({"ok": True}); return

            if head == "users":
                self._admin(user)
                if method == "GET":
                    self._json(ctx.auth.list_users()); return
                if method == "POST":
                    u = ctx.auth.create_user(self._body(), user["username"])
                    LOG.info("%s created user %s (%s)", user["username"], u["username"], u["role"])
                    self._json(u, 201); return
                if arg and method == "PUT":
                    u = ctx.auth.update_user(arg, self._body(), user["username"])
                    LOG.info("%s updated user %s", user["username"], arg)
                    self._json(u); return
                if arg and method == "DELETE":
                    ctx.auth.delete_user(arg, user["username"])
                    LOG.info("%s deleted user %s", user["username"], arg)
                    self._json({"ok": True}); return

            if head == "backups":
                self._admin(user)
                places = ctx.backup_places()

                def place_dir(body: dict) -> Path:
                    place = str(body.get("place") or "team")
                    if place not in places:
                        raise ApiError(404, "unknown backup place")
                    return places[place]

                def export_source(body: dict) -> Any:
                    """The export to look at: sent in the request (a file picked in the browser) or a listed file."""
                    if isinstance(body.get("data"), dict):
                        return body["data"]
                    try:
                        src = system.backup_path(str(body.get("name") or ""), place_dir(body))
                        if src.suffix != ".json":
                            raise KeyError(src.name)
                        return json.loads(src.read_text(encoding="utf-8"))
                    except (KeyError, OSError, ValueError) as exc:
                        raise ApiError(400, "export_invalid") from exc

                if method == "GET" and not arg:
                    out = []
                    for place, folder in places.items():
                        try:
                            files = system.list_backups(folder)
                            error = ""
                        except OSError:
                            files, error = [], "backup_dir_not_writable"
                        out.append({"place": place, "dir": str(folder), "files": files, "error": error,
                                    "cloud": system.cloud_provider(folder)})
                    s = ctx.db.get_settings()
                    self._json({"places": out, "backup_dir": s["backup_dir"], "export_on_start": s["export_on_start"],
                                "export_keep": s["export_keep"], "backup_keep": s["backup_keep"],
                                "can_pick": self._is_local()}); return
                if method == "POST" and arg == "check":
                    self._json(system.check_backup_folder(str(self._body().get("path") or ""))); return
                if method == "POST" and arg == "pick":
                    if not self._is_local():
                        raise ApiError(403, "only on the computer running regTester")
                    body = self._body()
                    picked = system.pick_folder(str(body.get("initial") or ""), str(body.get("title") or "regTester"))
                    if picked is None:
                        raise ApiError(501, "folder_dialog_unavailable")
                    self._json({"path": picked, "check": system.check_backup_folder(picked) if picked else None}); return
                if method == "POST" and arg == "export":
                    body = self._body()
                    data = ctx.db.export_data(user["username"], __version__)
                    if isinstance(body.get("prefs"), dict):
                        data["prefs"] = {k: v for k, v in body["prefs"].items() if isinstance(k, str) and k != "token"}
                    if body.get("target") == "download":
                        LOG.info("%s downloaded a full export", user["username"])
                        self._json(data); return
                    s = ctx.db.get_settings()
                    p = system.write_export(data, ctx.user_backup_dir, s["export_keep"])
                    self._json({"name": p.name, "dir": str(p.parent)}); return
                if method == "POST" and arg == "preview":
                    try:
                        self._json(ctx.db.restore_preview(export_source(self._body()))); return
                    except ValueError as exc:
                        raise ApiError(400, str(exc)) from exc
                if ctx.db.readonly:
                    raise ReadOnlyError("read only")
                if method == "POST" and arg == "restore-json":
                    body = self._body()
                    data = export_source(body)
                    label = str(body.get("name") or body.get("label") or "export")[:120]
                    system.backup_database(ctx.db_path, ctx.backup_dir, 1000)  # safety copy first
                    try:
                        res = ctx.db.restore_export(data, body.get("sections") or [], bool(body.get("settings")), user["username"], label)
                    except ValueError as exc:
                        raise ApiError(400, str(exc)) from exc
                    LOG.warning("%s restored %s from JSON %s: %s", user["username"], ", ".join(res["sections"]) or "-", label, res)
                    res["prefs"] = data.get("prefs") if body.get("prefs") and isinstance(data.get("prefs"), dict) else None
                    self._json(res); return
                if method == "POST" and arg == "restore":
                    body = self._body()
                    name = body.get("name", "")
                    src = system.backup_path(name, place_dir(body))
                    if src.suffix != ".db":
                        raise ApiError(400, "not a database copy")
                    system.backup_database(ctx.db_path, ctx.backup_dir, 1000)  # safety copy first
                    ctx.db.restore_from_file(src, user["username"])
                    LOG.warning("%s restored backup %s", user["username"], name)
                    self._json({"ok": True}); return
                if method == "POST" and not arg:
                    s = ctx.db.get_settings()
                    if ctx.shared:
                        with ctx.shared.lock.held(user["username"]):
                            p = system.backup_database(ctx.db_path, ctx.user_backup_dir, s["backup_keep"])
                    else:
                        p = system.backup_database(ctx.db_path, ctx.user_backup_dir, s["backup_keep"])
                    self._json({"name": p.name, "dir": str(p.parent)}); return

            raise ApiError(404, "unknown endpoint")

    return Handler


class _Server(ThreadingHTTPServer):
    # Windows: SO_REUSEADDR lets a second copy bind the same port silently while the first keeps answering
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class AppServer:
    def __init__(self, ctx: AppContext):
        self.ctx = ctx
        settings = ctx.db.get_settings()
        host = "0.0.0.0" if settings["lan_access"] else "127.0.0.1"
        ctx.bound_host, ctx.bound_port = host, int(settings["port"])
        self.httpd = _Server((host, ctx.bound_port), make_handler(ctx))
        self.httpd.daemon_threads = True
        self.thread: threading.Thread | None = None

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.ctx.bound_port}/"

    def start(self):
        self.thread = threading.Thread(target=self.httpd.serve_forever, name="http", daemon=True)
        self.thread.start()
        self.ctx.start_monitor()
        LOG.info("regTester %s listening on %s:%s", __version__, self.ctx.bound_host, self.ctx.bound_port)

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        for db in {id(self.ctx.db): self.ctx.db, id(self.ctx.local): self.ctx.local}.values():
            try:
                db.close()
            except Exception:  # noqa: BLE001
                pass
        LOG.info("regTester stopped")
