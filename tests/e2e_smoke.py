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

            # timeline: excel import + generator
            page.goto(BASE + "#timeline"); page.wait_for_selector(".page-head")
            page.evaluate("localStorage.setItem('rt.lang', JSON.stringify('en'))"); page.reload(); page.wait_for_selector(".page-head")
            upload("Import Excel", "timeline_2027.xlsx")
            tl = api("records?section=timeline", token)
            assert len(tl) >= 25, f"timeline import: {len(tl)}"
            kinds = {r["kind"] for r in tl}
            assert {"sprint", "planning", "review", "regtest", "qa", "deployment", "holiday"} <= kinds, kinds
            assert any(r["data"]["start"] == "2027-01-04" for r in tl), "date conversion"
            page.get_by_role("button", name="Generate year").click()
            page.click(".dialog footer .btn.primary"); page.wait_for_timeout(600)
            assert len(api("records?section=timeline", token)) > 80, "generator"
            for view in ["Calendar", "Year", "List", "Timeline", "History"]:
                page.get_by_role("tab", name=view).click(); page.wait_for_timeout(250)

            # coverage
            page.goto(BASE + "#coverage"); page.wait_for_selector(".page-head")
            upload("Import release notes", "release_notes.docx")
            feats = api("records?section=features", token)
            assert {f["key"] for f in feats} >= {"FN-1042", "FN-1051", "FN-1055", "FN-1060"}, feats
            upload("Import test export", "tests_export.xlsx")
            assert len(api("records?section=tests", token)) == 6

            # specs
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
            specs = api("records?section=specs", token)
            assert {s["kind"] for s in specs} >= {"bug", "issue", "procedure"}, specs
            assert any(s["key"] == "PR-130" for s in specs), [s["title"] for s in specs]
            page.fill("#spec-q", "costcenter type:bug"); page.wait_for_timeout(400)
            assert page.locator("article").count() == 1, page.locator("article").count()
            page.fill("#spec-q", "sandbx~"); page.wait_for_timeout(400)
            assert page.locator("article").count() >= 1, "fuzzy"
            page.locator("article").first.click(); page.wait_for_selector(".drawer")
            page.locator(".drawer").get_by_role("tab", name="History").click(); page.wait_for_timeout(300)
            page.keyboard.press("Escape")

            # triage
            page.goto(BASE + "#triage"); page.wait_for_selector(".page-head")
            upload("Import results", "regtest_run_2026-10-31.csv")
            upload("Import results", "regtest_run_2026-11-03.csv")
            assert len(api("records?section=runs", token)) == 2
            text = page.inner_text(".page")
            assert "New" in text and "Resolved" in text, text[:400]

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
                    assert "Error" not in page.inner_text(".page")[:60]
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
