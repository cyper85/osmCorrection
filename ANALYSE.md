# osmCorrection – Projektanalyse

Stand: 2026-10-31

## Ziel des Projekts

OpenStreetMap-Daten im Browser prüfen und korrigieren – zunächst Formatierungen
(Telefon, Mail, URLs, Social-Media-Tags), später auch Referenzen (Wikipedia,
Wikidata, Websites). Alles läuft clientseitig, es gibt **keine dynamische
Serverkomponente**.

## Ist-Zustand

Prototyp aus 2016/17 mit etwa 800 Zeilen TypeScript (`js/*.ts`), dazu Leaflet,
jQuery, Bootstrap 3 und RequireJS. Der Ablauf ist als Zustandsmaschine in
`index.html` angelegt:

1. **stateZero**: Login bei OSM über `osm-auth`.
2. **stateOne**: Kategorien auswählen (Telefon, Mail, URL, Wikipedia, Facebook,
   Twitter, Xing, LinkedIn) und in die Region zoomen.
3. **Download**: Für jeden Tag eine Overpass-Abfrage über die aktuelle
   Bounding-Box (`correctionTool.ts` `overpassQuery`).
4. **Prüfung**: Jedes Plugin (`correctionObjectClass`) liefert die fehlerhaften
   Tags eines Elements. Daraus entsteht eine Fehler-Warteschlange.
5. **stateTwo**: Die Fehler werden einzeln angezeigt, das Element wird auf der
   Karte hervorgehoben. Man kann den Wert korrigieren oder überspringen.
6. **stateThree**: Ein Changeset öffnen, osmChange-XML hochladen und das
   Changeset schließen.

Dateien:

| Datei | Inhalt |
|---|---|
| `js/main2.ts` | Einstieg: Auth, Karte, UI-Events |
| `js/correctionTool.ts` | Kern: Overpass, Fehler-Warteschlange, Anzeige, Changeset-Upload |
| `js/correctionObject.ts` | Abstrakte Plugin-Basisklasse und Editor-Formular |
| `js/tel.ts` | Einziges Plugin (phone, contact:phone, fax, contact:fax) |
| `js/osmObjectInterface.ts` | Typen für OSM- und Overpass-Elemente |

Die Architektur (generischer Kern plus ein Plugin pro Prüfregel) ist sinnvoll.
Umgesetzt ist aber nur das Telefon-Plugin. Die übrigen sieben Buttons tun
nichts.

## Warum es nicht läuft

- **OAuth 1.0a**: OSM hat OAuth 1 im Jahr 2024 abgeschaltet. `main2.ts` nutzt
  noch `oauth_consumer_key` und `oauth_secret`. `osm-auth` v3 (von Renovate
  hochgezogen) arbeitet nur noch mit OAuth 2 + PKCE und hat eine andere API
  (`client_id`, `redirect_uri`, `scope`).
- **Secret im Repo**: Das OAuth-Secret steht öffentlich in `main2.ts` und
  `main.js`. Die alte App sollte auf openstreetmap.org widerrufen werden.
  Bei OAuth 2 + PKCE braucht man kein Secret mehr.
- **Kaputte Submodule**: `js/libs/osmValidation`, `js/libs/leaflet-search` und
  `js/libs/leaflet-locatecontrol` sind als Git-Submodule eingetragen, aber es
  gibt keine `.gitmodules`. Die Ordner sind leer. Ohne `osmValidation` gibt es
  keine Prüflogik.
- **Build**: TypeScript 2 mit `module: amd` und `outFile`, dazu RequireJS. Das
  passt nicht zu aktuellen `@types/*` (jQuery 4, Leaflet 1.9). Das kompilierte
  JS liegt im Repo, und `typings/` ist veraltet.

## Fehler in der Logik

- **Seiten-Reload beim Klick**: `correctionObject.ts` `editorForm`: „weiter“
  (`type=submit`) und „überspringen“ (ein `<button>` ohne `type`, also auch ein
  Submit-Button) stehen in einem `<form>` ohne `preventDefault`. Der Browser
  lädt die Seite neu, und der ganze Zustand ist weg.
- **Weiter-Button bleibt aktiv**: Wird eine Eingabe wieder ungültig, sucht der
  Code den Button über `$(this).parent("form")`. Das Elternelement ist aber das
  `div`, nicht das Formular, deshalb wird der Button nicht wieder gesperrt.
- **Login-Logik vertauscht**: Im `else`-Zweig von `main2.ts` `update()` bekommt
  ein nicht eingeloggter Nutzer trotzdem die Download-Ansicht.
