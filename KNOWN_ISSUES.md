# KNOWN_ISSUES — regTester

Erori și modificări deschise. Când un punct e rezolvat și confirmat, se mută în CHANGELOG.md.
Format: `[P1 blocant / P2 important / P3 nice-to-have] descriere — unde apare / pași — (data)`.

## Erori
- [P3] Limbă amestecată în Dokumentation › Schreiben (UI pe Deutsch): șablonul „Funcție nouă”, secțiunile și textele de ajutor rămân în română; probabil șablonul implicit se salvează în limba de la creare — (24.10)
- [P3] Verlauf › Vergleichen arată numele tehnice ale câmpurilor (`data.own_status`, `data.notes`); salvarea doar a notițelor la o eroare apare și ca schimbare la `data.own_status` — (24.10)
- [P3] Plural greșit în germană: „1 Änderungen wiederherstellen?” la restaurare, „1 Bilder” la Sicherungen › Bilder in Texten — (24.10)

## Modificări
- [P3] Căutare printre secțiuni (obiecte, titluri, erori, versiuni; de ex. un anume UserStory) sau o căutare globală cu rezultate clare din orice context
- [P3] Instrucțiuni detaliate, foarte bune, pentru fiecare caz în parte
- [P3] „Im Regtest-Fenster gesehen”: Release-Cockpit arată 8 (doar deschise), Fehler & Läufe arată 10 (toate); aceeași etichetă, cifre diferite — (24.10)
- [P3] „In … öffnen” lasă pagina din spate pe tabul anterior (ex. Verlauf), nu pe Katalog — (24.10)

## De testat
- Versiunile 0.4.1–0.7.1: pașii nebifați sunt în `TESTING.md`. Netestate: sortarea pe fiecare criteriu, folderul comun și Drive-ul pe laptopul celălalt.

## Rezolvate recent (de mutat în CHANGELOG)
- 0.7.1 (26.10): server vechi rămas pornit după actualizare; `tests/e2e_smoke.py` pe Windows (WinError 5 / „paint”)
