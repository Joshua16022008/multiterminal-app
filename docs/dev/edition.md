# Editionen: Entwicklerversion und öffentliche Version

Dieses Repository ist die **Entwicklerversion** (`dev`). Die **öffentliche Version** (`public`) entsteht nur über den Export in ein eigenes Repository mit eigener Historie. Der Export lässt die unten genannten Dateien weg und legt eine `edition.json` an. Hier ändert sich dadurch nichts: Ohne `edition.json` verhält sich die App wie bisher.

## Schalter

`src/main/edition.js` liest `edition.json` im App-Root:

```json
{ "edition": "public", "appName": "Multiterminal", "bundleId": "io.github.multiterminal" }
```

| Fall | Ergebnis |
|---|---|
| keine `edition.json`, `dev-features.js` vorhanden (dieses Repo) | `dev`; Name, Bundle-ID und Funktionen kommen aus `dev-features.js` (`de.joshua.multiterminal`, alle Funktionen an) |
| `"edition": "public"` | alle Entwicklerfunktionen aus; `appName` und `bundleId` aus der Datei, sonst Standard `Multiterminal` / `io.github.multiterminal` |
| unbekannte Edition, kaputte Datei, kein Objekt | `public` (fail-safe) |
| `"edition": "dev"` mit `"features": { "dictation": false }` | einzelne Funktion aus; einschalten geht nur, wenn das Entwicklermodul vorhanden ist |
| Entwicklermodul fehlt | jede Funktion aus, egal was die Datei sagt |

Für Tests und QA: Die Umgebungsvariable `MULTITERMINAL_EDITION_FILE` zeigt auf eine andere `edition.json`.

API: `edition.edition`, `appName`, `bundleId`, `features.{dictation,taskLink,secondBrain}`, `isPublic()`, `isDev()`, `devFeatures` (Modul oder `null`), `publicInfo()` (geht an den Renderer, ohne Pfade) und `cloneDir(home)`.

## Was die öffentliche Version nicht hat

| Funktion | Schalter | Stellen |
|---|---|---|
| Diktat (Mikrofon im Kachelkopf, Schalter „Live-Diktat“, Esc-Abbruch, Hauptprozess-Dienst, IPC `dictation:*`, Mikrofon-Text in Info.plist) | `dictation` | `main.js` erzeugt `dictation` nur über `devFeatures.createDictation`, `preload.js` stellt `deck.dictation` nur bei Funktion an bereit, `terminal-pane.js` baut das Mikrofon nur mit `D.dictation.available`, den Schalter „Live-Diktat“ legt `renderer/dictation.js` selbst an, `build.js` setzt `usageDescription` nur mit Diktat |
| Aufgaben-Verknüpfung (Chip „+ Aufgabe“, Aktion `task-link` ⌘⇧L in Hotkeys, Palette, Menü „Funktionen“, Live-Tastentabelle, Komfort-Schalter, IPC `secondBrain:*`) | `taskLink` | `hotkeys.js` filtert Aktionen mit `feature: 'taskLink'` (`disabled`), `hotkey-store.js` verwirft deren Belegung aus einer fremden Datei, `main.js` registriert IPC und Menüpunkt nur bei Funktion an, `preload.js` stellt `deck.secondBrain` nur dann bereit, `qol-panel.js` zeigt den Schalter nur mit `DeckTaskLink.QOL_ITEM` |
| Persönlicher Klonordner | `secondBrain` | `edition.cloneDir()`: dev wie bisher (Second-Brain-Projektordner, sonst `~/Multiterminal`), public `~/<appName>/Projekte` |

Bezeichnungen der Entwicklerversion („Second-Brain-Aufgabe der Kachel“, Mikrofon-Tooltip, Komfort-Text, Knopf-Tooltip) stehen nur in den Dateien der Entwicklerversion und werden zur Laufzeit gesetzt (`DeckHotkeys.setLabel`, `D.dictation.label`, `DeckTaskLink.QOL_ITEM`). Die gemeinsamen Dateien sind neutral formuliert. In beiden Editionen heißt es jetzt „der Nutzer“ statt eines Namens (`pm-role.md`, `pm-bridge.js`, `mt-pm-cli.js`, `project-seed.js`).

