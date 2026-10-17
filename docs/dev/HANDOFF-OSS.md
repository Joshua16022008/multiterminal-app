# Übergabe: Open-Source-Vorbereitung Multiterminal (Stand 17.10.2026)

> Für jede neue Sitzung (Claude mit anderem Konto, Codex, …): **diese Datei zuerst lesen**, danach
> `AGENTS.md`, `WORK_IN_PROGRESS.md` (Abschnitt OSS-E0-OPUS-20261017-01 + Nachrichten), `PROGRESS.md` (oberste Einträge).
> Aufgaben-ID der Gesamtarbeit: **OSS-E0-OPUS-20261017-01** (Integrator). Weitermachende Sitzung trägt sich
> in `WORK_IN_PROGRESS.md` als Nachfolger dieser ID ein (eigene neue ID, Verweis auf diese).

## Ziel (Joshua)

1. Multiterminal als GitHub-Open-Source-Projekt veröffentlichen, vorher: Worktree-Stammbaum, User Guide,
   Start beliebiger Harnesses/Modelle. **Alles erledigt und in `main`.**
2. **Entwicklerversion** (dieses Repo, Edition `dev`) bleibt Joshuas Arbeitsumgebung, mit Diktat und
   Second-Brain-Aufgaben. **Export-Version** (eigenes Repo `../multiterminal-export`, eigene Historie)
   wird nur gezielt per Exportskript aktualisiert und beim Entwickeln nie angefasst.
3. Erster Export in ein nutzerfreundliches Modell (README, DMG-Release, LICENSE, CI).

## Entscheidungen (verbindlich)

- MIT-Lizenz, Copyright „The Multiterminal Authors“; Veröffentlichung als **frisches Repo** (keine alte Historie).
- Diktat (Flüsterflow) und Second-Brain-Aufgaben **nicht** in V1 und dort **nicht namentlich** nennen; später als eigene Integration mit eigenem Namen. App-Name evtl. noch änderbar → an einer Stelle (Edition) halten.
- Fremde Worktrees (Codex u. a.): nach Warnung übernehmbar (`managed:false`), Entfernen vergisst nur den Eintrag.
- Claude mit Fremd-Endpunkt: isolierter `CLAUDE_CONFIG_DIR`, keine Kontowahl.
- Export-Ziel: `…/Claude_code_tasks/Projekte/multiterminal-export` (neben diesem Projekt). **Noch kein GitHub-Repo**, erst lokal; GitHub erst nach Joshuas Namenswahl und Durchsicht.
- Merges nach `main` nur nach Joshuas ausdrücklicher Freigabe. Kein Push. Nutzer-App nie beenden/installieren – das macht Joshua.

## Stand `main` (alles gemergt, `npm test` 885/885 + 1 skip + 1 todo)

| Commit | Inhalt |
|---|---|
| `c4f6091` | Fremdstand gesichert (Memory, Update-Helper, Sidebar-Tooltips) |
| `b27faf8`…`1364f70` | IPC-Vertrag `docs/dev/ipc-contract.md`, Codex-Auftrag, Teilpläne, Gesamtplan `docs/dev/oss-gesamtplan.md` |
| `6cb79eb` | Worktree-Stammbaum (⑂-Knopf in Topbar, ⌘⇧Y, Branch-Chip), Hilfe-Panel-Kern (⌘⇧H), SIGABRT-Befund `docs/dev/qa-sigabrt.md` |
| `ae9bff1` | 17 Guide-Seiten `docs/guide/`, „?“-Hilfe-Links, `tests/guide-content.test.js` |
| `e5c4848` | Kontoumbenennung (Codex ACCOUNT-RENAME, vom Integrator committet) |
| Merge `claude/oss-harness-int` | Harness-/Modellkatalog (Codex `3b7884b` + Integration): Einstellungen → „Harnesses & Modelle“, Endpunkt-Profile, Schlüssel nur im Schlüsselbund, Startprofile, Kontextstart mit allen prompt-fähigen Harnesses, Guide-Seiten |
| `efcaf10` | ?-Link Konten-Panel |
| `19171dc` | **Version 0.3.0**, `scripts/install-update.sh` liest Version aus `package.json` |

Hinweis SIGABRT: Electron-QA scheitert nur in Agent-Sandboxes ohne WindowServer. Vorher `node scripts/qa-env-check.js`; QA mit `./node_modules/.bin/electron scripts/qa-*.js`. `qa-topbar` ist flaky (auch auf altem Stand).

## Update der Entwickler-App (wartet auf Joshua)

Paket `dist/updates/Multiterminal-0.3.0/Multiterminal.app` (920 Dateien, `CHECKSUMS.sha256`, `--check` Exit 0).
Joshua: Multiterminal mit ⌘Q schließen, dann im macOS-Terminal
`bash '<repo>/scripts/install-update.sh'`. Details `UPDATE_VERSION.md` (oben). Agentenaufgaben sind nicht enthalten.

## Laufende Arbeit: Edition-Schalter + Export (Etappe 5)

