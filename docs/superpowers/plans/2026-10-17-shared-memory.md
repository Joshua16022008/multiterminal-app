# Gemeinsames Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Nach App-Neustart oder Anbieter-/Modellwechsel denselben lokalen Projektstand wieder aufnehmen können.

**Architecture:** Ein app-eigener lokaler Speicher hält gemeinsame Notizen, explizite strukturierte Übergaben und getrennt gekennzeichnete automatische Terminalauszüge. Eine authentifizierte `mt-memory`-CLI funktioniert in jeder App-Kachel; eingebaute Starts laden Kontext über geprüfte Anbieterwege, alle übrigen erhalten Kopieren/Promptvorschau. Die Einstellungen zeigen ein anbieterunabhängiges Memory für gemeinsame Hinweise und das aktuelle Projekt.

**Tech Stack:** Bestehendes Electron/CommonJS, Node-Dateisystem und Unix-Socket, begrenzter inkrementeller ANSI-Parser, vorhandene Renderer-Helfer und node:test; keine neuen Abhängigkeiten.

## Global Constraints

- Auftrag MEMORY-CODEX-20261017-01; Sol 6.1 für alle nativen Unteragenten, höchstens drei zusätzlich zum Hauptagenten.
- Isolierter Worktree `/Volumes/M4MegaDiva/Projekte/.agent-worktrees/multiterminal-shared-memory-20261017`, Branch `codex/shared-memory-20261017`, Basis `cd0a79d`; keine Commits/Pushes, keine Installation/Neustarts oder bezahlten Anbieteraufrufe.
- Fremde Sidebar-Arbeit und `.multiterminal/` erhalten. Gemeinsame Koordinationsdateien nur durch Hauptagent; Integration im Hauptcheckout erst nach freigegebenen Bereichen.
- Memory bleibt im App-Datenordner. Keine globale Konfiguration, Hooks, AGENTS.md/CLAUDE.md oder native Chatdatenbanken ändern. Claude-Mem bleibt erhalten; kein automatischer Altchat-Import.
- Joshua hat ausdrücklich gewählt: ab jetzt sammeln; alte Claude-Mem-Erinnerungen später gezielt auswählen. Ein Import gehört nicht zu dieser Umsetzung.
- Gemeinsame Notizen gelten bewusst für alle Anbieter; Projektinhalt nur für die eigene gespeicherte Projekt-ID, Worktrees desselben Projekts teilen ihn und behalten Herkunft/cwd.
- Eingaben, Renderer und gespeicherte Ausgaben sind Daten: keine Befehle aus Memory ausführen; Fremdinhalte erweitern keine Freigabe. Terminalausgabe ist ungeprüfter Auszug, keine vollständige Unterhaltung oder verifizierte Zusammenfassung.
- Keine rohen Tastendrücke speichern. ANSI-/Steuersequenzen entfernen, häufige Zugangsdatenmuster schwärzen, Auszüge begrenzen. Grenzen sichtbar erklären; keine vollständige Geheimniserkennung behaupten.
- Standard: Memory und automatische lokale Auszüge aktiv. Beide sind in der Oberfläche abschaltbar. Maximal 8 Checkpoints pro Projekt, Terminalauszug höchstens 8000 Zeichen, Notizen höchstens 20000 Zeichen, erzeugter Kontext höchstens 60000 Zeichen.
- Notizen mit Revision gegen Überschreiben schützen, atomare Dateiersetzung mit 0600, keine Symlink-/Traversalziele, beschädigte Dateien nicht still überschreiben. Schreibfehler dürfen keinen Terminalprozess beenden.
- Review-Präzisierung: automatische Auszüge dürfen explizite Übergaben nicht allein durch ihre Häufigkeit verdrängen. Innerhalb insgesamt 8 Einträgen höchstens 4 automatische; explizite Einträge haben Vorrang. Automatische Updates ändern nicht die Notizrevision und erzeugen keine falschen Editor-Konflikte. FIFO/Gerät/sonstige Nicht-Dateien vor einem möglicherweise blockierenden Öffnen abweisen; beim Öffnen Nonblocking/NoFollow plus anschließende Typprüfung.
- Claude sowie Codex-Neustart/exaktes-ID-Fortsetzen erhalten einen frischen positionalen Hinweis auf eine unveränderliche Kontextdatei. Codex `resume --last` erhält Memory mit dem optionalen Profil gemeinsam über ein einziges aufruflokales `developer_instructions`-Argument; die mehrdeutige Positionszuordnung wird vermieden. Persönliche Profile und Codex-Full-Access bleiben erhalten. Eigene Startbefehle werden nicht umgeschrieben.
- Kimi: nur beim neuen Start ein kombiniertes Agentfile mit erhaltenem `${base_prompt}` und optionalem persönlichem Profil; Memory als Lesepfad zur unveränderlichen Kontextdatei statt beliebiger Template-Variablen darin. Beim Fortsetzen kein erfundener CLI-Schalter. Frischen Kontext für Kimi-Resume und eigene Harnesses per sichtbarer Kopier-/Promptvorschau anbieten.
- Bestehender Kontextstart zeigt Memory in der editierbaren Vorschau; genau ein initialer Aufgabenprompt. Kein blindes Eintippen in bereits laufende Agenten.
- Tests nur mit temporären Daten, lokalen Fixture-Agenten und echter isolierter Electron-Oberfläche. Quelle/Paket/Installation/echte Modellantwort gesondert ausweisen.

