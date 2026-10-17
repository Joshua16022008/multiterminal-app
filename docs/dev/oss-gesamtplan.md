<!-- Gesamtplan des Planungs-Workflows vom 17.10.2026 inkl. Entscheidungen Joshua. -->

# Gesamtplan: Open-Source-Vorbereitung Multiterminal (Worktree-Stammbaum, Harness-Katalog, User Guide, Release)

## Kontext
- Joshua will Multiterminal (Electron, macOS, Vanilla JS, node:test, 71 Testdateien) auf GitHub veröffentlichen.
- Vorher kommen drei Vorhaben:
  - **W:** Branch an jeder Kachel und Stammbaum-Ansicht aller Worktrees, auch fremder von Codex.
  - **H:** Datengetriebener Katalog aller Agenten-CLIs mit Modell- und Endpunktwahl, Schlüssel im Schlüsselbund.
  - **G:** Ein User Guide aus `docs/guide/*.md`, auf GitHub und in der App.
- Dazu kommt **R:** Release-Hygiene.
- Ausgangslage:
  - `main` @ `d8b11d5` mit 23 uncommitteten Fremdänderungen.
  - Die Electron-QA bricht derzeit mit SIGABRT ab.
  - UI-Texte sind deutsch, Code-Kommentare englisch.
  - Es kommen keine neuen Laufzeitabhängigkeiten dazu, und die CSP bleibt unverändert.

## Grundregeln für alle Pakete
- Jedes Paket arbeitet in einem eigenen Worktree mit Reservierung in `WORK_IN_PROGRESS.md`. Die Dateibereiche sind exklusiv.
- Neue IPC-Methoden stehen nur in `docs/dev/ipc-contract.md`; Abweichungen klärt der Integrator.
- Alle Prozessaufrufe laufen über `execFile` mit argv-Arrays, ohne Shell, mit Timeout.
- Kein Schlüssel steht je in argv, Datei, Log, Renderer oder `session.json`.
- `git worktree remove` gibt es nur für `managed:true`. Für `managed:false` wird nur der Datensatz vergessen.
- Für die drei eingebauten Anbieter sind die Startzeilen bytegleich zu heute (Golden-Tests).

## Etappe 0 – Sicherung (seriell, mit Joshua)
| Paket | Inhalt | Bereich |
|---|---|---|
| S1 | Fremdstand (Memory, Update, Tooltips) sichern bzw. committen nach Freigabe, Zweig `codex/worktree-context-start` klären, prunable-Rest `.qa-hotkeys-tmp` behandeln | Git, Koordinationsdateien |
| S2 | Ursache für Electron-QA-SIGABRT finden und beheben | `scripts/qa-*.js`, ggf. Startparameter |

## Etappe 1 – reine Kerne (parallel)
| Paket | Inhalt | Dateien |
|---|---|---|
| V | IPC-Vertrag aller Vorhaben (Signaturen, Rückgabeformen). Kommt zuerst, die anderen lesen ihn nur. | `docs/dev/ipc-contract.md` |
| W-A | `parsePorcelain` (branch/HEAD/detached/locked/prunable), `classifyOrigin`, `pickTrunk`, `buildTree` (ahead/behind, merge-base, merged, last, changes; höchstens 4 parallel, 10 s Cache, Fehler pro Knoten führt zu `null`), `adopt`, `remove` nach `managed`, `branchOf` | `src/main/worktree-tree.js`, `src/main/worktree-service.js`, Tests |
| W-B | Layout-Positionen, SVG-Pfade, `colorFor` | `src/renderer/tree-layout.js`, Test |
| H-0 | Schema (siehe unten), Loader, Validierung, Platzhalter-Expansion, 15 Einträge mit `evidence`/`verifiedWith` | `src/main/harness-catalog.js`, `src/main/harness-catalog/*.json`, Test, `docs/dev/harness-catalog.md` |
| H-1 | Erkennung (`command -v` im Login-Env, dazu `detect.verify` gegen Namenskollisionen wie `agent`/`kimi`), Modellquellen (statisch, Katalog-Query nur auf Klick, Ollama `/api/tags`, OpenRouter `/api/v1/models`) | `src/main/harness-detect.js`, `src/main/model-sources.js`, Tests |
| H-2 | Schlüsselbund (`set` über `security -i`/stdin mit korrektem Quoting, `has`, `delete`, `lookupExpression`), `endpoints.json` (0600, ohne Schlüssel, atomar) | `src/main/keychain.js`, `src/main/endpoint-store.js`, Tests |
| G-2 | Index, Front-Matter, GitHub-kompatible Anker, Slug-Whitelist, optionaler `lang` | `src/main/guide-service.js`, Test |
| G-3 | Markdown-Subset → Tokens → DOM über `h()`, nie `innerHTML`; `javascript:`/`data:` werden verworfen | `src/renderer/guide-markdown.js`, Test |

