---
schemaVersion: 1
projectId: multiterminal-app
state: active
updatedAt: 2026-10-13T13:10:00+02:00
updatedBy: claude
---

# Multiterminal App

## Zweck
Desktop-App für macOS, die Projekte in einer Seitenleiste zeigt und pro Projekt bis zu zehn echte Terminals mit eigenem Mini-Browser für parallel laufende Terminal-Agenten bereitstellt.

## Aktueller Stand
Version 0.1.0 läuft als Entwicklungsstart (`npm start`) und als gebaute `Multiterminal App.app` unter `dist/`. Geprüft, noch nicht von Joshua abgenommen.

## Nächster Schritt
Joshua probiert die gebaute App aus und nennt Änderungswünsche.

## Aktive Aufgaben
- Keine offenen Aufgaben aus der Prüfung; Änderungswünsche von Joshua abwarten.

## Blocker
- Joshuas zsh fragt in jedem neuen Terminal nach „insecure directories“ (Homebrew gehört Benutzer m4diva, ausgelöst durch Bun-Vervollständigung in `~/.zshrc`). Schnellstarts warten, bis die Frage beantwortet ist. Joshua hat der Änderung an `~/.zshrc` zugestimmt, die automatische Ausführung wurde aber von der Sicherheitsprüfung blockiert; Joshua muss die Zeile selbst einfügen.

## Entscheidungen
- Electron ohne Bundler/Framework; Shells über node-pty als interaktive Login-Shell, damit der normale PATH gilt.
- Schnellstart-Befehle werden erst getippt, wenn die Shell bereit ist (Bracketed-Paste-Signal).
- Fortsetzen-Befehle per `--help` geprüft: `claude --continue`, `codex resume --last`, `kimi --continue`.
- Umsetzung verteilt: Kern Opus, UI und Persistenz Sonnet, Kleinteile und Doku Haiku.

## Nachweise
- Auf GitHub gepusht (`Joshua16022008/multiterminal-app`, privat) und als Submodul im Second Brain eingetragen (lokaler Commit c7edd7c).
- `npm test`: 67 Tests, 67 bestanden (13.10.2026).
- Laufende App per Screenshot geprüft: zehn Terminals im Raster, elftes gesperrt; Shell im Projektordner mit vollem PATH; zwei Mini-Browser mit verschiedenen Seiten; Snapshot und PROGRESS.md angelegt; Aufbau, Browser-Adressen und Verlauf nach Neustart zurück; keine verwaisten Shells nach dem Beenden.
- Gebaute App gestartet: Terminals laufen, `claude`, `codex`, `kimi` werden gefunden.
- Claude Code lief in einer Kachel korrekt dargestellt.
- Zweite Prüfrunde (13.10.2026) an der laufenden App: Projekt hinzufügen (Ordnerdialog im Test ersetzt), umbenennen, entfernen (Ordner bleibt, Shells beendet); eigener Schnellstart über das Formular angelegt und gestartet; „Fortsetzen“ nach Neustart; Menübefehle Neues Terminal/Terminal schließen; Link-Klick im Terminal öffnet den Mini-Browser; Schließen über das Fenster sichert den Verlauf; wiederhergestellter Verlauf erscheint gedimmt.
- Nicht geprüft: Tastenkürzel ⌘T/⌘W per echtem Tastendruck (nur die Menübefehle dahinter), native Dialoge selbst, Codex und Kimi Code gestartet.

## Verbindungen
- Ziele:
- Projekte:
- Skills:
- Agents:

## Quellen
- README.md
