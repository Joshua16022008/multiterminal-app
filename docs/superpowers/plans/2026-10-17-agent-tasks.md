# Agent-to-agent terminal tasks implementation plan

> Execute with `subagent-driven-development` and independent review; Joshua has explicitly approved autonomous distribution after permission and bounded creation of new agent terminals. No live provider tests, installation, build, commit or push. Implement in this isolated worktree only; root coordinates integration with OSS integrator in the shared WIP file.

**Goal:** Claude/Codex and their native subagents can send project-scoped tasks, split them into children/dependencies and return explicit results through `mt-agent`; new Claude/Codex workers can start with the actual task after user permission.

**Architecture:** Persisted task service with main-derived terminal identities, source-specific grants and bounded task trees. Reuse the existing per-terminal authenticated browser socket for CLI transport. Existing agents pull/accept their inbox; never inject raw text into arbitrary live TUIs. New workers start through existing context/profile/memory and isolated Git-worktree paths, with assigned task and CLI instructions in their first prompt. A visible project task panel controls permission, worker cap, task status and results.

**Tech stack:** Existing CommonJS/vanilla DOM/Electron, Node built-ins, Unix socket, existing worktree/context factories. No new provider/runtime/dependencies.

## Constraints and exact semantics

- Existing terminal work/input is preserved. Queued means persisted; launched means only a process started; running requires target `accept`; completed/failed requires target `reply`. Never infer completion from output or hooks.
- Identity is terminal-level, including native subagents sharing its token. No claim to distinguish individual child model identities.
- User grants a source terminal within its project: `{enabled:false,allowNew:false,maxNewWorkers:2}` defaults; only renderer IPC may change grants. Root descendants inherit original grant owner and its original worker budget; descendants cannot grant themselves more. User may choose cap 1..4; initial value 2.
- Limits: depth <=3, 20 total tasks per root, 3 nonterminal child tasks per parent, text <=3000, title <=160, result <=16000, retained tasks <=500 and store <=2 MiB. Request id binds deduplication to source terminal and exact payload. Reusing id with conflicting content is an error.
- New-worker cap counts every new worker in the whole root tree, including finished workers; no replenishment loop. Persist assignment before launching. New workers use separate Git worktrees; never silently fall back into shared project folder. No Git repo/failed worktree is visible launch failure.
- Parent only usable by its assigned receiver while running. Dependencies max5, same project/root, acyclic by pointing to existing records; all must complete before accept/launch. Failed dependency stays blocked, never silently executes.
- On app restart, all enabled grants are revoked; running and pending/preparing new launches become interrupted. No automatic replay. Queued tasks for existing terminals remain explicit inbox items, requiring accept.
- Missing/corrupt/symlinked stores fail clearly; bounded schema-validated JSON atomically persisted in userData/agent-tasks. Project/task/source/target/actor spoofing rejected. Cancel records intention and does not kill an active agent.
- Shared main/preload/app/index are owned by OSS integrator; this worktree may contain integration hunks, but apply to shared checkout only after documented handoff.

## Task 1: Durable task store (`tasks_store`)

Create `src/main/agent-task-service.js` and `tests/agent-task-service.test.js` only.

Factory `createAgentTaskService({dataDir,getTerminal,listTerminals,onChanged,now?,randomId?})` returns:

```js
peers(actor); list(actor, {box:'all'|'inbox'|'outbox'}={}); get(actor,id);
send(actor,{to?,provider?,title,text,parentId?,dependsOn?,requestId});
accept(actor,id); reply(actor,id,{status:'completed'|'failed',text}); cancel(actor,id);
snapshot(projectId); setGrant(projectId,terminalId,{enabled,allowNew,maxNewWorkers});
pendingLaunches(); setDelivery(id,{state,error?,workspaceId?});
```

Actor is `{terminalId,projectId,provider?,cwd?,workspaceId?}` supplied only by main. `getTerminal(id)` returns authoritative metadata or null. `listTerminals(projectId)` returns live peer records. Task records contain `id,projectId,rootId,parentId,grantOwnerId,sourceTerminalId,targetTerminalId,targetProvider,newWorker,title,text,status,dependsOn,depth,createdAt,result,delivery`. A new worker target gets a random terminal ID at send time; targetProvider only claude/codex. Existing `to` must be live same-project nonmanager and cannot equal source. `status` starts queued; delivery starts inbox or pending. `setDelivery` is internal main-only and cannot change task acceptance/completion. `pendingLaunches` returns only queued, newWorker, delivery pending tasks with ready dependencies and still-active original grant. Snapshot returns `{tasks,grants,peers}` with project filtering. All API methods sync except actual callers may await. Store errors throw German user-readable Error.

- [x] Implement strict validation/actor authorization and schema-safe persistence; tests first for forged fields, wrong project/recipient, corrupted store and failed writes.
- [x] Implement source grants, deduplication, parent/dependency rules, statuses and root-wide limits. No terminal writes/process launch here.
- [x] Test explicit acceptance/result, revocation, restart, child inheritance and worker count even after completion; self-review and report files/tests, no commit.

## Task 2: CLI and authenticated transport (`tasks_cli`)

Create `src/main/mt-agent-cli.js`, `tests/mt-agent-cli.test.js`; modify only `src/main/browser-bridge.js` and its test file for task handler.

Add `taskHandler(terminalId,operation,input)` option to `createBrowserBridge`; strict commands `task-peers`, `task-list`, `task-get`, `task-send`, `task-accept`, `task-reply`, `task-cancel`. Reject missing handler and unknown/malformed fields before main handler; never accept project/source identity overrides. Keep event/browser/memory commands unchanged.

