# regTester

Unealtă locală pentru perioada de regression test dinaintea fiecărui release: timeline-ul anului, acoperirea funcțiilor noi, trierea erorilor din regtest, procesarea sesiunilor PO din Teams, documentație uniformă și o bază de specificații/bug-uri cu căutare avansată.

Rulează **doar pe calculatorul tău** (sau pe un calculator din echipă), fără cloud și fără AI integrat. Nicio dată a firmei nu pleacă de pe mașină. Interfața e în **română, engleză și germană**.

## Pornire rapidă (Windows)

1. Instalează Python 3.10+ de pe python.org (bifează „Add python.exe to PATH”).
2. Dublu-click pe `install.bat` (o singură dată; instalează pachetele opționale pentru iconița din tray).
3. Dublu-click pe `start.bat`. Se deschide browserul la `http://127.0.0.1:8765`.
4. Autentificare: `admin` / `admin`. La prima autentificare ți se cere o parolă nouă.

Fără tray: `python regtester.py --no-tray` (oprire cu Ctrl+C).

## Ce face fiecare secțiune

| Secțiune | Ce încarci | Ce primești |
|---|---|---|
| **Panou release** | – | Faza curentă a release-ului, ce mai e de făcut înainte de regtest, următoarele 3 săptămâni |
| **Timeline** | Excel/CSV cu evenimente, sau reguli (generator de an) | Vederi Timeline (Gantt scrolabil), Calendar scrolabil pe luni, An, Listă; filtre pe tip, release, perioadă, căutare; export CSV și `.ics` pentru Outlook |
| **Acoperire** | Release notes (Excel/CSV/Word/HTML), export test case-uri | Matrice: fiecare funcție nouă × sesiune PO × test case × specificație × procedură; goluri, marcaje manuale, listă de goluri de copiat |
| **Triere regtest** | Export rezultate rulare (Excel/CSV) | Erori grupate după mesaj; noi / încă deschise / cunoscute / intermitente / rezolvate; trend; raport pentru Teams |
| **Sesiuni PO** | Transcriere Teams (`.vtt`, `.docx`, text) | Text curățat (fără umplutură și repetiții), termeni corectați din glosar, funcții recunoscute, prompt fix pentru AI-ul permis de firmă, rezumat salvat |
| **Documentație** | Formular, sau document Word existent | Document în ordinea și stilul șablonului, copiere pentru OneNote / tool-ul de regtest, `.html`, `.md` |
| **Specificații** | Excel/CSV (exporturi bug tracker), Word/HTML (pagini OneNote exportate) | Bază unică pentru specificații, bug-uri, issue-uri, proceduri; căutare avansată; intrări asemănătoare |

Fiecare secțiune are tab-ul **Istoric**: fișierele importate și fiecare modificare (cine, când, ce câmp), cu comparare înainte/după și **restaurare**.

### Căutare în specificații

| Scrii | Înseamnă |
|---|---|
| `login timeout` | ambele cuvinte |
| `"cost center"` | expresie exactă |
| `invoice -pdf` | fără „pdf” |
| `pdf OR export` | oricare |
| `archiv*` | începe cu |
| `retension~` | acceptă greșeli de scriere (sau bifează „Tolerează greșeli”) |
| `type:bug status:open module:Invoice release:R-2026.4 tag:auditor` | filtre pe câmpuri |
| `updated>2026-09-01` | modificat după dată (și `<`, `>=`, `<=`, `created`) |

## Setări și administrare

- **Setări**: limba implicită (EN/DE/RO), temă, nume aplicație, **logo propriu** (apare în meniu, tab și tray), **pornire cu Windows**, pornire direct în tray, backup la pornire, **acces din rețea pentru telefon**, tiparul codurilor de funcție, pragul de potrivire, cuvintele de umplutură, promptul AI, culorile timeline-ului, nivelul și păstrarea log-ului, contul meu.
- **Administrare** (doar admin): utilizatori, roluri (doar citire / editor / administrator), pagini permise per utilizator, autentificare obligatorie, backup-uri și restaurare, audit, oprirea aplicației.
- **Log**: tot ce face aplicația (autentificări, importuri, modificări, erori), fișiere zilnice în folderul de date, cu filtru pe nivel și căutare.

Datele stau în `%LOCALAPPDATA%\regTester` (`regtester.db`, `logs\`, `backups\`). Alt folder: `python regtester.py --data D:\regTester`.

## Telefon și echipă

- Pe același Wi-Fi/rețea: **Setări › Acces de pe telefon** › bifează „Permite acces din rețea”, repornește, deschide pe telefon adresa afișată (`http://IP-ul-PC:8765`). Pe Android/iOS poți face „Adaugă pe ecranul principal”.
- Echipa: un singur calculator rulează regTester, ceilalți îl deschid din browser, fără instalare. Fiecare are cont și rol.
- Instalarea ca aplicație (PWA) completă cere HTTPS în afara `localhost`; pe `localhost` merge direct din Edge/Chrome (iconița de instalare din bara de adrese).
- Întreabă IT-ul înainte să deschizi portul în firewall.

## Demo

Dacă deschizi `web/index.html` fără server (sau pagina publicată), aplicația pornește în **mod demo**: date fictive, păstrate doar în browser. Așa arată totul înainte de a avea date reale.

## Pentru dezvoltare

```
python -m unittest discover -s tests       # teste backend
python tools/make_samples.py                # fișiere exemplu în sample-data/
python tests/e2e_smoke.py                   # test complet în browser (playwright)
```

- `backend/` – server HTTP + SQLite, doar biblioteca standard Python (`db.py` istoric și importuri, `auth.py` utilizatori/sesiuni, `system.py` log, autostart, backup, `tray.py`).
- `web/` – interfața PWA, JavaScript fără build și fără biblioteci externe (cititoarele de Excel/Word sunt în `js/parsers.js`).
- `web/js/i18n.js` – toate textele în EN/DE/RO.
