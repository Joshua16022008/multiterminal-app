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
- `adopt({ projectId, cwd })` → Datensatz `{ workspaceId, projectId, cwd, branch, managed:false, createdAt }`
  (nur wenn `cwd` in `git worktree list` des Projekts steht; idempotent per realpath).
- `remove(workspaceId)`: bei `managed:false` **nur Datensatz vergessen**, nie `git worktree remove`.

| Kanal | `deck.worktrees.*` | Rückgabe |
|---|---|---|
| `worktrees:tree` | `tree(projectId)` | `Tree` (unten) |
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
    forkPoint /* sha|null */, ahead /* number|null */, behind, merged /* bool|null */,
    last: { sha, subject, time, author } | null,
    changes /* number|null */,
  }],
}
// isGit:false → nodes: [], trunk: null. Fehler je Knoten → betroffene Felder null.
```

Renderer `src/renderer/worktree-tree.js`: `window.DeckWorktreeTree.create({ document, api, h, notify })`
→ `{ open({ project, focusId }), close(), isOpen(), refresh() }`; Callbacks per `setHooks({ panesFor(nodeId),
onJump(paneId), onOpenTerminal(project, workspace|null), onStartAgent(project, workspaceId|null),
onShowDiff(project, workspaceId|null), onAdopt(project, node) })`.
`src/renderer/tree-layout.js`: `window.DeckTreeLayout = { layout(tree) → {width,height,nodes:[{id,x,y}],edges:[{from,to,d}]}, colorFor(branch) → '#rrggbb' }`.

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

## 3. User Guide (Claude-Strang G)

```js
createGuideService({ dir /* docs/guide */ }) → { index() → GuideIndex, read(slug) → { slug, title, markdown } | null }
```

| Kanal | `deck.guide.*` | Rückgabe |
|---|---|---|
| `guide:index` | `guide.index()` | `{ pages: [{ slug, title, order, headings: [{ level, text, anchor }] }] }` |
| `guide:read` | `guide.read(slug)` | `{ slug, title, markdown } \| null` (Slug-Whitelist aus Index) |

Renderer: `window.DeckGuideMarkdown = { render(markdown, { h, onLink }) → DocumentFragment, anchor(text) }`
(nie `innerHTML`); `window.DeckHelp.create({ document, api, h, palette })` → `{ open(slug?, anchor?), close(), link(key) → HTMLElement }`.

## 4. Hotkeys und Menü (nur Integrator)

Neue Aktionen: `worktree-tree` (Standard `Cmd+Shift+Y`), `help` (Standard `Cmd+Shift+H`).
Befehlspalette: „Stammbaum / Arbeitskopien“, „Hilfe öffnen“, „Harnesses & Modelle“.