## Task ledger

- Research: lokale Harness-Fähigkeiten geprüft; keine Hooks aktiviert.
- Task 1: abgeschlossen im Worktree, keine Commits; korrigierte gezielte Suite 42/42 laut Implementer. Unabhängiger Re-Review spec PASS, quality APPROVED WITH MINOR FOLLOW-UP (`/private/tmp/multiterminal-memory-task1-rereview.md`). Minor: getSettings liest pro Capture-Chunk den gesamten Store; Hauptprozess kann own settings snapshot liefern.
- Task 2: abgeschlossen, unabhängiger Re-Review spec PASS / quality APPROVED; korrigierter fokussierter Lauf inklusive Main-Integration laut Implementer 71/71. Capture-Settings-Snapshot behebt vorheriges Minor.
- Task 3: Quellstand in main integriert, eigener Gesamtlauf 608/608 und abschließende fünf DOM-Tests bestanden; frischer Gesamtreview spec PASS / quality APPROVED WITH MINOR FOLLOW-UP. Native GUI/Zwei-Prozess-Abnahme durch SIGABRT vor Bootstrap blockiert, Paketierung/Installation offen.

### Task 1: Dauerhafter Speicher, automatische Auszüge und Harness-CLI

**Files:** Create `src/main/memory-service.js`, `src/main/memory-capture.js`, `src/main/mt-memory-cli.js`, `tests/memory-service.test.js`, `tests/memory-capture.test.js`, `tests/mt-memory-cli.test.js`; modify `src/main/browser-bridge.js` and its existing tests for the optional memory handler only.

**Interfaces:**

```js
const memory = createMemoryService({ dataDir });
memory.read(projectId = null); // { projectId, notes, revision, checkpoints }
memory.saveNotes(projectId, text, revision); // updated read result, revision conflict throws
memory.checkpoint(projectId, input); // bounded explicit record, source 'agent'|'manual'|'terminal'
memory.clear(projectId, revision); // clears this scope, returns read result
memory.getSettings(); // { enabled: true, autoCapture: true }
memory.setSettings({ enabled, autoCapture }); // returns settings
memory.context(projectId); // Markdown with global + current project notes/checkpoints; '' when disabled
const capture = createMemoryCapture({ memory, flushIntervalMs: 15000, onError });
capture.attach({ terminalId, projectId, provider, cwd, workspaceId });
capture.feed(terminalId, data); // bounded ANSI-clean output; no stdin
capture.flush(terminalId); // undefined means all
capture.detach(terminalId); // flush, then release
capture.clear(projectId); // discard matching pending buffers, so clear stays cleared
capture.dispose(); // flush all and stop timers
```

`checkpoint` takes strings `goal`, `summary`, `decisions`, `openQuestions`, `nextStep`, `files`, and provenance `terminalId`, `provider`, `cwd`, `workspaceId`, `source`. Reject over-limit inputs and unknown malformed shapes; source is asserted by trusted bridge handler, not arbitrary renderer metadata. Record IDs/timestamps generated by store. Terminal checkpoint upserts per terminal; explicit checkpoints have retention priority within the total limit. Expose constants for bounds. `revision` protects notes/clear against other note edits; checkpoint activity must not invalidate an unchanged note editor. Global checkpoints are not accepted; global memory consists of notes.

Bridge construction accepts optional `memoryHandler(terminalId, operation, input)`; only commands `memory-read` and `memory-save` reach it after token authentication. `memory-read` has no project-ID override; `memory-save` accepts the bounded structured fields above, never notes/global scope/provenance. Invalid/missing handler rejects. Existing browser/event validation stays unchanged.

