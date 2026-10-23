"""Common database in a folder on a Windows network share.

Several computers run their own regTester and open the same regtester.db in the
shared folder. Everyone can read and write at the same time; every write takes
the lock file of the folder for a moment, so writes never overlap:

    <shared folder>/regtester.db      common data (records, history, users, settings)
    <shared folder>/regtester.lock    held for the duration of one save, by one computer
    <shared folder>/presence/*.json   who is connected, refreshed every minute
    <shared folder>/backups/          daily backups

SQLite's own locking (rollback journal, BEGIN IMMEDIATE) stays on as a second guard.
Each computer keeps sessions and machine settings in its local database and a
copy of the shared database. When the share cannot be reached, the app keeps
working read-only on that copy and tells the user how old it is.
"""
from __future__ import annotations

import json
import logging
import os
import random
import socket
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .db import LOCAL_KEYS, BusyError, Database, ReadOnlyError, now

LOG = logging.getLogger("regtester.shared")

DB_NAME = "regtester.db"
LOCK_NAME = "regtester.lock"
STALE_SECONDS = 30        # a lock not refreshed for this long belongs to a crashed computer
HEARTBEAT_SECONDS = 5     # the holder refreshes the lock file this often during a long save
WAIT_SECONDS = 40         # how long a save waits for the lock (longer than STALE_SECONDS, so a stale lock is cleared)
PRESENCE_SECONDS = 180    # a computer counts as connected if it reported within this time


def host_name() -> str:
    return socket.gethostname() or "computer"


class SharedUnavailable(Exception):
    """The shared folder or its database cannot be opened."""


# ---------------------------------------------------------------- lock file
class WriteLock:
    """Lock file created atomically on the share; one save at a time across all computers."""

    def __init__(self, folder: Path, host: str | None = None, stale: float = STALE_SECONDS):
        self.path = Path(folder) / LOCK_NAME
        self.host = host or host_name()
        self.stale = stale
        # staleness is judged on this computer's own clock: the lock file must stay unchanged
        # for `stale` seconds while we watch it (clocks of different computers may differ)
        self._seen: tuple[float, float] | None = None
        self._token: str | None = None
        self._depth = 0
        self._mutex = threading.RLock()
        self._beat: threading.Thread | None = None

    def holder(self) -> dict[str, Any] | None:
        """Who holds the lock now, with its age in seconds; None when free."""
        try:
            st = self.path.stat()
            info = json.loads(self.path.read_text(encoding="utf-8") or "{}")
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            info, st = {}, None
        age = max(0.0, time.time() - st.st_mtime) if st else 0.0
        return {**info, "age": round(age, 1), "stale": age > self.stale}

    def _try_create(self, user: str) -> bool:
        token = f"{self.host}-{os.getpid()}-{random.getrandbits(48):x}"
        try:
            fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            return False
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"host": self.host, "user": user, "since": now(), "token": token}, f)
        self._token = token
        return True

    def _break_if_stale(self) -> None:
        try:
            mtime = self.path.stat().st_mtime
        except OSError:
            self._seen = None
            return
        if not self._seen or self._seen[0] != mtime:
            self._seen = (mtime, time.monotonic())
            return
        age = time.monotonic() - self._seen[1]
        if age <= self.stale:
            return
        self._seen = None
        # rename first: only one computer can win the rename, the others see the file gone
        aside = self.path.with_name(f"{LOCK_NAME}.stale-{self.host}-{random.getrandbits(32):x}")
        try:
            os.rename(self.path, aside)
        except OSError:
            return
        LOG.warning("Removed a stale lock in the shared folder (unchanged for %.0f s)", age)
        try:
            aside.unlink()
        except OSError:
            pass

    def acquire(self, user: str = "", timeout: float | None = None) -> None:
        timeout = WAIT_SECONDS if timeout is None else timeout
        with self._mutex:
            if self._depth:
                self._depth += 1
                return
            deadline = time.time() + timeout
            while not self._try_create(user):
                self._break_if_stale()
                if time.time() > deadline:
                    h = self.holder() or {}
                    raise BusyError(f"shared folder busy ({h.get('user') or '?'} @ {h.get('host') or '?'})")
                time.sleep(0.05 + random.random() * 0.15)
            self._depth = 1
            self._beat = threading.Thread(target=self._heartbeat, args=(self._token,), name="lock-heartbeat", daemon=True)
            self._beat.start()

    def _heartbeat(self, token: str | None) -> None:
        while True:
            time.sleep(HEARTBEAT_SECONDS)
            with self._mutex:
                if self._token != token or not self._depth:
                    return
                try:
                    os.utime(self.path)
                except OSError:
                    return

    def release(self) -> None:
        with self._mutex:
            if not self._depth:
                return
            self._depth -= 1
            if self._depth:
                return
            token, self._token = self._token, None
            try:
                info = json.loads(self.path.read_text(encoding="utf-8") or "{}")
                if info.get("token") == token:  # never remove a lock another computer took over
                    self.path.unlink()
            except (OSError, ValueError):
                pass

    def force_release(self) -> dict[str, Any] | None:
        """Admin unlock: remove whatever lock is there. Returns who held it."""
        held = self.holder()
        try:
            self.path.unlink()
        except FileNotFoundError:
            return None
        return held

    @contextmanager
    def held(self, user: str = ""):
        self.acquire(user)
        try:
            yield
        finally:
            self.release()