Die Edition gibt auch die App-Identität vor: Bundle-ID (`build.js`, `update-service.js`, `update-helper.sh` über `MT_UPDATE_BUNDLE_ID`/`MT_UPDATE_APP_NAME`), App-Name für Paket, Fenster, Hilfe-Menü, Benachrichtigung und Update-Dialog.

## Export-Manifest

Maschinenlesbar in `scripts/export-manifest.json` (selbst nur Entwicklerversion). Der Release-Wächter in `tests/guide-content.test.js` nimmt diese Dateien aus; `tests/edition-dev.test.js` prüft, dass alle existieren und gemeinsame Dateien sie nicht direkt laden.

**Nur Entwicklerversion (`devOnly`, werden weggelassen):**

- `src/main/dev-features.js`: Werte der Entwicklerversion, Pfade, Bezeichnungen, Fabriken für Diktat und Aufgaben
- `src/main/dictation.js`
- `src/main/second-brain-tasks.js`
- `src/renderer/dictation.js`
- `src/renderer/task-link.js`
- `src/renderer/task-link.css`
- `scripts/qa-task-link.js`
- `scripts/export-manifest.json`
- `tests/dictation.test.js`
- `tests/second-brain-tasks.test.js`
- `tests/task-link.test.js`
- `tests/private-terms.js`: persönliche Begriffe für die Wächter
- `tests/edition-dev.test.js`

**Interne Dokumente (`internal`, werden nie exportiert):** `AGENTEN_AUFTRAEGE.md`, `AGENTS.md`, `CLAUDE.md`, `ENTWICKLUNGSPLAN.md`, `FEATURE_RECHERCHE.md`, `PROGRESS.md`, `PROJECT_STATUS.md`, `UPDATE_VERSION.md`, `WORK_IN_PROGRESS.md`, `docs/dev/`, `docs/superpowers/`.

**Zeilen entfernen (`stripLines`):** In `src/renderer/index.html` die Zeilen mit `dev-only` (Script-Tags `dictation.js`, `task-link.js`, Stylesheet `task-link.css`). Fehlen die Dateien trotzdem, startet die App ebenfalls, denn jeder Zugriff prüft vorher, ob das Modul geladen ist.

**Neu anlegen:** `edition.json` aus `publicEdition`.

## Tests und QA

- `tests/edition.test.js` (wird exportiert): Auflösung, fail-safe, Hotkey-Modell, Preload und Komfort in beiden Editionen, Hotkey-Datei aus der anderen Edition.
- `tests/edition-dev.test.js` (nur dev): Die Entwicklerversion bleibt gleich (Identität, Label, Kürzel, Klonordner, Paketwerte, Diktat-Ordner) und das Manifest passt.
- `scripts/qa-edition.js`: öffentliche Version mit temporärer `edition.json` (Standard) oder `dev`; prüft Kachelkopf, Menü, Hotkeys, Komfort und Palette, mit Screenshot.
- `qa-topbar.js` und `qa-feature-hotkeys.js` laufen in beiden Editionen.

## Offen

- **Gemeinsame Daten:** Electron legt die Daten nach App-Namen ab. Mit gleichem `appName` teilen eine installierte öffentliche Version und die Entwicklerversion `~/Library/Application Support/Multiterminal`. Zum lokalen Testen der öffentlichen Version einen anderen `appName` wählen oder mit eigenem Datenordner starten.
- **Weiterer App-Name:** `package.json` (`productName`) und Texte, die „Multiterminal“ nennen (CLI-Hilfen `mt-*`, Einstellungen, PM-Rolle, Update-Texte im Renderer, `index.html`-Titel), setzt der Export bei einem anderen Namen; die technische Identität kommt schon aus `edition.json`.
- **R-2 (nicht Teil dieses Schritts):** `README.md` (Abschnitt Diktat), Lizenz, Projektdateien, `.gitignore`, CI und die `IGNORE`-Liste in `build.js`.
- Das Exportskript selbst (Kopie ohne `devOnly`/`internal`, `stripLines`, `edition.json`, Ziel `../multiterminal-export`).
