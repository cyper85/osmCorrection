# osmCorrection – Funktionen und Entscheidungen im Detail

Ausgelagert aus `STAND.md` am 2026-11-03. Hier steht, wie die einzelnen
Funktionen arbeiten und warum; `STAND.md` enthält nur den Überblick.

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

## Website-Keys

Ergänzt am 2026-11-01 mit Andreas: „Websites“, „Websites online prüfen“ und
das Bestätigen gelten für `website`, `contact:website`, `url`,
`reservation:website`, `opening_hours:url` und alle `website:*`
(`WEBSITE_KEYS` in `checks.ts`), außer `website:1` (so gewünscht) und
`website:note` (laut taginfo Text wie „kein https“, keine URL).
Ausnahmen stehen in `Check.excludeKeys`, weil das POSIX-ERE von Overpass
keine negativen Lookaheads kann; Overpass lädt sie mit, `coversKey()` filtert
sie in JavaScript. Bestätigt wird mit `check_date:website:menu` usw.

## Doppelte Angaben

Gewünscht von Andreas am 2026-11-01: Steht derselbe Wert unter `<key>` und
`contact:<key>`, wird der Tag ohne `contact:` gelöscht, `contact:*` bleibt.

- Eigene Prüfung „Doppelte Angaben“ (`duplicates`) in der Auswahl. Gilt für
  alle Keys, die es mit und ohne `contact:` gibt (eine Prüfung aus
  `checks.ts` passt auf beide): Telefon, Fax, Mobil, E-Mail, Website und die
  sozialen Netze. Overpass lädt dafür alle Elemente mit `contact:*`.
- „Gleich“ heißt: gleicher Text, oder gleich nach der bevorzugten Form von
  osmValidation; bei Websites zählt ein Schrägstrich am Ende nicht, bei
  E-Mail die Großschreibung nicht, bei Mehrfachwerten die Reihenfolge nicht.
  Unterschiedliche Werte werden nicht gemeldet.
- Der Fund steht auf dem Tag ohne `contact:`, das Eingabefeld ist leer:
  Übernehmen (Enter) löscht ihn. Wer einen Wert einträgt, korrigiert ihn
  stattdessen. Andere Funde zum selben Tag entfallen, der Fund kommt je
  Objekt zuerst.
- `check_date:website` bleibt stehen, es zählt beim Lesen auch für
  `contact:website`.
- `TagChange.duplicateOf` merkt sich den behaltenen Key: Liste vor dem
  Hochladen „… löschen (steht in contact:website)“, Kommentar „doppelte
  Angaben entfernt: Websites“ (ohne passende Prüfung steht der Key selbst da).

## Gleichbedeutende Keys (menu:url → website:menu)