**Schema-Regeln für H-0:**
- Ausschließlich JSON.
- `binary` ohne `/`.
- `query.argv[0] === binary`.
- Platzhalter nur aus fester Liste.
- Modell muss auf `^[A-Za-z0-9._:/@\[\]+-]{1,200}$` passen.
- `profileInjection` ist ein Enum, das auf vorhandene Funktionen verweist.
- `fullAccess` nur bei codex.
- `endpoints.openai` für codex mit Pflichtfeld `wire_api`. Wert lokal verifizieren, bis dahin `evidence: third-party`.
- Unbestätigte Einträge starten nur ohne Modell- und Resume-Flags.

## Etappe 2 – Ansichten und Refaktor (parallel, gegen Mocks)
| Paket | Inhalt | Dateien |
|---|---|---|
| W-D | Stammbaum-Ansicht `D.worktreeTree.open({project, focusId})`: Stamm, Äste, Karten, laufende Kacheln mit Statuspunkt; Aktionen über Callbacks (`onJump`, `onOpenTerminal`, `onStartAgent`, `onShowDiff`, `onRemove`, `onAdopt`); „Entfernen“ nur verwaltet und sauber; Warnung bei extern; verwaist nur Hinweis | `src/renderer/worktree-tree.js`, `worktree-tree.css`, Test |
| K | Kachelkopf: Branch-Chip für alle Git-Kacheln (Trunk gedämpft, Astfarbe, Punkt bei Änderungen, Kürzung von links, voller Name im title), `refreshBranch()` mit Drossel bei Fokus, Klick-Hook `onBranchClick`, Drag-Schutz; Slot `setLaunchInfo()` für den Harness-Chip; gemeinsame Platzregel für alle Chips | `src/renderer/terminal-pane.js`, `src/renderer/worktree.css`, Chip-Regeln in `styles.css`, Test |
| H-3 | `harness-launch.js` (Start-, Resume- und Prompt-Zeile aus Katalog, Modell, Endpunkt, Profil, Memory und Full Access; Präfix `VAR="$(/usr/bin/security … -w)"`; höchstens 2000 Zeichen); `agent-profile.argsFor`; `writePrivate` aus `memory-launch` herauslösen; `resumeFromCatalog`; `linkShared` exportieren, ohne `settings.json` bei Isolation | `src/main/harness-launch.js`, `agent-profile.js`, `memory-launch.js`, `agent-session-service.js`, `account-store.js`, Tests (Golden) |
| H-5 | Bereich „Harnesses & Modelle“: installiert/fehlt, Belegstufe, Installationsbefehl kopieren oder ohne Enter eintippen, Standardmodell, Endpunkt-Profile mit Vorlagen (DeepSeek, Z.ai, Moonshot, OpenRouter, Ollama), „Als Schnellstart anlegen“, eigenen Eintrag exportieren | `src/renderer/harness-panel.js`, `harness.css`, Test |
| G-4 | Hilfe-Panel: Inhaltsverzeichnis, Suche über `DeckCommandPalette.rank/normalize`, interne Links, Anker, `D.help.open/link`, Platzhalter `<!-- mt:hotkeys -->` live gerendert | `src/renderer/help-panel.js`, `help.css`, Test |

