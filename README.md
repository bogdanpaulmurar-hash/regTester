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
| **Panou release** | – | Release-ul curent (următorul PROD), pașii lui (sprinturi → MIG UAT → CORE LT → PROD), fereastra de regtest, erori deschise/noi, ce mai e de făcut, următoarele 4 săptămâni |
| **Timeline** | Exportul listei Timeline din SharePoint (Excel/CSV, coloanele listei) | Gantt, Calendar, An, Listă; filtre pe release, mediu (MIG UAT / CORE LT / PROD), produs, tip; tab **Calitatea datelor** (date copiate din alt release, duplicate, sfârșit înainte de început, release/sprint greșit); **Planifică release-ul următor** (copiază un release cu decalaj în săptămâni); export în formatul SharePoint și `.ics` |
| **Test cases & acoperire** | Exportul de test cases din toolul de regtest (lista sau arborele de categorii), release notes | Catalog pe categorii, aplicație, calitate, utilizări; matrice funcție nouă × document RegTest × test case × specificație × procedură, cu erorile deschise |
| **Erori & run-uri** | Exportul Error Management (Excel), opțional rezultatele unui run | Erorile cu status, run-uri, responsabili; ce s-a schimbat față de exportul anterior (noi, status schimbat, mai multe run-uri, dispărute); erori apărute în fereastra de regtest; istoric pe fiecare eroare; raport de copiat |
| **Documentație** | Formularul **Specificație Word** (sau o specificație `.docx` existentă), ori formularul simplu pe șablon | Specificație de regression test `.docx`: header, pagină de titlu, cuprins, secțiuni pe 3 niveluri cu text formatat și screenshoturi, footer cu „pagina X din Y”; documente salvate în aplicație, descărcabile oricând; formularul simplu dă copiere pentru OneNote, `.html`, `.md` |
| **Specificații** | Exportul Document Management (documente RegTest), exporturi bug tracker, Word/HTML | Bază unică pentru documente RegTest, specificații, bug-uri, proceduri; căutare avansată |
| **Sesiuni PO** (ascunsă implicit) | Transcriere Teams (`.vtt`, `.docx`, text) | Text curățat, funcții recunoscute, rezumat salvat |

Exporturile se citesc așa cum ies din tool: rândul de titlu de deasupra antetului e sărit, coloanele sunt recunoscute după nume sau după conținut (de ex. exportul de test cases are antetul decalat cu o coloană), iar datele `dd.mm.yyyy` și `M/D/YYYY` sunt detectate automat.

Fiecare secțiune are tab-ul **Istoric**: fișierele importate și fiecare modificare (cine, când, ce câmp), cu comparare înainte/după și **restaurare**.

### Specificație Word

**Documentație › Specificație Word** construiește documentul în formatul specificațiilor de regression test:

- **Pagina de titlu, header și footer**: titlu, user story, cale, titlul pachetului RegTest, produs, nume, departament, dată, clasificare și limba documentului (DE/EN/RO).
- **Secțiuni**: titluri editabile, nivel 1–3, „pagină nouă”, mutare sus/jos, adăugare/ștergere. Fiecare secțiune are editor cu aldin, cursiv, subliniat, text roșu, liste și screenshoturi (Ctrl+V, drag & drop sau buton); click pe imagine pentru lățime.
- **Generează Word (.docx)**: descarcă fișierul. Cuprinsul și numerele de pagină le completează Word la deschidere.
- **Importă Word (.docx)**: încarcă o specificație existentă (titluri, text, liste, tabele, imagini) ca s-o editezi.
- **Folosește această structură la documente noi**: păstrează produsul, departamentul, calea și titlurile secțiunilor ca punct de plecare.
- Documentele salvate apar în **Documente**, cu versiuni și restaurare în **Istoric**; oricine are acces la pagină (de ex. developerul) le poate descărca ca `.docx`.

### Căutare în specificații

| Scrii | Înseamnă |
|---|---|
| `login timeout` | ambele cuvinte |
| `"cost center"` | expresie exactă |
| `invoice -pdf` | fără „pdf” |
| `pdf OR export` | oricare |
| `archiv*` | începe cu |
| `retension~` | acceptă greșeli de scriere (sau bifează „Tolerează greșeli”) |
| `type:bug status:open module:Invoice release:V8.3 tag:auditor` | filtre pe câmpuri |
| `updated>2026-09-01` | modificat după dată (și `<`, `>=`, `<=`, `created`) |