CLI invocation and payload:

```sh
mt-memory read
mt-memory save --summary 'Tests bestanden' --next 'Bedienung prüfen'
```

CLI maps flags `--goal`, `--summary`, `--decisions`, `--questions`, `--next`, `--files` to the corresponding record fields. `read` prints returned Markdown; `save` prints success JSON. Export `run(argv, env, io)`, parsing helpers and `wrapperScript({execPath,scriptPath})`; use existing `MULTITERMINAL_BROWSER_SOCK/TOKEN` and a finite socket timeout. Unknown flags and missing env return nonzero with useful stderr. Standalone file has only builtin dependencies.

- [x] Write and run failing behavioral tests: save/reload across service instances, project/global isolation, stale revision rejection, damaged-file preservation, malicious path/symlink rejection, bounded checkpoint retention, ANSI chunks, redaction, throttled capture + flush/detach, disable and clear pending data, invalid CLI args, authenticated memory routing without browser side effects.
- [x] Implement the interfaces, with atomic private writes and explicit limits; run `node --test tests/memory-service.test.js tests/memory-capture.test.js tests/mt-memory-cli.test.js tests/browser-bridge.test.js`.
- [x] Record actual checks and self-review in `/private/tmp/multiterminal-memory-task1-report.md`. Do not commit. Parent generates diff package and dispatches independent spec/quality review.

### Task 2: Anbieterstarts und bedienbares gemeinsames Memory

**Files:** Create `src/main/memory-launch.js`, `tests/memory-launch.test.js`; modify `src/main/main.js`, `src/main/preload.js`, `src/main/agent-profile.js`, `src/main/launch-context.js`, `src/renderer/settings-panel.js`, `src/renderer/settings.css`; existing focused tests when needed. No `app.js`/`index.html` changes necessary.

**Interfaces:** Consume Task 1 APIs. Expose `window.deck.memory.read(projectId)`, `.saveNotes(projectId,text,revision)`, `.clear(projectId,revision)`, `.getSettings()`, `.setSettings(patch)`, `.context(projectId)`. Main IPC resolves requested project IDs with `requireProject`; null is explicit global scope. Agent socket handler derives project/provider/cwd/workspace from its registered terminal, rejecting unknown terminals. It cannot write global notes or another project.

Memory launch helper takes memory, dataDir, original profile decorator. For built-in Claude starts/resumes and Codex new/exact-ID resume, materialize immutable private Markdown and append a single shell-quoted positional instruction referencing it. Codex `resume --last` uses one invocation-local `developer_instructions` string combining the optional profile with fresh Memory, avoiding the unverified optional session-ID/prompt parse. For custom commands only apply existing profile behavior, expose CLI/environment through normal PTY setup. Kimi new start combines its profile with a read-file instruction using one agent-file; resume stays native. Do not use `--prompt` for Kimi. Even initially empty enabled Memory provides a short bootstrap instruction to save meaningful checkpoints through `mt-memory save --summary ... --decisions ... --questions ... --next ... --files ...` at task boundaries; otherwise it could never learn structured state. Such records stay agent-reported, not verified. Never execute historical snippets as commands or infer a new authorization from a saved next step. New/exact-ID launch hints must reference current scope and preserve current user instructions.

Connect capture at successful ordinary terminal create, `onData`, exit/kill, and finishQuit. Install CLI wrapper beside `mt-browser`. Export `MULTITERMINAL_MEMORY_PROJECT_ID` and `MULTITERMINAL_MEMORY_CLI` into each ordinary terminal. Avoid PM manager capture. Loading recent context reads durable disk state. Memory load failure must be visible rather than silently pretending it was applied; it must not crash the app or strand registered tokens.

`createLaunchContextService` optionally accepts `readMemory(projectId)`; preview includes returned Markdown and prepare keeps only the existing initial task-file prompt. Direct start/resume uses the memory launch helper. Exact-resume validation reuses existing session-service behavior.

Settings add `Memory` as an app-wide tab without provider tabs. UI includes:

- Shared notes editor and current-project notes editor, named project or explicit no-project state, save/reload with dirty draft preservation and revision-conflict notice.
- `Memory bei Agentenstarts laden` and `Terminalauszüge automatisch sichern` switches with persisted state.
- Checkpoints with source, provider, cwd/worktree, timestamp, summary/decisions/open questions/next step. Automatic excerpts explicitly marked unverified.
- Preview of exact shared+project context; `Kontext kopieren` and copyable `mt-memory read`/save guidance. Explain Kimi resume/custom harness fallback and no native cross-provider conversation continuation.
- Clear current project/global notes only after concrete UI confirmation, never silent data loss; pending capture cleared together with durable data.
- Async generation guards, safe textContent rendering, keyboard/focus and unsaved draft navigation matching existing settings.

