# IPC-Vertrag: Open-Source-Vorbereitung (Worktree-Stammbaum, Harness-Katalog, User Guide)

Stand 17.10.2026, Basis `main` @ `c4f6091`. Verbindlich für alle Pakete der Etappen 1–4
(Claude-Workflow **und** Codex-Harness-Strang). Gesamtplan: siehe `PROGRESS.md`, Eintrag OSS-E0-OPUS-20261017-01.

Regeln:
- Nur der Integrator (Etappe 3) ändert `src/main/main.js`, `src/main/preload.js`,
  `src/renderer/app.js`, `src/renderer/index.html`. Pakete liefern Module mit genau den
  unten genannten Factory-Signaturen; der Integrator verdrahtet sie.
- Kanäle werden in `main.js` über die vorhandene `handle(channel, fn)` (Herkunftsprüfung)
  registriert und in `preload.js` unter `window.deck.<bereich>` als `ipcRenderer.invoke` gespiegelt.
- Fehler: Handler werfen `Error` mit deutscher, nutzertauglicher Meldung **ohne** Geheimnisse.
  Erwartbare Zustände (kein Git, CLI fehlt) sind Rückgabewerte, keine Exceptions.
- Alle Prozessaufrufe: `execFile`/`spawn` mit argv-Array, keine Shell, Timeout ≤ 10 s.
- Abweichungen vom Vertrag nur nach Rückfrage beim Integrator (Nachricht in `WORK_IN_PROGRESS.md`).

---

## 1. Worktrees (Claude-Strang W)

Modul `src/main/worktree-tree.js` (rein, testbar mit injiziertem `run`):

```js
createWorktreeTree({ run = runGit, worktrees /* createWorktreeService-Instanz */ })
  → { tree(project) /* {id, path} */ → Promise<Tree>, branchOf(cwd) → Promise<string|null> }
// Hilfsexporte: parsePorcelain(text), classifyOrigin(path, homeDir), pickTrunk(refs)
```

`src/main/worktree-service.js` bekommt zusätzlich:
- `adopt({ projectId, cwd, projectPath? })` → Datensatz `{ workspaceId, projectId, cwd, branch, baseRef:'', managed:false, createdAt }`
  (nur wenn `cwd` in `git worktree list` des Projekts steht; idempotent per realpath).
  **Integriert (Etappe 3a):** Der Dienst kennt den Repo-Ordner nicht aus `projectId` allein. Main übergibt
  `createWorktreeService({ dataDir, getProjectPath: (id) => projects.get(id)?.path })`; ein optionales
  `projectPath` im Argument hätte Vorrang, wird vom IPC-Handler aber bewusst **nicht** aus dem Renderer
  übernommen. Ohne beides liefert `adopt` `{ ok:false, error:'Projekt unbekannt.' }`.
- `remove(workspaceId, projectPath)`: bei `managed:false` **nur Datensatz vergessen**, nie `git worktree remove`;
  Rückgabe dann `{ ok:true, forgotten:true }` (kein `branchKept`), bei `managed:true` unverändert
  `{ ok:true, branchKept }`. Der Renderer darf sich bei verknüpften Kopien nicht auf `branchKept` verlassen.
  Die Sperre `sessionUsesWorkspace` in `main.js` greift **auch** vor dem Vergessen eines `managed:false`-Datensatzes.
- Nach erfolgreichem `adopt` und `remove` ruft Main `worktreeTree.invalidate(projectId)` (der Cache erkennt neue
  Datensätze zusätzlich selbst über ihre Signatur).
- Factory tatsächlich: `createWorktreeTree({ worktrees, appDir /* <dataDir>/worktrees */, run?, homeDir? })`;
  `run` und `homeDir` haben Defaults, `invalidate(projectId)` ist zusätzlich exportiert. Aufrufer erhalten Kopien.

| Kanal | `deck.worktrees.*` | Rückgabe |
|---|---|---|
| `worktrees:tree` | `tree(projectId, force?)` (`force:true` umgeht den 10-s-Cache) | `Tree` (unten) |
| `worktrees:adopt` | `adopt(projectId, cwd)` | `{ ok:true, workspace }` \| `{ ok:false, error }` |
| `worktrees:branchOf` | `branchOf(projectId, workspaceId?)` | `string \| null` (Branch der Arbeitskopie bzw. des Projektordners) |

