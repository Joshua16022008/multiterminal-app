---
schemaVersion: 1
projectId: multiterminal-app
state: active
updatedAt: 2026-10-13T16:10:00+02:00
updatedBy: claude
---

# Multiterminal App

## Zweck
Desktop-App für macOS, die Projekte in einer Seitenleiste zeigt und pro Projekt bis zu zehn echte Terminals mit eigenem Mini-Browser für parallel laufende Terminal-Agenten bereitstellt.

## Aktueller Stand
Version 0.1.0 läuft als Entwicklungsstart (`npm start`) und als gebaute `Multiterminal App.app` unter `dist/`. Geprüft, noch nicht von Joshua abgenommen.

## Nächster Schritt
Joshua nutzt die App aus dem Dock und testet das Diktat mit echtem Mikrofon. Flüsterflow-Integration ruht, solange Joshua dort selbst arbeitet. Nach Änderungen: `npm run build`, dann die App nach `/Applications` kopieren.

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
- Name und Icon (13.10.2026): App heißt „Multiterminal“, Icon `assets/icon.icns` (Quelle `assets/icon.svg`). Installiert unter `/Applications/Multiterminal.app`, im Dock abgelegt; Daten von „Multiterminal App“ nach `~/Library/Application Support/Multiterminal` umgezogen. Start aus /Applications geprüft.
- Kontenverwaltung (13.10.2026, nicht committet): mehrere Konten je Anbieter (vorerst Claude Code und Codex), je Anbieter eines aktiv. Neue Terminals starten mit dem aktiven Konto über eigene Konfigurationsordner (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`); das Standardkonto nutzt weiter `~/.claude` bzw. `~/.codex`. Ein Terminal behält sein Konto, auch bei Wiederaufnahme. Skills, Hooks, Plugins und Einstellungen werden per Symlink aus dem Standardordner geteilt, Anmeldedaten nie; die App speichert keine Passwörter. Bedienung: Knopf „Konten“ in der oberen Leiste, Panel rechts (anlegen, umbenennen, in den Papierkorb entfernen, anmelden), aktives Konto im Schnellstart-Menü, Konto-Chip an der Kachel. Dateien: neu `src/main/account-store.js`, `src/renderer/accounts-panel.js`, `tests/account-store.test.js`; geändert `pty-manager.js`, `main.js`, `preload.js`, `session-store.js`, `app.js`, `terminal-pane.js`, `index.html`, `styles.css`. Geprüft: 94 Tests grün, Build läuft, Panel in der App mit Temp-Datenordner durchgespielt. Nicht geprüft: echte Anmeldung mit einem zweiten Konto (insbesondere ob Claude Code je Konfigurationsordner einen eigenen Schlüsselbund-Eintrag anlegt) und Wiederaufnahme nach App-Neustart. Ein Testlauf zeigte unerklärt 17 Kacheln, nicht reproduzierbar. Kimi und Gemini folgen später; eine zweite Sitzung ergänzt eine Verbrauchsübersicht je Konto. Nächster Schritt: Joshua legt ein zweites Claude-Konto an, meldet sich an und prüft, dass beide Konten nebeneinander laufen.
- Verbrauchsübersicht je Konto (13.10.2026, nicht committet): Im Konten-Panel zeigt jede Kontozeile die Kontingentfenster als Balken mit Prozent und Rücksetzzeit (5 Std., Woche), bei Codex dazu den Tarif; Aktualisierung beim Öffnen, alle 60 s und über ⟳. Codex-Stände kommen aus den Sitzungsprotokollen im Konto-Ordner (`sessions/**/rollout-*.jsonl`, jüngstes `token_count`-Ereignis). Claude-Stände liefert die Statuszeile von Claude Code: `usage-statusline.js` schreibt den Stand je Konto nach `<App-Daten>/usage/<Konto-ID>.json`; das Konto kommt über `MULTITERMINAL_USAGE_FILE`, das die App jedem Terminal mitgibt. Die Statuszeile wird nur auf Klick („Claude-Verbrauch aktivieren“) in `~/.claude/settings.json` eingetragen, mit Sicherung `settings.json.multiterminal-bak`; eine fremde Statuszeile wird nie überschrieben. Anmeldedateien und Schlüsselbund werden nicht gelesen. Dateien: neu `src/main/usage-service.js`, `usage-setup.js`, `usage-statusline.js`, `src/renderer/usage-view.js`, `usage.css`, vier Testdateien `tests/usage-*.test.js`; geändert `main.js`, `preload.js`, `index.html`, `accounts-panel.js` (dort auch behoben: Text „null“ über den Abschnitten). Geprüft: 133 Tests grün; App mit Temp-Datenordner und Temp-HOME gestartet, Balken, Farbstufen und Aktivieren-Knopf per DOM und Screenshot belegt; Skript über `ELECTRON_RUN_AS_NODE` ausgeführt; Dienst gegen die echten Codex-Protokolle (Tarif `prolite`, Woche 2 %). Nicht geprüft: echte Statuszeile in einem laufenden Claude-Terminal (laut Doku nur bei Pro/Max und erst nach der ersten Antwort), 60-s-Aktualisierung über längere Zeit, gebaute App. In Joshuas `~/.claude/settings.json` ist die Statuszeile noch nicht aktiviert.
- Nicht geprüft: Tastenkürzel ⌘T/⌘W per echtem Tastendruck (nur die Menübefehle dahinter), native Dialoge selbst, Codex und Kimi Code gestartet.

## Verbindungen
- Ziele:
- Projekte:
- Skills:
- Agents:

## Quellen
- README.md
