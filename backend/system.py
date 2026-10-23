"""OS integration: logging, Windows autostart, backups, network address."""
from __future__ import annotations

import logging
import logging.handlers
import os
import shutil
import socket
import sqlite3
import sys
import time
from pathlib import Path

LOG = logging.getLogger("regtester")
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "regTester"


# ------------------------------------------------------------------ logging
def setup_logging(log_dir: Path, level: str = "INFO", retention_days: int = 30) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "regtester.log"
    handler = logging.handlers.TimedRotatingFileHandler(
        log_file, when="midnight", backupCount=max(1, int(retention_days)), encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"))
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    root.addHandler(handler)
    if sys.stdout and sys.stdout.isatty():
        console = logging.StreamHandler()
        console.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        root.addHandler(console)
    set_log_level(level)
    return log_file


def set_log_level(level: str) -> None:
    logging.getLogger().setLevel(getattr(logging, str(level).upper(), logging.INFO))


def read_log(log_file: Path, limit: int = 500, level: str | None = None, text: str | None = None) -> list[dict]:
    """Return the newest log lines (newest first), parsed into fields."""
    if not log_file.exists():
        return []
    order = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
    min_idx = order.index(level.upper()) if level and level.upper() in order else 0
    with open(log_file, "r", encoding="utf-8", errors="replace") as fh:
        lines = fh.readlines()[-20000:]
    out = []
    for line in reversed(lines):
        parts = line.rstrip("\n").split(" | ", 3)
        if len(parts) != 4:
            if out:
                out[-1]["message"] += "\n" + line.rstrip("\n")
            continue
        ts, lvl, name, msg = parts
        lvl = lvl.strip()
        if lvl in order and order.index(lvl) < min_idx:
            continue
        if text and text.lower() not in line.lower():
            continue
        out.append({"ts": ts, "level": lvl, "source": name, "message": msg})
        if len(out) >= limit:
            break
    return out


# ---------------------------------------------------------------- autostart
def is_windows() -> bool:
    return os.name == "nt"


def launch_command() -> str:
    """Command Windows runs at login: pythonw (no console window) + this app."""
    exe = Path(sys.executable)
    pyw = exe.with_name("pythonw.exe")
    interpreter = pyw if pyw.exists() else exe
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --tray'
    script = Path(__file__).resolve().parent.parent / "regtester.py"
    return f'"{interpreter}" "{script}" --tray'


def autostart_enabled() -> bool:
    if not is_windows():
        return False
    import winreg  # type: ignore
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.QueryValueEx(key, RUN_NAME)
            return True
    except OSError:
        return False


def set_autostart(enabled: bool) -> bool:
    """Add or remove regTester from the current user's Windows startup list."""
    if not is_windows():
        LOG.warning("Autostart requested on %s: only available on Windows", sys.platform)
        return False
    import winreg  # type: ignore
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, RUN_NAME, 0, winreg.REG_SZ, launch_command())
        else:
            try:
                winreg.DeleteValue(key, RUN_NAME)
            except FileNotFoundError:
                pass
    LOG.info("Autostart with Windows %s", "enabled" if enabled else "disabled")
    return autostart_enabled()


# ------------------------------------------------------------------ backups
def backup_database(db_path: Path, backup_dir: Path, keep: int = 10) -> Path:
    """Consistent online copy of the SQLite file, keeping the newest `keep` copies."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / f"regtester-{time.strftime('%Y%m%d-%H%M%S')}.db"
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(target)
    with dst:
        src.backup(dst)
    src.close(); dst.close()
    copies = sorted(backup_dir.glob("regtester-*.db"))
    for old in copies[:-max(1, int(keep))]:
        old.unlink(missing_ok=True)
    LOG.info("Backup written: %s", target.name)
    return target


def list_backups(backup_dir: Path) -> list[dict]:
    if not backup_dir.exists():
        return []
    return [{"name": p.name, "size": p.stat().st_size, "ts": p.stat().st_mtime}
            for p in sorted(backup_dir.glob("regtester-*.db"), reverse=True)]


def backup_path(name: str, backup_dir: Path) -> Path:
    """A backup file by name, refusing anything outside the backup folder."""
    src = (backup_dir / name).resolve()
    if src.parent != backup_dir.resolve() or not src.is_file() or not src.name.startswith("regtester-"):
        raise KeyError(name)
    return src


def restore_backup(name: str, db_path: Path, backup_dir: Path) -> None:
    shutil.copy2(backup_path(name, backup_dir), db_path)


# ------------------------------------------------------------------ network
def lan_host() -> str:
    return socket.gethostname() or "computer"


def lan_addresses() -> list[str]:
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))