```js
Tree = {
  ok: true, isGit: boolean, projectPath, generatedAt /* ms */,
  trunk: { name, head, subject, time } | null,
  nodes: [{
    id,                 // workspaceId oder 'path:' + kurzer Hash des realpath
    path, branch /* null = detached */, head, detached, locked, prunable, missing,
    kind: 'project' | 'managed' | 'linked' | 'external',  // linked = managed:false-Datensatz
    origin: 'app' | 'codex' | 'agent-worktrees' | 'other',
    workspaceId /* string|null */,
    forkPoint /* sha|null */, forkTime /* ms|null, Zusatzfeld */, ahead /* number|null */, behind, merged /* bool|null */,
    last: { sha, subject, time, author } | null,
    changes /* number|null */,
  }],
}
// isGit:false → nodes: [], trunk: null. Fehler je Knoten → betroffene Felder null.
```

Präzisierungen aus der Integration (Etappe 3a):
- Zeitfelder (`generatedAt`, `trunk.time`, `last.time`, `forkTime`) sind Millisekunden; die Ansicht akzeptiert auch Sekunden.
- `forkTime` (Zusatzfeld): Commit-Zeit des Gabelpunkts. `tree-layout.js` sortiert Äste nach `forkTime`
  (neueste zuerst), dann `forkPoint`, dann `last.time`; Geschwister mit gleichem Gabelpunkt verlassen den Stamm
  auf gleicher Höhe.
- `merged`: `true` nur, wenn der Branch im Stamm enthalten ist **und nicht** auf der Stammspitze steht. Ein frischer
  Branch (ahead 0, behind 0) hat `merged:false`. Am Projekt-/Stammknoten: `ahead=0, behind=0, forkPoint=head, merged=null`.
- Prunable-Knoten: `ahead/behind/merged/last/changes/forkPoint/forkTime = null`. Detached: `branch=null, detached=true`.
  Bare-Einträge entfallen, höchstens 100 Knoten. Nur `isGit:true`-Ergebnisse werden 10 s gecacht.
- Stamm ist der Knoten mit `kind:'project'` (realpath = Projektordner); fehlt er (Projekt in einem Unterordner
  des Repos), nimmt das Layout den ersten Knoten.

Renderer `src/renderer/worktree-tree.js`: `window.DeckWorktreeTree.create({ document, api, h, notify })`
→ `{ open({ project, focusId }), close(), isOpen(), refresh() }`; Callbacks per `setHooks({ panesFor(nodeId),
onJump(paneId), onOpenTerminal(project, workspace|null), onStartAgent(project, workspaceId|null),
onShowDiff(project, workspaceId|null), onAdopt(project, node) })`.
`src/renderer/tree-layout.js`: `window.DeckTreeLayout = { layout(tree, options?) → {width,height,trunk,nodes:[{id,x,y}],edges:[{from,to,d}]}, colorFor(branch) → '#rrggbb', PALETTE }`.

Präzisierungen aus der Integration (Etappe 3a):
- `create(...)` nimmt zusätzlich optional `errText`, `confirm`, `now`, `layout`, `rootId` (Standard `#worktree-view`) sowie den Hook `onClose()`.
- `panesFor(nodeId)` liefert Einträge der Form `{ id /* paneId */, title, activity: 'working'|'waiting'|'idle'|null }`.
  `app.js` merkt sich den zuletzt geladenen Baum und ordnet zu: Kacheln mit `desc.workspaceId === node.workspaceId`;
  Kacheln ohne `workspaceId` hängen am Knoten mit `kind:'project'`.
- `layout(tree, { heights, gap })`: optionale gemessene Kartenhöhen je Knoten-ID. Die Ansicht rendert einmal,
  misst die Karten und legt neu aus, damit Kurven und Punkte an ihren Karten enden. `trunk` = `{x,y1,y2,d}|null`.
- `onBranchClick` aus dem Kachelkopf öffnet den Stammbaum mit `focusId = desc.workspaceId` bzw. der ID des Projektknotens.
- „Änderungen ansehen“ setzt im Diff-Panel einen einmaligen Kontext dieses Asts (`workspaceId|null`), der beim
  Schließen des Panels oder beim Klick auf den Diff-Knopf verfällt.

Kachelkopf (`terminal-pane.js`, Paket K): Hook `hooks.onBranchClick(pane)`, Methode
`pane.refreshBranch()`, Slot `pane.setLaunchInfo({ harnessLabel, model, endpointLabel } | null)`.

## 2. Harness-Katalog und Endpunkte (Codex-Strang H)

Main-Module (alle neu, außer genannt):

