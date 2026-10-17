"""Backend tests: python -m unittest discover -s tests"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.db import Database  # noqa: E402
from backend.server import AppContext, AppServer  # noqa: E402


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.db = Database(self.dir / "t.db")

    def tearDown(self):
        self.db.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_history_and_restore(self):
        r = self.db.create("specs", {"key": "S-1", "title": "First", "body": "a"}, "ana")
        self.db.update(r["id"], {"title": "Second"}, "ion")
        self.db.delete(r["id"], "ion")
        hist = self.db.history(record_id=r["id"])
        self.assertEqual([h["action"] for h in hist], ["delete", "update", "create"])
        create_entry = hist[-1]
        restored = self.db.restore(create_entry["id"], "ana")
        self.assertEqual(restored["title"], "First")
        self.assertEqual(len(self.db.list_records("specs")), 1)

    def test_upsert_import(self):
        self.db.import_records("tests", "a.csv", [{"key": "T1", "title": "x"}, {"key": "T2", "title": "y"}], "upsert", "u")
        res = self.db.import_records("tests", "b.csv", [{"key": "T1", "title": "x2"}, {"key": "T3", "title": "z"}], "upsert", "u")
        self.assertEqual((res["created"], res["updated"]), (1, 1))
        titles = sorted(r["title"] for r in self.db.list_records("tests"))
        self.assertEqual(titles, ["x2", "y", "z"])
        res = self.db.import_records("tests", "c.csv", [{"key": "N", "title": "only"}], "replace", "u")
        self.assertEqual(res["removed"], 3)
        self.assertEqual([r["title"] for r in self.db.list_records("tests")], ["only"])

    def test_version_conflict(self):
        from backend.db import ConflictError
        r = self.db.create("docs", {"title": "d"}, "u")
        self.db.update(r["id"], {"title": "d2"}, "u", expected_version=1)
        with self.assertRaises(ConflictError):
            self.db.update(r["id"], {"title": "d3"}, "u", expected_version=1)

    def test_settings_history(self):
        self.db.set_settings({"language": "de", "unknown": 1}, "admin")
        self.assertEqual(self.db.get_settings()["language"], "de")
        self.assertNotIn("unknown", self.db.get_settings())
        self.assertEqual(self.db.history(section="settings")[0]["summary"], "language")


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = Path(tempfile.mkdtemp())
        cls.ctx = AppContext(cls.dir, ROOT / "web")
        cls.ctx.db.set_settings({"port": 0}, "test")
        cls.server = AppServer(cls.ctx)
        cls.ctx.bound_port = cls.server.httpd.server_address[1]
        cls.server.start()
        cls.base = f"http://127.0.0.1:{cls.ctx.bound_port}/api/"

    @classmethod
    def tearDownClass(cls):
        cls.server.stop()
        shutil.rmtree(cls.dir, ignore_errors=True)

    def call(self, method, path, body=None, token=None):
        req = urllib.request.Request(self.base + path, method=method, data=json.dumps(body).encode() if body is not None else None)
        req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", "Bearer " + token)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null")

    def login(self, u="admin", p="admin"):
        return self.call("POST", "login", {"username": u, "password": p})[1]["token"]

    def test_flow(self):
        self.assertEqual(self.call("GET", "health")[1]["app"], "regTester")
        self.assertEqual(self.call("GET", "records?section=specs")[0], 401)
        self.assertEqual(self.call("POST", "login", {"username": "admin", "password": "x"})[0], 401)
        tok = self.login()
        st, rec = self.call("POST", "records", {"section": "specs", "record": {"title": "A", "kind": "spec"}}, tok)
        self.assertEqual(st, 201)
        st, upd = self.call("PUT", f"records/{rec['id']}", {"record": {"title": "B"}, "version": 1}, tok)
        self.assertEqual(upd["version"], 2)
        self.assertEqual(self.call("PUT", f"records/{rec['id']}", {"record": {"title": "C"}, "version": 1}, tok)[0], 409)
        # viewer restricted to specs, read only
        self.assertEqual(self.call("POST", "users", {"username": "vio", "password": "pass1", "role": "viewer", "sections": ["specs"]}, tok)[0], 201)
        vt = self.login("vio", "pass1")
        self.assertEqual(self.call("GET", "records?section=specs", token=vt)[0], 200)
        self.assertEqual(self.call("GET", "records?section=timeline", token=vt)[0], 403)
        self.assertEqual(self.call("POST", "records", {"section": "specs", "record": {"title": "x"}}, vt)[0], 403)
        self.assertEqual(self.call("GET", "users", token=vt)[0], 403)
        self.assertEqual(self.call("PUT", "settings", {"lan_access": True}, vt)[0], 403)
        # cannot remove the last admin
        self.assertEqual(self.call("PUT", "users/admin", {"role": "viewer"}, tok)[0], 400)
        # logs and backups
        self.assertTrue(any("created user vio" in l["message"] for l in self.call("GET", "logs?limit=50", token=tok)[1]))
        self.assertEqual(self.call("POST", "backups", {}, tok)[0], 200)
        self.assertGreaterEqual(len(self.call("GET", "backups", token=tok)[1]), 1)
        # static files
        with urllib.request.urlopen(self.base.replace("/api/", "/")) as r:
            self.assertIn(b"regTester", r.read())
        with self.assertRaises(urllib.error.HTTPError):
            urllib.request.urlopen(self.base.replace("/api/", "/") + "../backend/db.py")


if __name__ == "__main__":
    unittest.main()
