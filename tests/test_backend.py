"""Backend tests: python -m unittest discover -s tests"""
from __future__ import annotations

import base64
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

    def test_json_export_restore(self):
        keep = self.db.create("specs", {"key": "S-1", "title": "Keep", "body": "a"}, "ana")
        change = self.db.create("errors", {"key": "E-1", "title": "Old title", "data": {"status": "open"}}, "ana")
        gone = self.db.create("timeline", {"title": "Deleted before export"}, "ana")
        self.db.delete(gone["id"], "ana")
        self.db.set_settings({"flaky_window": 7, "port": 9999}, "ana")
        data = json.loads(json.dumps(self.db.export_data("ana", "test")))
        self.assertEqual(data["format"], "regtester-export")
        self.assertEqual(data["records"]["specs"][0]["title"], "Keep")
        self.assertTrue(next(r for r in data["records"]["timeline"] if r["id"] == gone["id"])["deleted"])
        self.assertNotIn("port", data["settings"])  # machine settings stay on the machine
        self.assertNotIn("users", data)
        # changes after the export
        self.db.update(change["id"], {"title": "New title"}, "ion")
        extra = self.db.create("specs", {"title": "Added later"}, "ion")
        self.db.delete(keep["id"], "ion")
        self.db.set_settings({"flaky_window": 3}, "ion")
        prev = self.db.restore_preview(data)
        self.assertEqual(prev["sections"]["specs"], {"in_file": 1, "create": 0, "update": 1, "delete": 1, "same": 0})
        self.assertEqual(prev["sections"]["errors"]["update"], 1)
        self.assertEqual(prev["settings"], ["flaky_window"])
        # only specs: errors keep the later change
        res = self.db.restore_export(data, ["specs"], False, "admin", "regtester-x.json")
        self.assertEqual((res["created"], res["updated"], res["deleted"]), (0, 1, 1))
        self.assertEqual([r["title"] for r in self.db.list_records("specs")], ["Keep"])
        self.assertEqual(self.db.get_record(change["id"])["title"], "New title")
        self.assertEqual(self.db.get_settings()["flaky_window"], 3)
        # every change is in the history and can be undone
        hist = self.db.history(record_id=extra["id"])
        self.assertEqual(hist[0]["action"], "delete")
        self.db.restore(hist[0]["id"], "admin")
        self.assertEqual(len(self.db.list_records("specs")), 2)
        # everything, with settings
        res = self.db.restore_export(data, ["specs", "errors", "timeline"], True, "admin", "regtester-x.json")
        self.assertEqual(self.db.get_record(change["id"])["title"], "Old title")
        self.assertEqual(self.db.get_settings()["flaky_window"], 7)
        self.assertEqual(self.db.get_settings()["port"], 9999)
        self.assertEqual(self.db.list_records("timeline"), [])
        self.assertEqual(self.db.restore_preview(data)["sections"]["specs"]["same"], 1)
        with self.assertRaises(ValueError):
            self.db.restore_preview({"format": "something else"})
        with self.assertRaises(ValueError):
            self.db.restore_preview({**data, "version": 99})

    def test_notes_survive_import(self):
        self.db.import_records("errors", "e1.xlsx", [{"key": "E-1", "title": "Crash", "data": {"status": "New"}}], "upsert", "ana")
        rec = self.db.list_records("errors")[0]
        self.db.update(rec["id"], {"data": {**rec["data"], "notes": "<p>seen on test env</p>"}}, "ana", rec["version"])
        self.db.import_records("errors", "e2.xlsx", [{"key": "E-1", "title": "Crash", "data": {"status": "Solved"}}], "upsert", "ana")
        rec = self.db.list_records("errors")[0]
        self.assertEqual(rec["data"], {"status": "Solved", "notes": "<p>seen on test env</p>"})
        self.db.import_records("errors", "e3.xlsx", [{"key": "E-1", "title": "Crash", "data": {"status": "Closed"}}], "replace", "ana")
        self.assertEqual(self.db.list_records("errors")[0]["data"]["notes"], "<p>seen on test env</p>")

    def test_attachments(self):
        png = b"\x89PNG\r\n\x1a\n" + b"x" * 50
        aid = self.db.put_data_url("data:image/png;base64," + base64.b64encode(png).decode(), "ana")
        self.assertEqual(self.db.put_attachment(png, "image/png", "ion"), aid)  # stored once
        self.assertEqual(self.db.get_attachment(aid), ("image/png", png))
        with self.assertRaises(ValueError):
            self.db.put_attachment(b"<svg/>", "image/svg+xml", "ana")
        r = self.db.create("specs", {"title": "With image", "body": f'<p>see <img src="/api/att/{aid}"></p>'}, "ana")
        # removed from the text, but still in the history: kept
        self.db.update(r["id"], {"body": "<p>no image</p>"}, "ana")
        self.assertEqual(self.db.attachment_stats()["unused"], 0)
        self.assertEqual(self.db.cleanup_attachments("admin")["removed"], 0)
        orphan = self.db.put_attachment(b"GIF89a" + b"y" * 10, "image/gif", "ana")
        self.assertEqual(self.db.cleanup_attachments("admin"), {"removed": 1, "bytes": 16})
        with self.assertRaises(KeyError):
            self.db.get_attachment(orphan)
        # export carries the images used by records; restore into an empty database brings them back
        self.db.update(r["id"], {"body": f'<img src="/api/att/{aid}">'}, "ana")
        data = self.db.export_data("ana", "test")
        self.assertEqual(list(data["attachments"]), [aid])
        other = Database(self.dir / "other.db")
        try:
            self.assertEqual(other.restore_preview(data)["images"], 1)
            res = other.restore_export(data, ["specs"], False, "ana", "export.json")
            self.assertEqual((res["created"], res["images"]), (1, 1))
            self.assertEqual(other.get_attachment(aid)[1], png)
            bad = json.loads(json.dumps(data))
            bad["attachments"][aid]["data"] = base64.b64encode(b"tampered").decode()
            self.assertEqual(Database._file_attachments(bad), {})
        finally:
            other.close()

    def test_backup_folder_checks(self):
        from backend import system
        self.assertEqual(system.cloud_provider(r"C:\Users\ana\OneDrive - Firma\regTester"), "OneDrive")
        self.assertEqual(system.cloud_provider(r"G:\My Drive\Backups"), "Google Drive")
        self.assertEqual(system.cloud_provider("/home/ana/Dropbox/rt"), "Dropbox")
        self.assertEqual(system.cloud_provider(r"\\server\regTester\backups"), "")
        self.assertEqual(system.cloud_provider(r"D:\Backups\regTester"), "")
        ok = system.check_backup_folder(str(self.dir / "new" / "folder"))
        self.assertTrue(ok["ok"] and (self.dir / "new" / "folder").is_dir(), ok)
        self.assertEqual(system.check_backup_folder("relative/path")["error"], "backup_dir_relative")
        self.assertEqual(system.check_backup_folder("")["error"], "backup_dir_empty")
        p = system.write_export({"format": "regtester-export"}, self.dir / "ex", keep=2)
        self.assertTrue(p.name.startswith("regtester-") and p.suffix == ".json")
        self.assertEqual([b["kind"] for b in system.list_backups(self.dir / "ex")], ["json"])

    def test_password_recovery(self):
        from backend.auth import Auth
        auth = Auth(self.db)
        auth.update_user("admin", {"password": "forgotten", "active": True}, "admin")
        token, _ = auth.login("admin", "forgotten")
        auth.create_user({"username": "ana", "role": "editor", "password": "pass1"}, "admin")
        auth.update_user("ana", {"active": False}, "admin")
        self.assertIsNone(auth.login("admin", "new1"))
        auth.reset_password("Admin", "new1")
        self.assertIsNone(auth.user_for_token(token), "old sessions end")
        _, user = auth.login("admin", "new1")
        self.assertTrue(user["must_change"])
        auth.reset_password("ana", "back1")
        self.assertTrue(auth.get_user("ana")["active"])
        created = auth.reset_password("rescue", "abcd")
        self.assertEqual(created["role"], "admin")
        actions = [h["action"] for h in self.db.history(section="admin")]
        self.assertIn("password-reset", actions)
        with self.assertRaises(ValueError):
            auth.reset_password("admin", "x")

    def test_settings_history(self):
        self.db.set_settings({"language": "de", "unknown": 1}, "admin")
        self.assertEqual(self.db.get_settings()["language"], "de")
        self.assertNotIn("unknown", self.db.get_settings())
        self.assertEqual(self.db.history(section="settings")[0]["summary"], "language")


