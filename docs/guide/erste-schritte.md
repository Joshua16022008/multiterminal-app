---
title: Erste Schritte
order: 10
keywords: installation, start, voraussetzungen, npm, projekt, erstes terminal
---

# Erste Schritte

Multiterminal läuft auf macOS. Diese Seite führt dich von der Installation bis zum ersten Terminal.

## Voraussetzungen

- macOS (die App wird für macOS gebaut)
- Node.js mit npm
- Git
- Mindestens ein Terminal-Agent, den du benutzen willst: `claude` (Claude Code), `codex` (Codex) oder `kimi` (Kimi Code). Die App startet diese Programme nur. Sie müssen bei dir installiert und angemeldet sein.
- Optional: die GitHub-CLI `gh`, angemeldet mit `gh auth login --web`. Ohne sie gehen „Von GitHub…“ und „Aktives Projekt auf GitHub anlegen…“ nicht, der Rest schon.

## Aus dem Quellcode starten

Im Projektordner:

```bash
npm install
npm start
```

`npm install` lädt die Abhängigkeiten und macht dabei den Hilfsprozess von node-pty ausführbar. `npm start` öffnet die App im Entwicklungsmodus.

Weitere Befehle aus der `package.json`:

| Befehl | Wirkung |
|---|---|
| `npm start` | App starten |
| `npm test` | automatische Tests ausführen |
| `npm run build` | Mac-App bauen, Ergebnis in `dist/` |

## Als App installieren

```bash
npm run build
```

Das Ergebnis liegt in `dist/Multiterminal-darwin-arm64/Multiterminal.app` (auf Intel-Macs heißt der Ordner entsprechend anders). Kopiere die App nach „Programme“, zum Beispiel mit `ditto`. Spätere Updates beschreibt die Seite [App aktualisieren](updates.md).

## Projekt hinzufügen

Ein Projekt ist ein Ordner auf deinem Mac. Klicke in der Seitenleiste auf „+ Projekt“. Das Menü bietet:

- **Neues Projekt planen…** legt einen neuen Git-Ordner an und öffnet darin einen Agenten, mit dem du das Projekt besprichst.
- **Ordner wählen…** fügt einen vorhandenen Ordner hinzu.
- **Von GitHub…** zeigt deine Repositories. Ein Klick klont das Repository und fügt es als Projekt hinzu. Dafür brauchst du `gh`.

Wenn bereits ein Projekt aktiv ist, steht im Menü außerdem „Aktives Projekt auf GitHub anlegen…“.

## Erstes Terminal

1. Wähle ein Projekt in der Seitenleiste.
2. Klicke oben rechts auf „+“ oder drücke ⌘T. Es öffnet sich ein normales Terminal (deine Login-Shell) im Projektordner.
3. Für einen Agenten klicke auf „▾“ neben dem „+“ und wähle zum Beispiel „Claude Code“. Die App tippt den Startbefehl für dich in ein neues Terminal.

Mehr dazu auf der Seite [Terminals und Agenten](terminals-und-agenten.md). Wie die Oberfläche aufgebaut ist, steht unter [Oberfläche](oberflaeche.md).

## Hilfe in der App

Dieses Handbuch öffnest du mit ⌘⇧H, mit dem Knopf „?“ in der Kopfleiste oder über das Menü „Hilfe“. Die Suche im Hilfe-Panel findet Seiten und Überschriften.
