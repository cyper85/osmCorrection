# osmCorrection – Stand der Arbeit

Stand: 2026-10-31. Diese Datei fasst zusammen, was gebaut wurde, warum, und
was noch offen ist. `ANALYSE.md` ist die ursprüngliche Analyse des alten
Prototyps (historisch), `README.md` die Anleitung für Nutzung und Entwicklung.

## Überblick

Statische Web-App (Vite + TypeScript, ohne Framework, Leaflet für die Karte),
veröffentlicht über GitHub Actions auf GitHub Pages:
<https://osmcorrection.neumann-andreas.de/> (`cyper85.github.io/osmCorrection/`
leitet dorthin um). Es gibt bewusst keinen Server.

Ablauf: Ausschnitt wählen → Prüfungen auswählen → eine Overpass-Abfrage →
Funde einzeln übernehmen/ändern/überspringen → Änderungen gesammelt prüfen →
vor dem Hochladen aktuelle Versionen von der OSM-API holen und Konflikte
aussortieren → ein Changeset (öffnen, hochladen, immer schließen).

## Branches und Commits

| Branch | Inhalt | Status |
|---|---|---|
| `master` | Neuaufbau, Renovate-Updates, alles aus `verbesserungen` | live, von Andreas getestet (Login, Upload, Schließung) |
| `verbesserungen` | deutsche Texte, Online-Prüfungen, Marker, Speichern im Browser, Tastenkürzel, check_date, Schließen/Löschen, OSM-Hinweise, soziale Netze | am 2026-11-01 per Rebase nach `master` übernommen (gleicher Stand) |

Andreas möchte eine lineare Historie: Branches per Rebase/Fast-Forward
übernehmen, keine Merge-Commits.

Hinweis: `b7907a3` verweist noch auf den osmValidation-Commit `8025fbe`, den
es auf GitHub nicht mehr gibt (Branch wurde umgeschrieben und gelöscht). Nur
relevant, wenn jemand genau diesen Commit auscheckt.

## Aufbau (`src/`)

| Datei | Aufgabe |
|---|---|
| `main.ts` | Oberfläche: Schritte login/select/review/upload, Verdrahtung aller Module |
| `auth.ts` | `osm-auth` 3, OAuth 2 + PKCE im Single-Page-Modus (Redirect auf dieselbe Seite), Scopes `read_prefs write_api` |
| `overpass.ts` | Abfrage für alle Key-Muster: `nw…; out meta geom; rel…; out meta bb;`, mehrere Server mit Zeitlimit und zweiter Runde (siehe unten) |
| `checks.ts` | Formatprüfungen (`Check` mit `keyPattern` als POSIX-ERE, gilt in JS und Overpass), `findIssues`, Mehrfachwerte über `validateEach`; 20 soziale Netze mit `group: 'social'`, `verifiable` für Werte, die man öffnen und bestätigen kann |
| `messages.ts` | deutsche Texte zu osmValidation (nach englischem Text, dann nach Vorlage mit Plattformname, ersatzweise nach Code) |
| `references.ts` | Online: Wikidata gelöscht/Weiterleitung, Abgleich `wikipedia` ↔ Sitelink |
| `websites.ts` | Online: Website erreichbar? http auch per https? (siehe Grenzen unten) |
| `verification.ts` | `check_date:<key>` für online prüfbare Werte, Modus „Websites und Profile bestätigen“, Prüfintervall |
| `closure.ts` | „Gibt es nicht mehr“: je Tag behalten/löschen/`disused:`/`was:`, Vorbelegung, einzelnen Tag löschen |
| `notes.ts` | „Vor Ort prüfen“: OSM-Hinweis (Note) am Objekt erstellen, erstellte Hinweise je Element merken |
| `changes.ts` | `ChangeStore`, eine Änderung je Element und Key (auch neue und gelöschte Tags), im `localStorage` gespeichert |
| `osmApi.ts` | aktuelle Versionen holen, `applyChanges` (Konflikte), leere Punkte löschen, osmChange-XML, Upload |
| `map.ts` | Karte, Hervorhebung des aktuellen Elements, Marker für alle Funde, Auswahlrahmen |
| `selection.ts` | Größe des Download-Rahmens (500 m × 500 m), Mindestzoom 14 |
| `nominatim.ts` | Ortssuche, Land der Kartenmitte (für Telefonnummern ohne `addr:country`) |
| `osm.ts` | Typen und Hilfsfunktionen für OSM-Elemente |

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

## check_date (online bestätigte Werte)

Entschieden mit Andreas am 2026-10-31:

- Nur für Werte, die sich online prüfen lassen (`Check.verifiable`):
  `website`, `contact:website`, `url` und die sozialen Netze mit Profilseite.
  Telefon, E-Mail, WhatsApp, Matrix und Tripadvisor bekommen kein
  `check_date`. Werte ohne öffnbare URL (z. B. ein diaspora*-Name) zeigt der
  Bestätigen-Modus nicht.