## Etappe 3 – Integration (2 parallel, je ein Besitzer)
| Paket | Inhalt | Dateien |
|---|---|---|
| I-M | IPC: `worktrees:tree/adopt/branchOf`, `harness:*`, `endpoints:*`, `guide:index/read` (über `handle()` :119); `terminals:create` nimmt `launch` an, `meta.provider` aus `launch.harnessId` statt `builtinProvider` (:352, :453); Presets um `harnessId/model/endpointId` erweitert; `session.json` speichert `launch` und nie die fertige Zeile; Whitelist in `launch-context` (:144) aus dem Katalog; Hilfe-Menü `role:'help'`; Menüeinträge über `shortcutItems` | `src/main/main.js`, `preload.js`, `presets.js`, `session-store.js`, `launch-context.js`, Tests |
| I-R | Topbar-Knopf `⑂ n` neben `#ws-title` (nur bei Git), Hilfe-Knopf, Container `#worktree-view` und `aside#help-panel`, Panel-Ausschluss (:688–720), Palette (:909), `runFeatureAction` (:979) für `worktree-tree` (Cmd+Shift+Y) und `help` (Cmd+Shift+H), `jumpToPane` an die Ansicht, `onBranchClick`, Diff-Kontextüberschreibung `showFor`, Schnellstart-Menü und Formular mit Harness-Feldern, `PRESET_PROVIDER` aus Katalog-`accounts`, Tab in `settings-panel.js`, `agent-launch.js`: Vorbelegung `workspaceId` plus Harness-, Modell- und Endpunkt-Auswahl in einem Zug | `app.js`, `index.html`, `hotkeys.js`, `command-palette.js`, `settings-panel.js`, `agent-launch.js`, `diff-panel.js`, Tests |

Abschluss der Etappe: `npm test` im integrierten Stand und ein kurzer manueller Start. Wenn möglich zusätzlich `qa-worktree`, `qa-agent-launch`, `qa-settings` und `qa-topbar` als Regression.

## Etappe 4 – QA, Inhalte, Kontext-Links (parallel)
| Paket | Inhalt | Dateien |
|---|---|---|
| Q-W | Temp-Repo mit: main mit 2 Commits; App-Worktree `feature/a` (+1 Commit, 1 Änderung); externer Worktree unter `…/.codex/worktrees/…`; ein gemergter Branch; ein prunable-Eintrag. Geprüft werden: Chips, Ansicht mit 4 Ästen und richtigen Arten, Sprung zur Kachel, Übernehmen bzw. Terminal am externen Ast, Entfernen dirty abgelehnt und sauber entfernt (Branch bleibt), Screenshot | `scripts/qa-worktree-tree.js` |
| Q-H | Fake-CLIs (claude, codex, kimi, opencode, dsh) und Fake-`security` im Temp-PATH. Ablauf: Endpunkt und Startprofil per UI anlegen und starten. Geprüft werden: argv und Env im Kindprozess, kein `FAKE_KEY` in `session.json`, `endpoints.json` und Scrollback, Neustart und Fortsetzen, Kontextstart mit opencode, alte Schnellstarts bytegleich | `scripts/qa-harness.js` |
| Q-G | Ablauf: ⌘⇧H öffnen, Inhaltsverzeichnis, Suche „Arbeitskopie“, interner und externer Link, Treffer über ⌘K, Weg über „?“ in den Einstellungen, Esc mit Fokus-Rückgabe, keine Konsolenfehler | `scripts/qa-help.js` |
| G-1 → G-6 | Alle Seiten im Endstand: zusätzlich `harnesses-modelle`, `endpunkte`, erweitertes `worktrees` (Stammbaum, Arten, Warnung), erweitertes `agenten-starten`, `fehlerbehebung` mit Schlüsselbund- und settings.json-Fällen. Danach „?“-Einzeiler in allen Dialogen inkl. Stammbaum und Harness-Bereich. Inhaltstest: Syntax-Subset, Links und Anker, alle `D.help.link`-Schlüssel, Kürzel-Tabelle = `hotkeys.defaults('darwin')`, keine persönlichen Pfade in `docs/`, `src/` und `scripts/` | `docs/guide/**`, Einzeiler in `settings-panel.js`, `worktree-picker.js`, `worktree-tree.js`, `harness-panel.js`, `agent-launch.js`, `accounts-panel.js`, `ports-panel.js`, `diff-panel.js`, `workspace-templates.js`, `handoff-panel.js`, `tests/guide-content.test.js` |

## Etappe 5 – Release-Hygiene
| Paket | Inhalt | Dateien |
|---|---|---|
| R-1 | Persönliches entfernen: Klonordner als Einstellung bzw. `~/Multiterminal`; Diktat und Second-Brain je nach Antwort auf Frage 4 (Standard aus, Pfad/URL konfigurierbar); „Joshua“ aus Agententexten; neutrale Bundle-ID (mit Update-Pfad); Fixtures neutralisieren. Kommt vor R-2 in `build.js`. | `main.js`, `project-seed.js`, `pm-role.md`, `pm-bridge.js`, `mt-pm-cli.js`, `dictation.js`, `second-brain-tasks.js`, `qol-panel.js`, `update-service.js`, `update-helper.sh`, `scripts/qa-project-manager.js`, `scripts/qa-claude-profile.js`, `tests/project-store.test.js`, Bundle-ID in `scripts/build.js` |
| R-2 | `LICENSE`, `README.md` (englischer Kurzkopf „UI currently German“, Agentenregeln raus, Link auf `docs/guide/README.md`), `CONTRIBUTING.md` (inkl. Katalog-PR), `SECURITY.md`, `CODE_OF_CONDUCT.md`, `package.json` (license/repository/homepage), `.gitignore` (`.multiterminal/`, `.claude/`, `.qa-*`, `WORKTREE_START.patch`), CI `.github/workflows/test.yml` (macOS, `npm ci && npm test`), ignore-Liste in `build.js` (`/docs` außer `guide`, Koordinationsdateien) | genannte Dateien |

