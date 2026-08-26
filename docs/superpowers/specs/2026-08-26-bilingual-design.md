# Zweisprachigkeit (EN/DE) — Design

Status: **geplant, nicht umgesetzt.** Entschieden am 2026-08-26; die Seite ist
bis dahin bewusst sprachneutral/englisch gehalten.

## Ausgangslage (Stand 2026-08-26)

Die Meta-Zeile unter den Captions und im Knob-Fenster ist bereits
sprachneutral: `markdorf, 2018-08-17` (Ort lowercase per CSS, Datum
`yyyy-mm-dd` direkt aus `taken`). Sprachabhängig bleiben nur noch:

| Stelle | EN (heute) | DE (geplant) |
|---|---|---|
| Knob-Fenster leer | `turn a knob` / `undated` | `dreh einen Knopf` / `ohne Datum` |
| Scrubber-Karte, Monatsname | `January` | `Januar` |
| Ortsnamen (Exonyme) | `Munich`, `Venice`, `Milan` | `München`, `Venedig`, `Mailand` |
| `<html lang>` | `en` | `de` |

`afterworkphoto N` / `afterworkvideo N` und der Titel sind der Name der
Sache und werden nicht übersetzt.

## Entscheidungen

1. **Sprachwahl: mit Umschalter.** `?lang=de|en` überschreibt, die Wahl wird
   in `localStorage` (`lang`) gehalten; ohne beides entscheidet
   `navigator.language` (`de*` → DE, sonst EN). UI-Form des Umschalters ist
   noch offen (Kandidat: unaufdringlich neben dem Titel oder an der
   Goto-Einheit).
2. **Ortsnamen in beiden Sprachen.** `scripts/ingest.sh` fragt Nominatim
   zweimal (`accept-language=en` und `=de`) und schreibt `place_de` in
   `photos.json` **nur wenn abweichend**; der Client nimmt
   `place_de || place`. Kostet eine Anfrage mehr pro neuem Foto und einen
   einmaligen erneuten Backfill (Cache dann analog `place` über das Datum).
3. **Datum bleibt `yyyy-mm-dd`** in beiden Sprachen — kein Formatwechsel.

## Implementierungsskizze

- `main.js`: Konstante `LANG` (Auflösung wie oben), Mini-Wörterbuch für die
  zwei festen Strings, Monatsname der Scrubber-Karte über
  `toLocaleDateString(LANG === 'de' ? 'de-DE' : 'en-GB', {month: 'long'})`,
  `document.documentElement.lang = LANG`, `metaOf()` nimmt
  `p.place_de || p.place` bei DE.
- `ingest.sh`: zweiter `geocode`-Aufruf, `place_de`-Feld + Cache-Index,
  `sleep 1` zwischen beiden Anfragen.
- `docs/details.md` nachziehen, `?v=`-Bump.

## Nicht in Scope

Übersetzte URLs, mehrsprachige Doku, weitere Sprachen.