- Nur ausdrücklich: Schaltfläche „Geöffnet und geprüft“ (oder Strg+Enter).
  Sie wird erst aktiv, nachdem genau der Wert, der gespeichert wird, über
  „Im neuen Tab öffnen“ geöffnet wurde. Eine reine Formatkorrektur setzt
  kein `check_date`.
- Schlüssel: `check_date:<geprüfter Key>`, z. B.
  `check_date:contact:website`. Laut taginfo (2026-10-31) ist
  `check_date:website` 2838-mal in Gebrauch, `check_date:contact:website`
  2-mal, die Social-Media-Varianten gar nicht. Beim Lesen zählt für
  `contact:website` auch `check_date:website`.
- Intervall: `VITE_CHECK_INTERVAL_MONTHS` in `.env`, Standard 24 Monate.
  Werte mit jüngerem `check_date` werden von „Websites online prüfen“ und
  vom Bestätigen-Modus übersprungen. Formatfehler werden trotzdem gemeldet.
- Modus „Websites und Profile bestätigen“ (Online-Prüfung): zeigt auch
  gültige Werte ohne aktuelles `check_date` zum Bestätigen.
- Beim Hochladen wird ein `check_date` nur geschrieben, wenn der geprüfte Tag
  dann genau den geprüften Wert hat (`TagChange.verifies`). Fällt eine
  Korrektur wegen eines Konflikts weg, fällt ihr `check_date` mit weg.
- Changeset-Kommentar: „…; online geprüft (check_date): Websites, …“.

## Tags löschen, „Gibt es nicht mehr“

Entschieden mit Andreas am 2026-10-31:

- „Tag löschen“ entfernt nur den Tag des aktuellen Fundes.
- „Gibt es nicht mehr …“ zeigt alle Tags des Objekts, je Tag wählbar:
  behalten, löschen, `disused:` (leer stehend) oder `was:` (ehemals), siehe
  [Lifecycle prefix](https://wiki.openstreetmap.org/wiki/Lifecycle_prefix).
  Vorbelegung: `shop`, `amenity`, `craft`, `office`, `healthcare`,
  `tourism`, `leisure`, `club` → `disused:`; Gebäude-Tags (`building*`,
  `roof:*`, `height`, `level`, `entrance`, …), vorhandene Lebenszyklus-Tags
  und bei Gebäuden `addr:*` → behalten; alles andere → löschen.
- Korrekturen behaltener Tags bleiben erhalten, `check_date` gelöschter Tags
  fällt weg. Danach springt die Prüfung zum nächsten Objekt.
- Bleibt kein Tag übrig: Ein Punkt wird gelöscht, aber nur, wenn er laut
  OSM-API (`/node/<id>/ways`, `/relations`) zu keinem Weg und keiner Relation
  gehört; sonst bleibt er als leerer Stützpunkt. Das gilt beim Hochladen für
  jeden Punkt, der leer würde. Gelöscht wird mit `<delete if-unused="true">`,
  damit ein inzwischen verwendeter Punkt den Upload nicht scheitern lässt.
  Wege und Relationen können nicht leer werden (Schaltfläche gesperrt).
- In der Liste vor dem Hochladen lässt sich eine Schließung nur als Ganzes
  entfernen. `TagChange.closed` markiert ihre Änderungen, `deleteIfUnused`
  dient der Anzeige.
- Changeset-Kommentar: „existiert nicht mehr: 1 Objekt; …; entfernt: Website“.

## Vor Ort prüfen (OSM-Hinweise)

Entschieden mit Andreas am 2026-10-31: Ist unklar, ob es ein Objekt noch
gibt, erstellt „Vor Ort prüfen …“ einen
[OSM-Hinweis](https://wiki.openstreetmap.org/wiki/DE:Notes) an der Position
des Objekts (vorbelegter, änderbarer Text mit Link und `#osmCorrection`).
Hinweise statt `fixme=*`, weil sie die Daten nicht ändern und Mapper vor Ort
(auch StreetComplete) sie sehen. Kein `check_date` setzen: Sonst fragt
StreetComplete nicht mehr nach, ob es das Geschäft noch gibt.

- Der Hinweis wird sofort erstellt, nicht mit dem Changeset. Nur angemeldet.
- Braucht die OAuth-Berechtigung `write_notes`. Sie muss in der
  OSM-Anwendung angehakt sein; alte Logins ohne sie bekommen 403, die
  Meldung bittet um erneutes Anmelden.
- Erstellte Hinweise merkt sich der Browser je Element
  (`osmCorrection.notes`) und zeigt den Link beim Fund an.

## Soziale Netze

Alle Plattformen aus osmValidation (Facebook, X/Twitter, Instagram, TikTok,
YouTube, LinkedIn, XING, Pinterest, Vimeo, Flickr, VK, Mastodon, Bluesky,
Mobilizon, diaspora*, GNU social, Telegram, WhatsApp, Matrix, Tripadvisor)
sind eigene Prüfungen für `contact:<name>` und `<name>`. In der Auswahl
stehen sie unter „Soziale Netze“: ein Kästchen für alle (dreiwertig), die
einzelnen Netze darunter aufklappbar. Die IDs `facebook` und `twitter` sind
geblieben, gespeicherte Auswahlen gelten weiter. Neue Meldungen von
osmValidation, die aus einer Vorlage mit dem Plattformnamen gebaut werden,
prüft `test/messages.test.ts` ebenfalls.

## Download-Bereich

Entschieden mit Andreas am 2026-11-01: Geladen werden höchstens
500 m × 500 m. Ein gestrichelter Rahmen liegt fest in der Kartenmitte, man
verschiebt die Karte darunter; zeigt die Karte weniger, gilt der sichtbare
Teil. Unter Zoom 14 ist der Rahmen zu klein, der Download ist dann gesperrt,
der Hinweis nennt die Grenze. (Den sichtbaren Bereich auf 500 m zu begrenzen
ginge erst ab etwa Zoom 19, deshalb der Rahmen.) Größe und Mindestzoom stehen
in `src/selection.ts`.

## Versionen

`version` in `package.json`, steht als `created_by` in jedem Changeset.
1.0.0 seit 2026-11-01 (live, mit echten Uploads getestet). Neue Funktionen
erhöhen die zweite Stelle, Fehlerbehebungen die dritte.

## Oberfläche

Beim Auswählen bekommt die Karte den meisten Platz. Beim Prüfen und Hochladen
wird die Seitenleiste breiter (45 %, mindestens 420 px; schmal: 70 % Höhe).
„Geöffnet und geprüft“ ist wie „Übernehmen“ hervorgehoben.

## Overpass-Server

Die öffentlichen Overpass-Server sind oft ausgelastet. overpass-api.de
antwortet dann sofort mit 502 („at capacity“), meist geht es Sekunden später
wieder. Getestet am 2026-10-31 aus Edge:

| Server | Ergebnis |
|---|---|
| overpass-api.de | zeitweise 502, sonst OK |
| maps.mail.ru (VK) | OK, zeitweise 504 |
| overpass.private.coffee | hing ohne Antwort |
| overpass.kumi.systems | hing ohne Antwort, nicht eingebaut |
| overpass.osm.jp | kein CORS, nicht nutzbar |

`download()` fragt die Server der Reihe nach (overpass-api.de, mail.ru,
private.coffee), jeweils mit 100 s Zeitlimit, und macht nach 5 s eine zweite
Runde. Erst dann kommt eine Fehlermeldung, die für jeden Server den Grund
nennt. Eine fehlerhafte Abfrage (z. B. 400) wird sofort gemeldet.

Lokal muss die Seite unter `127.0.0.1` laufen, nicht `localhost`: OSM erlaubt
http-Redirect-URIs nur für 127.0.0.1. `main.ts` leitet `localhost` deshalb um.

## Grenzen der Online-Prüfung im Browser (getestet mit Edge)

Anfragen an fremde Websites gehen nur im Modus `no-cors`:

- 200 und 404 sehen gleich aus („opaque“), Weiterleitungen werden immer
  stillschweigend verfolgt (`redirect: 'manual'` ist in `no-cors` verboten).
- Erkennbar ist nur ein Fehlschlag der ganzen Anfrage: Domain unbekannt,
  Zertifikat ungültig, Verbindung abgelehnt, Timeout.
- `http://`-URLs werden von der https-Seite blockiert (Mixed Content). Deshalb
  wird nur die https-Variante probiert und bei Erfolg als Vorschlag angeboten.
- Fehlalarme: Seiten mit `Cross-Origin-Resource-Policy: same-origin` sowie X,
  Twitter und YouTube schlagen immer fehl. Letztere sind ausgenommen, die
  Meldung sagt „möglicherweise nicht erreichbar“ und bietet einen Link an.
- **Social-Media-Profile lassen sich ohne Server nicht prüfen** (Facebook
  liefert für fehlende Seiten dasselbe wie für vorhandene, X weist alles ab).
  Entscheidung: nicht umgesetzt. Ein Proxy (z. B. Cloudflare Worker) wäre
  nötig und selbst dann für Social Media unzuverlässig.

## Testen

- `npm test`: Unit-Tests (vitest), 162 Tests. `test/messages.test.ts` liest
  die Texte aus osmValidation und schlägt fehl, wenn eine Übersetzung fehlt.
- `npm run smoke`: Browser-Test mit dem installierten Edge über
  `playwright-core` gegen den Vorschau-Server (`npm run build && npx vite
  preview --port 4173`). Nutzt echte Overpass-Daten (Rahmen auf dem Campus
  der TU Ilmenau, `VIEW=lat,lon,zoom` und `CHECKS=…` zum Ändern), ohne
  Login. Werden dort Funde korrigiert, braucht der Test eventuell einen
  anderen Ausschnitt; er meldet dann „findings in the frame“ als Fehler.
- Login und Upload lassen sich nur mit echtem OSM-Konto testen.
- Overpass weist Node-Anfragen ohne User-Agent mit 406 ab. Im Browser ist das
  kein Problem, in Node-Skripten einen User-Agent setzen.

## Offene Punkte

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
