"""Shared folder: lock file, two computers on one database, conflicts, read-only fallback."""
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.auth import Auth  # noqa: E402
from backend.db import BusyError, ConflictError, Database, ReadOnlyError  # noqa: E402
from backend import shared as sh  # noqa: E402
from backend.server import AppContext  # noqa: E402

WEB = Path(__file__).resolve().parents[1] / "web"


class LockTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_exclusive_and_own_release(self):
        a, b = sh.WriteLock(self.tmp, "pc-a"), sh.WriteLock(self.tmp, "pc-b")
        a.acquire("ana")
        self.assertEqual(a.holder()["user"], "ana")
        with self.assertRaises(BusyError):
            b.acquire("bob", timeout=0.3)
        a.release()
        self.assertIsNone(a.holder())
        b.acquire("bob")
        a._depth, a._token = 1, "someone-else"  # a must not remove a lock it does not own
        a.release()
        self.assertEqual(b.holder()["user"], "bob")
        b.release()

    def test_stale_lock_is_broken(self):
        a, b = sh.WriteLock(self.tmp, "pc-a", stale=0.6), sh.WriteLock(self.tmp, "pc-b", stale=0.6)
        a.acquire("ana")
        a._token = None  # crashed: no heartbeat, no release
        old = time.time() + 3600  # the other computer's clock is far ahead: must not matter
        os.utime(a.path, (old, old))
        with self.assertRaises(BusyError):
            b.acquire("bob", timeout=0.3)  # watched too briefly to call it stale
        b.acquire("bob", timeout=3)
        self.assertEqual(b.holder()["user"], "bob")
        b.release()

    def test_live_lock_is_not_broken(self):
        a = sh.WriteLock(self.tmp, "pc-a", stale=0.6)
        b = sh.WriteLock(self.tmp, "pc-b", stale=0.6)
        a.acquire("ana")
        old = time.time() - 3600  # clock far behind, but the holder keeps refreshing
        os.utime(a.path, (old, old))
        stop = time.time() + 1.5
        ok = False
        while time.time() < stop:
            os.utime(a.path)  # heartbeat
            try:
                b.acquire("bob", timeout=0.2)
                ok = True
                break
            except BusyError:
                pass
        self.assertFalse(ok)
        a.release()

    def test_force_release(self):
        a = sh.WriteLock(self.tmp, "pc-a")
        a.acquire("ana")
        held = sh.WriteLock(self.tmp, "pc-admin").force_release()
        self.assertEqual(held["user"], "ana")
        self.assertIsNone(a.holder())


