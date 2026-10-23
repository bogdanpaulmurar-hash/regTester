# regTester — note pentru Claude

Unealtă locală pentru perioada de regression test dinaintea fiecărui release: timeline, test cases și acoperire, erori și run-uri, documentație, specificații. Server HTTP Python + SQLite, interfață PWA în browser.

## Comenzi
- Pornire: `start.bat` (fără consolă, icon în tray) sau `python regtester.py --no-tray`; se deschide `http://127.0.0.1:8765`
- Teste backend: `python -m unittest discover -s tests`
- Test complet în browser: `python tests/e2e_smoke.py` (Playwright)
- Acces de urgență: `reset-parola.bat` sau `python regtester.py --reset-password USER` (`--list-users`); un nume necunoscut creează un admin
- Date exemplu: `python tools/make_samples.py` → `sample-data/`
- Demo fără server: `web/index.html` deschis direct
- Versiune (acum 0.3.0): `UI_VERSION` în `web/js/version.js` = `__version__` în `backend/__init__.py`. Un modul JS nou se adaugă și în lista `SHELL` din `web/sw.js` (cu `CACHE` incrementat)

## Hartă
- `backend/`: `server.py` (HTTP/API), `db.py` (schemă, istoric, importuri), `auth.py` (utilizatori, roluri, sesiuni), `system.py` (log, autostart, backup), `tray.py`
- `web/`: JavaScript fără build și fără biblioteci externe; `js/parsers.js` citește Excel/Word; `js/docx-spec.js` generează/importă specificația Word (layout: header, titlu, cuprins, secțiuni H1–H3, footer); `js/i18n.js` are toate textele în EN/DE/RO
- Date utilizator: `%LOCALAPPDATA%\regTester` (`regtester.db`, `logs\`, `backups\`)

## Reguli
- Doar biblioteca standard Python (pystray + Pillow opționale pentru tray). Fără `.exe`, fără cloud, fără AI integrat: nicio dată a firmei nu pleacă de pe mașină.
- Exporturile se citesc cum ies din tool: coloane recunoscute după nume sau conținut, rând de titlu sărit, date `dd.mm.yyyy` și `M/D/YYYY`. Timeline-ul vine direct din exportul listei SharePoint.
- În timeline, „Zugewiesen an” pe rândurile de absență = înlocuitorul.
- Orice text nou trece prin i18n în EN/DE/RO. Orice modificare de date intră în Istoric (cine, când, ce), cu restaurare.
- `sample-data/` conține doar date fictive. Datele reale nu intră niciodată în repo.
- Pagina „Sesiuni PO” e ascunsă implicit (poate fi redenumită/refolosită). Exportul de rezultate al run-urilor e amânat la final.
- Analiză + plan, apoi aprobarea utilizatorului, apoi implementare.
- Cod și commit-uri în engleză; README și răspunsurile către utilizator în română.
- Documentație vizibilă: fără numele angajatorului, e-mailuri de firmă, ID-uri sau numere interne.

## Context comun
Prezentarea proiectelor și lista de erori/modificări sunt în două Google Docs: **PROIECTE_CONTEXT (live)** și **MODIFICARI_PROIECTE (live)** — citește doar secțiunea regTester. Ce s-a implementat și confirmat se șterge din MODIFICARI.

## Când se actualizează fișierul
În același commit, când se schimbă comenzile de pornire/test, structura folderelor, formatul unui export suportat sau când un defect scoate la iveală o regulă de ținut minte. Nu pentru funcții obișnuite. Sub ~60 de rânduri.