class StartupBackupTests(unittest.TestCase):
    def test_chosen_folder_and_daily_export(self):
        d = Path(tempfile.mkdtemp())
        try:
            ctx = AppContext(d / "data", ROOT / "web")
            chosen = d / "chosen"
            ctx.db.set_settings({"backup_dir": str(chosen), "export_on_start": True}, "t")
            ctx.db.create("specs", {"title": "x"}, "t")
            for _ in range(2):
                ctx.startup_backup(ctx.db.get_settings())
            self.assertEqual(len(list(chosen.glob("regtester-*.db"))), 1)    # once a day in the chosen folder
            self.assertEqual(len(list(chosen.glob("regtester-*.json"))), 1)
            self.assertGreaterEqual(len(list(ctx.local_backup_dir.glob("regtester-*.db"))), 1)
            data = json.loads(next(chosen.glob("regtester-*.json")).read_text(encoding="utf-8"))
            self.assertEqual(data["records"]["specs"][0]["title"], "x")
            ctx.db.close()
        finally:
            shutil.rmtree(d, ignore_errors=True)


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
        bk = self.call("GET", "backups", token=tok)[1]
        self.assertEqual([p["place"] for p in bk["places"]], ["team"])
        self.assertGreaterEqual(len(bk["places"][0]["files"]), 1)
        # folder chosen on this computer: copies and exports go there, team copies stay listed
        chosen = self.dir / "chosen backups"
        self.assertEqual(self.call("PUT", "settings", {"backup_dir": "not/absolute"}, tok)[0], 400)
        self.assertEqual(self.call("PUT", "settings", {"backup_dir": str(chosen)}, vt)[0], 403)
        self.assertEqual(self.call("PUT", "settings", {"backup_dir": str(chosen)}, tok)[0], 200)
        self.assertTrue(self.call("POST", "backups/check", {"path": str(chosen)}, tok)[1]["ok"])
        st, ex = self.call("POST", "backups/export", {"prefs": {"order.docs": "asc", "token": "secret"}}, tok)
        self.assertEqual(st, 200)
        self.assertEqual(Path(ex["dir"]), chosen)
        bk = self.call("GET", "backups", token=tok)[1]
        self.assertEqual([p["place"] for p in bk["places"]], ["team", "chosen"])
        self.assertEqual(bk["places"][1]["files"][0]["kind"], "json")
        dl = self.call("POST", "backups/export", {"target": "download"}, tok)[1]
        self.assertEqual(dl["format"], "regtester-export")
        # change something, preview and restore from the listed file
        self.call("PUT", f"records/{rec['id']}", {"record": {"title": "Changed after export"}, "version": 2}, tok)
        prev = self.call("POST", "backups/preview", {"name": ex["name"], "place": "chosen"}, tok)[1]
        self.assertEqual(prev["sections"]["specs"]["update"], 1)
        res = self.call("POST", "backups/restore-json", {"name": ex["name"], "place": "chosen", "sections": ["specs"], "prefs": True}, tok)[1]
        self.assertEqual(res["updated"], 1)
        self.assertEqual(res["prefs"], {"order.docs": "asc"})
        self.assertEqual(next(r for r in self.call("GET", "records?section=specs", token=tok)[1] if r["id"] == rec["id"])["title"], "B")
        self.assertEqual(self.call("POST", "backups/preview", {"data": {"format": "x"}}, tok)[0], 400)
        self.assertEqual(self.call("POST", "backups/restore", {"name": ex["name"], "place": "chosen"}, tok)[0], 400)
        self.assertEqual(self.call("POST", "backups/export", {}, vt)[0], 403)
        self.call("PUT", "settings", {"backup_dir": ""}, tok)
        # images: upload, read with the header or the cookie, not without a login
        png = b"\x89PNG\r\n\x1a\n" + b"api" * 20
        st, att = self.call("POST", "att", {"data_url": "data:image/png;base64," + base64.b64encode(png).decode()}, tok)
        self.assertEqual(st, 201)
        self.assertEqual(self.call("POST", "att", {"data_url": "data:image/png;base64,AAAA"}, vt)[0], 403)
        url = self.base.replace("/api/", "") + att["url"]
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(url)
        self.assertEqual(cm.exception.code, 401)
        req = urllib.request.Request(url, headers={"Cookie": "rt_token=" + vt})
        with urllib.request.urlopen(req) as r:
            self.assertEqual((r.headers["Content-Type"], r.read()), ("image/png", png))
        self.assertEqual(self.call("GET", "att/stats", token=tok)[1]["unused"], 1)
        self.assertEqual(self.call("POST", "att/cleanup", {}, vt)[0], 403)
        self.assertEqual(self.call("POST", "att/cleanup", {}, tok)[1]["removed"], 1)
        # static files
        with urllib.request.urlopen(self.base.replace("/api/", "/")) as r:
            self.assertIn(b"regTester", r.read())
        with self.assertRaises(urllib.error.HTTPError):
            urllib.request.urlopen(self.base.replace("/api/", "/") + "../backend/db.py")


if __name__ == "__main__":
    unittest.main()
