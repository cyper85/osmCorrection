# osmCorrection – Stand der Arbeit

Stand: 2026-11-03 (Version 1.3.0). Überblick, Aufbau, Regeln und offene
Punkte. Wie die einzelnen Funktionen arbeiten und warum:
[docs/funktionen.md](docs/funktionen.md) (check_date, Tags löschen und
„Gibt es nicht mehr“, Website-Keys, doppelte Angaben, gleichbedeutende Keys,
KI-Unterstützung und KI-Agent, OSM-Hinweise, soziale Netze, Download-Bereich,
Mehrsprachigkeit, Anleitung, Oberfläche, Overpass-Server und OSM-API-Ersatz,
Grenzen der Online-Prüfung). Entwürfe zur KI: `docs/ki-unterstuetzung.md`,
`docs/ki-claude-code.md`. `ANALYSE.md` ist die Analyse des alten Prototyps
(historisch), `README.md` die Anleitung für Nutzung und Entwicklung.

## Überblick

Statische Web-App (Vite + TypeScript, ohne Framework, Leaflet für die Karte),
veröffentlicht über GitHub Actions auf GitHub Pages:
<https://osmcorrection.neumann-andreas.de/> (`cyper85.github.io/osmCorrection/`
leitet dorthin um). Es gibt bewusst keinen Server.

Ablauf: Ausschnitt wählen → Prüfungen auswählen → eine Overpass-Abfrage →
Funde einzeln übernehmen/ändern/überspringen → Änderungen gesammelt prüfen →
vor dem Hochladen aktuelle Versionen von der OSM-API holen und Konflikte
aussortieren → ein Changeset (öffnen, hochladen, immer schließen).

## Arbeitsweise

- Lineare Historie: Branches per Fast-Forward übernehmen
  (`git push origin <branch>:master`), keine Merge-Commits. Rulesets in
  allen drei Repos (lineare Historie, kein Force-Push, kein Löschen).
- osmValidation und osmAssist nur per PR mit Versionssprung. Reihenfolge:
  Bibliothek mergen, dann osmCorrection mit dem Submodul auf deren `master`.
- npm-Release: GitHub-Release `v<version>` in der Bibliothek, der Workflow
  veröffentlicht (Vorabversion als `latest`, solange es keine stabile gibt).
  osmCorrection bekommt Tag und Release `v<version>` ohne Workflow.

## Aufbau (`src/`)

| Datei | Aufgabe |
|---|---|
| `main.ts` | Oberfläche: Schritte login/select/review/upload, Verdrahtung aller Module |
| `auth.ts` | `osm-auth` 3, OAuth 2 + PKCE im Single-Page-Modus (Redirect auf dieselbe Seite), Scopes `read_prefs write_api` |
| `overpass.ts` | Abfrage für alle Key-Muster: `nw…; out meta geom; rel…; out meta bb;`, mehrere Server mit Zeitlimit und zweiter Runde (siehe docs/funktionen.md) |
| `checks.ts` | Formatprüfungen (`Check` mit `keyPattern` als POSIX-ERE, gilt in JS und Overpass), `findIssues`, Mehrfachwerte über `validateEach`; 20 soziale Netze mit `group: 'social'`, `verifiable` für Werte, die man öffnen und bestätigen kann |
| `i18n.ts`, `locales/` | Mehrsprachigkeit: `t(key, params)`, Texte in `locales/de.ts` (legt die Schlüssel fest) und `locales/en.ts`, siehe docs/funktionen.md |
| `messages.ts` | deutsche Texte zu osmValidation (nach englischem Text, dann nach Vorlage mit Plattformname, ersatzweise nach Code); auf Englisch bleibt der Originaltext |
| `contact.ts` | setzt auf Impressum und Datenschutz die E-Mail-Adresse zusammen (steht nicht im HTML) |
| `help.css` | Stil der Anleitung (`hilfe.html`, `help.html`), siehe docs/funktionen.md |
| `references.ts` | Online: Wikidata gelöscht/Weiterleitung, Abgleich `wikipedia` ↔ Sitelink |
| `websites.ts` | Online: Website erreichbar? http auch per https? (siehe docs/funktionen.md) |
| `verification.ts` | `check_date:<key>` für online prüfbare Werte, Modus „Websites und Profile bestätigen“, Prüfintervall |
| `closure.ts` | „Gibt es nicht mehr“: je Tag behalten/löschen/`disused:`/`was:`, Vorbelegung, einzelnen Tag löschen |
| `duplicates.ts` | „Doppelte Angaben“: `website` und `contact:website` (usw.) mit gleichem Wert, Vorschlag: Tag ohne `contact:` löschen |
| `synonyms.ts` | gleichbedeutende Keys mit URL (`menu:url` …) nach `website:menu` verschieben |
| `assist.ts` | KI-Unterstützung: Einstellungen (Schlüssel, Modell), Funde „Mit KI abgleichen“, Vorschläge und Hinweise aus osmAssist |
| `notes.ts` | „Vor Ort prüfen“: OSM-Hinweis (Note) am Objekt erstellen, erstellte Hinweise je Element merken |
| `changes.ts` | `ChangeStore`, eine Änderung je Element und Key (auch neue und gelöschte Tags), im `localStorage` gespeichert |
| `osmApi.ts` | aktuelle Versionen holen, `applyChanges` (Konflikte), leere Punkte löschen, osmChange-XML, Upload |
| `map.ts` | Karte, Hervorhebung des aktuellen Elements, Marker für alle Funde, Auswahlrahmen |
| `selection.ts` | Größe des Download-Rahmens (500 m × 500 m), Mindestzoom 14 |
| `nominatim.ts` | Ortssuche, Land der Kartenmitte (für Telefonnummern ohne `addr:country`) |
| `osm.ts` | Typen und Hilfsfunktionen für OSM-Elemente |
| `osmMap.ts` | Lesen von der OSM-API statt Overpass: Rahmen im Notfall (`map`-Aufruf), Objekte für den KI-Import |
| `exportCache.ts` | Objekte eines KI-Auftrags, 24 Stunden im Browser für den Import |

