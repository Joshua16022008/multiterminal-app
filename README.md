# Multiterminal App

Die Multiterminal App ist eine Desktop-Anwendung für macOS. Projekte stehen in einer Seitenleiste. Pro Projekt gibt es bis zu zehn echte Terminals, und jedes Terminal hat einen eigenen Mini-Browser. So lassen sich Claude Code, Codex, Kimi Code und andere Terminal-Agenten nebeneinander betreiben.

## Funktionen

- Projekte in einer Seitenleiste
- Plus-Knopf legt ein neues Terminal an, bis zu zehn pro Projekt
- Schnellstarts für Claude Code, Codex, Kimi Code und eigene Befehle
- Mini-Browser in jeder Terminal-Kachel
- Layout und Terminal-Ausgabe werden nach einem Neustart wiederhergestellt
- Eine PROGRESS.md pro Projekt
- Snapshots der Terminal-Ausgabe werden unter `.multiterminal/snapshots/` im Projektordner gespeichert

## Entwicklung

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
