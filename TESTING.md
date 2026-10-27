# TESTING — regTester

Pași de test pentru versiunile netestate. Ce a fost testat și confirmat (✅ în vechiul document) a fost scos. După confirmare, șterge pașii de aici și notează în CHANGELOG.md.

## Actualizare înainte de test (valabilă pentru orice versiune)
Închizi regTester din iconița din tray. În clona locală: `git fetch`, apoi `git reset --hard origin/main` (nu `git pull`). Pornești `start.bat`, Ctrl+F5 în browser. În meniu, sub nume, apare versiunea așteptată.

## 0.4.1 — sortare cronologică inversă
- Test cases & acoperire › Catalog: sortare Data adăugării, Ultima modificare, Grup. Așteptat: implicit cele mai noi sus; la Grup revin titlurile de grup; la sortarea după dată, grupul apare sub titlu.
- Acoperire › Matrice: sortare Ultima modificare, Release, Nume. Așteptat: la Release cel mai nou e sus; la Nume butonul de inversare dispare.
- Erori & run-uri: la Error items, „Ultima apariție” cu cele mai recente sus și buton de inversare; la „Cele mai multe run-uri” / „După ID” butonul dispare. Run results: cel mai nou run sus; istoricul unei erori: cele mai noi primele.
- Specificații › tab „toate”: implicit Ultima modificare; „ID” sortează după cheie.
- Folder comun (opțional): pe 2 calculatoare cu aceeași bază, ordini diferite; fiecare își păstrează alegerea, fără mesaje „modificat între timp”.

## 0.5.0 — backup
- Administrare › Backup-uri › „Alege folderul…”: se deschide fereastra Windows; după alegere „Se poate scrie în folder”. (Netestat: alegerea folderului și avertismentul cloud.)
- Folder din OneDrive / Google Drive + Verifică: avertisment galben, dar se poate salva.
- „Descarcă” salvează același tip de fișier prin browser (netestat).
- „Restaurează din fișier…” cu un export descărcat; bifezi „Preferințele mele de afișare”: revin ordinea listelor și filtrele salvate (netestat).
- Folder comun (opțional): folderul local ales primește copia ta zilnică; copia zilnică a echipei rămâne în share.

## 0.6.0 — chenare clicabile și screenshoturi în texte
- Chenarele filtrează lista (Erori; Schimbări pe import; Rezultate run-uri; Catalog; Matrice; Timeline › Calitatea datelor). Așteptat: lista se potrivește cu cifra. Chenarul activ e conturat.
- Panoul erorii: săgețile ‹ › cu „1 din N” trec prin lista filtrată; cu modificări nesalvate, săgeata întreabă dacă salvezi.
- Capturile după un reimport Error Management: notițele și imaginea rămân.
- Alte câmpuri cu lipire de imagini: Specificații (Text), Timeline, Test cases, Funcționalități, Erori cunoscute, Documentație › formular simplu. Așteptat: imaginea se lipește, se salvează, apare după refresh; textele vechi arată ca înainte.
- Specificație Word veche cu screenshoturi: salvezi, apoi .docx; imaginile apar în Word. Documentație › „Copiază pentru OneNote” → lipești în OneNote/Outlook.
- Backup › „Imagini din texte” arată numărul și mărimea; exportul .json conține imaginile și restaurarea le readuce; „Curăță imaginile nefolosite” șterge doar ce nu mai folosește nimic.
- Folder comun (opțional): o captură salvată pe un calculator apare la colegul conectat la același folder.

## 0.7.0 — rapoarte, status propriu pe erori, legături
- Reimport Error Management: statusul propriu rămâne; dacă exportul schimbă statusul, panoul arată avertisment galben; „Ca în export” scoate statusul propriu.
- „Deschide în …” dintr-o legătură: se deschide pagina elementului; cu modificări nesalvate întreabă înainte să plece.
- Rapoarte (Sprint, Release, Fereastră regtest, Lună, Perioadă): un rând pe perioadă; click arată detalii; CSV, Raport HTML, Copiază text și Tipărește (ascunde meniul) — exporturile netestate.
- Documentație: apare ca țintă și legături inverse, dar formularul nu are încă cardul Legături.