osmValidation ist ein Git-Submodul unter `libs/osmValidation` (Branch
`master`). Es wird direkt aus den TypeScript-Quellen eingebunden (Vite-Alias +
`paths` in `tsconfig.json`), seine Abhängigkeiten installiert der
npm-Workspace. Prüfregeln gehören nach osmValidation, nicht hierher.
## Wichtige Entscheidungen

- **Kein Server.** Deshalb Single-Page-OAuth ohne Secret (öffentliche
  Client-ID in `.env`, Redirect-URIs müssen exakt und mit kleingeschriebenem
  Host registriert sein).
- **Jede Änderung wird einzeln bestätigt**, es gibt kein „alle übernehmen“
  (Automated Edits Code of Conduct).
- **Konflikte:** Eine Änderung wird nur angewendet, wenn der Tag in der
  aktuellen Version noch den Wert hat, den der Nutzer gesehen hat. Sonst wird
  sie übersprungen und angezeigt.
- **Wikipedia-Abgleich:** Ob `wikipedia` oder `wikidata` falsch ist, lässt
  sich nicht automatisch entscheiden. Der Vorschlag ändert immer `wikipedia`,
  der Text weist darauf hin.
## Versionen

`version` in `package.json`, steht als `created_by` in jedem Changeset.
1.0.0 seit 2026-11-01 (live, mit echten Uploads getestet), 1.1.0 seit
2026-11-02 (KI-Unterstützung, Impressum und Datenschutz, Mehrsprachigkeit).
1.2.0 seit 2026-11-02 (Anleitung, Ersatz über die OSM-API, Zwischenspeicher
für den KI-Import, Handynummern und WhatsApp aus der KI-Auswertung), 1.3.0
seit 2026-11-03 (Auffälligkeiten der KI, `contact:mobile` als Standard,
Handynummer aus `phone` entfernen).
Neue Funktionen erhöhen die zweite Stelle, Fehlerbehebungen die dritte.
## Testen

- `npm test`: Unit-Tests (vitest), 220 Tests. `test/messages.test.ts` liest
  die Texte aus osmValidation und schlägt fehl, wenn eine Übersetzung fehlt.
- Browser-Tests mit dem installierten Edge über `playwright-core` gegen den
  Vorschau-Server (`npm run build && npx vite preview --port 4173`):
  - `npm run smoke`: echte Overpass-Daten (`VIEW=lat,lon,zoom`,
    `CHECKS=…`), ohne Login. Der bisherige Rahmen (TU Ilmenau) hat keine
    Funde mehr; ein neuer Ausschnitt fehlt noch.
  - `npm run smoke:assist`: KI-Ablauf mit nachgebauten Antworten.
  - `npm run screenshots`: Bilder der Anleitung (`public/help/<sprache>/`).
- Login und Upload lassen sich nur mit echtem OSM-Konto testen.
- Overpass weist Node-Anfragen ohne User-Agent mit 406 ab; in Node-Skripten
  einen User-Agent setzen.

## Offene Punkte

0. KI-Unterstützung: noch nicht mit einem echten API-Schlüssel getestet
   (Antwortformat von `web_fetch`, ob Links im Seitentext erhalten bleiben,
   tatsächliche Kosten). Danach `ai_assisted` im OSM-Forum vorstellen.
0. OSM-API-Ersatz: Auswahl (`parseMap`) noch nicht mit einem Overpass-Ergebnis
   desselben Rahmens verglichen (Overpass war beim Test ausgefallen).
0. Smoke-Test braucht einen neuen Ausschnitt mit Funden.

1. Viele Funde bei „Websites online prüfen“ sind http → https (in Ilmenau
   etwa 180 von 390 Websites). Eventuell einen Filter oder eine Sortierung
   nach Art des Fundes anbieten.
2. Marker-Farbe „übersprungen“ vs. „offen“ ist für Elemente mit mehreren
   Funden nur eine Näherung (der wichtigste Zustand gewinnt).
3. Eine Schließung steht vor dem Hochladen als eine Zeile je Tag in der
   Liste, bei großen Objekten (z. B. 17 Tags) unübersichtlich. Eventuell je
   Element gruppieren.
4. Ideen: Fund-Liste/Filter in der Seitenleiste, Wikidata-ID für Elemente mit
   `wikipedia`, aber ohne `wikidata` vorschlagen (neue Tags gibt es seit
   check_date, das wäre also machbar).