# ------------------------------------------------------------ the database
def check_folder(path: str) -> dict[str, Any]:
    """What is at `path`: does it exist, can this computer write there, is there a database already."""
    folder = Path(str(path or "").strip().strip('"'))
    out = {"path": str(folder), "exists": False, "writable": False, "has_db": False, "error": ""}
    if not str(path or "").strip():
        out["error"] = "empty path"
        return out
    try:
        if not folder.is_dir():
            out["error"] = "folder not found"
            return out
        out["exists"] = True
        probe = folder / f".regtester-write-test-{host_name()}-{os.getpid()}"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        out["writable"] = True
        out["has_db"] = (folder / DB_NAME).is_file()
    except OSError as exc:
        out["error"] = str(exc)
    return out


class SharedDatabase(Database):
    """The common database on the share, with a read-only fallback on the local copy."""

    def __init__(self, folder: Path, local: Database, create: bool = False):
        self.folder = Path(folder)
        self.local = local
        self.host = host_name()
        self.lock = WriteLock(self.folder, self.host)
        self.copy_path = Path(local.path).parent / "shared-copy.db"
        self.copy_meta_path = Path(local.path).parent / "shared-copy.json"
        self.online = False
        self.last_error = ""
        self._lock = threading.RLock()
        self.readonly = False
        self.path = self.folder / DB_NAME
        try:
            self._open_online(create)
        except (OSError, sqlite3.Error, SharedUnavailable) as exc:
            self.last_error = str(exc)
            LOG.warning("Shared folder not reachable (%s); opening the local copy read-only", exc)
            self._open_offline()

    # ------------------------------------------------------------ connect
    def _open_online(self, create: bool = False) -> None:
        if not self.folder.is_dir():
            raise SharedUnavailable(f"folder not found: {self.folder}")
        if not create and not self.path.is_file():
            raise SharedUnavailable(f"no regTester database in {self.folder}")
        # rollback journal: WAL needs shared memory, which does not work over a network share
        conn = self._connect(self.path, False, journal="DELETE")
        conn.execute("PRAGMA synchronous=FULL")
        old = getattr(self, "_conn", None)
        self._conn, self.readonly, self.online, self.last_error = conn, False, True, ""
        if old is not None:
            try:
                old.close()
            except sqlite3.Error:
                pass
        self._migrate()
        self.refresh_copy()

    def _open_offline(self) -> None:
        if not self.copy_path.is_file():
            raise SharedUnavailable(self.last_error or "shared folder not reachable and no local copy yet")
        conn = self._connect(self.copy_path, True)
        old = getattr(self, "_conn", None)
        self._conn, self.readonly, self.online = conn, True, False
        if old is not None:
            try:
                old.close()
            except sqlite3.Error:
                pass

    def go_offline(self, reason: str) -> None:
        with self._lock:
            if not self.online:
                return
            self.last_error = reason
            LOG.warning("Shared folder lost (%s): switching to the local copy, read-only", reason)
            try:
                self._open_offline()
            except SharedUnavailable:
                self.online = False
                self.readonly = True

    def check(self) -> bool:
        """Called every few seconds: notice a lost share, or come back when it is reachable again."""
        with self._lock:
            if self.online:
                try:
                    self.path.stat()
                    self._conn.execute("SELECT 1 FROM meta LIMIT 1").fetchall()
                except (OSError, sqlite3.Error) as exc:
                    self.go_offline(str(exc))
            else:
                try:
                    self._open_online()
                    LOG.info("Shared folder reachable again: %s", self.folder)
                except (OSError, sqlite3.Error, SharedUnavailable) as exc:
                    self.last_error = str(exc)
            return self.online

    # -------------------------------------------------------------- copy
    def refresh_copy(self) -> None:
        """Consistent snapshot of the shared database for read-only work when the share is gone."""
        if not self.online:
            return
        tmp = self.copy_path.with_suffix(".tmp")
        try:
            dst = sqlite3.connect(tmp)
            with self._lock:
                self._conn.backup(dst)
            dst.close()
            os.replace(tmp, self.copy_path)
            self.copy_meta_path.write_text(json.dumps({"ts": now(), "path": str(self.folder)}), encoding="utf-8")
        except (OSError, sqlite3.Error) as exc:
            LOG.warning("Could not refresh the local copy of the shared database: %s", exc)
            tmp.unlink(missing_ok=True)

    def copy_ts(self) -> float | None:
        try:
            return json.loads(self.copy_meta_path.read_text(encoding="utf-8")).get("ts")
        except (OSError, ValueError):
            return None

    # ------------------------------------------------------------ writes
    @contextmanager
    def write_guard(self, user: str = ""):
        if not self.online:
            raise ReadOnlyError("shared folder not reachable: read only")
        # the lock file first, so reads on this computer are not held up while waiting for another one
        try:
            self.lock.acquire(user)
        except OSError as exc:
            self.go_offline(str(exc))
            raise ReadOnlyError("shared folder not reachable: read only") from exc
        try:
            with self._lock:
                if not self.online:
                    raise ReadOnlyError("shared folder not reachable: read only")
                yield
        finally:
            try:
                self.lock.release()
            except OSError:
                pass

    @contextmanager
    def tx(self, user: str = ""):
        try:
            with super().tx(user) as c:
                yield c
        except sqlite3.OperationalError as exc:
            if self._is_io_error(exc):
                self.go_offline(str(exc))
                raise ReadOnlyError("shared folder not reachable: read only") from exc
            raise

    def q(self, sql: str, args=()):
        try:
            return super().q(sql, args)
        except sqlite3.OperationalError as exc:
            if self.online and self._is_io_error(exc):
                self.go_offline(str(exc))
                return super().q(sql, args)
            raise

    @staticmethod
    def _is_io_error(exc: Exception) -> bool:
        msg = str(exc).lower()
        return any(k in msg for k in ("disk i/o", "unable to open", "readonly database", "no such file", "network"))

    def restore_from_file(self, src_path: Path, user: str) -> None:
        super().restore_from_file(src_path, user)
        with self._lock:  # a backup of a local (WAL) database must not switch the share to WAL
            self._conn.execute("PRAGMA journal_mode=DELETE")

    # ---------------------------------------------------------- settings
    def get_settings(self) -> dict[str, Any]:
        out = super().get_settings()
        mine = self.local.get_settings()
        for k in LOCAL_KEYS:
            out[k] = mine[k]
        return out

    def set_settings(self, values: dict[str, Any], user: str) -> dict[str, Any]:
        local_part = {k: v for k, v in values.items() if k in LOCAL_KEYS}
        shared_part = {k: v for k, v in values.items() if k not in LOCAL_KEYS}
        if local_part:
            before = self.local.get_settings()
            changed = [k for k, v in local_part.items() if before.get(k) != v]
            self.local.set_settings(local_part, user)
            if changed and self.online:  # keep machine settings visible in the common history too
                try:
                    with self.tx(user) as c:
                        c.execute(
                            "INSERT INTO history(ts,user,section,record_id,action,summary,before,after) VALUES(?,?,?,?,?,?,?,?)",
                            (now(), user, "settings", "settings", "update", f"{', '.join(sorted(changed))} ({self.host})",
                             json.dumps({k: before.get(k) for k in changed}), json.dumps({k: local_part[k] for k in changed})),
                        )
                except (ReadOnlyError, BusyError):
                    pass
        if shared_part:
            super().set_settings(shared_part, user)
        return self.get_settings()

    # ---------------------------------------------------------- presence
    def report_presence(self, users: list[str]) -> None:
        if not self.online:
            return
        try:
            folder = self.folder / "presence"
            folder.mkdir(exist_ok=True)
            safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in self.host)
            (folder / f"{safe}.json").write_text(
                json.dumps({"host": self.host, "users": users, "ts": now()}), encoding="utf-8")
        except OSError as exc:
            LOG.debug("Presence not written: %s", exc)

    def presence(self) -> list[dict[str, Any]]:
        out = []
        try:
            for p in (self.folder / "presence").glob("*.json"):
                try:
                    d = json.loads(p.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                if now() - float(d.get("ts") or 0) <= PRESENCE_SECONDS:
                    out.append(d)
        except OSError:
            pass
        return sorted(out, key=lambda d: d.get("host", ""))

    def status(self) -> dict[str, Any]:
        holder = self.lock.holder() if self.online else None
        if holder:
            holder.pop("token", None)
        return {"mode": "shared" if self.online else "offline", "path": str(self.folder), "host": self.host,
                "online": self.online, "copy_ts": self.copy_ts(), "writer": holder, "error": self.last_error}


def create_shared(folder: Path, local: Database, init: str, user: str) -> None:
    """Put a database into an empty shared folder: a copy of this computer's data, or empty with the accounts."""
    folder = Path(folder)
    target = folder / DB_NAME
    if target.exists():
        raise ValueError("the shared folder already has a database")
    lock = WriteLock(folder)
    with lock.held(user):
        tmp = folder / f"{DB_NAME}.creating-{host_name()}"
        tmp.unlink(missing_ok=True)
        dst = sqlite3.connect(tmp)
        try:
            with local._lock:
                local._conn.backup(dst)
            dst.execute("PRAGMA journal_mode=DELETE")
            dst.execute("DELETE FROM sessions")
            if init == "empty":
                for table in ("records", "history", "imports"):
                    dst.execute(f"DELETE FROM {table}")
            dst.execute(
                "INSERT INTO history(ts,user,section,record_id,action,summary) VALUES(?,?,?,?,?,?)",
                (now(), user, "admin", "shared", "shared-create", f"{init} from {host_name()}"),
            )
            dst.commit()
        finally:
            dst.close()
        os.replace(tmp, target)
