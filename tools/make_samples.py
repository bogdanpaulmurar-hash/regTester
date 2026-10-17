"""Create fictional sample files for trying every import in regTester.

    python tools/make_samples.py        -> writes into sample-data/

Needs openpyxl and python-docx only for the .xlsx/.docx samples (pip install openpyxl python-docx);
the CSV/VTT samples are written with the standard library.
"""
from __future__ import annotations

import csv
import datetime as dt
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "sample-data"


def write_csv(name, header, rows):
    with open(OUT / name, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh, delimiter=";")
        w.writerow(header)
        w.writerows(rows)


def main():
    OUT.mkdir(exist_ok=True)
    # ---------------------------------------------------------- timeline
    rows = []
    start = dt.date(2027, 1, 4)
    for i in range(6):
        s = start + dt.timedelta(weeks=2 * i)
        e = s + dt.timedelta(days=11)
        rel = f"R-2027.{i // 3 + 1}"
        rows += [["Sprint", f"Sprint {60 + i}", s, e, rel, f"Sprint {60 + i}", "Team Blau", ""],
                 ["Sprintplanung", f"Sprint {60 + i} Planning", s, s, rel, f"Sprint {60 + i}", "PO", "Teams"],
                 ["Review", f"Sprint {60 + i} Review", e, e, rel, f"Sprint {60 + i}", "PO", "Demo + video"]]
        if i % 3 == 2:
            r0 = e + dt.timedelta(days=3)
            rows += [["Regressionstest", f"{rel} Regtest", r0, r0 + dt.timedelta(days=8), rel, "", "QA", ""],
                     ["Q&A", f"{rel} Q&A", r0 + dt.timedelta(days=11), r0 + dt.timedelta(days=14), rel, "", "QA", ""],
                     ["Go-Live", f"{rel} Deployment", r0 + dt.timedelta(days=16), r0 + dt.timedelta(days=16), rel, "", "Ops", ""]]
    rows.append(["Feiertag", "Neujahr", dt.date(2027, 1, 1), dt.date(2027, 1, 1), "", "", "", ""])
    header = ["Typ", "Titel", "Beginn", "Ende", "Release", "Sprint", "Verantwortlich", "Notizen"]
    try:
        from openpyxl import Workbook
        wb = Workbook(); ws = wb.active; ws.title = "Timeline 2027"
        ws.append(header)
        for r in rows:
            ws.append(r)
        for c in ws["C"][1:] + ws["D"][1:]:
            c.number_format = "DD.MM.YYYY"
        wb.save(OUT / "timeline_2027.xlsx")

        wb = Workbook(); ws = wb.active; ws.title = "Testfaelle"
        ws.append(["Test ID", "Name", "Ordner", "Anforderung", "Status"])
        tests = [("TC-2201", "Import orders csv happy path", "Orders", "FN-1055"), ("TC-2210", "Reminder mail 3 days before due", "Invoice", "FN-1060"),
                 ("TC-2216", "Auditor read only access", "Admin", "FN-1036"), ("TC-2220", "Cost center mandatory on order", "Orders", "FN-1047"),
                 ("TC-2230", "Report labels in German", "Reports", "FN-1062"), ("TC-2240", "Invoice list filter by region", "Invoice", "")]
        for tc in tests:
            ws.append([*tc, "Ready"])
        wb.save(OUT / "tests_export.xlsx")

        wb = Workbook(); ws = wb.active; ws.title = "Bugs"
        ws.append(["Issue key", "Issue Type", "Summary", "Description", "Status", "Component", "Fix Version", "Labels"])
        ws.append(["BUG-2301", "Bug", "Export button disabled for auditor", "Auditor sees the export button greyed out although read access exists.", "Open", "Admin", "R-2026.4", "auditor, export"])
        ws.append(["BUG-2302", "Bug", "Cost center not copied to invoice", "When an order becomes an invoice the cost center is empty.", "In Progress", "Invoice", "R-2026.4", "costcenter"])
        ws.append(["ISS-95", "Issue", "Sandbox mail server not reachable", "Reminder mails cannot be tested in sandbox since Monday.", "Open", "General", "", "sandbox, mail"])
        wb.save(OUT / "bugs_export.xlsx")
    except ImportError:
        print("openpyxl missing: .xlsx samples skipped")
    write_csv("timeline_2027.csv", header, [[*r[:2], r[2].strftime("%d.%m.%Y"), r[3].strftime("%d.%m.%Y"), *r[4:]] for r in rows])

    # ----------------------------------------------------- release notes
    feats = [("FN-1042", "Export PDF facturi", "S39", "Invoice", "Invoices can be exported as PDF from the list."),
             ("FN-1051", "Filtru avansat clienți", "S40", "Invoice", "Filter invoices by customer region and cost center."),
             ("FN-1055", "Import comenzi din CSV", "S40", "Orders", "Orders can be imported from CSV files."),
             ("FN-1060", "Notificări e-mail scadență", "S41", "Invoice", "Reminder e-mail three days before due date.")]
    write_csv("release_notes.csv", ["ID", "Title", "Sprint", "Release", "Module", "Description"], [[k, t, s, "R-2026.4", m, d] for k, t, s, m, d in feats])
    try:
        from docx import Document
        doc = Document()
        doc.add_heading("Release Notes R-2026.4", 0)
        for k, t, s, m, d in feats:
            doc.add_heading(f"{k} {t}", level=2)
            doc.add_paragraph(f"Sprint {s} · Modul {m}")
            doc.add_paragraph(d)
        doc.save(OUT / "release_notes.docx")

        doc = Document()
        doc.add_heading("Prozeduren Regtest", 0)
        doc.add_heading("PR-130 Mahnlauf im Sandbox prüfen", level=1)
        doc.add_paragraph("Mahnlauf manuell starten, Protokoll prüfen, E-Mail im Testpostfach kontrollieren.")
        doc.add_paragraph("Kunde K-71 verwenden", style="List Bullet")
        doc.add_paragraph("Fälligkeit auf heute + 3 Tage setzen", style="List Bullet")
        doc.add_heading("PR-131 CSV-Import von Aufträgen", level=1)
        doc.add_paragraph("Datei mit 10 Zeilen importieren, Fehlerprotokoll pro Zeile prüfen.")
        t = doc.add_table(rows=3, cols=2)
        for i, (a, b) in enumerate([("Feld", "Erwartung"), ("Trennzeichen", "Semikolon oder Komma"), ("Kodierung", "UTF-8")]):
            t.cell(i, 0).text, t.cell(i, 1).text = a, b
        doc.save(OUT / "procedures_onenote_export.docx")

        doc = Document()
        doc.add_paragraph("Sprint 41 Review")
        for name, time, text in [("Ravi Kumar", "0:12", "so basically uh the in voice reminder will go three days before due date"),
                                 ("Jonas Müller", "0:25", "ähm und das geht auch für Kunden ohne E-Mail Adresse?"),
                                 ("Ravi Kumar", "0:31", "no no only customers with mail, others get the letter like before you know")]:
            doc.add_paragraph(f"{name}   {time}")
            doc.add_paragraph(text)
        doc.save(OUT / "teams_transcript_sprint41.docx")
    except ImportError:
        print("python-docx missing: .docx samples skipped")

    # ----------------------------------------------------- regtest runs
    base = [f"TC-{3000 + i}" for i in range(30)] + ["TC-1800", "TC-1801", "TC-2201", "TC-2220"]
    runs = {
        "2026-10-31": {"TC-1800": "Rounding diff 0.01 in VAT total (expected 714.00, got 714.01)", "TC-1801": "Test data missing: customer K-77",
                       "TC-3007": "Element #btnSave not clickable after 15s", "TC-3008": "Element #btnSave not clickable after 15s"},
        "2026-11-03": {"TC-1800": "Rounding diff 0.01 in VAT total (expected 99.00, got 99.01)", "TC-3007": "Element #btnSave not clickable after 15s",
                       "TC-2220": "Field 'CostCenter' is mandatory (order 90011)"},
    }
    for date, fails in runs.items():
        write_csv(f"regtest_run_{date}.csv", ["Test", "Result", "Error message", "Date"],
                  [[t, "Failed" if t in fails else "Passed", fails.get(t, ""), date] for t in base])

    (OUT / "transcript_sprint41.vtt").write_text(
        "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Ravi K.>okay okay so today uh the in voice reminder</v>\n\n"
        "00:00:04.500 --> 00:00:09.000\n<v Ravi K.>it goes three days before due date for every custom are with e-mail</v>\n\n"
        "00:00:09.500 --> 00:00:12.000\n<v Jonas M.>ähm und was passiert bei Kunden ohne E-Mail?</v>\n\n"
        "00:00:12.500 --> 00:00:16.000\n<v Ravi K.>they get the letter like before, the reg test should check both</v>\n", encoding="utf-8")
    write_csv("glossary.csv", ["Heard as", "Correct term"], [["in voice", "Invoice"], ["custom are", "customer"], ["reg test", "regtest"], ["cost centre", "cost center"]])
    print("Samples written to", OUT)


if __name__ == "__main__":
    main()
