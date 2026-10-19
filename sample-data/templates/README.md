# Template-uri pentru upload

Câte un fișier pentru fiecare import din aplicație. Fiecare are un singur sheet, antetul și câteva rânduri de exemplu.

- **Antet portocaliu** = coloană obligatorie, **antet albastru** = opțională.
- Treci cu mouse-ul peste un antet în Excel: comentariul arată valorile acceptate și celelalte nume de coloană recunoscute (EN/DE/RO).
- Ordinea coloanelor nu contează, iar coloanele în plus sunt ignorate. Dacă un antet are alt nume, îl alegi manual în dialogul de import („Mapare coloane").
- Merge și `.csv` cu aceleași coloane (separator `;`, `,` sau tab).

| Fișier | Tab → buton | Obligatoriu |
|---|---|---|
| `1_timeline.xlsx` | Timeline → Importă Excel | Titlu, Început |
| `2_acoperire_release_notes.xlsx` | Acoperire → Importă release notes | Titlu |
| `3_acoperire_teste.xlsx` | Acoperire → Importă export teste | ID test, Titlu |
| `4_triere_rezultate_regtest.xlsx` | Triere regtest → Importă rezultate | Test, Rezultat |
| `5_triere_erori_cunoscute.xlsx` | Triere regtest → Erori cunoscute | Tipar |
| `6_specificatii.xlsx` | Specificații → Import | Titlu |
| `7_sesiuni_po_glosar.xlsx` | Sesiuni PO → Glosar | Auzit ca, Termen corect |

Legături între ele: **Cod** din release notes = **Cod funcție** din teste (așa se calculează acoperirea), iar **ID test** din teste = **Test** din rezultatele regtest.

## Importuri care nu sunt tabele

Pentru acestea, mostrele sunt în folderul părinte `sample-data/`:

- **Sesiuni PO → Încarcă transcript**: `.vtt` din Teams (`transcript_sprint41.vtt`), `.docx` (`teams_transcript_sprint41.docx`) sau `.txt`.
- **Documentație → import**: `.docx`/`.html` cu titluri (Heading); fiecare titlu este pus la secțiunea cu nume asemănător din șablon.
- **Specificații / Release notes din Word**: fiecare Heading 1–2 devine o înregistrare; un cod de forma `ABC-123` din titlu devine ID-ul (`release_notes.docx`, `procedures_onenote_export.docx`).

Regenerare: `python tools/make_templates.py`