class TwoComputers(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.share = self.tmp / "share"
        self.share.mkdir()
        self.loc_a = Database(self.tmp / "a" / "regtester.db")
        self.loc_b = Database(self.tmp / "b" / "regtester.db")
        Auth(self.loc_a)  # creates admin
        self.loc_a.create("specs", {"title": "existing"}, "admin")
        sh.create_shared(self.share, self.loc_a, "copy", "admin")
        self.a = sh.SharedDatabase(self.share, self.loc_a)
        self.b = sh.SharedDatabase(self.share, self.loc_b)

    def tearDown(self):
        for db in (self.a, self.b, self.loc_a, self.loc_b):
            try:
                db.close()
            except Exception:  # noqa: BLE001
                pass
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_copy_and_concurrent_writes(self):
        self.assertTrue(self.a.online and self.b.online)
        self.assertEqual([r["title"] for r in self.b.list_records("specs")], ["existing"])
        errors = []

        def work(db, who):
            try:
                for i in range(15):
                    db.create("specs", {"title": f"{who}-{i}"}, who)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=work, args=(db, who)) for db, who in ((self.a, "ana"), (self.b, "bob"), (self.a, "cri"))]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        self.assertEqual(len(self.a.list_records("specs")), 46)
        self.assertEqual(len(self.b.list_records("specs")), 46)
        self.assertIsNone(self.a.lock.holder())

    def test_conflict_between_computers(self):
        rec = self.a.create("specs", {"title": "shared"}, "ana")
        self.b.update(rec["id"], {"title": "bob's"}, "bob", rec["version"])
        with self.assertRaises(ConflictError) as cm:
            self.a.update(rec["id"], {"title": "ana's"}, "ana", rec["version"])
        self.assertEqual(cm.exception.current["title"], "bob's")

    def test_machine_settings_stay_local(self):
        self.a.set_settings({"port": 9001, "app_name": "Team tool"}, "ana")
        self.assertEqual(self.a.get_settings()["port"], 9001)
        self.assertEqual(self.b.get_settings()["port"], 8765)
        self.assertEqual(self.b.get_settings()["app_name"], "Team tool")
        self.assertTrue(any("port" in h["summary"] for h in self.b.history("settings")))

    def test_offline_copy_read_only(self):
        self.a.create("specs", {"title": "before outage"}, "ana")
        self.a.refresh_copy()
        self.assertIsNotNone(self.a.copy_ts())
        moved = self.tmp / "share-away"
        self.a.close(); self.b.close()
        self.share.rename(moved)
        self.a = sh.SharedDatabase(self.share, self.loc_a)
        self.assertFalse(self.a.online)
        self.assertTrue(self.a.readonly)
        self.assertIn("before outage", [r["title"] for r in self.a.list_records("specs")])
        with self.assertRaises(ReadOnlyError):
            self.a.create("specs", {"title": "x"}, "ana")
        self.assertEqual(self.a.status()["mode"], "offline")
        moved.rename(self.share)
        self.assertTrue(self.a.check())
        self.a.create("specs", {"title": "after"}, "ana")
        self.b = sh.SharedDatabase(self.share, self.loc_b)
        self.assertIn("after", [r["title"] for r in self.b.list_records("specs")])

    def test_lost_share_while_running(self):
        self.a.refresh_copy()
        moved = self.tmp / "share-away"
        self.b.close()
        self.a._conn.close()  # the network drops: the open handle is gone too
        self.share.rename(moved)
        self.a.check()
        self.assertFalse(self.a.online)
        self.assertTrue(self.a.list_records("specs"))


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.share = self.tmp / "share"
        self.share.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_connect_unlock_disconnect(self):
        ctx = AppContext(self.tmp / "a", WEB)
        ctx.db.create("specs", {"title": "mine"}, "admin")
        token, _ = ctx.auth.login("admin", "admin")
        with self.assertRaises(ValueError):
            ctx.connect_shared(str(self.share), None, "admin")  # empty folder: must choose copy or empty
        st = ctx.connect_shared(str(self.share), "empty", "admin")
        self.assertEqual(st["mode"], "shared")
        self.assertEqual(ctx.db.list_records("specs"), [])
        self.assertIsNone(ctx.auth.user_for_token(token))  # signed out after the switch
        self.assertIsNotNone(ctx.auth.get_user("admin"))  # accounts kept

        other = sh.WriteLock(self.share, "pc-b")
        other.acquire("bob")
        held = ctx.unlock_shared("admin")
        self.assertEqual(held["user"], "bob")
        self.assertTrue(any(h["action"] == "shared-unlock" for h in ctx.db.history("admin")))

        token, _ = ctx.auth.login("admin", "admin")
        rows = ctx.local.q("SELECT last_seen FROM sessions WHERE token=?", (token,))
        ctx.local.q("UPDATE sessions SET last_seen=? WHERE token=?", (rows[0]["last_seen"] - 100, token))
        ctx.auth.user_for_token(token, touch=False)
        self.assertLess(ctx.local.q("SELECT last_seen FROM sessions WHERE token=?", (token,))[0]["last_seen"], time.time() - 50)

        ctx.disconnect_shared("admin")
        self.assertEqual(ctx.shared_status()["mode"], "local")
        self.assertEqual([r["title"] for r in ctx.db.list_records("specs")], ["mine"])
        ctx.db.close() if ctx.db is not ctx.local else None
        ctx.local.close()

    def test_second_computer_joins(self):
        a = AppContext(self.tmp / "a", WEB)
        a.db.create("specs", {"title": "from A"}, "admin")
        a.connect_shared(str(self.share), "copy", "admin")
        b = AppContext(self.tmp / "b", WEB)
        b.connect_shared(str(self.share), None, "admin")
        self.assertEqual([r["title"] for r in b.db.list_records("specs")], ["from A"])
        b.db.create("specs", {"title": "from B"}, "admin")
        self.assertEqual(len(a.db.list_records("specs")), 2)
        for c in (a, b):
            c.db.close(); c.local.close()


if __name__ == "__main__":
    unittest.main()