## Setări și administrare

- **Setări**: limba implicită (EN/DE/RO), temă, nume aplicație, **logo propriu** (apare în meniu, tab și tray), **pornire cu Windows**, pornire direct în tray, backup la pornire, **acces din rețea pentru telefon**, tiparul codurilor de funcție, pragul de potrivire, cuvintele de umplutură, promptul AI, culorile timeline-ului, nivelul și păstrarea log-ului, contul meu.
- **Administrare** (doar admin): **Echipă** (acces din rețea, adresa pentru colegi, invitație gata de copiat), **Pagini** (ascunde paginile nefolosite și redenumește-le în meniu; datele rămân), utilizatori, roluri (doar citire / editor / administrator), pagini permise per utilizator, autentificare obligatorie, backup-uri și restaurare, audit, oprirea aplicației.
- **Log**: tot ce face aplicația (autentificări, importuri, modificări, erori), fișiere zilnice în folderul de date, cu filtru pe nivel și căutare.

Datele stau în `%LOCALAPPDATA%\regTester` (`regtester.db`, `logs\`, `backups\`). Alt folder: `python regtester.py --data D:\regTester`.

### Am uitat parola

- Un administrator îți poate seta o parolă nouă: **Administrare › Utilizatori › Editează** (sau „Generează parolă temporară”). La următoarea logare alegi una proprie.
- Dacă niciun administrator nu se mai poate loga: pe calculatorul unde rulează regTester, dublu-click pe **`reset-parola.bat`** din folderul aplicației. Afișează utilizatorii, întreabă numele (implicit `admin`) și parola nouă. Contul e reactivat, sesiunile vechi se închid, iar acțiunea intră în Istoric. Merge și cu aplicația pornită.
- Din linia de comandă: `python regtester.py --list-users` și `python regtester.py --reset-password admin`. Un nume necunoscut creează un administrator nou.
- Datele nu se pierd: baza rămâne neatinsă, se schimbă doar parola.

### Autentificare unică (SSO)

În **Administrare › Securitate** sunt pregătite câmpurile pentru Microsoft Entra ID (tenant ID, client ID și adresa de redirect de trecut în înregistrarea aplicației). Conectarea cu Microsoft se activează într-o versiune următoare; logarea locală rămâne mereu disponibilă ca rezervă.

## Telefon și echipă

- Pe același Wi-Fi/rețea: **Setări › Acces de pe telefon** › bifează „Permite acces din rețea”, repornește, deschide pe telefon adresa afișată (`http://IP-ul-PC:8765`). Pe Android/iOS poți face „Adaugă pe ecranul principal”.
- Echipa: un singur calculator rulează regTester, ceilalți îl deschid din browser, fără instalare. Toți lucrează pe aceleași date; fiecare are cont, rol și paginile permise.
- **Administrare › Echipă** adună pașii: pornește accesul din rețea, arată adresa de dat colegilor, duce la crearea conturilor și generează un text de invitație de copiat (parola temporară se trimite separat).
- Colegii pot lucra doar cât timp regTester rulează pe calculatorul-server.
- Instalarea ca aplicație (PWA) completă cere HTTPS în afara `localhost`; pe `localhost` merge direct din Edge/Chrome (iconița de instalare din bara de adrese).
- Întreabă IT-ul înainte să deschizi portul în firewall.

## Demo

Dacă deschizi `web/index.html` fără server (sau pagina publicată), aplicația pornește în **mod demo**: date fictive, păstrate doar în browser. Așa arată totul înainte de a avea date reale.

## Pentru dezvoltare

```
python -m unittest discover -s tests       # teste backend
python tools/make_samples.py                # fișiere exemplu în sample-data/ (exporturi fictive: timeline, erori, test cases, documente)
python tests/e2e_smoke.py                   # test complet în browser (playwright)
```

- `backend/` – server HTTP + SQLite, doar biblioteca standard Python (`db.py` istoric și importuri, `auth.py` utilizatori/sesiuni, `system.py` log, autostart, backup, `tray.py`).
- `web/` – interfața PWA, JavaScript fără build și fără biblioteci externe (cititoarele de Excel/Word sunt în `js/parsers.js`).
- `web/js/i18n.js` – toate textele în EN/DE/RO.