```js
createHarnessCatalog({ builtinDir, userFile /* <dataDir>/harnesses.json */ })
  → { list() → Harness[], get(id) → Harness|null, validate(entry) → {ok, errors[]},
      addOwn(entry), removeOwn(id), exportEntry(id) → string /* JSON */ }
createHarnessDetect({ catalog, env /* Login-Shell-Env */, run })
  → { detect(id?) → Promise<Detection[]>, version(id) → Promise<string|null> }
createModelSources({ catalog, run, fetch })
  → { models(harnessId, endpointId?) → Promise<{ models: string[], source: 'static'|'query'|'ollama'|'openrouter', error? }> }
createKeychain({ run })            → { set(account, secret), has(account), remove(account), lookupExpression(account) → string }
createEndpointStore({ file /* <dataDir>/endpoints.json, 0600 */, keychain })
  → { list(), get(id), save(profile /* + optional secret */), remove(id), templates() }
createHarnessLaunch({ catalog, endpoints, keychain, agentProfile, memoryLaunch, dataDir })
  → { build({ harnessId, model?, endpointId?, prompt?, resume?: 'last'|{sessionId}, fullAccess? })
        → { command /* Zeile ≤ 2000, Schlüssel nur als $(security …)-Lookup */, env /* ohne Geheimnis */,
            provider /* für meta.provider */, label } }
```

| Kanal | `deck.harness.*` / `deck.endpoints.*` | Rückgabe |
|---|---|---|
| `harness:list` | `harness.list()` | `HarnessView[]` (Katalog + Erkennung zusammengeführt, ohne Geheimnisse) |
| `harness:detect` | `harness.detect(id?)` | `Detection[]` = `{ id, installed, path\|null, version\|null }` |
| `harness:models` | `harness.models(id, endpointId?)` | wie `createModelSources().models` |
| `harness:addOwn` / `harness:removeOwn` / `harness:export` | `harness.addOwn(entry)`, `removeOwn(id)`, `export(id)` | Eintrag / `boolean` / JSON-Text |
| `harness:typeInstall` | `harness.typeInstall(id, terminalId)` | `boolean` – tippt Installationsbefehl **ohne Enter** ein |
| `endpoints:list` | `endpoints.list()` | `Endpoint[]` mit `hasSecret: boolean`, **nie** der Schlüssel |
| `endpoints:save` | `endpoints.save(profile, secret?)` | `Endpoint` |
| `endpoints:remove` | `endpoints.remove(id)` | `boolean` (löscht auch Schlüsselbund-Eintrag) |
| `endpoints:templates` | `endpoints.templates()` | Vorlagen (DeepSeek, Z.ai, Moonshot, OpenRouter, Ollama) |

```js
HarnessView = { id, label, kind: 'tui'|'web'|'headless', evidence: 'local'|'doc'|'third-party'|'unconfirmed',
  docsUrl, install: [{ method, display }], installed, path, canPrompt, canResume, supportsHooks,
  accounts /* 'claude'|'codex'|null */, endpointTypes: ['anthropic'|'openai'|'ollama'|'deepseek'],
  builtin: boolean, defaultModel|null }
Endpoint = { id, label, type, baseUrl, defaultModel|null, modelMap|null, isolateClaudeConfig, hasSecret }
```

Start einer Kachel (Integrator ändert `terminals:create`): Optionsfeld
`launch: { harnessId, model?, endpointId? }`. Ist es gesetzt, ruft Main `harnessLaunch.build()`.
`session.json` speichert nur `launch`, nie die fertige Zeile. Presets werden abwärtskompatibel um
optionale `harnessId`, `model`, `endpointId` erweitert.

Entscheidungen (Joshua, 17.10.2026): Claude mit Fremd-Endpunkt → eigener `CLAUDE_CONFIG_DIR`
je Endpunkt (`isolateClaudeConfig: true` Standard), dann keine Kontowahl; Hooks bleiben über
`--settings` des Wrappers. Starts von claude/codex/kimi **ohne** `launch` bleiben bytegleich.

Renderer `src/renderer/harness-panel.js`: `window.DeckHarnessPanel.create({ document, api, h, notify, guard })`
→ `{ el, render() }`; wird vom Integrator als Bereich in `settings-panel.js` eingehängt.

