# Multiterminal

Die Multiterminal ist eine Desktop-Anwendung für macOS. Projekte stehen in einer Seitenleiste. Es gibt beliebig viele Projekte und pro Projekt bis zu 30 echte Terminals im Dreier-Raster (ab der dritten Reihe wird gescrollt), und jedes Terminal hat einen eigenen Mini-Browser. So lassen sich Claude Code, Codex, Kimi Code und andere Terminal-Agenten nebeneinander betreiben.

## Funktionen

- Projekte in einer Seitenleiste
- Plus-Knopf legt ein neues Terminal an, bis zu 30 pro Projekt
- Schnellstarts für Claude Code, Codex, Kimi Code und eigene Befehle
- Mini-Browser in jeder Terminal-Kachel
- Layout und Terminal-Ausgabe werden nach einem Neustart wiederhergestellt
- Eine PROGRESS.md pro Projekt
- Snapshots der Terminal-Ausgabe werden unter `.multiterminal/snapshots/` im Projektordner gespeichert

## Entwicklung

### Zusammenarbeit der Agenten in diesem Repository

Vor Beginn und bei Wiederaufnahme `AGENTS.md`, `PROJECT_STATUS.md`, `WORK_IN_PROGRESS.md` und `PROGRESS.md` lesen. Claude erhält dieselben Regeln über `CLAUDE.md`. In anderen Oberflächen diese Dateien ausdrücklich lesen lassen; laufende Sitzungen müssen die neuen Regeln neu laden.

- `WORK_IN_PROGRESS.md` hält Aufgaben, zuständige Sitzungen, reservierte Dateien sowie Nachrichten und Übergaben fest. Erst reservieren, dann bearbeiten; Überschneidungen vor Änderungen klären.
- `PROGRESS.md` ist das einzige ausführliche Fortschrittsprotokoll und bleibt an das bestehende Fortschrittspanel angebunden. Ergebnisse enthalten konkrete Prüfungen und offene Punkte.
- `PROJECT_STATUS.md` bleibt die kompakte Projektübersicht. Gemeinsame Dokumente unmittelbar vor Änderungen neu lesen und nur gezielt ergänzen, damit fremde Einträge erhalten bleiben.

Die Übersicht koordiniert per Absprache und bietet keine technische Sperre gegen gleichzeitige Reservierungen oder Schreibvorgänge. Diese Einrichtung gilt für das Multiterminal-Repository; sie wird nicht automatisch in andere Projekte der App übertragen.

### Start und Prüfungen

```bash
npm install
npm start
```

Tests ausführen:

```bash
npm test
```

Mac-App bauen (Ergebnis liegt in `dist/`):

```bash
npm run build
```

## Technik

Electron, node-pty, xterm.js

## Aufbau

- `src/main`: Hauptprozess von Electron, Projekt- und Schnellstart-Speicher
- `src/renderer`: Oberfläche im Fenster, Terminal-Kacheln und Layout
- `tests`: automatische Tests mit `node:test`
- `scripts`: Hilfsskripte, etwa für Build und Nachinstallation

## GitHub

Über „+ Projekt → Von GitHub…“ lassen sich eigene Repositories als Projekt hinzufügen (benötigt die GitHub-CLI `gh`, angemeldet mit `gh auth login --web`). Die Seitenleiste zeigt Branch, offene Änderungen und ausstehende Pushes/Pulls; der Sync-Knopf holt neue Änderungen und pusht vorhandene Commits. Committet wird nie automatisch.

## Diktat

Der Mikro-Knopf in jeder Kachel nimmt über Flüsterflow auf (lokal, Projektordner `Flüsterflow` daneben) und tippt den Text in dieses Terminal, ohne Enter. Der Schalter „Live-Diktat“ oben rechts lässt den Text schon beim Sprechen erscheinen. Das Sprachmodell wird beim ersten Diktat geladen.

## Dateien und Bilder

Im Entwicklungsstand öffnet der Büroklammer-Knopf im Kachelkopf eine Vorschau für Text und Dateiverweise. Dateien lassen sich auch direkt auf die gewünschte Kachel ziehen. Bilder können in der Kachel oder Vorschau eingefügt oder über „Bild aus Zwischenablage“ hinzugefügt werden.

Die Vorschau zeigt die Zielkachel und den vollständigen Einfügetext. „Ins Terminal einfügen“ übernimmt ihn ohne Enter; Abbrechen lässt die Terminaleingabe unverändert. Zeilenumbrüche im Auftrag werden dabei zu Leerzeichen. Es sind bis zu 20 Dateien möglich; Zwischenablagebilder bis zu 20 MB werden als lokale PNG-Dateien im App-Datenordner unter `attachments/` gespeichert. Dateinamen mit Steuerzeichen oder Zeilenumbrüchen werden mit einer Meldung abgewiesen.

Die App fügt Dateipfade ein. Ob ein Agent daraus ein Bild oder Dokument lädt, hängt vom jeweiligen CLI ab und wird dadurch nicht bestätigt. Die Funktion ist unabhängig vom bisherigen Ziehen zum Tauschen zweier Kacheln. Der Entwicklungsstand muss zum Nutzen in der installierten App separat gebaut und installiert werden.

## Installieren

`npm run build` erzeugt `dist/Multiterminal-darwin-arm64/Multiterminal.app`. Zum Aktualisieren die App beenden und mit `ditto "dist/Multiterminal-darwin-arm64/Multiterminal.app" /Applications/Multiterminal.app` ersetzen.
