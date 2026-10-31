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
| `master` | Neuaufbau (`b7907a3`), osmValidation auf master (`65941db`) | live, von Andreas getestet (Login + Upload) |
| `verbesserungen` | deutsche Texte, Wikidata-Online-Prüfung, Karten-Marker, Speichern im Browser, Tastenkürzel (`07e4c19`); Website-Online-Prüfung, Smoke-Test, diese Datei | gepusht, **nicht gemergt** |

Hinweis: `b7907a3` verweist noch auf den osmValidation-Commit `8025fbe`, den
es auf GitHub nicht mehr gibt (Branch wurde umgeschrieben und gelöscht). Nur
relevant, wenn jemand genau diesen Commit auscheckt.

## Aufbau (`src/`)

| Datei | Aufgabe |
|---|---|
| `main.ts` | Oberfläche: Schritte login/select/review/upload, Verdrahtung aller Module |
| `auth.ts` | `osm-auth` 3, OAuth 2 + PKCE im Single-Page-Modus (Redirect auf dieselbe Seite), Scopes `read_prefs write_api` |
| `overpass.ts` | Abfrage für alle Key-Muster: `nw…; out meta geom; rel…; out meta bb;`, mehrere Server mit Zeitlimit und zweiter Runde (siehe unten) |
| `checks.ts` | Formatprüfungen (`Check` mit `keyPattern` als POSIX-ERE, gilt in JS und Overpass), `findIssues`, Mehrfachwerte über `validateEach` |
| `messages.ts` | deutsche Texte zu osmValidation (nach englischem Text, ersatzweise nach Code) |
| `references.ts` | Online: Wikidata gelöscht/Weiterleitung, Abgleich `wikipedia` ↔ Sitelink |
| `websites.ts` | Online: Website erreichbar? http auch per https? (siehe Grenzen unten) |
| `changes.ts` | `ChangeStore`, eine Änderung je Element und Key, im `localStorage` gespeichert |
| `osmApi.ts` | aktuelle Versionen holen, `applyChanges` (Konflikte), osmChange-XML, Upload |
| `map.ts` | Karte, Hervorhebung des aktuellen Elements, Marker für alle Funde |
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

- `npm test`: Unit-Tests (vitest), 105 Tests. `test/messages.test.ts` liest
  die Texte aus osmValidation und schlägt fehl, wenn eine Übersetzung fehlt.
- `npm run smoke`: Browser-Test mit dem installierten Edge über
  `playwright-core` gegen den Vorschau-Server (`npm run build && npx vite
  preview --port 4173`). Nutzt echte Overpass-Daten (Ilmenau), ohne Login.
- Login und Upload lassen sich nur mit echtem OSM-Konto testen.
- Overpass weist Node-Anfragen ohne User-Agent mit 406 ab. Im Browser ist das
  kein Problem, in Node-Skripten einen User-Agent setzen.

## Offene Punkte

1. `verbesserungen` im Browser testen (Login aus dem Hochladen-Schritt) und
   nach `master` mergen.
2. Viele Funde bei „Websites online prüfen“ sind http → https (in Ilmenau
   etwa 180 von 390 Websites). Eventuell einen Filter oder eine Sortierung
   nach Art des Fundes anbieten.
3. Marker-Farbe „übersprungen“ vs. „offen“ ist für Elemente mit mehreren
   Funden nur eine Näherung (der wichtigste Zustand gewinnt).
4. Ideen: Fund-Liste/Filter in der Seitenleiste, Wikidata-ID für Elemente mit
   `wikipedia`, aber ohne `wikidata` vorschlagen (bräuchte das Hinzufügen von
   Tags, bisher werden nur vorhandene Werte geändert).
