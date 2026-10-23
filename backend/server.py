"""HTTP server: JSON API under /api and the PWA from /web. Standard library only."""
from __future__ import annotations

import base64
import json
import logging
import mimetypes
import platform
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
from .db import SECTIONS, ConflictError, Database

LOG = logging.getLogger("regtester.server")
MAX_BODY = 60 * 1024 * 1024

# Which page (permission unit) a storage section belongs to.
PAGE_OF = {
    "timeline": "timeline", "features": "coverage", "tests": "coverage", "runs": "triage",
    "known": "triage", "errors": "triage", "errsnaps": "triage", "transcripts": "transcripts", "glossary": "transcripts",
    "docs": "docs", "templates": "docs", "specs": "specs",
}
PAGES = ("dashboard", "timeline", "coverage", "triage", "transcripts", "docs", "specs")

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
    """Shared state for request handlers."""

    def __init__(self, data_dir: Path, web_dir: Path):
        self.data_dir = data_dir
        self.web_dir = web_dir
        self.db_path = data_dir / "regtester.db"
        self.backup_dir = data_dir / "backups"
        self.log_dir = data_dir / "logs"
        self.db = Database(self.db_path)
        self.auth = Auth(self.db)
        settings = self.db.get_settings()
        self.log_file = system.setup_logging(self.log_dir, settings["log_level"], settings["log_retention_days"])
        self.started = time.time()
        self.on_logo_changed: Callable[[], None] | None = None
        self.on_quit: Callable[[], None] | None = None
        self.bound_host = "127.0.0.1"
        self.bound_port = settings["port"]

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
            return h[7:] if h.startswith("Bearer ") else None

        def _is_local(self) -> bool:
            return self.client_address[0] in ("127.0.0.1", "::1")

        def _user(self, required: bool = True) -> dict | None:
            user = ctx.auth.user_for_token(self._token())
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

            if head == "public-settings":
                s = ctx.db.get_settings()
                self._json({k: s[k] for k in ("language", "theme", "app_name", "require_login")}); return

            user = self._user()
            assert user is not None

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
                    sensitive = {"port", "lan_access", "require_login", "sso", "log_retention_days", "backup_keep"}
                    if user["role"] != "admin" and sensitive.intersection(body):
                        raise ApiError(403, "admin only")
                    if user["role"] == "viewer":
                        raise ApiError(403, "forbidden")
                    before = ctx.db.get_settings()
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
                if method == "GET":
                    self._json(system.list_backups(ctx.backup_dir)); return
                if method == "POST" and arg == "restore":
                    name = self._body().get("name", "")
                    system.backup_database(ctx.db_path, ctx.backup_dir, 1000)  # safety copy first
                    ctx.db.close()
                    system.restore_backup(name, ctx.db_path, ctx.backup_dir)
                    ctx.db.__init__(ctx.db_path)  # reopen
                    LOG.warning("%s restored backup %s", user["username"], name)
                    self._json({"ok": True}); return
                if method == "POST":
                    s = ctx.db.get_settings()
                    p = system.backup_database(ctx.db_path, ctx.backup_dir, s["backup_keep"])
                    self._json({"name": p.name}); return

            raise ApiError(404, "unknown endpoint")

    return Handler


class AppServer:
    def __init__(self, ctx: AppContext):
        self.ctx = ctx
        settings = ctx.db.get_settings()
        host = "0.0.0.0" if settings["lan_access"] else "127.0.0.1"
        ctx.bound_host, ctx.bound_port = host, int(settings["port"])
        self.httpd = ThreadingHTTPServer((host, ctx.bound_port), make_handler(ctx))
        self.httpd.daemon_threads = True
        self.thread: threading.Thread | None = None

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.ctx.bound_port}/"

    def start(self):
        self.thread = threading.Thread(target=self.httpd.serve_forever, name="http", daemon=True)
        self.thread.start()
        LOG.info("regTester %s listening on %s:%s", __version__, self.ctx.bound_host, self.ctx.bound_port)

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.ctx.db.close()
        LOG.info("regTester stopped")
