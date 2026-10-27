# regTester — note pentru Claude

Reguli generale (v1.1; textul complet: repo `dev-framework`, GLOBAL_RULES.md):
- Răspunde în română, scurt; rezultatul primul; spune ce nu ai putut verifica.
- Lucrează în etape mici: citește doar ce trebuie (caută, apoi deschide porțiunea), scrie doar funcțiile modificate, plan de 3–5 rânduri înainte de schimbări mari.
- După fiecare etapă rulează testele proiectului și notează în CHANGELOG.md.
- Parolele și cheile stau în keyring sau variabile de mediu; documentația vizibilă omite numele angajatorului, e-mailurile de firmă, ID-urile și numerele interne.
- Aplicații Windows: Python cu `pythonw`, tray, fără `.exe`; respectă DevPilot (`DEVPILOT_MANAGED`, `DEVPILOT_SUPPRESS`).
- Git: GitHub e sursa de adevăr; un singur laptop o dată; commit și push înainte de schimbarea laptopului; lasă Drive să termine sincronizarea.

Unealtă locală pentru perioada de regression test dinaintea fiecărui release: timeline, test cases și acoperire, erori și run-uri, documentație, specificații. Server HTTP Python + SQLite, interfață PWA în browser.

## Comenzi
- Pornire: `start.bat` (fără consolă, icon în tray) sau `python regtester.py --no-tray`; se deschide `http://127.0.0.1:8765`
- Teste backend: `python -m unittest discover -s tests`
- Test complet în browser: `python tests/e2e_smoke.py` (Playwright)
- Acces de urgență: `reset-parola.bat` sau `python regtester.py --reset-password USER` (`--list-users`); un nume necunoscut creează un admin (lucrează pe folderul comun dacă e setat)
- Folder comun: `python regtester.py --shared "\\server\regTester"` (`""` = înapoi la date locale) sau Administrare › Echipă
- Date exemplu: `python tools/make_samples.py` → `sample-data/`
- Demo fără server: `web/index.html` deschis direct
- Versiune (acum 0.7.1): `UI_VERSION` în `web/js/version.js` = `__version__` în `backend/__init__.py`. Un modul JS nou se adaugă și în lista `SHELL` din `web/sw.js` (cu `CACHE` incrementat)

## Hartă
- `backend/`: `server.py` (HTTP/API, `AppContext` alege unde stau datele), `db.py` (schemă, istoric, importuri), `shared.py` (folder comun: fișier de blocare, copie locală, mod citire), `auth.py` (utilizatori, roluri, sesiuni), `system.py` (log, autostart, backup), `tray.py`
- `web/`: JavaScript fără build și fără biblioteci externe; `js/parsers.js` citește Excel/Word; `js/docx-spec.js` generează/importă specificația Word (layout: header, titlu, cuprins, secțiuni H1–H3, footer); `js/i18n.js` are toate textele în EN/DE/RO
- Date utilizator: `%LOCALAPPDATA%\regTester` (`regtester.db`, `logs\`, `backups\`, `shared-copy.db`). Cu folder comun: datele în `<folder>\regtester.db`, local doar sesiunile, log-ul, copia și setările din `LOCAL_KEYS` (`db.py`)

## Reguli
- Doar biblioteca standard Python (pystray + Pillow opționale pentru tray). Fără `.exe`, fără cloud, fără AI integrat: nicio dată a firmei nu pleacă de pe mașină.
- Exporturile se citesc cum ies din tool: coloane recunoscute după nume sau conținut, rând de titlu sărit, date `dd.mm.yyyy` și `M/D/YYYY`. Timeline-ul vine direct din exportul listei SharePoint.
- În timeline, „Zugewiesen an” pe rândurile de absență = înlocuitorul.
- Orice text nou trece prin i18n în EN/DE/RO. Orice modificare de date intră în Istoric (cine, când, ce), cu restaurare.
- `sample-data/` conține doar date fictive. Datele reale nu intră niciodată în repo.
- Folder comun: orice scriere trece prin `db.tx()`/`write_guard()` (fișierul de blocare + `BEGIN IMMEDIATE`); verificarea de versiune se face în tranzacție. Fără WAL pe share. Sesiunile nu se scriu niciodată în baza comună. Polling-ul din fundal (`GET /api/shared`) nu reînnoiește sesiunea.
- Backup: copii `.db` (complete, cu istoric) și export `.json` (`db.export_data`/`restore_export`, fără utilizatori). Restaurarea din JSON scrie intrări normale în Istoric (create/update/delete), după o copie `.db` de siguranță. Folderul ales (`backup_dir`) e setare locală; cloud = doar avertisment.
- Imagini din texte: tabelul `attachments` (sha256, o singură copie), referite în HTML ca `/api/att/<id>`; `<img>` primește sesiunea prin cookie-ul `rt_token` (doar `/api/att/`). Editorul e `richtext.js` (`richText`, `storeImages`, `inlineImages`); câmp `type: 'rich'` în `openEditor`. Exportul JSON are secțiunea `attachments`. `data.notes` (`KEEP_ON_IMPORT`) nu e atins de importuri. Căutare/CSV/rapoarte folosesc `plainText()`.
- Erori: `data.own_status` (+`_at`, `_by`) = status setat în regTester; `effStatus(r)` din `errors.js` îl folosește peste cel din export peste tot (liste, filtre, KPI, rapoarte). Legături între elemente: `data.rel = [{s, id, k}]` (`links.js`), plus ID-uri găsite în text și legături inverse; în panou automat pentru secțiunile din `LINKABLE`. `own_status*` și `rel` sunt în `KEEP_ON_IMPORT`. (`data.links` la specificații e alt câmp, text liber.)
- Deschiderea unui element din altă pagină: `ctx.openRecord(rec)`; paginile înregistrează `ctx.openers[section]` în `render`.
- KPI-urile sunt `kpiBox()`; trimit la o pagină cu filtru prin `ctx.drill(page, {…, from})` → paginile citesc `params` (`drillFromParams`) și arată `drillBand()`.
- Listele cronologice arată implicit cele mai noi primele, cu butonul comun `orderToggle()` din `util.js`; alegerea se ține per listă în browser (`rt.order.<listă>`), nu în baza comună.
- Pagina „Sesiuni PO” e ascunsă implicit (poate fi redenumită/refolosită). Exportul de rezultate al run-urilor e amânat la final.
- Analiză + plan, apoi aprobarea utilizatorului, apoi implementare.
- Cod și commit-uri în engleză; README și răspunsurile către utilizator în română.
- Documentație vizibilă: fără numele angajatorului, e-mailuri de firmă, ID-uri sau numere interne.

## Stare și jurnale
- Erori și modificări deschise: `KNOWN_ISSUES.md`. Istoric: `CHANGELOG.md` (dacă există). Pașii de test pentru versiunile neconfirmate: `TESTING.md`. Ce e implementat și confirmat se mută din KNOWN_ISSUES în CHANGELOG.

## Când se actualizează fișierul
În același commit, când se schimbă comenzile de pornire/test, structura folderelor, formatul unui export suportat sau când un defect scoate la iveală o regulă de ținut minte. Nu pentru funcții obișnuite. Sub ~60 de rânduri.