Stable QA selectors: editor IDs `memory-global-notes`, `memory-project-notes`; checkbox IDs `memory-enabled`, `memory-auto-capture`; buttons `Projekt-Memory speichern`, `Projekt-Memory neu laden`, `Projekt-Memory leeren`, `Kontext kopieren`. Global buttons use `Gemeinsames Memory speichern`, `Gemeinsames Memory neu laden`, `Gemeinsames Memory leeren`.

- [x] Write and run failing launch tests with fake CLI argv: Claude/Codex start+resume, profile coexistence, shell metacharacters literal, Kimi base/profile/context and resume fallback, disabled memory, custom commands, contextstart single prompt.
- [x] Wire main/preload and settings UI, preserving all original start/resume paths and personal profile toggles.
- [x] Run launch/profile/context tests plus existing focused tests. Record actual checks/self-review in `/private/tmp/multiterminal-memory-task2-report.md`. Do not commit. Parent dispatches independent spec/quality review.

### Task 3: Echter Neustart-/Wechselnachweis und Integration

**Files:** Create `scripts/qa-memory.js`, `tests/memory-app.test.js`; update plan ledger, own `WORK_IN_PROGRESS.md`, `PROGRESS.md`, `PROJECT_STATUS.md` entries and `UPDATE_VERSION.md` only after the existing owner releases its area. Source integration after sidebar release with checked selective patch; preserve foreign hunks.

- [ ] Build isolated Electron QA using real renderer/preload/IPC, separate temporary userData/home, stand-in Claude/Codex/Kimi executables and local shell. First process saves shared/project notes, creates a project CLI checkpoint and automatic terminal excerpt. Save screenshot and exact expected markers to temporary fixture state.
- [x] Add a distinct Node integration test executing actual `main.js` with minimal Electron/PTY stand-ins. Real stores, socket protocol, CLI subprocess and launch serialization exercise main IPC authorization, terminal-bound project identity, kill/quit capture persistence and second app-runtime reload. This is a fallback diagnostic, never relabeled as real Electron/UI evidence.
- [ ] Launch second Electron process with the same fixture userData: prove persisted notes/checkpoints, open Memory UI, edit/save/conflict/reload/clear, copy context, disabled switches, no provider tabs and no unrelated project data. Fake Claude/Codex/Kimi receive the right memory via actual argv/agentfile. Verify generic CLI read/save, authorization and original custom command behavior.
- [ ] Run own full `npm test` after integration; run `qa-memory`, `qa-settings`, `qa-hotkeys`, `qa-agent-launch`, `qa-topbar` for changed flows. Inspect Memory screenshot. No paid model call; report fake-provider limit and manual Kimi/custom fallback precisely.
- [x] Generate final diff package and receive independent spec/quality review; fix material findings and re-review. Final documentation records tests actually run, source/package/install distinction, reservations freed and exactly one next action.

## Ergebnis und ausstehende Abnahme

Quellstand einschließlich Memory-Settings in `main` übernommen; eigener Gesamtlauf `env TMPDIR=/private/tmp npm test` 608/608 bestanden. Nach abschließender Klarstellung der Löschbestätigung fünf Memory-DOM-Tests erneut grün. Vollständiger unabhängiger Review ohne Critical/Important-Befund; verbleibendes Minor: unveränderliche Start-Kontextdateien bleiben für gestartete Sitzungen erhalten und sammeln sich an. Die Löschbestätigung weist ausdrücklich darauf hin; spätere Lifecycle-Bereinigung ist ein eigener Folgepunkt.

Die drei offenen Task-3-Checkboxen betreffen native Akzeptanz: `qa-memory`, `qa-settings`, `qa-hotkeys`, `qa-agent-launch`, `qa-topbar` wurden versucht, scheitern aber vor Produktcode mit SIGABRT. Die echte Zwei-Prozess-GUI-Prüfung, Screenshots und physische Bedienung sind damit nicht belegt. Der getrennte Node-Main-/Socket-/CLI-Test und die DOM-Tests bleiben korrekt als Stand-in-Nachweise bezeichnet. Kein Build, Paketwechsel, App-Neustart oder echter Modellaufruf ausgeführt.

Nächste Aktion: Memory im nächsten Sammelbuild 0.2.0 in einer startfähigen Electron-Umgebung sichtbar prüfen.