- **Elemente werden nicht geprüft**: Jede Overpass-Abfrage liefert auch
  Way-Nodes ohne Tags (`>;out skel`). Kommt ein Node so in der ersten Abfrage an
  und in einer späteren mit Tags, verwirft die Duplikat-Prüfung in
  `correctData` die Version mit Tags. Das Element wird nie geprüft und hat keine
  `version`.
- **Absturz bei Relationen**: `showRelation()` ist nur ein Platzhalter. Danach
  läuft `fitBounds(null)` und wirft einen Fehler.
- **Keine Fehlerbehandlung beim Upload**: Fehler werden ignoriert, und das
  Changeset wird in jedem Fall geschlossen. Die Overpass-Daten können veraltet
  sein, es kommt dann zu einem Versionskonflikt (HTTP 409).
- **Changeset-Metadaten**: Die XML gibt `generator="JOSM"` an, der Kommentar ist
  fest eingebaut, und es gibt Debug-`console.log`s.
- **Mehrfachwerte**: `phone=+49 1;+49 2` ist in OSM üblich, wird aber als ein
  einziger Wert geprüft.
- **Keine Korrekturvorschläge**: Ungültige Werte muss man selbst neu eintippen.
  Gerade bei Formatierungsfehlern wäre ein automatischer Vorschlag der
  eigentliche Nutzen.

## osmValidation (eigenes Repo)

Liegt unter `github.com/cyper85/osmValidation` (lokal
`~/PhpstormProjects/osmValidation`), Version 0.0.3 von 2017. Eine einzige
Datei `osmValidation.js` als globales Singleton, dazu jQuery-Plugin und
CommonJS-Export. Funktionen: `phone`, `mail`, `url`, `facebook`, `twitter`,
`google`, `wikipedia`, `wikidata`. Jede gibt nur `true`/`false` zurück und
schreibt den Grund in die gemeinsame Eigenschaft `msg`.

Tests (mocha): 42 bestanden, 1 fehlgeschlagen.

Fehler:

- **IDN-URLs stürzen ab**: Der Punycode-Code ist unvollständig aus
  `punycode.js` kopiert. `digitToBasic`, `adapt` und `error` fehlen, deshalb
  wirft `url("https://server-börse.de")` einen `ReferenceError` (der
  fehlschlagende Test). Mit Pfad (`http://müller.de/x`) entfernt die Regex
  `idn_name_regex` den ganzen Host, und das Ergebnis ist fälschlich `false`.
  Abhilfe: `new URL()` im Browser macht die IDN-Umwandlung selbst.
- **URL-Prüfung zu locker**: `http://a.b?x` gilt als gültig. Benutzer und
  Passwort werden nur erkannt, wenn der Name ein Zeichen lang ist.
- **Google+**: Der Dienst ist seit 2019 abgeschaltet. Außerdem ist die
  Regex `/^\d{+}21}$/` kaputt, sodass numerische IDs nie erkannt werden.
  Die Funktion kann ganz weg.
- **Twitter**: `x.com` fehlt. Nach dem `return` steht toter Code (eine
  kopierte Mail-Regex).
- **Facebook**: Die URL-Regex akzeptiert `f.com` und `https:/` mit nur einem
  Schrägstrich. `profile.php?id=…` wird nicht erkannt.
- **Telefon**: Eine feste Liste von Notrufnummern gilt für alle Länder. Die
  Regex prüft nur „+ und 7–15 Ziffern“, ohne gültige Ländervorwahl und ohne
  Mehrfachwerte mit `;`. `PHONE_INVALID` enthält eine nicht maskierte Regex
  als Text.
- **Wikipedia**: Sprachcodes mit Bindestrich (`zh-yue:`, `be-tarask:`) werden
  nicht erkannt. Eine vollständige URL gilt als gültig, obwohl die OSM-Konvention
  `sprache:Titel` verlangt. Auch ein Wert ohne Sprache gilt als gültig.
- **Mail**: Keine internationalisierten Domains, und ein `mailto:`-Präfix wird
  nicht als typischer, behebbarer Fehler erkannt.
- **API**: `msg` als gemeinsamer Zustand ist fehleranfällig (Aufruf ohne
  Objekt, mehrere Prüfungen nacheinander). Es gibt keine Korrekturvorschläge.
  `osmValidation.d.ts` beschreibt nur ein `interface` ohne Modul-Export.