Gestartet als Claude-Workflow `oss-edition-export` (Run `wf_61e64bfb-e03`). Script mit **vollständigen Auftragstexten**:
`~/.claude/projects/-Volumes-M4MegaDiva-Projekte-Lokale-Projekte-Desktop-Second-Brain-Arbeit-Ai-Builds-and-projekts-Claude-code-tasks-Projekte-multiterminal-app/1042bcaa-13b5-4561-a700-123b7f16febf/workflows/scripts/oss-edition-export-wf_61e64bfb-e03.js`
(die Konstanten `CONTEXT`, `EDITION`, `EXPORT` sind die Arbeitsaufträge – eine neue Sitzung kann sie direkt als Auftrag lesen).

- Branch: `claude/oss-edition-export` (Basis `19171dc`), Worktree vermutlich `.claude/worktrees/wf_61e64bfb-e03-1`.
- **Wiederaufnahme prüfen:** `git worktree list`, `git log --oneline main..claude/oss-edition-export`, im Worktree `git status`.
  - Gibt es keine Commits: Teil „Edition“ neu beginnen.
  - Gibt es Edition-Commits, aber kein `scripts/export.js`: mit Teil „Export“ weitermachen.
  - Ist beides da: Review machen (siehe unten).

Teile:
1. **Edition** (`src/main/edition.js`, `edition.json` im App-Root, fehlt = `dev`):
   - In `public` ausblenden: Diktat (Mikro-Knopf, „Live-Diktat“, Hotkeys) und Second-Brain-Aufgaben („+ Aufgabe“, task-link ⌘⇧L in Hotkeys/Palette/Menü/Live-Tastentabelle, Komfort-Schalter, `second-brain-tasks.js`).
   - Ebenso: persönliche Pfade (`SECOND_BRAIN_PROJECTS`, `project-seed.js`) und die Bundle-ID (`scripts/build.js`, `update-service.js`, `update-helper.sh`).
   - „Joshua“ in `pm-role.md`/`pm-bridge.js`/`mt-pm-cli.js` neutral formulieren.
   - Für `dev` ändert sich nichts.
   - Dev-only-Dateien kommen nach `docs/dev/edition.md`.
2. **Export** (`scripts/export.js [--target] [--dry-run] [--ref]`, `export/manifest.json`, `export/overlay/**`):
   - Ablauf: `git archive` → Temp → Ausschlüsse → Overlay (LICENSE, README en+de, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, `.github/workflows/test.yml`, Issue-Templates, `docs/harness-catalog.md`) → `edition.json` public → package.json umschreiben → **Datenschutz-Wächter** (Joshua, /Users/, Second_Brain, Second Brain, Flüsterflow, gulla, de.joshua, M4MegaDiva) → `npm test` im Export → Ziel synchronisieren (Ziel-`.git` bleibt) → Commit „Export aus Entwicklerversion <sha>“.
   - `scripts/release.js`: Build + DMG (`hdiutil`) + SHA256 nach `dist/release/`.
3. **Review** mit Probe-Export (`--dry-run`), selbst grep nach persönlichen Begriffen, Electron-Start im Export, danach Korrektur.

## Nächste Schritte (in dieser Reihenfolge)

1. Ergebnis von `claude/oss-edition-export` prüfen bzw. fertigstellen, siehe oben. `npm test` muss grün sein, der Probe-Export grün, und die QA der public-Edition braucht einen angesehenen Screenshot.
2. Joshua Ergebnis zeigen → **mit Freigabe** nach `main` mergen (vorher `WORK_IN_PROGRESS.md` lesen; AGENT-TASKS-Codex-Sitzung will ebenfalls `main.js`/`app.js` integrieren – wer zweiter ist, rebased).
3. Ersten echten Export: `node scripts/export.js --target '../multiterminal-export'`. Danach im Export: `npm install`, `npm test`, `npm run release` → DMG; DMG öffnen und App in einem Test-Ordner starten (nicht `/Applications` überschreiben).
4. Joshua zeigen: README, DMG, App-Name. Offen für Joshua: endgültiger App-Name, GitHub-Repo anlegen (privat → öffentlich), Code-Signing/Notarisierung (Apple-Developer-Konto) optional, Screenshots fürs README.
5. Danach Dokumentation: `PROGRESS.md`-Eintrag, `PROJECT_STATUS.md`, Reservierung in `WORK_IN_PROGRESS.md` freigeben.

## Bekannte offene Punkte

- `⑂ n`-Zähler aktualisiert nicht bei Worktrees externer Tools bis Projektwechsel/Öffnen der Ansicht.
- Harness: echte Schlüsselbund-ACLs, bezahlte Endpunkte, OpenCode real ungeprüft; Harness-Karten in den Einstellungen recht lang (Design-Nacharbeit).
- Kein Start des gepackten 0.3.0-Bundles (Nutzer-App lief); Joshuas sichtbare Abnahme aller neuen Funktionen offen.
- Codex-Zweig `codex/worktree-context-start` (`7f1a839`) unangetastet, Klärung offen.
- AGENT-TASKS-CODEX-20261017-01 (Agentenaufgaben) noch nicht in `main`; fertiges Patch/Branch `codex/agent-tasks-20261017`.

## Wichtige Dateien

`docs/dev/oss-gesamtplan.md` (Etappen + Entscheidungen) · `docs/dev/ipc-contract.md` (Schnittstellen) ·
`docs/dev/harness-catalog.md` (Katalog-Schema) · `docs/dev/qa-sigabrt.md` · `docs/guide/` (User Guide) ·
`UPDATE_VERSION.md` · Plan-Datei `~/.claude/plans/sharded-strolling-reef.md`.