Abschluss: Paketlauf, also `docs/guide` ist im `.app`, `docs/superpowers` und `PROGRESS.md` fehlen dort. Danach Entscheidung zur Historie und echte CLI-Läufe durch Joshua.

## Wiederverwendete Funktionen
- **Git und Worktrees:** `runGit`, `gitEnv`, `real`, `isDirty`, `resolveCwd`, `inspect`, `remove` (`src/main/worktree-service.js`); `sessionUsesWorkspace` (`src/main/main.js:133`); `listChanges` (`src/main/diff-service.js`); `ps`/`lsof`-Auswertung (`src/main/port-service.js`, nur für später: Live-Ordner).
- **Start:** `shellQuote`, `tomlString`, `decorate`, `decorateCommand`, `builtinLine` (`src/main/agent-profile.js`); `builtinProvider` (`src/main/memory-launch.js`); `quote` (`src/main/launch-context.js`); `buildResume`, `isValidSessionId` (`src/main/agent-session-service.js`); `shellEnv` und `-l -i` (`src/main/pty-manager.js:35/88`); `--settings`-Hooks über den Wrapper (`src/main/agent-wrapper.js`), wirkt auch bei eigenem Konfigordner.
- **Persistenz:** atomares Schreiben und Sicherung defekter Dateien (`src/main/presets.js`, `src/main/account-store.js`); `writeDerived` (`agent-profile.js:91`); `linkShared` (`account-store.js:155`, wird exportiert).
- **Renderer:** `D.h`, `D.guard`, `D.notify`; `newTerminal` (`app.js:268`); `jumpToPane` (`app.js:799`); `showPorts`/`showSettings` (`app.js:688/700`); `paletteActions` (`app.js:909`); `runFeatureAction` (`app.js:979`); `DeckActivity.activityOf/projectActivity` (`activity.js`); `DeckAttention.createStatusDot` (`attention-panel.js`); `DeckCommandPalette.rank/normalize/KIND_LABEL` (`command-palette.js`); `createDiffPanel({getContext})` (`diff-panel.js:59`); Panel-Muster aus `progress-panel.js` und `qol-panel.js`.
- **Menü und Hotkeys:** `shortcutItems` (`main.js:581`); `defaults`/`extra` (`hotkeys.js:61–73`); `withNewDefaults` (`hotkey-store.js`).
- **QA-Vorlagen:** `scripts/qa-worktree.js`, `scripts/qa-agent-launch.js` (Fake-CLIs mit argv-Protokoll), `scripts/qa-topbar.js`.

## Verifikation
- **Pro Paket:** eigene node:test-Tests grün, und `npm test` vollständig im eigenen Worktree.
- **Pro Integrationsetappe:** `npm test` im integrierten Stand plus Regression der vorhandenen QA-Skripte. Ein Bestanden zählt erst nach behobenem SIGABRT (S2); solange er nicht behoben ist, als „ungeprüft“ führen.
- **Pflichtnachweise:**
  - Golden-Tests: Startzeilen von claude, codex und kimi bytegleich in allen Kombinationen von Profil, Memory, Resume und Full Access.
  - Spy-Test: `remove` bei `managed:false` ruft kein `worktree remove` auf.
  - Schlüsseltests: argv enthält nie den Schlüssel, Sonderzeichen werden korrekt gespeichert, Fehlermeldungen sind ohne Schlüssel.
  - Katalog-Validierung als CI-Wächter.
  - Guide-Inhaltstest inkl. Datenschutz-grep.
  - Paketlauf mit dem richtigen Bundle-Inhalt.