```text
mt-agent peers
mt-agent inbox | outbox | tasks
mt-agent task <id>
mt-agent send --to <terminal-id> --title <title> --text <text> [--parent <id>] [--after <id,id>]
mt-agent spawn --provider claude|codex --title <title> --text <text> [--parent <id>] [--after <id,id>]
mt-agent accept <id>
mt-agent reply <id> --status completed|failed --text <result>
mt-agent cancel <id>
mt-agent wait <id> [--timeout <seconds<=300>]
```

Support `--json` everywhere; help explains grants, inbox queue/explicit acceptance, result reporting, worktree isolation, terminal-level subagent identity and bounded workflow. Use existing MULTITERMINAL_BROWSER_SOCK/TOKEN auth; no project option. RequestId generated once per send/spawn request. Export `parseArgs(argv)`, `request(message,options?)`, `wrapperScript({execPath,scriptPath})`, and useful pure helpers. Stdout protocol and limits as mt-memory CLI. Root copies CLI/wrapper during bridge setup.

- [x] Implement parser/authenticated socket transport and strict bridge route; tests for flags, byte limits, invalid/revoked token and project spoofing.
- [x] Test no regressions to memory/browser/event behavior; self-review/handoff, no commit.

## Task 3: Visible task panel (`tasks_ui`)

Create `src/renderer/agent-tasks.js`, `agent-tasks.css`, `tests/agent-tasks-ui.test.js` only. Root adds HTML/script/CSS/button and app callbacks.

Factory `window.DeckAgentTasks.create({button,root,api,getProject,h,notify})` returns `{toggle(),refresh(),isOpen()}`. `api` exposes `snapshot(projectId)`, `grant(projectId,terminalId,patch)`, `cancel(projectId,id)`, `onChanged(callback)` (returns unsubscribe). Snapshot `{tasks,grants,peers}`; peers contain id/terminalId/title/provider; grants map by terminalId. Display a peer selector and explicit source permission, permission for new workers + cap (1..4, default2), queued/running/completed/failed/cancelled/interrupted tasks, parent/dependency information and full result text. Explain no message is typed into busy terminals and that `mt-agent inbox/accept/reply` handles participation. Offer copying the tool instruction; use textContent/safe DOM and clear busy/error states. Closing/cancelling never kills agent processes. No direct process start code.

- [x] Build DOM/controller and behavioral tests from realistic fixture data for grants, cap, status, result text and cancellation errors.
- [x] Preserve existing app layout via dedicated bounded aside styles, report actual checks and GUI limits, no commit.

## Task 4: Main dispatch and app wiring (root)

Create `src/main/agent-task-main.js` factory `createAgentTaskMain({dataDir,getTerminal,listTerminals,getProject,worktrees,launchContext,sendToWindow,onChanged})` with store, `handleCli`, snapshot/grant/cancel, launch scheduler and prepared-start validation. Strictly derive actor from meta and reject managers. Validate renderer create ID/project/command/workspace against prepared map and store before agent creation; authoritative provider comes from validated launch, not parsing decorated CLI string. On new launch: persist preparing, create unique worktree branch, build preview with task/accept/reply instructions, prepare context, publish `agentTasks:launch` with task/provider/prepared/terminalId. Renderer request acknowledgment and terminal creation are tracked separately; failure visible, no automatic repeated paid launches. Result notification is data/refresh only, never raw typing. Existing recipients read inbox; parent reads results with task/wait.

In worktree only modify main/preload/app/index to initialize module, expose origin-checked task IPC, attach task bridge handler, copy CLI/wrapper, include task env hints, validate prepared worker starts and launch background pane with assigned terminal ID. Ordinary starts/resume/profile/memory paths stay intact. Root adds source tool hint to task panel, not native user configs. Do not edit harness interfaces or worktree implementation.

- [x] Implement adapter + isolated node integration with real socket/store and dummy worker commands, no providers.
- [x] Build main renderer wiring and tests for counterfeit launch assignment, missing/background project, limit and failed creation.
- [x] Review full task workflow with independent reviewer; final source suite in worktree, socket/CLI/launch integration, syntax/Diff checks.
- [ ] Document final shared-integration evidence and exactly one next step; coordinate shared integration with OSS integrator and preserve both sets of source hunks. No app install/build/commit.

## Worktree verification and integration handoff

Implementation and isolated verification complete: 692/692 source tests pass; manual local QA 64/64 passes with providerCalls=0 and guiVerified=false. Actual Main/IPC/copied CLI/socket/Git-worktree/context exercised with dummy PTYs and no providers. Independent review covers grants/caps, source-process revocation, subtree cancellation, receiver lifecycle, raw input and restart; final delta review 28/28 with no remaining finding. Electron still aborts at --version with SIGABRT, so visible/provider acceptance is open. The store also provides internal canLaunch/cancelByUser/interrupt. Worker occupancy is limited across all roots of one source grant, while historical root budgets remain fixed. Source grants revoke at terminal exit as well as app restart. Startup/runtime store damage preserves ordinary app terminals and reports task unavailability without resetting the file. In-memory source revocation also covers descendant acceptance/starts after restoring a damaged file; only a successful fresh explicit grant clears it.

Shared integration awaits the OSS integrator's explicitly promised W+G merge notice. Until then these changes remain isolated; source-only patch excludes node_modules and all unrelated files. After handoff apply on the new main state, resolve only task hunks, then run combined tests. No commit, build, paid call or user-app operation in this task.
