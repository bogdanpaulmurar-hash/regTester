"""regTester — start the app.

    python regtester.py            start server, tray icon (if available), open browser
    python regtester.py --tray     same, without opening the browser (used at Windows login)
    python regtester.py --no-tray  server only, stop with Ctrl+C
    python regtester.py --data D   keep database, logs and backups in folder D
"""
from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import threading
import webbrowser
from pathlib import Path

from backend import system, tray
from backend.server import AppContext, AppServer

ROOT = Path(__file__).resolve().parent


def default_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "regTester"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="regTester")
    ap.add_argument("--data", type=Path, default=Path(os.environ.get("REGTESTER_DATA", default_data_dir())))
    ap.add_argument("--tray", action="store_true", help="started at login: do not open the browser")
    ap.add_argument("--no-tray", action="store_true")
    ap.add_argument("--port", type=int, help="override the port from settings for this run")
    ap.add_argument("--list-users", action="store_true", help="show the user accounts and exit")
    ap.add_argument("--reset-password", metavar="USER",
                    help="set a new password for USER (creates USER as admin if missing) and exit")
    args = ap.parse_args(argv)

    if args.list_users or args.reset_password:
        return recovery(args)

    ctx = AppContext(args.data, ROOT / "web")
    log = logging.getLogger("regtester")
    if args.port:
        ctx.db.set_settings({"port": args.port}, "cli")
    settings = ctx.db.get_settings()
    if settings["backup_on_start"]:
        try:
            system.backup_database(ctx.db_path, ctx.backup_dir, settings["backup_keep"])
        except Exception:  # noqa: BLE001
            log.exception("Backup on start failed")

    try:
        server = AppServer(ctx)
    except OSError as exc:
        log.error("Cannot open port %s: %s (already running?)", settings["port"], exc)
        webbrowser.open(f"http://127.0.0.1:{settings['port']}/")
        return 1
    server.start()

    stop = threading.Event()

    def quit_app():
        stop.set()

    ctx.on_quit = quit_app
    # manual start: follow "open browser"; start at Windows login (--tray): open only if "start in tray" is off
    if (not args.tray and settings["open_browser_on_start"]) or (args.tray and not settings["start_minimized"]):
        webbrowser.open(server.url)

    use_tray = tray.AVAILABLE and not args.no_tray
    if not tray.AVAILABLE and not args.no_tray:
        log.warning("Tray not available: install with 'pip install pystray Pillow'")
    try:
        if use_tray:
            tray.Tray(ctx, server.url, quit_app).run()
        else:
            signal.signal(signal.SIGINT, lambda *_: stop.set())
            print(f"regTester running at {server.url}  (Ctrl+C to stop)")
            while not stop.wait(0.5):
                pass
    finally:
        server.stop()
    return 0


CLI_TEXT = {
    "en": {"none": "No user accounts yet. The first start creates admin / admin.",
           "head": "User accounts in {db}:", "disabled": "disabled", "must": "must change password",
           "new": "New password for '{u}': ", "again": "Repeat it: ", "short": "At least 4 characters, both entries equal.",
           "done": "Done. Log in as '{u}' with the new password; you will be asked to choose your own.",
           "temp": "Temporary password for '{u}': {pw}"},
    "de": {"none": "Noch keine Benutzerkonten. Der erste Start legt admin / admin an.",
           "head": "Benutzerkonten in {db}:", "disabled": "deaktiviert", "must": "muss Passwort ändern",
           "new": "Neues Passwort für '{u}': ", "again": "Wiederholen: ", "short": "Mindestens 4 Zeichen, beide Eingaben gleich.",
           "done": "Fertig. Melden Sie sich als '{u}' mit dem neuen Passwort an; danach wählen Sie ein eigenes.",
           "temp": "Temporäres Passwort für '{u}': {pw}"},
    "ro": {"none": "Nu există încă utilizatori. Prima pornire creează admin / admin.",
           "head": "Utilizatori în {db}:", "disabled": "dezactivat", "must": "trebuie să schimbe parola",
           "new": "Parolă nouă pentru '{u}': ", "again": "Repetă parola: ", "short": "Minimum 4 caractere, ambele la fel.",
           "done": "Gata. Intră ca '{u}' cu parola nouă; vei fi rugat să-ți alegi una proprie.",
           "temp": "Parolă temporară pentru '{u}': {pw}"},
}


def recovery(args) -> int:
    """Console access to the accounts, for whoever can open the data folder on this machine."""
    import getpass
    import secrets

    from backend.auth import Auth
    from backend.db import Database

    db = Database(Path(args.data) / "regtester.db")
    lang = db.get_settings().get("language", "ro")
    tx = CLI_TEXT.get(lang, CLI_TEXT["en"])
    try:
        auth = Auth(db)
        if args.list_users:
            users = auth.list_users()
            if not users:
                print(tx["none"])
            print(tx["head"].format(db=db.path))
            for u in users:
                flags = [] if u["active"] else [tx["disabled"]]
                if u["must_change"]:
                    flags.append(tx["must"])
                print(f"  {u['username']:<20} {u['role']:<8} {', '.join(flags)}")
            if not args.reset_password:
                return 0
        user = args.reset_password.strip().lower()
        if sys.stdin and sys.stdin.isatty():
            for _ in range(3):
                pw = getpass.getpass(tx["new"].format(u=user))
                if len(pw) >= 4 and pw == getpass.getpass(tx["again"]):
                    break
                print(tx["short"])
            else:
                return 1
        else:  # no console to type into: hand out a temporary password
            pw = secrets.token_urlsafe(9)
            print(tx["temp"].format(u=user, pw=pw))
        auth.reset_password(user, pw, actor="recovery (console)")
        print(tx["done"].format(u=user))
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