- **Echt mit Joshua:** Claude mit DeepSeek, Z.ai und Ollama (Rangfolge settings.json-env gegen Prozess-env, Schlüsselbund-Abfragedialog), codex mit `--oss` und mit eigenem Provider (`wire_api`), opencode, dsh. Dazu der Stammbaum am echten Repo mit beiden Codex-Worktrees.
- **Dokumentation:** nach jedem Paket ein Eintrag in `PROGRESS.md`, `PROJECT_STATUS.md` aktualisieren und die Reservierung freigeben.

## Risiken
1. **Integrationskonflikte:** `main.js`, `preload.js`, `app.js` und `index.html` gehören in Etappe 3 genau einem Besitzer; sonst gibt es keine Änderungen daran. Fremdstand vorher sichern (S1).
2. **Anbietererkennung über Stringvergleich** (`builtinProvider`, `PRESET_PROVIDER`): Ein Start mit `--model` fiele aus Profil, Memory und Konten heraus. Gegenmittel sind explizites `launch.harnessId` und die Golden-Tests.
3. **Konto oder isolierter Konfigordner:** Beide setzen `CLAUDE_CONFIG_DIR`. Die Rangfolge muss vor H-3 entschieden sein (Frage 2).
4. **Fremde Worktrees:** Ein zweiter Agent im Codex-Ordner kann dessen Arbeit stören. Gegenmittel: Warnung, `adopt` ohne Entfernen, und `remove` vergisst nur den Datensatz.
5. **Katalog aus Community-PRs:** Erkennung und Modellabfrage führen Programme aus. Gegenmittel: `argv[0] === binary`, Ausführen nur auf Klick, keine Shell, Installationsbefehle nur als Anzeige.
6. **Flags und Modellnamen veralten:** Gegenmittel: `verifiedWith`, Belegstufe in der UI, Freitext bleibt immer möglich, unbestätigte Einträge starten ohne Flags. Codex `wire_api` und OpenCode `-s`/`--session` lokal prüfen.
7. **Leistung im Stammbaum:** 4–5 Git-Aufrufe pro Ast. Gegenmittel: höchstens 4 parallel, 10 s Cache, Laden nur bei offener Ansicht, Chip-Aktualisierung nur bei Fokus. Branch-Wechsel oder `cd` im Terminal bleiben bis zur nächsten Aktualisierung unsichtbar; die Ansicht sagt das ausdrücklich.
8. **Kachelkopf zu eng:** Alle Chips gehören deshalb in ein Paket (K) mit gemeinsamer Platzregel.
9. **Guide veraltet:** Gegenmittel sind der Inhaltstest und, nach Freigabe, eine `AGENTS.md`-Regel „Funktion geändert → Guide-Seite ändern“. Abweichungen der Anker bei Umlauten mit Testbeispielen festhalten.
10. **Release und Historie:** In der Historie stehen Name, E-Mail, persönliche Pfade und Protokolle. Entscheidung offen (Frage 3). Ein echtes Secret habe ich in der Historie nicht gefunden.

## Offene Fragen an Joshua
1. **Fremde Codex-Worktrees:** Nach Warnung übernehmen und dort starten, oder nur anzeigen?
2. **Claude mit Fremd-Endpunkt:** Standardmäßig isolierter Konfigordner (dann keine Kontowahl), oder gemeinsamer `~/.claude` mit Warnung?
3. **Lizenz und Historie:** MIT oder Apache-2.0? Bestehende Historie veröffentlichen oder frisches Repo?
4. **Diktat und Second-Brain-Aufgaben:** Als optionale Integration behalten (standardmäßig aus) oder entfernen?
## Entscheidungen Joshua (17.10.2026)
1. Fremde Worktrees (Codex u. a.): im Stammbaum anzeigen, nach Warnung übernehmen (`managed:false`) und dort Terminal/Agent starten; Entfernen vergisst nur den Eintrag.
2. Claude mit Fremd-Endpunkt: isolierter `CLAUDE_CONFIG_DIR` je Endpunkt, keine Kontowahl bei solchen Starts; Hooks bleiben über `--settings`.
3. Lizenz MIT, Veröffentlichung als frisches Repo mit sauberem Erstcommit (keine bestehende Historie).
4. Diktat (Flüsterflow) und Second-Brain-Aufgaben: für V1 aus dem öffentlichen Release herausnehmen und nicht namentlich nennen; später als eigenständige Integration (eigener Name offen) wieder einbauen. App-Name selbst ist evtl. noch offen. → R-1: diese Module im Release-Build ausschließen bzw. hinter internem Schalter, keine Erwähnung in Guide/README.
