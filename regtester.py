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
    args = ap.parse_args(argv)

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


if __name__ == "__main__":
    sys.exit(main())
