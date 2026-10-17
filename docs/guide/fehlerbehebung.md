---
title: Fehlerbehebung
order: 170
keywords: fehler, problem, hilfe, path, agent nicht gefunden, gh, status, electron, qa, sigabrt, symlink, tmp, socket
---

# Fehlerbehebung

Die häufigsten Stolpersteine, jeweils mit Ursache und Lösung.

## Der Agent wird nicht gefunden

Meldung wie „command not found: claude“ (oder `codex`, `kimi`) im Terminal einer Kachel.

Jedes Terminal der App ist eine interaktive **Login-Shell** (deine `SHELL`, sonst `zsh`). Sie liest dieselben Startdateien wie ein normales Terminalfenster. Ein Agent muss also dort im `PATH` stehen.

1. Öffne in der Kachel `which claude` (bzw. `codex` oder `kimi`). Findet die Shell nichts, ist der Agent nicht installiert oder sein Ordner nicht im `PATH`.
2. Trage den Ordner in eine Startdatei deiner Shell ein, zum Beispiel `~/.zprofile` oder `~/.zshrc`, und öffne ein **neues** Terminal in der App. Bestehende Kacheln lesen die Dateien nicht neu.
3. Die App startet nur Befehle. Sie installiert keine Agenten.

Die Meldung „claude wurde nicht gefunden (kein 'claude' im PATH ausserhalb von Multiterminal)“ kommt von einem kleinen Hilfsprogramm, das die App für den [Agentenstatus](terminals-und-agenten.md#agentenstatus) vor `claude` schaltet. Es meldet damit dasselbe Problem: Kein echtes `claude` im `PATH`.

## Der Agentenstatus erscheint nicht

- Der Status ist nach der Installation aus. Schalte ihn im Panel „Rückmeldungen“ unter „Agentenstatus anzeigen (Claude)“ oder im Panel „Komfort“ unter „Agentenstatus empfangen“ ein.
- Er wirkt nur für **neu gestartete** Claude-Sitzungen. Beende laufende Sitzungen einmal mit `/exit` und setze sie fort.
- Für Codex und Kimi gibt es keinen Status. Dort bleiben die Kacheln ohne Markierung.
- Ohne Status arbeiten die Markierungen und die automatische Sortierung nicht.

## Die GitHub-Funktionen melden einen Fehler

Der Dialog „Von GitHub hinzufügen“ sagt, was fehlt:

- „Das GitHub-Tool ‚gh‘ ist nicht installiert.“ Installiere es, zum Beispiel mit `brew install gh`, und klicke auf „Erneut prüfen“.
- „Du bist bei GitHub nicht angemeldet.“ Führe in irgendeinem Terminal `gh auth login --web` aus und klicke auf „Erneut prüfen“.

Mehr dazu unter [Änderungen und Git](diff-und-git.md#github).

## Das Projekt zeigt keinen Git-Stand

Die Seitenleiste zeigt Branch und Änderungen nur bei Git-Repositories. Ist der Ordner keins, fehlen auch Branch-Chip und Stammbaum. Mit `git init` im Ordner änderst du das.

## Der Branch-Chip zeigt den alten Branch

Die Anzeige liest den Zustand zu festen Zeitpunkten. Ein `git checkout` im Terminal erscheint erst bei der nächsten Aktualisierung (Knopf „⟳ Aktualisieren“ im [Stammbaum](worktrees.md#stammbaum)). Ein `cd` in einen anderen Ordner erkennt die App nicht: Die Kachel gehört weiter zu dem Ordner, in dem sie gestartet wurde.

## Eine Arbeitskopie lässt sich nicht entfernen

„Entfernen“ ist gesperrt, solange eine Kachel die Arbeitskopie nutzt, sie ungesicherte Änderungen hat oder ihr Zustand nicht lesbar ist. Schließe die Kachel, sichere oder verwirf die Änderungen, und versuche es erneut. Der Branch bleibt immer erhalten. Fremde Arbeitskopien („extern“) entfernt die App nie. Ein „verwaister“ Eintrag verschwindet mit `git worktree prune` im Terminal.

## Ein Port ist „Nicht zugeordnet“

Die App ordnet einen Port nur einer Kachel zu, wenn sie den Prozess sicher in einem laufenden Terminal findet. Startet der Server außerhalb der App, bleibt er unzugeordnet. Siehe [Ports](ports.md).

## „mt-browser“, „mt-memory“ oder „mt-pm“ nicht gefunden

Diese Befehle gibt es nur in Terminals der App (`mt-pm` nur im Projektmanager-Fenster). In einem normalen Terminalfenster sind sie nicht verfügbar. Kann die App die Brücke für `mt-browser` nicht starten, etwa weil der Pfad des Datenordners für einen Unix-Socket zu lang ist (höchstens 100 Bytes), läuft sie trotzdem weiter, und die Kacheln bekommen dann kein `mt-browser`.

## Die Update-Funktion ist nicht verfügbar

„App aktualisieren…“ funktioniert nur in der gebauten und installierten App, nicht bei `npm start`. Siehe [App aktualisieren](updates.md).

## Für Entwickler: Electron-Tests brechen ab

Die Skripte `scripts/qa-*.js` starten die echte App mit Electron. In manchen abgeschotteten Umgebungen, etwa in der Sandbox eines Agenten, hat der Prozess keinen Zugriff auf den macOS-WindowServer. Electron bricht dann mit `SIGABRT` ab, noch bevor Produktcode läuft. Das ist ein Problem der Umgebung, nicht der App.

- Prüfe es mit `node scripts/qa-env-check.js`. Das Skript startet eine minimale Electron-App und meldet, ob native Tests möglich sind (Exit-Code 0).
- Führe die `qa-*`-Skripte in einem normalen Terminalfenster einer Anmeldesitzung aus, zum Beispiel in Terminal.app.
- Bei einem langsamen ersten Start hilft `QA_ENV_TIMEOUT_MS=90000`.
- `npm test` (die Unit-Tests mit `node --test`) braucht Electron nicht.

### Temporäre Pfade und Symlinks

Unter macOS sind `/tmp` und `/var` Symlinks auf `/private/tmp` und `/private/var`. Wenn ein Test oder ein QA-Skript einen temporären Projektordner anlegt und Pfade vergleicht, löse ihn mit `fs.realpathSync(fs.mkdtempSync(...))` auf. Die App vergleicht aufgelöste Pfade, etwa bei Arbeitskopien. Mit einem nicht aufgelösten Symlink-Pfad können gleiche Ordner scheinbar verschieden aussehen.