Für osmCorrection heißt das: Die Bibliothek liefert die Prüfregeln, aber in
der jetzigen Form passt sie nicht zur vorgeschlagenen `Check`/`Issue`-
Schnittstelle. Vorschlag: osmValidation selbst modernisieren (TypeScript,
ES-Modul, npm-Paket statt Submodul). Jede Funktion gibt dann
`{ valid, message, suggestion? }` zurück statt `msg` zu setzen. Telefon über
`libphonenumber-js`, URLs über `new URL()`, Google+ entfernen, `x.com`
ergänzen. Die vorhandenen mocha-Tests dienen als Ausgangsbasis (Umstieg auf
vitest). osmCorrection bindet die Bibliothek dann als npm-Abhängigkeit ein,
lokal während der Entwicklung über `npm link` oder einen Workspace.

## Überflüssige Dateien

`js/main.js` (eine ältere Variante), `js/correctionTool_old.js.bak`, die leere
`js/correctionTool.d.ts`, SystemJS (wird nicht benutzt, RequireJS übernimmt
das), mehrere jQuery-Builds, eine doppelte `images/`-Kopie der Leaflet-Bilder
und das veraltete `typings/`.

## Empfehlung: Neuaufbau mit gleichem Konzept

Bei dieser Größe ist ein Neustart weniger Arbeit als eine Migration.

- **Werkzeuge**: Vite + TypeScript 5 mit ES-Modulen, Bibliotheken über npm statt
  kopiert oder als Submodul. jQuery und Bootstrap 3 streichen, Leaflet behalten.
  Statisch hosten, z. B. auf GitHub Pages.
- **Login**: `osm-auth` v3 mit OAuth 2 + PKCE und dem Scope `write_api`. Dafür
  auf openstreetmap.org eine neue OAuth-2-App registrieren und die
  `redirect_uri` auf die Pages-URL setzen.
- **Plugin-Schnittstelle**, z. B.:

  ```ts
  interface Check {
    id: string;
    keys: string[];  // daraus wird die Overpass-Abfrage gebaut
    validate(value: string, el: OsmElement): Issue[];
  }
  interface Issue { key: string; message: string; suggestion?: string }
  ```

  Damit wird aus jedem Fund ein konkreter Vorschlag nach dem Muster
  „alt → neu“, den man übernimmt, ändert oder überspringt.
- **Telefonnummern**: `libphonenumber-js` statt eigener Regex. Diese Bibliothek
  kann gleich ins internationale Format umwandeln; das Land lässt sich aus
  `addr:country` oder dem Kartenausschnitt ableiten. Mehrfachwerte an `;`
  aufteilen.
- **Overpass**: eine Abfrage für alle Keys mit `out meta geom;`. Dann bringt
  jeder Way seine Geometrie selbst mit, und die ganze Node-Verwaltung fällt
  weg.
- **Vor dem Upload**: die aktuelle Version jedes Elements über die OSM-API
  holen, Konflikte erkennen und alle Änderungen gesammelt als Diff zeigen. Den
  Changeset-Kommentar kann man selbst eingeben.
- **OSM-Regeln**: Solange jede Änderung einzeln bestätigt wird, ist das ein
  normales Editier-Werkzeug. Eine Funktion „alle übernehmen“ würde unter den
  *Automated Edits Code of Conduct* fallen; die bewusst weglassen oder
  begrenzen.

## Referenzprüfung nur im Browser

Ohne Server stößt die Referenzprüfung schnell an CORS:

- **Gut machbar**: Wikidata- und Wikipedia-APIs (sie erlauben `origin=*`), z. B.
  ob `wikidata=Q…` existiert und zu `wikipedia=de:…` passt. Ebenso Nominatim
  und die OSM-API.
- **Kaum machbar**: prüfen, ob `website` erreichbar ist oder ob ein Facebook-,
  X- oder LinkedIn-Profil existiert. Die meisten Seiten blockieren Anfragen aus
  dem Browser. Mit `fetch(..., {mode: "no-cors"})` erkennt man höchstens DNS-
  und Netzwerkfehler, keine 404. Für diese Netzwerke bleibt realistisch nur
  eine Formatprüfung und Normalisierung (URL ↔ Benutzername, je nach
  Konvention im OSM-Wiki).

## Offene Fragen

- ~~Gibt es `osmValidation` noch?~~ Ja, siehe oben.
- Soll der alte Code behalten oder ersetzt werden?
- ~~osmValidation als Bibliothek weiterführen oder übernehmen?~~ Bleibt eine
  eigenständige Bibliothek. Die Details stehen in `osmValidation/ANALYSE.md`.

## Nächster Schritt (vorgeschlagen)

Neues Grundgerüst mit Vite, OAuth 2 und dem Ablauf
Download → Prüfen → Bestätigen → Hochladen, mit einem sauberen Telefon-Plugin
als Vorlage für alle weiteren.
