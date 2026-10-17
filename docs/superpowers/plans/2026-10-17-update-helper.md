# Independent local app updater implementation plan

> **For agentic workers:** Use `subagent-driven-development` task by task with separate file ownership. Joshua has authorized implementation; no additional execution-choice gate. No commit, real installation, restart, paid providers or downloads.

**Goal:** Select a prepared local update in the project manager, inspect it, explicitly approve installation, then let an independent helper wait for the old app to exit, replace it safely and launch the new app.

**Architecture:** A main-process update service owns package selection, validation, confirmation and staging. A copied `/bin/bash` helper runs detached from Electron and outside either app bundle. The existing graceful quit path saves session data; the helper waits without killing processes, retains a backup, records persistent success/failure, and restores the old app if replacement fails.

**Tech stack:** Existing CommonJS/Electron IPC, built-in Node modules, macOS `/bin/bash`, `ditto`, `shasum`, `PlistBuddy` and `open`. No dependencies or update server.

## Global constraints

- Shared checkout `main`, starting HEAD `cd0a79d`; preserve sidebar and concurrent memory changes. Do not edit `main.js`, ordinary preload or memory/settings files.
- Never install or close the user's live app during development. Replacement tests use temporary app fixtures only.
- Only project-manager windows can use update IPC. Source/target paths are chosen/resolved in main, never accepted from renderer install arguments.
- Native confirmation must explain that all terminals and manager agents stop, show versions and selected package, and default to cancellation. Same-version replacement is allowed because the current release is still being assembled.
- Require complete `CHECKSUMS.sha256` verification, correct bundle identity/version, safe relative manifest paths, and reject missing/unlisted files, escaping symlinks and overlapping source/target paths.
- Finish all staging and revalidation before requesting graceful quit. Copy helper outside app; ensure it is ready before quitting. A helper start/readiness failure leaves app running.
- Await parent exit with bounded timeout; no forced process termination. Check target app is not running before replacement. Retain backup and log/status across restarts; expose last outcome in PM.
- Stage on target volume; use argv rather than interpolated shell commands. No privileged installation or download. Any error before replacement preserves current app; failed replacement restores backup.

### Task 1: Update backend and independent helper (`update_backend`)

**Files:** create `src/main/update-service.js`, `src/main/update-helper.sh`, `tests/update-service.test.js`, `tests/update-helper.test.js`.

**Interface:** `createUpdateService({ app, dialog, shell, getParentWindow, dataDir, ...testDependencies })` returns:

```js
select() // Promise<{ok, cancelled?, error?, token?, version?, currentVersion?, packagePath?, targetPath?, fileCount?}>
install(token) // Promise<{ok, cancelled?, error?, started?}>
status() // Promise<{ok, supported?, message?, lastResult?, busy?}>
```

Main retains package selection by opaque token. Successful `install` includes native confirmation, revalidation/staging, readiness handshake, then `app.quit()`; cancellation/failure does not quit. Service serializes concurrent installs across PM windows and prevents reusing a consumed token. Production resolves current packaged app and rejects development execution. Tests may inject paths/commands or platform adapters; renderer cannot do so. All helper/status paths live outside app in private directories. Avoid Electron binary as helper runtime.

- [x] Write failing behavioral tests for invalid checksums/path traversal/unlisted files/symlink escape, cancellation, concurrent requests, helper failure and no premature quit.
- [x] Implement package validation, native picker/confirmation, staging and lifecycle service.
- [x] Implement shell helper: ready marker, wait for owner exit, verify staged checksums again, backup/swap/rollback, launch app, persistent result/log. Use fixed result vocabulary and no unsafe dynamic JSON interpolation.
- [x] Prove real detached helper survives owner exit and installs only temp bundles; cover parent timeout, failed validation, rollback and failed relaunch result.
- [x] Run `node --test tests/update-service.test.js tests/update-helper.test.js`, `bash -n src/main/update-helper.sh`; self-review handoff, no commit.

### Task 2: PM update interface (`update_ui`)

**Files:** only `src/renderer/pm.html`, `pm.js`, `pm.css`; create `tests/update-ui.test.js` or narrowly scoped DOM checks as appropriate.

**Consumes preload API:**

```js
window.pm.updateSelect() // service.select result
window.pm.updateInstall(token) // service.install result; main owns native confirmation
window.pm.updateStatus() // service.status result
```

Add visible `App aktualisieren…` action in PM, preview with current/new version and package, installation button, cancellation, accessible busy/error/success feedback and last installation outcome. Clearly explain this updates Multiterminal globally and ends running terminals. Native confirmation is the decisive approval; selecting/previewing does not quit. Never show raw implementation scaffolding. Keep existing manager controls and narrow layouts usable.

- [x] Add focused tests for selection/cancel/error/busy/preview/install and last-result states.
- [x] Implement real DOM flow using `textContent`, prevent double submissions, handle rejection and cancellation, retain selected token only until replaced/used.
- [x] Verify PM controls and keyboard semantics with DOM fixtures; actual width/layout acceptance remains open because Electron aborts before bootstrap.

### Task 3: PM main/preload integration (root)

**Files:** `src/main/pm-main.js`, `pm-preload.js`, `tests/pm-main.test.js` or new `tests/update-ipc.test.js`, `scripts/qa-update-helper.js`.

Lazy-create service using `require('electron')` app/dialog only upon first authorized update IPC; inject `ctx.updateService` in tests. Keep existing `main.js` untouched. Route `pm:updateSelect`, `pm:updateInstall`, `pm:updateStatus` through existing sender/project checks. Service confirmation parent is actual requesting PM window. No update surface in `mt-pm` agent CLI. Preload methods forward no filesystem path, only opaque token for installation.

- [x] Test main window/unknown window/subframe rejection and authorized PM calls; ensure spoofed project ID cannot bypass sender validation.
- [x] Add lazy service and bridge methods; exercise actual PM/main/preload modules with controlled Electron stand-ins.
- [x] Add isolated QA harness with no providers, real staged fixture replacement and explicit no-live-install guard.

### Task 4: Review and handoff (root + independent reviewer)

- [x] Independently review helper handoff/races, complete checksum boundary, rollback and UI/IPC scope; fix material findings.
- [x] Run final full suite with `env TMPDIR=/private/tmp npm test`, syntax/Diff checks and native helper integration. Attempt isolated Electron GUI once if environment can start; report exact limitation if bootstrap still fails.
- [x] Update `PROGRESS.md`, `PROJECT_STATUS.md`, own `UPDATE_VERSION.md` entry and release reservation. One next action: include helper in next approved package and verify visible flow before user installation. The currently installed app cannot gain this button until updated once externally.