Bestätigte Klarstellungen (Integrator, Etappe 3a, 17.10.2026):
- **(a) Erkennung:** `createHarnessDetect` darf die Login-Shell zum Auflösen des Programms nutzen, und zwar
  ausschließlich in der Form `execFile('/bin/zsh', ['-lc', 'command -v -- "$1"', 'mt-harness-detect', binary])`.
  Der Programmname geht als Positionsparameter `$1` hinein, nie in den Befehlstext; Timeout ≤ 10 s. Das ist die
  einzige erlaubte Ausnahme von „keine Shell“ in diesem Vertrag.
- **(b) Memory-Adapter:** Der Memory-Adapter ist projektgebunden und wird der `createHarnessLaunch`-Factory
  übergeben (Main erzeugt die Factory je Projekt bzw. reicht den projektgebundenen Adapter durch). Die
  IPC-Signatur bleibt unverändert: `terminals:create` mit `launch: { harnessId, model?, endpointId? }`.
- **(c) Modellquellen (vorgeschlagen, von Codex noch nicht bestätigt):** `createModelSources({ catalog, run, fetch, endpoints? })` bekommt optional den
  Endpunkt-Speicher (`createEndpointStore`-Instanz), um `baseUrl`/Typ eines `endpointId` aufzulösen. Ohne
  `endpoints` liefert eine Abfrage mit `endpointId` `{ models: [], source, error }` statt einer Exception.

## 3. User Guide (Claude-Strang G)

```js
createGuideService({ dir /* docs/guide */ }) → { index() → GuideIndex, read(slug) → { slug, title, markdown } | null }
```

| Kanal | `deck.guide.*` | Rückgabe |
|---|---|---|
| `guide:index` | `guide.index()` | `{ pages: [{ slug, title, order, keywords?, headings: [{ level, text, anchor }] }] }` (`keywords`: optional Zusatzfeld aus dem Frontmatter, für die Hilfe-Suche) |
| `guide:read` | `guide.read(slug)` | `{ slug, title, markdown } \| null` (Slug-Whitelist aus Index) |

Renderer: `window.DeckGuideMarkdown = { render(markdown, { h, onLink }) → DocumentFragment, anchor(text) }`
(nie `innerHTML`); `window.DeckHelp.create({ document, api, h, palette })` → `{ open(slug?, anchor?), close(), link(key) → HTMLElement }`.

Präzisierungen aus der Integration (Etappe 3a):
- `guide.index()` und `guide.read()` sind **synchron** implementiert; `handle()` reicht den Wert durch, im
  Renderer kommen trotzdem Promises an. `read` mit Nicht-String-Slug wird als `''` behandelt → `null`.
- `dir`: `path.join(__dirname, '..', '..', 'docs', 'guide')` – gilt in der Entwicklung und im Paket (`asar: false`).
  `scripts/build.js` packt von `docs/` nur `docs/guide` ein; `docs/dev` und `docs/superpowers` bleiben draußen.
- `DeckHelp.create` nimmt zusätzlich `storage`, `markdown`, `hooks: { hotkeys(node) }`, `onToggle(open)`,
  `onExternal(href)`, `restoreFocus()`; Zusatz-API `toggle(force)`, `isOpen()`, `el`. `app.js` hängt `help.el`
  in `#content` ein und füllt den Platzhalter `<!-- mt:hotkeys -->` mit der aktuellen Tastenbelegung.
- Die Suche umfasst Titel, `keywords` und Überschriften (kein Volltext).

## 4. Hotkeys und Menü (nur Integrator)

Neue Aktionen: `worktree-tree` (Standard `Cmd+Shift+Y`, Linux/Windows `Ctrl+Alt+Y`), `help` (Standard
`Cmd+Shift+H`, Linux/Windows `Ctrl+Alt+H`). `reserved()` gibt dafür `Cmd/Ctrl+Shift+H` und `Cmd/Ctrl+Shift+Y`
frei; `Cmd+H`, `Cmd+Alt+H` (Ausblenden), `Cmd/Ctrl+Y` (Redo/Yank) und `Cmd/Ctrl+Shift+Z` bleiben reserviert.
Menü: „Funktionen → Arbeitskopien-Stammbaum…“ und ein natives Hilfe-Menü (`role:'help'`) mit
„Multiterminal-Hilfe“, beide über `shortcutItems`. Topbar: `#btn-tree` („⑂ n“, nur bei Git-Projekten sichtbar,
n = alle Arbeitskopien inkl. Projektordner) rechts von `#ws-title`/`#counter`, `#btn-help` („?“) vor dem Menü-Knopf.
Befehlspalette: „Stammbaum / Arbeitskopien“, „Hilfe öffnen“, „Harnesses & Modelle“.
