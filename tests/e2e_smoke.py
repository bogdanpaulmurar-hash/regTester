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
import urllib.error
import urllib.request
from datetime import datetime
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
            # list order: newest first by default, the switch reverses it and is remembered
            def list_starts():
                cells = page.locator(".page table.t tr.click td:nth-child(3)").all_inner_texts()
                return [datetime.strptime(c.strip().replace("Sept", "Sep"), "%d %b %Y") for c in cells if c.strip()]
            page.get_by_role("tab", name="List").click(); page.wait_for_timeout(300)
            starts = list_starts()
            assert len(starts) > 20 and starts == sorted(starts, reverse=True), starts[:5]
            page.locator(".order-toggle").first.click(); page.wait_for_timeout(300)
            assert list_starts() == sorted(starts), "oldest first"
            assert page.evaluate("localStorage.getItem('rt.order.timeline.list')") == '"asc"'
            page.reload(); page.wait_for_selector(".order-toggle")
            assert page.locator(".order-toggle").first.get_attribute("data-order") == "asc"
            page.locator(".order-toggle").first.click(); page.wait_for_timeout(300)
            assert list_starts() == sorted(starts, reverse=True), "back to newest first"

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

            # KPIs lead to the elements behind the number, with the filter applied and a notice to remove it
            page.goto(BASE + "#dashboard"); page.wait_for_selector("[data-kpi=err_k_open]")
            n_open = int(page.inner_text("[data-kpi=err_k_open] .v"))
            page.click("[data-kpi=err_k_open]"); page.wait_for_selector("#drill-band")
            assert page.url.endswith("#triage"), page.url
            assert page.locator(".page table.t tbody tr").count() == n_open, (n_open, page.locator(".page table.t tbody tr").count())
            page.click("[data-kpi=err_k_new]"); page.wait_for_timeout(300)
            assert page.locator(".page table.t tbody tr").count() == 2 and "EI-150" in page.inner_text(".page table.t")
            page.click("#drill-clear"); page.wait_for_timeout(300)
            assert page.locator("#drill-band").count() == 0
            page.click("[data-kpi=err_k_open]"); page.wait_for_timeout(300)
            # error panel: fields from the export read-only, notes with a pasted screenshot, ‹ › through the list
            page.locator(".page table.t tbody tr").first.click(); page.wait_for_selector(".drawer .rt-area")
            first_title = page.inner_text(".drawer header h2")
            page.click("#ed-next"); page.wait_for_timeout(300)
            assert page.inner_text(".drawer header h2") != first_title
            page.click("#ed-prev"); page.wait_for_timeout(300)
            assert page.inner_text(".drawer header h2") == first_title
            page.click(".drawer .rt-area"); page.keyboard.type("Seen on the test system ")
            page.evaluate("""() => new Promise(res => {
              const c = document.createElement('canvas'); c.width = 40; c.height = 30;
              const g = c.getContext('2d'); g.fillStyle = '#c00'; g.fillRect(0, 0, 40, 30);
              c.toBlob(b => {
                const dt = new DataTransfer(); dt.items.add(new File([b], 'shot.png', { type: 'image/png' }));
                document.querySelector('.drawer .rt-area').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
                res();
              }, 'image/png');
            })""")
            page.wait_for_selector(".drawer .rt-area img[src^='/api/att/']")
            page.wait_for_function("document.querySelector('.drawer .rt-area img').naturalWidth === 40", timeout=5000)  # served with the image cookie
            page.click("#ed-save"); page.wait_for_timeout(600)
            noted = next(e for e in api("records?section=errors", token) if e["key"] == first_title.split(" · ")[0])
            assert "/api/att/" in noted["data"]["notes"] and "test system" in noted["data"]["notes"], noted["data"]
            upload("Import Error Management", "error_management_export_2.xlsx")
            again = next(e for e in api("records?section=errors", token) if e["id"] == noted["id"])
            assert again["data"].get("notes") == noted["data"]["notes"], again["data"]
            page.get_by_role("tab", name="Error items").click(); page.wait_for_timeout(300)
            page.locator(".page table.t tbody tr", has_text=noted["key"]).first.click(); page.wait_for_selector(".drawer [role=tab]")
            page.locator(".drawer [role=tab]", has_text="History").click(); page.wait_for_timeout(500)
            for i in range(page.locator(".drawer .btn", has_text="Compare").count()):
                page.locator(".drawer .btn", has_text="Compare").nth(i).click(); page.wait_for_timeout(150)
            assert page.locator(".drawer .hist-thumbs img").count() >= 1
            page.keyboard.press("Escape")
            # own status set in regTester wins over the export and survives the next import; links to other items
            tc = sorted(api("records?section=tests", token), key=lambda r: r["key"])[0]
            page.locator(".page table.t tbody tr", has_text=noted["key"]).first.click(); page.wait_for_selector("#ed-data-own_status")
            page.select_option("#ed-data-own_status", "Cancelled")
            page.wait_for_selector("#lnk-add"); page.click("#lnk-add"); page.wait_for_selector("#lnk-q")
            page.fill("#lnk-q", tc["key"]); page.wait_for_timeout(200)
            page.locator(".dialog .lnk-open", has_text=tc["key"]).first.click(); page.wait_for_timeout(200)
            assert tc["key"] in page.inner_text("#lnk-card")
            page.click("#ed-save"); page.wait_for_timeout(600)
            own = next(e for e in api("records?section=errors", token) if e["id"] == noted["id"])
            assert own["data"]["own_status"] == "Cancelled" and own["data"]["own_status_by"] and own["data"]["rel"][0]["id"] == tc["id"], own["data"]
            upload("Import Error Management", "error_management_export_2.xlsx")
            own2 = next(e for e in api("records?section=errors", token) if e["id"] == noted["id"])
            assert own2["data"]["own_status"] == "Cancelled" and own2["data"]["rel"] == own["data"]["rel"], own2["data"]
            page.get_by_role("tab", name="Error items").click(); page.wait_for_timeout(300)
            # counted by the own status: not open any more, found with the status filter
            page.select_option(".page select[aria-label='All statuses']", "Cancelled"); page.wait_for_timeout(300)
            assert "✎ Cancelled" in page.inner_text(".page table.t") and noted["key"] in page.inner_text(".page table.t")
            # the test case shows the error as a backlink; the preview opens it in its own page
            page.locator(".page table.t tbody tr", has_text=noted["key"]).first.click(); page.wait_for_selector("#lnk-card .lnk-open")
            page.locator("#lnk-card .lnk-open", has_text=tc["key"]).first.click(); page.wait_for_selector("#lnk-go")
            page.click("#lnk-go"); page.wait_for_selector(".drawer #lnk-card .lnk-open", timeout=8000)
            assert "#coverage" in page.url and tc["title"] in page.inner_text(".drawer header h2"), page.url
            assert noted["key"] in page.inner_text(".drawer #lnk-card")
            page.keyboard.press("Escape")
            # reports per sprint / release / month, with the elements behind each number
            page.goto(BASE + "#reports"); page.wait_for_selector(".page-head")
            for g in ["Release", "Month", "Sprint"]:
                page.locator(".page .seg button", has_text=g).first.click(); page.wait_for_timeout(300)
                assert page.locator(".page > .card > pre.pre").count() == 0
            if page.locator("#rep-overview tbody tr").count():
                page.locator("#rep-overview tbody tr").last.click(); page.wait_for_selector("#rep-detail")
            page.locator(".page .seg button", has_text="Month").first.click(); page.wait_for_selector("#rep-overview")
            assert "2026" in page.inner_text("#rep-overview"); page.locator("#rep-overview tbody tr").first.click(); page.wait_for_selector("#rep-detail")
            if page.locator("#rep-detail .lnk-open").count():
                page.locator("#rep-detail .lnk-open").first.click(); page.wait_for_selector("#lnk-go"); page.keyboard.press("Escape")
            # dashboard → catalogue (uncategorised), timeline quality
            page.goto(BASE + "#dashboard"); page.wait_for_selector("[data-kpi=cat_k_uncat]")
            page.click("[data-kpi=cat_k_uncat]"); page.wait_for_selector("#drill-band")
            assert "#coverage" in page.url and page.is_checked(".page .check input[type=checkbox]")
            page.click("#drill-clear"); page.wait_for_timeout(300)
            page.goto(BASE + "#dashboard"); page.wait_for_selector("[data-kpi=dash_k_tl_issues]")
            page.click("[data-kpi=dash_k_tl_issues]"); page.wait_for_timeout(600)
            assert page.locator(".page [role=tab][aria-selected=true]").first.inner_text().startswith("Data quality")

            # PO sessions are hidden by default; show them again from Administration
            assert page.locator("nav a[data-page=transcripts]").count() == 0, "PO page should be hidden"
            page.goto(BASE + "#admin"); page.wait_for_selector(".page-head")
            page.get_by_role("tab", name="Team").click(); page.wait_for_selector("#team-path")
            page.get_by_role("tab", name="Pages").click(); page.wait_for_selector("#pg-transcripts")
            page.check("#pg-transcripts"); page.fill("#pg-n-transcripts", "Demo sessions")
            page.locator(".page .btn.primary").last.click(); page.wait_for_timeout(600)
            assert page.locator("nav a[data-page=transcripts]").inner_text().strip().endswith("Demo sessions")

            # backups: chosen folder, full JSON export, restore with preview
            page.get_by_role("tab", name="Backups").click(); page.wait_for_selector("#bk-dir")
            bkdir = data / "my backups"
            page.fill("#bk-dir", str(bkdir)); page.get_by_role("button", name="Check").click(); page.wait_for_timeout(400)
            assert "The folder can be written." in page.inner_text(".page"), page.inner_text(".page")[:400]
            page.get_by_role("button", name="Save", exact=True).first.click(); page.wait_for_timeout(700)
            page.get_by_role("button", name="Export to folder").click(); page.wait_for_timeout(900)
            exports = list(bkdir.glob("regtester-*.json"))
            assert len(exports) == 1, exports
            assert len(json.loads(exports[0].read_text(encoding="utf-8"))["attachments"]) == 1
            assert "Chosen folder" in page.inner_text(".page")
            s0 = api("records?section=specs", token)[0]
            api(f"records/{s0['id']}", token, "PUT", {"record": {"title": "Changed after export"}, "version": s0["version"]})
            page.get_by_role("button", name="Restore…").first.click(); page.wait_for_selector(".dialog")
            assert "Specifications" in page.inner_text(".dialog")
            page.get_by_role("button", name="Restore selected").click(); page.wait_for_timeout(300)
            page.locator(".dialog").last.get_by_role("button", name="Restore", exact=True).click(); page.wait_for_timeout(2000)
            page.wait_for_selector(".page-head")
            s1 = next(r for r in api("records?section=specs", token) if r["id"] == s0["id"])
            assert s1["title"] == s0["title"], (s0["title"], s1["title"])
            assert any(h["action"] == "update" and h["record_id"] == s0["id"] for h in api("history?limit=50", token))

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
            page.goto(BASE + "#docs"); page.wait_for_selector("#sp-title")
            page.get_by_role("tab", name="Write").click(); page.wait_for_selector("#doc-title")
            page.fill("#doc-title", "Filtru avansat clienți"); page.fill("#doc-code", "FN-1051")
            page.fill("#doc-s-purpose", "Filter invoices by region"); page.fill("#doc-s-steps", "Open list\nApply filter")
            page.get_by_role("button", name="Save").first.click(); page.wait_for_timeout(400)
            assert len(api("records?section=docs", token)) == 1

            # Word specification: fill, save, generate .docx, import it back
            page.get_by_role("tab", name="Word specification").click(); page.wait_for_selector("#sp-title")
            page.fill("#sp-title", "Invoice filter by region -US-0042"); page.fill("#sp-path", "Billing › Other")
            page.locator(".rt-area").first.click(); page.keyboard.type("Short description")
            page.wait_for_timeout(400)
            page.locator(".page .btn.primary").first.click(); page.wait_for_timeout(500)
            spec_docs = [d for d in api("records?section=docs", token) if d["data"].get("format") == "regspec"]
            assert len(spec_docs) == 1, spec_docs
            assert "Short description" in spec_docs[0]["data"]["sections"][0]["html"], spec_docs[0]["data"]["sections"][0]
            with page.expect_download() as dl:
                page.get_by_role("button", name="Generate Word (.docx)").click()
            docx = data / "spec.docx"; dl.value.save_as(str(docx))
            assert docx.stat().st_size > 5000 and docx.read_bytes()[:2] == b"PK", docx.stat().st_size
            page.get_by_role("button", name="New specification").click(); page.wait_for_timeout(200)
            with page.expect_file_chooser() as fc:
                page.get_by_role("button", name="Import Word (.docx)").click()
            fc.value.set_files(str(docx)); page.wait_for_timeout(1200)
            assert page.input_value("#sp-title") == "Invoice filter by region -US-0042"
            assert page.input_value("#sp-path") == "Billing › Other"
            assert page.locator(".spec-sec").count() == 7, page.locator(".spec-sec").count()

            # system pages and languages
            for lang in ["ro", "de", "en"]:
                page.evaluate(f"localStorage.setItem('rt.lang', JSON.stringify('{lang}'))")
                page.reload(); page.wait_for_selector(".page-head", timeout=8000)
                for pg in ["dashboard", "reports", "timeline", "coverage", "triage", "transcripts", "docs", "specs", "history", "logs", "settings", "admin"]:
                    page.evaluate(f"location.hash = '{pg}'"); page.wait_for_timeout(600); page.wait_for_selector(".page-head", timeout=8000)
                    assert page.locator(".page > .card > pre.pre").count() == 0, f"{lang}/{pg}: " + page.inner_text(".page")[:300]
            # every newest/oldest switch on every tab works (JavaScript errors are collected above)
            toggles = 0
            for pg in ["reports", "timeline", "coverage", "triage", "transcripts", "docs", "specs", "history", "logs"]:
                page.evaluate(f"location.hash = '{pg}'"); page.wait_for_timeout(500); page.wait_for_selector(".page-head")
                for i in range(page.locator(".page [role=tab]").count()):
                    page.locator(".page [role=tab]").nth(i).click(); page.wait_for_timeout(250)
                    for _ in range(2):
                        for j in range(page.locator(".page .order-toggle").count()):
                            page.locator(".page .order-toggle").nth(j).click(); page.wait_for_timeout(150); toggles += 1
            assert toggles >= 20, toggles
            hist = api("history?limit=1000", token)
            assert any(h["action"] == "import" for h in hist)
            logs = api("logs?limit=200", token)
            assert any("imported" in l["message"] for l in logs)

            # shared folder: copy the data there, sign in again, survive an outage read-only
            share = data / "share"
            share.mkdir()
            n_specs = len(api("records?section=specs", token))
            page.evaluate("location.hash = 'admin'"); page.wait_for_selector(".page-head")
            page.get_by_role("tab", name="Team").click(); page.wait_for_selector("#team-path")
            page.fill("#team-path", str(share)); page.get_by_role("button", name="Connect").click()
            page.get_by_role("button", name="Copy my data").click()
            page.wait_for_selector("#login-user", timeout=8000)
            assert page.locator("#login-shared").count() == 0
            page.fill("#login-user", "admin"); page.fill("#login-pass", "secret1"); page.click("button[type=submit]")
            page.wait_for_selector(".page-head", timeout=8000)
            token = page.evaluate("JSON.parse(localStorage.getItem('rt.token'))")
            st = api("shared", token)
            assert st["mode"] == "shared" and (share / "regtester.db").is_file(), st
            assert len(api("records?section=specs", token)) == n_specs
            away = data / "share-away"
            share.rename(away)
            for _ in range(60):
                if api("shared", token)["mode"] == "offline":
                    break
                time.sleep(0.5)
            page.reload(); page.wait_for_selector("#shared-band .band-warn", timeout=8000)
            assert "read-only on the local copy" in page.inner_text("#shared-band")
            try:
                api("records", token, "POST", {"section": "specs", "record": {"title": "x"}})
                raise AssertionError("write accepted while read-only")
            except urllib.error.HTTPError as exc:
                assert exc.code == 503, exc.code
            away.rename(share)
            for _ in range(60):
                if api("shared", token)["mode"] == "shared":
                    break
                time.sleep(0.5)
            api("records", token, "POST", {"section": "specs", "record": {"title": "after outage"}})

            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
                page.evaluate("localStorage.setItem('rt.lang', JSON.stringify('ro'))")
                page.reload(); page.wait_for_timeout(500)
                for pg in ["dashboard", "reports", "timeline", "coverage", "triage", "specs"]:
                    page.evaluate(f"location.hash = '{pg}'"); page.wait_for_timeout(900)
                    page.screenshot(path=str(args.shots / f"desk-{pg}.png"), full_page=pg == "reports")
                page.evaluate("location.hash = 'triage'"); page.wait_for_timeout(900)
                page.locator(".page [role=tab]").first.click(); page.wait_for_timeout(400)
                page.locator(".page table.t tbody tr").first.click(); page.wait_for_selector("#lnk-card"); page.wait_for_timeout(500)
                page.screenshot(path=str(args.shots / "desk-error-panel.png"))
                page.keyboard.press("Escape")
                m = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
                m.goto(BASE); m.evaluate(f"localStorage.setItem('rt.token', JSON.stringify('{token}'))")
                m.reload(); m.wait_for_timeout(600)
                for pg in ["dashboard", "reports", "timeline", "specs"]:
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