Gewünscht von Andreas am 2026-11-01, Liste aus
[Key:website:menu](https://wiki.openstreetmap.org/wiki/Key:website:menu):
`menu:url`, `url:menu`, `menu`, `lunch:menu:url`, `image:menu`,
`image:menu:0`. Läuft mit der Prüfung „Websites“ (Overpass lädt die Keys
dann mit), weitere Ziele lassen sich in `SYNONYMS` ergänzen.

- Nur Werte, die mit `http://`, `https://` oder `www.` anfangen (`menu=yes`
  und Commons-Dateinamen bleiben).
- `website:menu` frei: Der erste dieser Keys wird verschoben. Übernehmen
  setzt `website:menu` (Wert wie im Eingabefeld, mit URL-Prüfung) und löscht
  den alten Key. Weitere Keys mit demselben Wert sind Doppelungen des ersten
  (nicht von `website:menu`, damit der Wert nicht verloren geht, wenn man
  das Verschieben überspringt).
- `website:menu` belegt: gleicher Wert → Doppelung, alten Key löschen;
  anderer Wert → nur Meldung, man entscheidet selbst.
- `TagChange.movedFrom` (neuer Key) und `movedTo` (alter Key): Das Löschen
  wird beim Hochladen nur angewendet, wenn der neue Key dann genau den Wert
  hat; sonst Konflikt und der alte Key bleibt. In der Liste werden beide nur
  zusammen entfernt, „Tag löschen“ macht das Verschieben rückgängig.
  Kommentar: „umbenannt: menu:url → website:menu“.

## KI-Unterstützung

Entwurf und Entscheidungen: [docs/ki-unterstuetzung.md](docs/ki-unterstuetzung.md).
Umgesetzt am 2026-11-01:

- Bibliothek [osmAssist](https://github.com/cyper85/osmAssist) als Submodul
  `libs/osmAssist` (öffentlich, MIT). Der Claude-Adapter liegt im eigenen
  Einstieg `osmassist/claude`; osmCorrection lädt ihn, das SDK und den
  `opening_hours`-Parser erst beim ersten Auswerten nach (Haupt-Bundle
  bleibt bei ca. 365 KB).
- Online-Prüfung „Mit KI abgleichen“ (`ai-assist`): ein Fund je Objekt mit
  Website, dessen `check_date:opening_hours` fehlt oder alt ist, als erster
  Fund des Objekts. Darin „Website mit KI auswerten“ (kostet Geld, nur auf
  Klick, abbrechbar). Die Schaltfläche steht auch bei allen anderen Funden
  eines Objekts mit Website (nicht bei den KI-Funden selbst), solange die
  Prüfung für den Ausschnitt gewählt ist.
- Changeset-Kommentar (`comment.ts`): höchstens 255 Zeichen (Grenze der
  OSM-API, am 2026-11-01 mit HTTP 400 aufgefallen). Zu lang: erst die
  sozialen Netze als „soziale Netze“ zusammenfassen, dann nur die Arten der
  Änderungen; die KI mit Modell bleibt immer genannt. Zähler unter dem
  Feld, zu lange Kommentare werden vor dem Hochladen abgefangen.
- Einstellungen in Schritt 1, sichtbar mit der Prüfung: API-Schlüssel
  (`sessionStorage`, mit „merken“ `localStorage`), Modell (Standard Claude
  Sonnet 5.5), Kostenspanne.
- Zwischenspeicher (gewünscht 2026-11-01): Claude meldet alle Angaben der
  Website, unabhängig von den Tags (`SiteReading`); der Abgleich mit den
  Tags (`assess`) läuft je Objekt lokal und kostet nichts. Was gelesen
  wurde, bleibt für die Sitzung und gilt für jedes Objekt mit derselben
  Website **und derselben Adresse** (`addr:street`, `housenumber`,
  `postcode`, `city`, `place`), z. B. Gebäude und Laden oder ein zweiter
  Besuch. Die Adresse gehört zum Schlüssel, weil eine Seite mehrere
  Filialen listen kann. „Erneut auswerten“ liest die Website neu.
  Fehlgeschlagene oder abgebrochene Lesevorgänge werden nicht gespeichert.
- Ergebnis: Hinweise und Vorschläge werden als Funde direkt hinter dem
  Objekt eingefügt (ein erneuter Lauf ersetzt sie), mit Zitat und Quelle.
  Gelesene Seiten, Abruffehler und verworfene Vorschläge stehen beim Fund.
  Vorschläge werden mit der Formatprüfung von osmCorrection bzw. dem
  `opening_hours`-Parser geprüft und in die bevorzugte Form gebracht.
- Übernehmen setzt den Tag, `source:<key>=website` und
  `check_date:<key>=<heute>` (die beiden nur, wenn der Tag hochgeladen
  wird, über `verifies`). `TagChange.ai` hält das Modell fest.
- Changeset: Kommentar „von der Website übernommen, ausgewertet mit
  KI-Unterstützung (Anthropic Claude Sonnet 5.5): …“, Tags `source=website`
  und `ai_assisted=Anthropic Claude Sonnet 5.5` nur, wenn KI-Vorschläge
  wirklich hochgeladen werden (nicht bei Konflikten).
- `npm run smoke:assist`: Browser-Test mit nachgebauter Overpass- und
  Anthropic-Antwort (kostenlos, ohne Schlüssel).
- Handynummern und WhatsApp (entschieden 2026-11-02, osmAssist
  1.0.0-alpha.3, osmValidation 1.0.0-alpha.3):
  - Handynummern kommen nach `contact:mobile` (`mobile` nur, wenn das Objekt
    diesen Tag schon hat; korrigiert am 2026-11-03 nach der Auswertung in
    Jena, vorher galt `mobile`, wenn das Objekt `phone` nutzte). Neben dem, was die KI als `mobile` meldet,
    verschiebt osmAssist Nummern mit sicherer Handy-Vorwahl (DE +49 15/16/17,
    AT +43 6, CH +41 75–79) dorthin.
  - Ein `phone`-Vorschlag, der eine Nummer weglässt, die als Handynummer
    vorgeschlagen wird, trägt `together`. Der Fund sagt das, der Diff zeigt
    „nur zusammen mit contact:mobile“, und `TagChange.requires` sorgt dafür,
    dass er beim Hochladen nur gilt, wenn `contact:mobile` die Nummer enthält
    (Vergleich über die Ziffern). Wird der Handy-Eintrag vor dem Hochladen
    entfernt, gehen der Telefon-Eintrag und alle `source:`/`check_date:` mit.
  - Steht die Handynummer in `phone`/`contact:phone` und gibt es dafür keinen
    eigenen Vorschlag, fügt osmAssist einen hinzu: `phone` ohne diese Nummer,
    bzw. leer = Tag löschen („Löschen“ beim Fund), ebenfalls nur zusammen mit
    `contact:mobile` (osmAssist 1.0.0-alpha.4).
- Auffälligkeiten (gewünscht 2026-11-03 nach der Auswertung in Jena, wo der
  Agent sie nur im Chat nannte): Hinweis-Typ `other` mit `note` (ein Satz,
  in der Sprache der Auftragsdatei; per API vorerst Englisch), z. B.
  Umleitung auf eine andere Domain, Filialen nur an anderen Orten, nur noch
  fremde Inhalte, vorübergehend geschlossen, eine andere Website genannt,
  ohne dass sie als neue Adresse bezeichnet ist. Unsicheres soll als
  Auffälligkeit kommen, nicht als Wert. Wie alle Hinweise mit Zitat; bei
  einer Umleitung vermerkt der Agent die Zieladresse als `final_url` in
  `pages`, Zitate von dort gelten als von der Website. Der Fund zeigt den
  Text, das Zitat und „Im neuen Tab öffnen“ für die Website (neu für alle
  KI-Hinweise), der Nutzer entscheidet selbst.
  - WhatsApp nur, wenn das Zitat „WhatsApp“ oder einen wa.me-Link enthält:
    die Nummer, wenn sie eindeutig dasteht (Ziffern auf der Seite), sonst
    der Link (wa.me/<nutzername>, wa.me/message/…). osmValidation lässt Links
    gelten; bei wa.me/<nummer> wird die Nummer allein bevorzugt.

## KI-Auswertung über Claude Code (Branch `claude-code`)

Konzept: [docs/ki-claude-code.md](docs/ki-claude-code.md). Umgesetzt am
2026-11-02 im Branch `claude-code` beider Repos:

- osmAssist: `jobFile` (Vorlage `auftrag.md` mit Anweisung, Antwortformat
  und Objekt-IDs), `parseAnswerFile` (Antwortdateien
  `osmcorrection-assist-answer`, Version 1), `htmlToText` (ohne DOM, Links
  behalten ihre Adresse), `readingFromAnswer` (Antwort plus gespeicherte
  Seiten als `SiteReading`, danach `assess` wie bei der API).
- osmCorrection: „Auftrag für Claude Code erstellen“ in Schritt 1 neben
  „Herunterladen und prüfen“: lädt den Rahmen (nur Objekte mit Website,
  unabhängig von den angehakten Prüfungen) und speichert sofort die
  Auftragsdateien, ohne Prüfschritt (gewünscht 2026-11-02; je Website und
  Adresse ein Auftrag, höchstens 15 je Datei); „Ergebnis aus Claude Code
  importieren …“ in Schritt 1 (Ordnerauswahl; die Objekte kommen aus dem
  Zwischenspeicher des Exports, `exportCache.ts`, 24 Stunden lang, sonst
  frisch von der OSM-API, `fetchElements` in `osmMap.ts`), Hinweis mit Zahl der Antworten, nicht
  mehr vorhandenen Objekten und unlesbaren Dateien. Die angehakten
  Prüfungen laufen für die importierten Objekte mit.
- Herkunft (entschieden 2026-11-02): Die Antwortdatei hat das Pflichtfeld
  `ai` (`vendor` = Hersteller des **Modells**, nicht des Werkzeugs; `model`;
  `tool`). Beim Import zeigt osmCorrection die Angaben der Antworten und
  lässt Hersteller (Auswahl plus „anderer“) und Modell (Textfeld, vorbelegt,
  wenn alle Antworten dasselbe nennen) bestätigen oder korrigieren. Nur die
  bestätigten Werte kommen in `ai_assisted` und den Kommentar, wie bei der
  API-Auswertung, z. B. `Anthropic Claude Opus 5.5` (`claude-*`-IDs in
  lesbarer Form); ohne Modell nur der Hersteller. Ein Claude-Modell in Kiro
  ist `Anthropic`. Oberfläche und `auftrag.md` sind
  neutral formuliert („KI-Agent, z. B. Claude Code“), Schaltfläche
  „Auftrag für KI erstellen“.
- JSON-Schema der Antwortdatei in osmAssist: `schema/answer-file.schema.json`
  (aus `ANSWER_FILE_SCHEMA` mit `npm run schema`, Test prüft Gleichheit),
  Doku `docs/answer-file.md`.
- `npm run smoke:assist` prüft Export und Import mit.

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

## Mehrsprachigkeit

Deutsch und Englisch, ohne Framework (`src/i18n.ts`):

- Texte in `src/locales/de.ts` und `en.ts`. Die deutsche Datei legt die
  Schlüssel fest, jede weitere Sprache braucht genau dieselben (sonst
  scheitert der Typcheck). Platzhalter `{name}`, Ein- und Mehrzahl als
  `{ one, other }` (gewählt über `count` und `Intl.PluralRules`). Ein Test
  prüft, dass alle Sprachen dieselben Platzhalter haben.
- `index.html` enthält keine Texte, nur `data-i18n="schlüssel"` (Text),
  `data-i18n-html` (Text mit Auszeichnung, nur aus den Sprachdateien) und
  `data-i18n-<attribut>` (z. B. `placeholder`). `translatePage()` füllt sie
  beim Start.
- Sprache: gespeicherte Wahl (`osmCorrection.lang`), sonst die erste passende
  Browsersprache, sonst Englisch. Umschalten im Fuß der Seitenleiste lädt die
  Seite neu; noch nicht hochgeladene Änderungen bleiben erhalten.
- In der Sprache der Oberfläche sind auch der Changeset-Kommentar, der Text
  von OSM-Hinweisen und die Auftragsdatei für KI-Agenten (`auftrag.md` bzw.
  `job.md`, aus osmAssist). Der Import liest `antworten/` und `answers/`.
- Impressum und Datenschutz bleiben deutsch.
- Die Anleitung gibt es je Sprache als eigene Seite (`hilfe.html`,
  `help.html`); welche die Links öffnen, steht in `app.helpPage`.
- Die Tests laufen auf Deutsch (`test/setup.ts`), die Smoke-Tests mit
  `locale: 'de-DE'`.

Neue Sprache: `src/locales/<code>.ts` als `Messages` anlegen, in
`LANGUAGES` und `MESSAGES` (`i18n.ts`) eintragen; für die Auftragsdatei
braucht osmAssist die Sprache ebenfalls (`JOB_FOLDERS`, `jobFile`). Für die
Anleitung die Seite übersetzen (Eingang in `vite.config.ts`) und die
Sprache in `scripts/screenshots.mjs` aufnehmen.

## Anleitung

`hilfe.html` (deutsch) und `help.html` (englisch): je ein Abschnitt für
Anmelden, Auswählen, Prüfen, Hochladen und die beiden Wege der
KI-Unterstützung, mit Klickanleitungen und Bildern. Die Abschnitte haben in
beiden Sprachen dieselben Anker (`#start`, `#select`, `#review`, `#upload`,
`#ai-key`, `#ai-agent` …). In der App verlinkt ein „?“ an jeder
Schrittüberschrift (`data-help="<anker>"`, `setupHelpLinks()` in `main.ts`)
auf den Abschnitt, in einem neuen Tab.

Die Bilder in `public/help/<sprache>/` erzeugt `npm run screenshots`
(Vorschau-Server wie bei den Smoke-Tests) mit erfundenen Läden am Markt in
Ilmenau: Overpass, Nominatim, OSM-API und Anthropic-API sind nachgebaut, nur
die Kartenkacheln kommen von openstreetmap.org. Was angeklickt werden soll,
ist orange umrandet. Nach Änderungen an der Oberfläche neu erzeugen.

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
| maps.mail.ru (VK) | OK, zeitweise 504; am 2026-11-02 entfernt (Russland, Datenschutz) |
| overpass.private.coffee | hing ohne Antwort |
| overpass.kumi.systems | hing ohne Antwort, nicht eingebaut (heute private.coffee) |
| overpass.osm.jp | kein CORS, nicht nutzbar |
| ovp.dresel.systems | CORS offen, antwortet; nur Europa, nur nächtlich aktualisiert, privat mit 4 Kernen; nicht eingebaut |

Nur Server in EU/EWR, damit die Datenschutzerklärung keine Drittländer
nennen muss. `download()` fragt die Server der Reihe nach (overpass-api.de,
private.coffee), jeweils mit 100 s Zeitlimit, und macht nach 5 s eine zweite
Runde. Erst dann kommt eine Fehlermeldung, die für jeden Server den Grund
nennt. Eine fehlerhafte Abfrage (z. B. 400) wird sofort gemeldet.

**Ersatz über die OSM-API** (entschieden 2026-11-02, Variante „nach der
ersten Runde“): Für den Rahmen (Herunterladen und Auftrag für KI) hat die
erste Runde nur 30 s Zeitlimit je Server. Antwortet keiner, lädt
`downloadMap()` (`src/osmMap.ts`) den Rahmen mit dem `map`-Aufruf der OSM-API
(`/api/0.6/map.json?bbox=…`, alle Objekte ohne Filter) und wählt im Browser
aus, was die Overpass-Abfrage geliefert hätte (`parseMap`: gleiche
Key-Muster, Punkte im Rahmen, Wege und Relationen mit einem Punkt im Rahmen;
Geometrie aus den Punkten, bei Relationen nur aus den mitgelieferten
Mitgliedern). Der Nutzer sieht „Overpass ist nicht erreichbar, lade direkt
von openstreetmap.org …“. Scheitert auch das, folgt die zweite
Overpass-Runde (100 s). Erster Test am 2026-11-02: Overpass war gerade ganz
ausgefallen, der Ersatz brauchte für den Rahmen am Markt in Ilmenau etwa
5 s. Ein Abgleich der Auswahl mit Overpass steht noch aus.

Der Import einer KI-Antwort fragt Overpass gar nicht mehr: Die Objekte
kommen aus dem Export (24 Stunden im Browser) oder einzeln von der OSM-API.

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
