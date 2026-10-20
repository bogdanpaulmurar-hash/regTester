"""Browser smoke test (needs: pip install playwright && playwright install chromium).

    python tests/e2e_smoke.py [--shots DIR]

Starts regTester on a temporary database, logs in, imports every sample file through the UI,
opens every page in all three languages and fails on any JavaScript error.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "sample-data"
PORT = 8811
BASE = f"http://127.0.0.1:{PORT}/"


def api(path, token, method="GET", body=None):
    req = urllib.request.Request(BASE + "api/" + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", type=Path)
    args = ap.parse_args()
    data = Path(tempfile.mkdtemp())
    proc = subprocess.Popen([sys.executable, str(ROOT / "regtester.py"), "--no-tray", "--data", str(data), "--port", str(PORT)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    errors = []
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(BASE + "api/health"); break
            except OSError:
                time.sleep(0.2)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1366, "height": 900}, accept_downloads=True)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.on("console", lambda m: m.type == "error" and "fonts.g" not in m.text and "Failed to load resource" not in m.text and errors.append(f"console: {m.text}"))
            page.goto(BASE)
            page.fill("#login-user", "admin"); page.fill("#login-pass", "admin"); page.click("button[type=submit]")
            page.wait_for_selector("#pw-new")
            page.fill("#pw-old", "admin"); page.fill("#pw-new", "secret1"); page.fill("#pw-rep", "secret1")
            page.click(".dialog footer .btn.primary")
            page.wait_for_timeout(400)
            token = page.evaluate("JSON.parse(localStorage.getItem('rt.token'))")

            def upload(button_text, file, confirm=True):
                page.get_by_role("button", name=button_text).first.click()
                with page.expect_file_chooser() as fc:
                    page.click(".dialog .drop")
                fc.value.set_files(str(SAMPLES / file))
                if confirm:
                    page.wait_for_selector(".dialog footer .btn.primary:not([disabled])", timeout=8000)
                    page.click(".dialog footer .btn.primary")
                    page.wait_for_selector(".dialog", state="detached", timeout=8000)
                page.wait_for_timeout(300)

            # timeline: SharePoint export + quality check + next release
            page.goto(BASE + "#timeline"); page.wait_for_selector(".page-head")
            page.evaluate("localStorage.setItem('rt.lang', JSON.stringify('en'))"); page.reload(); page.wait_for_selector(".page-head")
            upload("Import SharePoint export", "timeline_sharepoint_export.xlsx")
            tl = api("records?section=timeline", token)
            assert len(tl) >= 60, f"timeline import: {len(tl)}"
            kinds = {r["kind"] for r in tl}
            assert {"sprint", "review", "deployment", "integration", "regtest", "performance", "protocol", "documentation", "holiday"} <= kinds, kinds
            prod = [r for r in tl if r["title"] == "V8.3 Deployment PROD"]
            assert len(prod) == 1 and prod[0]["data"]["start"] == "2026-11-14" and prod[0]["data"]["env"] == "PROD", prod
            assert prod[0]["data"].get("dup_count") == 2, "duplicate merged"
            hol = [r for r in tl if r["kind"] == "holiday"]
            assert hol and hol[0]["data"].get("substitute"), hol
            page.get_by_role("tab", name="Data quality").click(); page.wait_for_timeout(300)
            q = page.inner_text(".page")
            assert "Dates copied from another release" in q and "End before start" in q, q[:600]
            n_before = len(tl)
            page.get_by_role("button", name="Plan next release").click()
            page.wait_for_selector(".dialog"); page.get_by_role("button", name="Create release").click(); page.wait_for_timeout(700)
            tl2 = api("records?section=timeline", token)
            assert len(tl2) > n_before + 15, (n_before, len(tl2))
            assert any(r["title"] == "V8.4 Deployment PROD" and r["data"]["start"] > "2027-01-01" for r in tl2), "clone"
            for view in ["Calendar", "Year", "List", "Timeline", "History"]:
                page.get_by_role("tab", name=view).click(); page.wait_for_timeout(250)

            # test case catalogue + coverage
            page.goto(BASE + "#coverage"); page.wait_for_selector(".page-head")

            def pick(button_text, file):
                with page.expect_file_chooser() as fc:
                    page.get_by_role("button", name=button_text).first.click()
                fc.value.set_files(str(SAMPLES / file))
                page.wait_for_selector(".dialog footer .btn.primary")
                page.click(".dialog footer .btn.primary")
                page.wait_for_selector(".dialog", state="detached", timeout=8000)
                page.wait_for_timeout(300)

            pick("Import test case export", "testcases_list_export.xlsx")
            tests = api("records?section=tests", token)
            assert len(tests) == 13, len(tests)
            t1 = next(x for x in tests if x["key"] == "demo-IA-1103")
            assert t1["data"]["app"] == "Web Client" and t1["data"]["quality"] == "High" and t1["data"]["main"] == "Master Data", t1
            pick("Import test case export", "testcases_tree_export.xlsx")
            tests = api("records?section=tests", token)
            assert next(x for x in tests if x["key"] == "demo-IA-1602")["data"]["main"] == "Orders", "tree merge"
            upload("Import release notes", "release_notes.docx")
            feats = api("records?section=features", token)
            assert {f["key"] for f in feats} >= {"FN-1042", "FN-1051", "FN-1055", "FN-1060"}, feats
            page.get_by_role("tab", name="Matrix").click(); page.wait_for_timeout(300)

            # specs (incl. RegTest documents from Document Management)
            page.goto(BASE + "#specs"); page.wait_for_selector(".page-head")
            page.get_by_role("button", name="Import").first.click(); page.click(".dialog footer .btn.primary")
            with page.expect_file_chooser() as fc:
                page.click(".dialog .drop")
            fc.value.set_files(str(SAMPLES / "bugs_export.xlsx"))
            page.wait_for_selector(".dialog footer .btn.primary:not([disabled])"); page.click(".dialog footer .btn.primary"); page.wait_for_timeout(500)
            page.get_by_role("button", name="Import").first.click()
            page.select_option(".dialog select >> nth=0", "procedure"); page.click(".dialog footer .btn.primary")
            with page.expect_file_chooser() as fc:
                page.click(".dialog .drop")
            fc.value.set_files(str(SAMPLES / "procedures_onenote_export.docx"))
            page.wait_for_selector(".dialog footer .btn.primary:not([disabled])"); page.click(".dialog footer .btn.primary"); page.wait_for_timeout(500)
            page.get_by_role("button", name="Import").first.click()
            page.select_option(".dialog select >> nth=0", "regspec"); page.click(".dialog footer .btn.primary")
            with page.expect_file_chooser() as fc:
                page.click(".dialog .drop")
            fc.value.set_files(str(SAMPLES / "document_management_export.xlsx"))
            page.wait_for_selector(".dialog footer .btn.primary:not([disabled])"); page.click(".dialog footer .btn.primary"); page.wait_for_timeout(500)
            specs = api("records?section=specs", token)
            assert {s["kind"] for s in specs} >= {"bug", "issue", "procedure", "regspec"}, specs
            rs = next(s for s in specs if s["key"] == "DOC-20311")
            assert rs["data"]["release"] == "V8.3" and rs["data"]["sprint"] == "S2" and rs["data"]["idents"] == ["US-5101", "US-5102"], rs
            assert any(s["key"] == "PR-130" for s in specs), [s["title"] for s in specs]
            page.fill("#spec-q", "costcenter type:bug"); page.wait_for_timeout(400)
            assert page.locator("article").count() == 1, page.locator("article").count()
            page.fill("#spec-q", "sandbx~"); page.wait_for_timeout(400)
            assert page.locator("article").count() >= 1, "fuzzy"
            page.locator("article").first.click(); page.wait_for_selector(".drawer")
            page.locator(".drawer").get_by_role("tab", name="History").click(); page.wait_for_timeout(300)
            page.keyboard.press("Escape")

            # errors & runs
            page.goto(BASE + "#triage"); page.wait_for_selector(".page-head")
            upload("Import Error Management", "error_management_export_1.xlsx")
            upload("Import Error Management", "error_management_export_2.xlsx")
            errs = api("records?section=errors", token)
            assert len(errs) == 10, len(errs)
            e110 = next(e for e in errs if e["key"] == "EI-110")
            assert e110["data"]["status"] == "Solved" and e110["data"]["prev_status"] == "Assigned" and e110["data"]["runs"] == [1, 5, 135], e110
            snaps = sorted(api("records?section=errsnaps", token), key=lambda r: r["created_at"])
            assert len(snaps) == 2 and snaps[-1]["data"]["added"] == ["EI-150", "EI-151"], snaps[-1]["data"]
            assert len(snaps[-1]["data"]["status"]) == 3, snaps[-1]["data"]["status"]
            text = page.inner_text(".page")
            assert "EI-150" in text, text[:400]
            page.get_by_role("tab", name="Error items").click(); page.wait_for_timeout(300)
            page.get_by_role("tab", name="Run results").click(); page.wait_for_timeout(200)
            upload("Import results", "regtest_run_2026-10-31.csv")
            upload("Import results", "regtest_run_2026-11-03.csv")
            assert len(api("records?section=runs", token)) == 2
            page.get_by_role("tab", name="Run results").click(); page.wait_for_timeout(300)
            text = page.inner_text(".page")
            assert "New" in text and "Resolved" in text, text[:400]

            # PO sessions are hidden by default; show them again from Administration
            assert page.locator("nav a[data-page=transcripts]").count() == 0, "PO page should be hidden"
            page.goto(BASE + "#admin"); page.wait_for_selector(".page-head")
            page.get_by_role("tab", name="Pages").click(); page.wait_for_selector("#pg-transcripts")
            page.check("#pg-transcripts"); page.fill("#pg-n-transcripts", "Demo sessions")
            page.locator(".page .btn.primary").last.click(); page.wait_for_timeout(600)
            assert page.locator("nav a[data-page=transcripts]").inner_text().strip().endswith("Demo sessions")

            # transcripts
            page.goto(BASE + "#transcripts"); page.wait_for_selector(".page-head")
            with page.expect_file_chooser() as fc:
                page.get_by_role("button", name="Upload transcript").click()
            fc.value.set_files(str(SAMPLES / "teams_transcript_sprint41.docx"))
            page.wait_for_selector("text=Clean text")
            clean = page.inner_text(".prose")
            assert "Ravi Kumar" in clean and " uh " not in clean, clean
            page.get_by_role("button", name="Save session").click(); page.wait_for_timeout(400)
            assert len(api("records?section=transcripts", token)) == 1

            # docs
            page.goto(BASE + "#docs"); page.wait_for_selector("#doc-title")
            page.fill("#doc-title", "Filtru avansat clienți"); page.fill("#doc-code", "FN-1051")
            page.fill("#doc-s-purpose", "Filter invoices by region"); page.fill("#doc-s-steps", "Open list\nApply filter")
            page.get_by_role("button", name="Save").first.click(); page.wait_for_timeout(400)
            assert len(api("records?section=docs", token)) == 1

            # system pages and languages
            for lang in ["ro", "de", "en"]:
                page.evaluate(f"localStorage.setItem('rt.lang', JSON.stringify('{lang}'))")
                page.reload(); page.wait_for_selector(".page-head", timeout=8000)
                for pg in ["dashboard", "timeline", "coverage", "triage", "transcripts", "docs", "specs", "history", "logs", "settings", "admin"]:
                    page.evaluate(f"location.hash = '{pg}'"); page.wait_for_timeout(600); page.wait_for_selector(".page-head", timeout=8000)
                    assert page.locator(".page > .card > pre.pre").count() == 0, f"{lang}/{pg}: " + page.inner_text(".page")[:300]
            hist = api("history?limit=1000", token)
            assert any(h["action"] == "import" for h in hist)
            logs = api("logs?limit=200", token)
            assert any("imported" in l["message"] for l in logs)

            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
                page.evaluate("localStorage.setItem('rt.lang', JSON.stringify('ro'))")
                page.reload(); page.wait_for_timeout(500)
                for pg in ["dashboard", "timeline", "coverage", "triage", "specs"]:
                    page.evaluate(f"location.hash = '{pg}'"); page.wait_for_timeout(900)
                    page.screenshot(path=str(args.shots / f"desk-{pg}.png"))
                m = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
                m.goto(BASE); m.evaluate(f"localStorage.setItem('rt.token', JSON.stringify('{token}'))")
                m.reload(); m.wait_for_timeout(600)
                for pg in ["dashboard", "timeline", "specs"]:
                    m.evaluate(f"location.hash = '{pg}'"); m.wait_for_timeout(900)
                    m.screenshot(path=str(args.shots / f"phone-{pg}.png"))
            browser.close()
    finally:
        if errors:
            print("JS errors:\n" + "\n".join(errors))
        proc.terminate(); proc.wait(5)
        shutil.rmtree(data, ignore_errors=True)
    if errors:
        print("\n".join(errors)); sys.exit(1)
    print("E2E OK")


if __name__ == "__main__":
    main()
