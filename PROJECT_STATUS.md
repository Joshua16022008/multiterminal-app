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
Joshua testet das Diktat mit echtem Mikrofon in der gebauten App (macOS fragt einmalig nach der Mikrofonfreigabe).

## Aktive Aufgaben
- Keine offenen Aufgaben aus der Prüfung; Änderungswünsche von Joshua abwarten.

## Blocker
- Keine.

## Entscheidungen
- Electron ohne Bundler/Framework; Shells über node-pty als interaktive Login-Shell, damit der normale PATH gilt.
- Schnellstart-Befehle werden erst getippt, wenn die Shell bereit ist (Bracketed-Paste-Signal).
- Fortsetzen-Befehle per `--help` geprüft: `claude --continue`, `codex resume --last`, `kimi --continue`.
- GitHub: Repos über `gh` auflisten/klonen (Ziel: Second-Brain-Projekte-Ordner); Sync holt nur per Fast-Forward und pusht vorhandene Commits, committet nie selbst.
- Umsetzung verteilt: Kern Opus, UI und Persistenz Sonnet, Kleinteile und Doku Haiku.

## Nachweise
- Auf GitHub gepusht (`Joshua16022008/multiterminal-app`, privat) und als Submodul im Second Brain eingetragen (lokaler Commit c7edd7c).
- `npm test`: 67 Tests, 67 bestanden (13.10.2026).
- Laufende App per Screenshot geprüft: zehn Terminals im Raster, elftes gesperrt; Shell im Projektordner mit vollem PATH; zwei Mini-Browser mit verschiedenen Seiten; Snapshot und PROGRESS.md angelegt; Aufbau, Browser-Adressen und Verlauf nach Neustart zurück; keine verwaisten Shells nach dem Beenden.
- Gebaute App gestartet: Terminals laufen, `claude`, `codex`, `kimi` werden gefunden.
- Claude Code lief in einer Kachel korrekt dargestellt.
- Zweite Prüfrunde (13.10.2026) an der laufenden App: Projekt hinzufügen (Ordnerdialog im Test ersetzt), umbenennen, entfernen (Ordner bleibt, Shells beendet); eigener Schnellstart über das Formular angelegt und gestartet; „Fortsetzen“ nach Neustart; Menübefehle Neues Terminal/Terminal schließen; Link-Klick im Terminal öffnet den Mini-Browser; Schließen über das Fenster sichert den Verlauf; wiederhergestellter Verlauf erscheint gedimmt.
- GitHub-Anbindung (13.10.2026): `gh` 2.102.0 nach `~/.local/bin` installiert, angemeldet als Joshua16022008. 77 Tests grün. An der laufenden App geprüft: Menü „Ordner wählen…/Von GitHub…“, Repo-Liste mit 13 Repos und Suche, vorhandenes Repo ohne Klonen als Projekt hinzugefügt, Git-Zeile (Branch, offene Änderungen), Sync meldet „Alles aktuell“. Echtes Klonen über den Dienst in einen Testordner geprüft, nicht über den Dialog. Pull/Push/auseinandergelaufene Stände nur in den automatischen Tests geprüft.
- Raster (13.10.2026): ab drei Terminals immer drei Spalten, zwei Reihen sichtbar, darunter scrollen; Obergrenze 30. Mit acht Terminals an der laufenden App geprüft.
- Diktat über Flüsterflow (13.10.2026): neuer Dienst `fluesterflow/server.py` im Flüsterflow-Projekt; Mikro-Knopf je Kachel, Schalter „Live-Diktat“, Abbrechen. Lautlos mit erzeugter Sprachdatei an der laufenden App geprüft: am Stück, live mit Endkorrektur, zweites Mikro währenddessen abgewiesen, Abbrechen. 82 Tests grün. Nicht geprüft: echtes Mikrofon und macOS-Mikrofonfreigabe der gebauten App.
- Nicht geprüft: Tastenkürzel ⌘T/⌘W per echtem Tastendruck (nur die Menübefehle dahinter), native Dialoge selbst, Codex und Kimi Code gestartet.

## Verbindungen
- Ziele:
- Projekte:
- Skills:
- Agents:

## Quellen
- README.md
