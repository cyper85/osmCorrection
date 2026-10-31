# osmCorrection

Prüft und korrigiert OpenStreetMap-Daten im Browser: Telefon- und Faxnummern,
E-Mail-Adressen, Websites, Wikipedia, Wikidata, Facebook und X/Twitter. Die
Prüfregeln kommen aus [osmValidation](https://github.com/cyper85/osmValidation),
das als Git-Submodul eingebunden ist.

Ablauf: Kartenausschnitt wählen → Daten über Overpass laden → jeden Fund
einzeln übernehmen, ändern oder überspringen → Änderungen gesammelt prüfen und
als ein Changeset hochladen. Vor dem Hochladen wird die aktuelle Version jedes
Elements von der OSM-API geholt. Wurde ein Tag inzwischen von jemand anderem
geändert, wird diese Änderung als Konflikt übersprungen.

Zusätzlich gibt es eine Online-Prüfung der Wikidata-Verweise: Gibt es das
Objekt noch, ist es eine Weiterleitung, und passt der `wikipedia`-Tag zu dem
Artikel, der im Wikidata-Objekt verknüpft ist?

Alle Funde stehen als Marker auf der Karte (orange offen, grün geändert, grau
übersprungen); ein Klick springt zum Fund. Tastenkürzel: <kbd>Enter</kbd>
übernehmen, <kbd>Bild ↓</kbd> überspringen, <kbd>Bild ↑</kbd> zurück,
<kbd>Esc</kbd> alten Wert wiederherstellen. Nicht hochgeladene Änderungen
bleiben im Browser gespeichert, auch über ein Neuladen oder das Login hinweg.

Alles läuft im Browser, es gibt keinen Server. Veröffentlicht wird über
GitHub Pages.

## Entwicklung

```bash
git clone --recurse-submodules https://github.com/cyper85/osmCorrection.git
# bei einem bestehenden Klon: git submodule update --init
npm install
npm run dev        # http://127.0.0.1:5173/
npm test           # vitest
npm run build      # Typprüfung + Build nach dist/
```

osmValidation wird direkt aus den TypeScript-Quellen in `libs/osmValidation`
eingebunden (Vite-Alias und `paths` in `tsconfig.json`), Änderungen dort sind
im Dev-Server sofort sichtbar. Die Abhängigkeiten des Submoduls installiert
`npm install` über den npm-Workspace mit.

Submodul aktualisieren:

```bash
git submodule update --remote libs/osmValidation
git add libs/osmValidation && git commit -m "osmValidation aktualisiert"
```

## OAuth

Für das Login braucht es eine OAuth-2-Anwendung auf openstreetmap.org
(Einstellungen → OAuth 2-Anwendungen):

* „Vertrauliche Anwendung“ **nicht** ankreuzen (PKCE, kein Secret)
* Berechtigungen: `read_prefs`, `write_api`
* Redirect-URIs:
  `https://osmcorrection.neumann-andreas.de/ https://cyper85.github.io/osmCorrection/ http://127.0.0.1:5173/`
  (OSM vergleicht exakt; der Hostname muss kleingeschrieben sein, so wie ihn
  der Browser in `location.origin` liefert)

Die Client-ID kommt nach `VITE_OSM_CLIENT_ID` in `.env`. Sie ist öffentlich
und darf ins Repo.

## Deployment

`.github/workflows/deploy.yaml` testet und baut bei jedem Push und
veröffentlicht `master` auf GitHub Pages (Repo-Einstellungen → Pages → Source:
„GitHub Actions“).

Eigene Domain `osmcorrection.neumann-andreas.de`:

* DNS: `CNAME`-Eintrag `osmcorrection.neumann-andreas.de` → `cyper85.github.io`
* Repo-Einstellungen → Pages → Custom domain eintragen, danach „Enforce HTTPS“
* Am besten vorher die Domain unter den Account-Einstellungen → Pages
  verifizieren, damit sie niemand anderes übernehmen kann

Bei einer Veröffentlichung über GitHub Actions braucht es keine `CNAME`-Datei
im Repo, die Domain steht nur in den Einstellungen. GitHub leitet
`cyper85.github.io/osmCorrection/` dann automatisch auf die eigene Domain um.
Der Build verwendet relative Pfade (`base: './'`) und funktioniert unter
beiden Adressen.
