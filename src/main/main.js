'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, Menu, Notification, dialog, ipcMain, session, shell, webContents, clipboard, nativeImage } = require('electron');
const { createPtyManager } = require('./pty-manager');
const { createProjectStore } = require('./project-store');
const { createPresetStore } = require('./presets');
const { createSessionStore } = require('./session-store');
const { createAccountStore } = require('./account-store');
const { createUsageService } = require('./usage-service');
const { createUsageSetup } = require('./usage-setup');
const { createSettingsService } = require('./settings-service');
const { createHotkeyStore } = require('./hotkey-store');
const hotkeyModel = require('../renderer/hotkeys');
const { createWorkspaceTemplateStore } = require('./workspace-template-store'); // F08
const { createAgentProfile } = require('./agent-profile');
const { createMemoryService, validateCheckpointInput } = require('./memory-service');
const { createMemoryCapture } = require('./memory-capture');
const { createMemoryLaunch, builtinProvider } = require('./memory-launch');
const mtMemoryCli = require('./mt-memory-cli');
const progressFiles = require('./progress-files');
const { createGitService } = require('./git-service');
const { createWorktreeService } = require('./worktree-service');
const { createWorktreeTree } = require('./worktree-tree');
const { createGuideService } = require('./guide-service');
const { createLaunchContextService } = require('./launch-context');
const { createAttachmentStore, MAX_IMAGE_BYTES } = require('./attachment-store');
const edition = require('./edition'); // dev/public; developer-only parts come from edition.devFeatures
const { createPortService } = require('./port-service');
const { createDiffService } = require('./diff-service'); // F04
const { createBrowserBridge, MAX_SOCKET_PATH_BYTES } = require('./browser-bridge');
const { createBrowserControl, createConsoleStore, createRendererLink } = require('./browser-control');
const mtBrowserCli = require('./mt-browser-cli');
const { createBrowserFeedback } = require('./browser-feedback'); // F05
const { createAgentStatusStore, createAgentSettings } = require('./agent-events');
const { createAgentSessionService, resumePlan: planResume } = require('./agent-session-service'); // F02
const { claudeWrapperScript, eventWrapperScript, zdotdirZshenv } = require('./agent-wrapper');
const attentionLabels = require('../renderer/attention-panel');
const { createPmMain } = require('./pm-main'); // PM: Projektmanager
const { createAgentTaskMain } = require('./agent-task-main');
const mtAgentCli = require('./mt-agent-cli');
// Harness-Katalog und Endpunkte (Etappe 3b)
const { createHarnessCatalog } = require('./harness-catalog');
const { createHarnessDetect } = require('./harness-detect');
const { createModelSources } = require('./model-sources');
const { createKeychain } = require('./keychain');
const { createEndpointStore } = require('./endpoint-store');
const { createHarnessLaunch } = require('./harness-launch');
const { sanitizeLaunch } = require('./launch-spec');
const { sanitizeNativeSession } = require('./agent-session-service');
const execFileAsync = require('util').promisify(require('child_process').execFile);

const BROWSER_PARTITION = 'persist:minibrowser';
const QUIT_FLUSH_TIMEOUT_MS = 2000;
// Developer-only features (null in the public edition); each part also needs its switch.
const devFeatures = edition.devFeatures;
const HOME_DIR = os.homedir();

let mainWindow = null;
let quitting = false;
let projects;
let presets;
let accounts;
let usage;
let usageSetup;
let settings;
let hotkeys;
let workspaceTemplates; // F08
let agentProfile;
let memory;
let memoryLaunch;
let memoryCapture;
let captureSettings = { enabled: false, autoCapture: false };
let sessions;
let ptys;
let git;
let worktrees;
let worktreeTree; // Stammbaum: read-only picture of a project's working copies
let guide; // User Guide from docs/guide
let launchContext;
let agentTasks = null;
let attachments;
let dictation;
let ports;
let browserBridge = null; // null when it could not start; terminals then simply get no mt-browser
let browserBinDir = null;
let browserReady = Promise.resolve();
let pm = null; // PM: Projektmanager (Fenster, Manager-Terminal, mt-pm-Brücke)
let appDataDir = null;
let harnessCatalog; // validated JSON catalog (built-in + own entries)
let harnessDetect;
let modelSources;
let keychain;
let endpointStore;
// Context starts prepared for a catalog harness: command line -> public start metadata.
// One-time and short-lived; lets terminals:create skip re-decoration and the Claude account.
const preparedLaunches = new Map();
const PREPARED_TTL_MS = 10 * 60 * 1000;
// Agent status (F01): state per terminal, switches, and what the page reports as visible.
let agentStore;
const agentSessions = createAgentSessionService(); // F02
let agentSettings;
const terminalMeta = new Map(); // terminalId -> { projectId, accountId }
let visibleTerminal = null;
let zdotdirPath = null; // ZDOTDIR shim (zsh): brings our bin folder back in front of PATH after the user's startup files
const browserConsole = createConsoleStore();
// F05: Auswahlmodus im Kachel-Browser; Seite wie bei mt-browser über die Oberfläche der Kachel gefunden.
const browserFeedback = createBrowserFeedback({
  pageOf: async (terminalId) => {
    const open = await rendererLink.call(terminalId, 'isOpen');
    const wcId = open ? await rendererLink.call(terminalId, 'webContentsId') : null;
    if (wcId === null || wcId === undefined) throw new Error('Kein Mini-Browser offen.');
    const wc = webContents.fromId(wcId);
    if (!wc || wc.isDestroyed() || !isOurWebview(wc)) throw new Error('Der Mini-Browser dieser Kachel ist nicht erreichbar.');
    if (!(await rendererLink.call(terminalId, 'visible'))) throw new Error('Der Mini-Browser ist gerade nicht sichtbar.');
    return wc;
  },
  saveImage: (png) => attachments.saveImage(png),
});
const rendererLink = createRendererLink({ send: (request) => sendToWindow('browser:request', request) });

function isWebUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function sendToWindow(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

// Only the app's own page may talk to the main process — never a page
// loaded inside a mini browser.
function fromApp(event) {
  return Boolean(mainWindow) && !mainWindow.isDestroyed()
    && event.senderFrame === mainWindow.webContents.mainFrame;
}

function handle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event)) throw new Error('Nicht erlaubt.');
    return handler(...args);
  });
}

function listen(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    if (fromApp(event)) handler(...args);
  });
}

// True while a saved tile still points at this working copy.
function sessionUsesWorkspace(workspaceId) {
  return Object.values(sessions.load().projects)
    .some((proj) => proj.terminals.some((t) => t.workspaceId === workspaceId));
}

function requireProject(projectId) {
  const project = projects.get(String(projectId));
  if (!project) throw new Error('Projekt nicht gefunden.');
  return project;
}

function windowIsFocused() {
  return Boolean(mainWindow) && !mainWindow.isDestroyed() && mainWindow.isFocused() && !mainWindow.isMinimized();
}

// A tile counts as seen only when the page says it is the visible active tile and the window has the focus.
function isTerminalSeen(terminalId) {
  return visibleTerminal !== null && String(terminalId) === visibleTerminal && windowIsFocused();
}

function attentionLog(...args) {
  if (process.env.MULTITERMINAL_ATTENTION_LOG === '1') console.log('[attention]', ...args);
}

function notifyAgent(entry) {
  const s = agentSettings.get();
  const project = projects.get(String(entry.projectId));
  const title = project ? project.name : edition.appName;
  const body = attentionLabels.providerLabel(entry.provider) + ': ' + attentionLabels.stateLabel(entry);
  attentionLog('notify', JSON.stringify({ terminalId: entry.terminalId, state: entry.state, desktop: s.desktopNotification, sound: s.sound }));
  if (s.desktopNotification && Notification.isSupported()) {
    const n = new Notification({ title, body, silent: !s.sound });
    n.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      sendToWindow('agents:jump', entry.terminalId);
    });
    n.show();
  } else if (s.sound) {
    shell.beep();
  }
}

function agentEventHandler(terminalId, args) {
  const meta = terminalMeta.get(String(terminalId)) || {};
  const result = agentStore.ingest(terminalId, args, { projectId: meta.projectId, accountId: meta.accountId, provider: 'claude' },
    { visible: isTerminalSeen(terminalId) });
  attentionLog('event', String(terminalId), args.hook_event_name, result.changed ? 'changed' : 'ignored');
  if (pm && pm.handleAgentEvent(terminalId, result.entry)) return; // PM: Manager nur Gesprächs-ID, keine Benachrichtigung
  if (result.notify && result.entry) notifyAgent(result.entry);
  // F02: a reported conversation ID is remembered per tile and handed to the page, which stores it in the session file.
  if (result.entry && result.entry.nativeSessionId) {
    const rec = agentSessions.observe(result.entry);
    if (rec) sendToWindow('agents:session', String(terminalId), rec);
  }
}

function reportMemoryError(err, terminalId) {
  console.error('Memory:', err.message);
  const ids = terminalId === undefined ? [...terminalMeta.keys()] : [String(terminalId)];
  for (const id of ids) sendToWindow('terminals:data', id, '\r\n[Memory konnte nicht geladen/gesichert werden: ' + err.message + ']\r\n');
}

function handleAgentMemory(terminalId, operation, input) {
  const meta = terminalMeta.get(String(terminalId));
  if (!meta || meta.manager) throw new Error('Memory-Terminal unbekannt oder kein gewöhnliches Terminal.');
  const project = requireProject(meta.projectId);
  if (operation === 'read') return memory.context(project.id);
  if (operation !== 'save') throw new Error('Unbekannte Memory-Aktion.');
  const fields = validateCheckpointInput(input, { allowProvenance: false });
  return memory.checkpoint(project.id, { ...fields, source: 'agent', terminalId: String(terminalId), provider: meta.provider, cwd: meta.cwd, ...(meta.workspaceId ? { workspaceId: meta.workspaceId } : {}) });
}

function forgetTerminal(id) {
  if (agentTasks) agentTasks.terminalEnded(String(id));
  if (memoryCapture) memoryCapture.detach(String(id));
  terminalMeta.delete(String(id));
  agentSessions.forget(id); // F02
  agentStore.terminalClosed(String(id));
  if (visibleTerminal === String(id)) visibleTerminal = null;
}

// Main-side view of a catalog entry for the renderer (IPC §2 HarnessView). No secrets.
function harnessView(entry, detection) {
  return {
    id: entry.id, label: entry.label, kind: entry.kind, evidence: entry.evidence, docsUrl: entry.docsUrl,
    install: (entry.install || []).map((item) => ({ method: item.method, display: item.display })),
    installed: Boolean(detection && detection.installed), path: (detection && detection.path) || null,
    canPrompt: Boolean(entry.prompt), canResume: Boolean(entry.resume), supportsHooks: entry.supportsHooks === true,
    accounts: entry.accounts || null, endpointTypes: Object.keys(entry.endpoints || {}),
    builtin: entry.builtin === true, defaultModel: entry.defaultModel || null,
  };
}

// The Memory adapter is bound to one project; build() itself has no project field (IPC §2 b).
function harnessBuilderFor(projectId) {
  const scopedMemory = {
    decorateCommand: (options) => memoryLaunch.decorateCommand({ ...options, projectId }),
    contextArgs: (options) => memoryLaunch.contextArgs({ ...options, projectId }),
  };
  return createHarnessLaunch({ catalog: harnessCatalog, endpoints: endpointStore, keychain, agentProfile, memoryLaunch: scopedMemory, dataDir: appDataDir });
}

// Builds a harness start exactly once. Returns the line plus public metadata: provider for
// meta, whether Claude runs with its own isolated config (then no account), and the chip text.
async function buildHarnessStart(projectId, spec, extra = {}) {
  const entry = harnessCatalog.get(spec.harnessId);
  if (!entry) throw new Error('Unbekanntes Harness.');
  const built = await harnessBuilderFor(projectId).build({ ...spec, ...extra });
  const endpoint = spec.endpointId && entry.evidence !== 'unconfirmed' ? await endpointStore.get(spec.endpointId) : null;
  const isolated = Boolean(endpoint) && entry.binary === 'claude' && entry.profileInjection === 'claude-append'
    && endpoint.isolateClaudeConfig !== false;
  const model = entry.evidence === 'unconfirmed' ? null : (spec.model || (endpoint && endpoint.defaultModel) || entry.defaultModel || null);
  return {
    command: built.command, provider: built.provider, isolated,
    info: { harnessLabel: entry.label, model, endpointLabel: endpoint ? endpoint.label : null },
  };
}

function takePreparedLaunch(command) {
  const now = Date.now();
  for (const [key, value] of preparedLaunches) if (value.expires < now) preparedLaunches.delete(key);
  if (typeof command !== 'string' || !preparedLaunches.has(command)) return null;
  const value = preparedLaunches.get(command);
  preparedLaunches.delete(command);
  return value;
}

// Fortsetzen / Neu starten of a harness tile: the line is rebuilt here from the stored launch.
async function runHarnessLine(id, meta, request) {
  try {
    const spec = sanitizeLaunch(request && request.launch);
    if (!spec) throw new Error('Ungültige Harness-Startvorgabe.');
    const entry = harnessCatalog.get(spec.harnessId);
    if (!entry) throw new Error('Unbekanntes Harness.');
    let resume;
    if (request.resume === true && entry.evidence !== 'unconfirmed' && entry.resume) {
      const ns = sanitizeNativeSession(request.nativeSession);
      if (ns && ns.provider === entry.id && entry.resume.byId && (ns.projectId === null || ns.projectId === meta.projectId)) resume = { sessionId: ns.nativeSessionId };
      else if (entry.resume.last) resume = 'last';
    }
    const built = await buildHarnessStart(meta.projectId, spec, resume ? { resume } : {});
    if (terminalMeta.get(String(id)) !== meta) return; // tile closed meanwhile
    meta.provider = built.provider;
    if (built.isolated) meta.accountId = null;
    memoryCapture.detach(String(id)); memoryCapture.attach({ terminalId: String(id), ...meta });
    ptys.write(id, built.command + '\r');
  } catch (err) {
    sendToWindow('terminals:data', String(id), '\r\n[Harness konnte nicht gestartet werden: ' + err.message + ']\r\n');
  }
}

function registerIpc() {
  handle('agentTasks:snapshot', pid => agentTasks.snapshot(requireProject(pid).id));
  handle('agentTasks:grant', (pid, terminalId, patch) => agentTasks.grant(requireProject(pid).id, terminalId, patch));
  handle('agentTasks:cancel', (pid, taskId) => agentTasks.cancel(requireProject(pid).id, taskId));
  handle('agentTasks:launchResult', result => agentTasks.launchResult(result));
  handle('agents:list', () => pm.withoutManagers(agentStore.list())); // PM
  // F02: how a tile is resumed; the command is built here from the validated ID only.
  handle('agents:resumePlan', (req) => planResume({
    provider: req && req.provider, stored: req && req.nativeSession,
    currentAccountId: req && typeof req.accountId === 'string' ? req.accountId : null,
    projectId: req && typeof req.projectId === 'string' ? req.projectId : null,
  }));
  handle('agents:getSettings', () => { const { hooksFile, ...rest } = agentSettings.get(); return rest; });
  handle('agents:setSettings', (patch) => { const { hooksFile, ...rest } = agentSettings.set(patch || {}); return rest; });
  handle('agents:markRead', (id) => agentStore.markRead(String(id)));
  handle('agents:markAllRead', () => agentStore.markAllRead());
  listen('agents:userInput', (id) => { agentStore.userInput(String(id)); });
  // The page names the tile the user can see (or null); main combines that with the window focus.
  listen('agents:reportVisible', (id) => {
    visibleTerminal = typeof id === 'string' && id ? id : null;
    if (visibleTerminal && windowIsFocused()) agentStore.markRead(visibleTerminal);
  });
  // F04: read-only Git changes of a project or of one of its working copies (F07).
  // The folder always comes from the stored project/worktree, never from the page.
  const diffs = createDiffService();
  async function diffCwd(projectId, workspaceId) {
    const project = requireProject(projectId);
    if (!workspaceId) return { cwd: project.path, scope: { kind: 'project', label: 'Projektordner' } };
    const wt = await worktrees.resolveCwd(String(workspaceId), project.id, project.path);
    if (!wt.ok) throw new Error(wt.error);
    return { cwd: wt.cwd, scope: { kind: 'worktree', label: 'Arbeitskopie ⑂ ' + (wt.worktree.branch || wt.worktree.workspaceId) } };
  }
  handle('diff:list', async (projectId, workspaceId) => {
    const { cwd, scope } = await diffCwd(projectId, workspaceId);
    return { ...(await diffs.listChanges(cwd)), scope };
  });
  handle('diff:file', async (projectId, workspaceId, file, mode) => {
    const { cwd } = await diffCwd(projectId, workspaceId);
    return diffs.fileDiff(cwd, file, mode);
  });
  // F10: verknüpfte Aufgaben, nur lesend und nur in der Entwicklerversion (dev-features.js)
  if (devFeatures && edition.features.taskLink) {
    const tasks = devFeatures.createTasks(process.env);
    handle('secondBrain:listTasks', () => tasks.list());
    handle('secondBrain:getTask', (id) => tasks.get(id));
  }
  handle('ports:list', () => ports.list());
  handle('ports:resolve', async (id) => {
    if (typeof id !== 'string' || id.length > 512) return { ok: false, error: 'Ungültiger Port.' };
    const current = await ports.list();
    if (!current.ok) return { ok: false, error: current.error };
    const entry = current.entries.find(item => item.id === id);
    if (!entry) return { ok: false, error: 'Dieser Port lauscht nicht mehr. Bitte aktualisieren.' };
    if (!entry.terminalId) return { ok: false, error: 'Keine belegte Terminal-Zuordnung für diesen Port.' };
    return { ok: true, entry };
  });
  handle('projects:list', () => projects.list());
  handle('projects:add', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Projektordner wählen',
      buttonLabel: 'Als Projekt hinzufügen',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folder = result.filePaths[0];
    return projects.add({ name: path.basename(folder), path: folder });
  });
  handle('projects:rename', (id, name) => projects.rename(String(id), String(name)));
  handle('projects:remove', async (id) => {
    const project = requireProject(id);
    const running = ptys.countFor(project.id);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Entfernen', 'Abbrechen'],
      defaultId: 1,
      cancelId: 1,
      message: `Projekt „${project.name}“ aus der Liste entfernen?`,
      detail: `${running > 0 ? `${running} laufende Terminals werden beendet. ` : ''}Der Ordner und seine Dateien bleiben unverändert.`,
    });
    if (response !== 0) return false;
    ptys.killProject(project.id);
    pm.removeProject(project.id); // PM: Manager beenden, Fenster schließen, Token widerrufen
    return projects.remove(project.id);
  });

  handle('presets:list', () => presets.list());
  handle('presets:add', (preset) => {
    if (preset && preset.harnessId !== undefined && !harnessCatalog.get(String(preset.harnessId))) throw new Error('Unbekanntes Harness.');
    return presets.add(preset || {});
  });
  handle('presets:remove', (id) => presets.remove(String(id)));

  handle('attachments:pickFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Dateien für das Terminal wählen', properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : attachments.validateFiles(result.filePaths.map(file => ({ path: file })));
  });
  handle('attachments:validateFiles', files => attachments.validateFiles(files));
  handle('attachments:saveImage', bytes => attachments.saveImage(bytes));
  handle('attachments:clipboardImage', () => attachments.clipboardImage());

  handle('terminals:create', async (options) => {
    await browserReady; // mt-browser must be ready before the first shell starts
    const { id, projectId, cols, rows, command, accountOverrides, workspaceId, launch } = options || {};
    const project = projects.get(String(projectId));
    if (!project) return { ok: false, error: 'Projekt nicht gefunden.' };
    let taskStart;
    try { taskStart = agentTasks && agentTasks.validateStart({ id, projectId: project.id, command, workspaceId, launch }); }
    catch (err) { return { ok: false, error: err.message }; }
    // A tile with a working copy starts there; a missing one is an error, never the project folder.
    let cwd = project.path;
    if (workspaceId) {
      const wt = await worktrees.resolveCwd(String(workspaceId), project.id, project.path);
      if (!wt.ok) { agentTasks?.startFailed(id, wt.error); return { ok: false, error: wt.error }; }
      cwd = wt.cwd;
    }
    // Resolve Memory before registering a token: a damaged store fails visibly, without leaking registration.
    let launchCommand;
    let harnessStart = null; // set for a catalog start (launch) or a prepared harness context start
    if (taskStart) {
      launchCommand = taskStart.command; // privately prepared context; never decorate twice
    } else if (launch !== undefined && launch !== null) {
      // Harness start: validated public fields only; the line is built here exactly once.
      const spec = sanitizeLaunch(launch);
      if (!spec) return { ok: false, error: 'Ungültige Harness-Startvorgabe.' };
      if (terminalMeta.has(String(id))) return { ok: false, error: 'Terminal bereits vorhanden.' };
      try { harnessStart = await buildHarnessStart(project.id, spec); }
      catch (err) { return { ok: false, error: 'Harness konnte nicht gestartet werden: ' + err.message }; }
      launchCommand = harnessStart.command;
    } else if ((harnessStart = takePreparedLaunch(command))) {
      launchCommand = command; // already built by the start service; never decorated twice
    } else {
      try { launchCommand = memoryLaunch.decorateCommand({ command, projectId: project.id }); }
      catch (err) { agentTasks?.startFailed(id, err.message); return { ok: false, error: 'Memory konnte nicht geladen werden: ' + err.message }; }
    }
    if (terminalMeta.has(String(id))) return { ok: false, error: 'Terminal bereits vorhanden.' };
    // The working directory always comes from the stored project, never from the page.
    const envResult = accounts.envFor(accountOverrides);
    let env = envResult.env;
    let applied = envResult.accounts;
    // Claude with an isolated endpoint config: no account choice and no account metadata.
    if (harnessStart && harnessStart.isolated) {
      applied = applied.filter((a) => a.provider !== 'claude');
      env = { ...env, CLAUDE_CONFIG_DIR: null };
    }
    // Claude Code writes its quota state to a per-account file through the status line script.
    const claude = applied.find((a) => a.provider === 'claude');
    let extraEnv = claude ? { ...env, MULTITERMINAL_USAGE_FILE: usage.usageFileFor(claude.id) } : env;
    extraEnv = { ...extraEnv, MULTITERMINAL_MEMORY_PROJECT_ID: project.id, MULTITERMINAL_MEMORY_CLI: path.join(browserBinDir || path.join(app.getPath('userData'), 'bin'), 'mt-memory') };
    // mt-browser: a token for exactly this terminal, the socket, and the command on its PATH.
    if (browserBridge && browserBinDir && typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      browserBridge.register(id);
      extraEnv = {
        ...extraEnv,
        ...browserBridge.envFor(id),
        MULTITERMINAL_BROWSER_CLI: path.join(browserBinDir, 'mt-browser'),
        PATH: browserBinDir + path.delimiter + (process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'),
      };
      // Always for zsh (the shell pty-manager starts): the claude wrapper decides at each start whether the
      // status hooks apply (hooks file present = status on), so switching the status on later needs no new tile.
      if (zdotdirPath && path.basename(process.env.SHELL || '/bin/zsh') === 'zsh') {
        extraEnv = { ...extraEnv, ZDOTDIR: zdotdirPath, MULTITERMINAL_ORIG_ZDOTDIR: process.env.ZDOTDIR || '' };
      }
    }
    let result;
    try {
      if (taskStart) agentTasks.validateStart({ id, projectId: project.id, command, workspaceId, launch });
      result = ptys.create({ id, projectId: project.id, cwd, cols, rows, command: launchCommand, extraEnv, workspaceId: workspaceId ? String(workspaceId) : undefined });
    }
    catch (err) { if (browserBridge) browserBridge.unregister(String(id)); agentTasks?.startFailed(id, err.message); return { ok: false, error: err.message }; }
    if (!result.ok && browserBridge) browserBridge.unregister(String(id));
    if (result.ok) {
      const meta = { projectId: project.id, accountId: claude ? claude.id : null, provider: taskStart ? taskStart.provider : harnessStart ? harnessStart.provider : (builtinProvider(command) || 'custom'), cwd, ...(workspaceId ? { workspaceId: String(workspaceId) } : {}) };
      terminalMeta.set(String(id), meta);
      agentTasks?.started(String(id));
      try { memoryCapture.attach({ terminalId: String(id), ...meta }); } catch (err) { reportMemoryError(err, id); }
    }
    if (!result.ok) agentTasks?.startFailed(String(id), result.error);
    if (result.ok && harnessStart) return { ...result, accounts: applied, launchInfo: harnessStart.info };
    return result.ok ? { ...result, accounts: applied } : result;
  });
  handle('accounts:list', () => accounts.list());
  handle('accounts:add', (provider, label) => accounts.add({ provider, label }));
  handle('accounts:rename', (id, label) => accounts.rename(String(id), label));
  handle('accounts:setActive', (provider, id) => accounts.setActive(provider, String(id)));
  handle('accounts:remove', async (id) => {
    const removed = accounts.remove(String(id));
    if (!removed) return false;
    // The folder holds the CLI's login and history: to the trash, never deleted for good.
    try {
      if (fs.existsSync(removed.folder)) await shell.trashItem(removed.folder);
    } catch {
      // The entry is gone either way; the folder can be removed by hand.
    }
    return true;
  });
  handle('accounts:loginCommand', (provider) => accounts.loginCommand(provider));

  handle('usage:list', () => usage.forAccounts(accounts.list().flatMap((g) => g.accounts)));
  handle('usage:claudeStatus', () => usageSetup.status());
  handle('usage:claudeEnable', () => usageSetup.enable());
  handle('usage:claudeDisable', () => usageSetup.disable());

  handle('hotkeys:get', () => ({ bindings: hotkeys.get(), defaults: hotkeyModel.defaults(process.platform), platform: process.platform }));
  handle('hotkeys:save', (bindings) => {
    const saved = hotkeys.save(bindings);
    buildMenu();
    sendToWindow('hotkeys:changed', saved);
    return saved;
  });
  // F08: benannte Aufbauten (nur Vorlagen; gestartet wird im Renderer über die normalen Kachelwege)
  handle('templates:list', () => workspaceTemplates.list());
  handle('templates:save', (input) => workspaceTemplates.save(input));
  handle('templates:delete', (id) => workspaceTemplates.remove(id));

  handle('hotkeys:capture', (enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('Ungültiger Aufnahmezustand.');
    mainWindow.webContents.setIgnoreMenuShortcuts(enabled);
    return true;
  });

  const memoryScope = id => id === null ? null : requireProject(id).id;
  handle('memory:read', id => memory.read(memoryScope(id)));
  handle('memory:saveNotes', (id, text, revision) => memory.saveNotes(memoryScope(id), text, revision));
  handle('memory:clear', (id, revision) => {
    const scope = memoryScope(id);
    const result = memory.clear(scope, revision);
    memoryCapture.clear(scope);
    return result;
  });
  handle('memory:getSettings', () => { captureSettings = memory.getSettings(); return { ...captureSettings }; });
  handle('memory:setSettings', patch => {
    captureSettings = memory.setSettings(patch);
    if (!captureSettings.enabled || !captureSettings.autoCapture) for (const id of new Set([...terminalMeta.values()].map(meta => meta.projectId))) memoryCapture.clear(id);
    return { ...captureSettings };
  });
  handle('memory:context', id => memory.context(memoryScope(id)));

  handle('settings:overview', (projectId) => settings.overview({
    projectPath: projectId ? requireProject(projectId).path : undefined,
    accounts: accounts.list(),
  }));
  handle('settings:readProfile', (scope) => settings.readProfile(scope));
  handle('settings:saveProfile', (scope, text, revision) => settings.saveProfile(scope, text, revision));
  handle('settings:setLoadAtStart', (scope, enabled) => agentProfile.setEnabled(String(scope), enabled === true));
  handle('settings:assignSkill', (provider, id) => settings.assignSkill(String(provider), String(id)));
  handle('settings:unassignSkill', (provider, name) => settings.unassignSkill(String(provider), String(name)));
  handle('settings:readResource', (id) => settings.readResource(id));
  handle('settings:openFolder', async (scope) => {
    const { path: folder } = settings.ensureFolders(scope);
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
    return true;
  });
  handle('settings:reveal', (id) => {
    const folder = settings.revealPath(id);
    if (fs.existsSync(folder)) shell.showItemInFolder(folder);
    else throw new Error('Dieser Ordner wurde noch nicht angelegt. Speichere zuerst ein Profil.');
    return true;
  });

  handle('terminals:kill', (id) => {
    if (dictation) dictation.cancelFor(String(id));
    forgetTerminal(id);
    if (browserBridge) browserBridge.unregister(String(id));
    ptys.kill(id);
  });
  listen('terminals:write', (id, data) => ptys.write(id, data));
  // The app's own commands ("Fortsetzen"): decorated here, never on the raw input channel above.
  listen('terminals:runBuiltin', (id, command) => {
    const meta = terminalMeta.get(String(id));
    if (!meta || meta.manager) return;
    // Harness tile: { launch, resume, nativeSession } instead of a line; the line is rebuilt here.
    if (command && typeof command === 'object') { runHarnessLine(id, meta, command); return; }
    try {
      const line = memoryLaunch.builtinLine(command, requireProject(meta.projectId).id);
      if (line !== null) {
        const provider = builtinProvider(command);
        if (provider) { meta.provider = provider; memoryCapture.detach(String(id)); memoryCapture.attach({ terminalId: String(id), ...meta }); }
        ptys.write(id, line);
      }
    } catch (err) { reportMemoryError(err, id); }
  });
  listen('terminals:resize', (id, cols, rows) => ptys.resize(id, cols, rows));

  handle('session:load', () => sessions.load());
  handle('session:save', (data) => {
    sessions.save(data);
    const keep = [];
    for (const entry of Object.values(sessions.load().projects)) {
      for (const terminal of entry.terminals) keep.push(terminal.id);
    }
    sessions.pruneScrollback(keep);
  });
  handle('session:saveScrollback', (terminalId, text) => sessions.saveScrollback(terminalId, String(text)));
  handle('session:loadScrollback', (terminalId) => sessions.loadScrollback(terminalId));
  handle('session:deleteScrollback', (terminalId) => sessions.deleteScrollback(terminalId));

  handle('progress:open', (projectId) => {
    const project = requireProject(projectId);
    return progressFiles.ensureProgress(project.path, project.name);
  });
  handle('progress:read', (projectId) => progressFiles.readProgress(requireProject(projectId).path));
  handle('progress:saveSnapshot', (projectId, title, text) => (
    progressFiles.writeSnapshot(requireProject(projectId).path, String(title), String(text))
  ));

  handle('github:status', () => git.githubStatus());
  handle('github:listRepos', () => git.listRepos());
  handle('github:clone', async (nameWithOwner) => {
    const { path: folder } = await git.cloneRepo(String(nameWithOwner));
    return projects.add({ name: path.basename(folder), path: folder });
  });
  // A new project to plan: folder + git init + planning files. Returns the stored project.
  handle('projects:createDraft', async (name) => {
    const created = await git.createLocalProject(String(name));
    const project = projects.add({ name: created.name, path: created.path });
    return { project, message: created.message };
  });
  // Publishing is outward-facing: the confirmation lives here, not in the page.
  handle('projects:publish', async (projectId) => {
    const project = requireProject(projectId);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Privat anlegen', 'Öffentlich anlegen', 'Abbrechen'],
      defaultId: 0,
      cancelId: 2,
      message: `„${project.name}“ als GitHub-Repo anlegen?`,
      detail: 'Das Repo wird in deinem GitHub-Konto erstellt und der aktuelle Stand hochgeladen. Öffentliche Repos kann jeder sehen.',
    });
    if (response === 2) return null;
    return git.publishRepo(project.path, { isPrivate: response === 0 });
  });
  handle('git:status', (projectId) => git.status(requireProject(projectId).path));
  handle('git:pull', (projectId) => git.pull(requireProject(projectId).path));
  handle('git:sync', (projectId) => git.sync(requireProject(projectId).path));

  handle('worktrees:list', (projectId) => worktrees.list(requireProject(projectId).id));
  // Optional context start; the existing terminal and quick-start paths stay direct.
  handle('launch:preview', (input) => launchContext.preview({
    project: requireProject(input && input.projectId),
    workspaceId: input && input.workspaceId,
    task: input && input.task,
    scope: input && input.scope,
    acceptance: input && input.acceptance,
  }));
  handle('launch:prepare', async (input) => {
    const result = await launchContext.prepare({
      project: requireProject(input && input.projectId),
      workspaceId: input && input.workspaceId,
      provider: input && input.provider,
      model: input && input.model,
      endpointId: input && input.endpointId,
      text: input && input.text,
      expectedHead: input && input.expectedHead,
      expectedCwd: input && input.expectedCwd,
      expectedBranch: input && input.expectedBranch,
    });
    if (!result || !result.ok || !result.launchMeta) return result;
    // Harness context start: remember the built line once and hand only public data back.
    const { launchMeta, ...rest } = result;
    preparedLaunches.set(result.command, { ...launchMeta, expires: Date.now() + PREPARED_TTL_MS });
    return { ...rest, launchInfo: launchMeta.info };
  });
  handle('worktrees:create', (projectId, options) => worktrees.create({
    project: requireProject(projectId),
    branch: options && options.branch,
    baseRef: options && options.baseRef,
  }));
  handle('worktrees:inspect', (workspaceId) => worktrees.inspect(String(workspaceId)));
  handle('worktrees:remove', async (workspaceId) => {
    const rec = worktrees.get(String(workspaceId));
    if (!rec) return { ok: false, error: 'Arbeitskopie unbekannt.' };
    const project = requireProject(rec.projectId);
    // Also guards forgetting a linked (managed:false) record: a saved tile would lose its folder.
    if (sessionUsesWorkspace(rec.workspaceId)) {
      return { ok: false, error: 'Die Arbeitskopie wird noch von einer Kachel verwendet.' };
    }
    const result = await worktrees.remove(rec.workspaceId, project.path);
    if (result && result.ok) worktreeTree.invalidate(project.id);
    return result;
  });
  // Stammbaum: read-only tree, adopting a foreign worktree as a linked record, branch for tile chips.
  handle('worktrees:tree', (projectId, force) => {
    const project = requireProject(projectId);
    return worktreeTree.tree({ id: project.id, path: project.path }, { force: force === true });
  });
  handle('worktrees:adopt', async (projectId, cwd) => {
    const project = requireProject(projectId);
    const result = await worktrees.adopt({ projectId: project.id, cwd: typeof cwd === 'string' ? cwd : '' });
    if (result && result.ok) worktreeTree.invalidate(project.id);
    return result;
  });
  handle('worktrees:branchOf', (projectId, workspaceId) => {
    const project = requireProject(projectId);
    if (workspaceId === undefined || workspaceId === null || workspaceId === '') return worktreeTree.branchOf(project.path);
    const rec = worktrees.get(String(workspaceId));
    return rec && rec.projectId === project.id ? worktreeTree.branchOf(rec.cwd) : null;
  });

  // Harnesses & Modelle (IPC §2). Detection and model lists only on request; no secret leaves main.
  const harnessId = (id) => { if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('Ungültige Harness-ID.'); return id; };
  handle('harness:list', async () => {
    const rows = await harnessDetect.detect();
    const byId = new Map(rows.map((row) => [row.id, row]));
    return harnessCatalog.list().map((entry) => harnessView(entry, byId.get(entry.id)));
  });
  handle('harness:detect', async (id) => {
    if (id === undefined || id === null) return harnessDetect.detect();
    const rows = await harnessDetect.detect(harnessId(id));
    if (rows[0] && rows[0].installed) rows[0].version = await harnessDetect.version(id);
    return rows;
  });
  handle('harness:models', (id, endpointId) => modelSources.models(harnessId(id),
    endpointId === undefined || endpointId === null || endpointId === '' ? undefined : String(endpointId)));
  handle('harness:addOwn', (entry) => harnessCatalog.addOwn(entry));
  handle('harness:removeOwn', (id) => harnessCatalog.removeOwn(harnessId(id)));
  handle('harness:export', (id) => harnessCatalog.exportEntry(harnessId(id)));
  // Types the first non-manual install hint into an existing project terminal. Never Enter.
  handle('harness:typeInstall', (id, terminalId) => {
    const entry = harnessCatalog.get(harnessId(id));
    if (!entry) throw new Error('Harness nicht gefunden.');
    const meta = terminalMeta.get(String(terminalId));
    if (!meta || meta.manager) throw new Error('Terminal nicht gefunden.');
    const item = (entry.install || []).find((option) => option.method !== 'manual');
    if (!item || typeof item.display !== 'string' || /[\x00-\x1f\x7f]/.test(item.display)) return false;
    ptys.write(String(terminalId), item.display);
    return true;
  });
  handle('endpoints:list', () => endpointStore.list());
  handle('endpoints:save', (profile, secret) => endpointStore.save(profile, secret));
  handle('endpoints:remove', (id) => endpointStore.remove(String(id)));
  handle('endpoints:templates', () => endpointStore.templates());

  // Edition for the preload, synchronously before the page builds anything (no flicker).
  ipcMain.on('edition:get', (event) => { event.returnValue = fromApp(event) ? edition.publicInfo() : null; });

  // User Guide (read-only; the service checks every slug against its index).
  handle('guide:index', () => guide.index());
  handle('guide:read', (slug) => guide.read(typeof slug === 'string' ? slug : ''));

  if (dictation) {
    handle('dictation:start', (terminalId, live) => dictation.start(terminalId, live));
    handle('dictation:stop', () => dictation.stop());
    handle('dictation:cancel', () => dictation.cancel());
  }

  // F05: Element im Mini-Browser der eigenen Kachel markieren; die Oberfläche nennt ihre Kachel-ID.
  const feedbackId = (id) => { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('Ungültige Kachel.'); return id; };
  handle('browser:pick', id => browserFeedback.pick(feedbackId(id)));
  handle('browser:pickCancel', id => browserFeedback.cancel(feedbackId(id)));

  listen('browser:response', (reqId, response) => rendererLink.respond(reqId, response));
  listen('app:quit-ready', finishQuit);
  pm.registerIpc(); // PM
}

function finishQuit() {
  if (quitting) return;
  quitting = true;
  if (agentTasks) agentTasks.dispose();
  if (dictation) dictation.shutdown();
  if (memoryCapture) memoryCapture.dispose();
  ptys.killAll();
  if (browserBridge) browserBridge.stop().catch(() => {});
  if (pm) pm.shutdown().catch(() => {}); // PM
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  app.quit();
}

function menuAction(action) {
  // PM: bei fokussiertem Manager-Fenster nicht ans Hauptfenster weiterreichen
  return () => {
    if (pm && pm.handleMenuAction(action, BrowserWindow.getFocusedWindow())) return;
    sendToWindow('menu:action', action);
  };
}

// Extra bindings use hidden twins so they also work with xterm/webview focus.
function shortcutItems(action, label) {
  const bindings = hotkeys.get()[action];
  const click = menuAction(action);
  return [
    { label, accelerator: bindings[0], click },
    ...bindings.slice(1).map(accelerator => ({ label: label + ' (Alternative)', accelerator, click, visible: false, acceleratorWorksWhenHidden: true })),
  ];
}

function terminalJumpItems() {
  const visible = [];
  const hidden = [];
  for (let i = 1; i <= 10; i++) {
    const key = String(i % 10);
    const [primary, ...alternatives] = shortcutItems('focus-terminal:' + key, 'Terminal ' + i);
    visible.push(primary);
    hidden.push(...alternatives);
  }
  return { visible, hidden };
}

function buildMenu() {
  const jump = terminalJumpItems();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about' },
      { type: 'separator' },
      ...shortcutItems('settings', 'Einstellungen…'),
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' },
    ] },
    {
      label: 'Terminal',
      submenu: [
        ...shortcutItems('new-terminal', 'Neues Terminal'),
        ...shortcutItems('close-terminal', 'Terminal schließen'),
        { type: 'separator' },
        { label: 'Zu Terminal springen', submenu: jump.visible },
        ...shortcutItems('next-attention', 'Zur nächsten Rückmeldung springen'),
        // F03
        { type: 'separator' },
        ...shortcutItems('command-palette', 'Befehlspalette…'),
        ...shortcutItems('terminal-search', 'Im Terminalverlauf suchen…'),
        ...shortcutItems('project-manager', 'Projektmanager öffnen'), // PM
        ...jump.hidden,
      ],
    },
    {
      label: 'Funktionen',
      submenu: [
        ...shortcutItems('diff-panel', 'Änderungen'),
        ...shortcutItems('ports-panel', 'Ports'),
        ...shortcutItems('attention-panel', 'Rückmeldungen'),
        ...shortcutItems('progress-panel', 'Fortschritt'),
        ...shortcutItems('worktree-tree', 'Arbeitskopien-Stammbaum…'),
        { label: 'Harnesses & Modelle…', click: menuAction('harness-settings') },
        { type: 'separator' },
        ...shortcutItems('handoff', 'Übergabe an anderes Terminal…'),
        ...shortcutItems('browser-pick', 'Element im Browser kommentieren'),
        ...(edition.features.taskLink ? shortcutItems('task-link', devFeatures.TASK_LINK_LABEL + '…') : []),
        { type: 'separator' },
        ...shortcutItems('layout-start', 'Aufbau starten…'),
        ...shortcutItems('layout-save', 'Aufbau speichern…'),
        { type: 'separator' },
        ...shortcutItems('qol-panel', 'Komfort…'),
        ...shortcutItems('auto-sort', 'Automatisch sortieren an/aus'),
        ...shortcutItems('pm-situation', 'Lagebild im Projektmanager ein/aus'),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Darstellung',
      submenu: [
        // Electron restores the role's Cmd+0 even with accelerator:null.
        { label: 'Originalgröße', click: () => { const focused = webContents.getFocusedWebContents(); if (focused) focused.setZoomLevel(0); } },
        { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    // macOS adds its menu search field to the help menu by itself.
    { role: 'help', submenu: [...shortcutItems('help', edition.appName + '-Hilfe')] },
  ]));
}

// True only for a webview hosted by our own window, never for any other page.
function isOurWebview(wc) {
  return Boolean(mainWindow) && !mainWindow.isDestroyed() && wc.getType() === 'webview'
    && Boolean(wc.hostWebContents) && wc.hostWebContents.id === mainWindow.webContents.id;
}

function removeStaleSockets(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    const m = /^(\d+)(?:\.pm)?\.sock$/.exec(name); // PM: auch die Sockets des Projektmanagers
    if (!m) continue;
    let alive = true;
    try { process.kill(Number(m[1]), 0); } catch (err) { alive = err.code !== 'ESRCH'; }
    if (!alive) { try { fs.unlinkSync(path.join(dir, name)); } catch { /* gone already */ } }
  }
}

// Starts the socket server for mt-browser and installs the command. A failure only
// disables mt-browser; the app itself keeps running.
async function startBrowserBridge(dataDir) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  let dir = path.join(os.tmpdir(), `mt-${uid}`);
  let socketPath = path.join(dir, `${process.pid}.sock`);
  if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES) {
    dir = `/tmp/mt-${uid}`; // os.tmpdir() can be long on macOS
    socketPath = path.join(dir, `${process.pid}.sock`);
  }
  // The command and its wrapper live in the data folder, outside the app bundle.
  const cliPath = path.join(dataDir, 'mt-browser-cli.js');
  const binDir = path.join(dataDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'mt-browser-cli.js'), cliPath);
  fs.writeFileSync(path.join(binDir, 'mt-browser'), mtBrowserCli.wrapperScript({ execPath: process.execPath, scriptPath: cliPath }), { mode: 0o755 });
  fs.chmodSync(path.join(binDir, 'mt-browser'), 0o755);

  const memoryCliPath = path.join(dataDir, 'mt-memory-cli.js');
  fs.copyFileSync(path.join(__dirname, 'mt-memory-cli.js'), memoryCliPath);
  fs.writeFileSync(path.join(binDir, 'mt-memory'), mtMemoryCli.wrapperScript({ execPath: process.execPath, scriptPath: memoryCliPath }), { mode: 0o755 });
  fs.chmodSync(path.join(binDir, 'mt-memory'), 0o755);
  const agentCliPath = path.join(dataDir, 'mt-agent-cli.js');
  fs.copyFileSync(path.join(__dirname, 'mt-agent-cli.js'), agentCliPath);
  fs.writeFileSync(path.join(binDir, 'mt-agent'), mtAgentCli.wrapperScript({ execPath: process.execPath, scriptPath: agentCliPath }), { mode: 0o755 });
  fs.chmodSync(path.join(binDir, 'mt-agent'), 0o755);

  // Agent status: `mt-event` for the hooks and a `claude` wrapper for hand-typed starts.
  // Both are rewritten at every start; the wrapper only changes anything while the status is switched on.
  const eventCli = path.join(dataDir, 'mt-event-cli.js');
  fs.copyFileSync(path.join(__dirname, 'mt-event-cli.js'), eventCli);
  fs.writeFileSync(path.join(binDir, 'mt-event'), eventWrapperScript({ execPath: process.execPath, scriptPath: eventCli }), { mode: 0o755 });
  fs.chmodSync(path.join(binDir, 'mt-event'), 0o755);
  fs.writeFileSync(path.join(binDir, 'claude'), claudeWrapperScript({ hooksFile: agentSettings.hooksFile }), { mode: 0o755 });
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);

  const zdir = path.join(dataDir, 'zdotdir');
  fs.mkdirSync(zdir, { recursive: true });
  fs.writeFileSync(path.join(zdir, '.zshenv'), zdotdirZshenv({ binDir }));
  zdotdirPath = zdir;

  const control = createBrowserControl({
    callRenderer: (terminalId, op, arg) => rendererLink.call(terminalId, op, arg),
    webContentsFromId: (id) => webContents.fromId(id),
    isOurWebview,
    consoleStore: browserConsole,
    revealWindow: (level) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      // Never take the keyboard focus for an agent's screenshot: the user may
      // be typing elsewhere. Every level only raises the window without focus.
      mainWindow.showInactive();
      mainWindow.moveTop();
    },
  });
  const bridge = createBrowserBridge({ socketPath, handler: control, eventHandler: agentEventHandler, memoryHandler: handleAgentMemory,
    taskHandler: (id, operation, input) => agentTasks.handleCli(id, operation, input), isAllowedUrl: isWebUrl });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  removeStaleSockets(dir);
  await bridge.start();
  browserBinDir = binDir;
  browserBridge = bridge;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#14161a',
    titleBarStyle: 'hiddenInset',
    title: edition.appName,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  const { webContents } = mainWindow;
  mainWindow.on('blur', () => webContents.setIgnoreMenuShortcuts(false));
  webContents.on('did-start-loading', () => webContents.setIgnoreMenuShortcuts(false));
  webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event) => event.preventDefault());
  webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    const src = params.src || '';
    if (params.partition !== BROWSER_PARTITION || (src && src !== 'about:blank' && !isWebUrl(src))) {
      event.preventDefault();
    }
  });

  mainWindow.on('close', (event) => {
    if (quitting) return;
    // Let the page save terminal output first; do not wait forever for it.
    event.preventDefault();
    sendToWindow('app:before-quit');
    setTimeout(finishQuit, QUIT_FLUSH_TIMEOUT_MS);
  });
  mainWindow.on('focus', () => { if (visibleTerminal) agentStore.markRead(visibleTerminal); });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// Pages inside a mini browser: web only, popups stay in the same mini browser.
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  // Console history for mt-browser console; starts with the webview, ends with it.
  const wcId = contents.id;
  contents.on('console-message', (...args) => browserConsole.add(wcId, args));
  contents.once('destroyed', () => browserConsole.drop(wcId));
  contents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) contents.loadURL(url).catch(() => {});
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault();
  });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    const dataDir = app.getPath('userData');
    appDataDir = dataDir;
    projects = createProjectStore(path.join(dataDir, 'projects.json'));
    presets = createPresetStore(path.join(dataDir, 'presets.json'));
    sessions = createSessionStore(path.join(dataDir, 'session'));
    // adopt() needs the repository folder of a project; it is looked up, never taken from the page.
    worktrees = createWorktreeService({ dataDir, getProjectPath: (id) => { const p = projects.get(String(id)); return p ? p.path : null; } });
    worktreeTree = createWorktreeTree({ worktrees, appDir: path.join(dataDir, 'worktrees') });
    // docs/guide sits next to src/ in development and in the packaged app (asar: false).
    guide = createGuideService({ dir: path.join(__dirname, '..', '..', 'docs', 'guide') });
    attachments = createAttachmentStore({
      dataDir,
      decodeImage: bytes => {
        const image = nativeImage.createFromBuffer(bytes);
        if (image.isEmpty()) throw new Error('Das Bildformat konnte nicht gelesen werden.');
        const { width, height } = image.getSize();
        if (width * height > 40000000) throw new Error('Das Bild hat zu viele Pixel (maximal 40 Millionen).');
        return image.toPNG();
      },
      readClipboardImage: async () => {
        // Read only after the explicit image button is pressed, never in background.
        for (const item of await clipboard.read()) {
          const mime = item.types.find(type => ['image/png', 'image/jpeg', 'image/webp', 'image/tiff'].includes(type));
          if (!mime) continue;
          const blob = await item.getType(mime);
          if (blob.size > MAX_IMAGE_BYTES) throw new Error('Das Bild ist zu groß (maximal 20 MB).');
          return new Uint8Array(await blob.arrayBuffer());
        }
        return null;
      },
    });
    agentProfile = createAgentProfile({ dataDir, readProfile: (scope) => settings.readProfile(scope) });
    memory = createMemoryService({ dataDir });
    try { captureSettings = memory.getSettings(); } catch (err) { console.error('Memory nicht verfügbar:', err.message); }
    memoryLaunch = createMemoryLaunch({ dataDir, memory, agentProfile, readProfile: scope => settings.readProfile(scope) });
    memoryCapture = createMemoryCapture({ memory: { getSettings: () => captureSettings, checkpoint: (...args) => memory.checkpoint(...args) }, onError: reportMemoryError });
    // Harness catalog, detection, model sources, keychain and endpoint profiles (IPC §2).
    keychain = createKeychain({});
    endpointStore = createEndpointStore({ file: path.join(dataDir, 'endpoints.json'), keychain });
    try { harnessCatalog = createHarnessCatalog({ userFile: path.join(dataDir, 'harnesses.json') }); }
    catch (err) {
      // A damaged own catalog stays untouched on disk; the built-in entries keep working.
      console.error('Eigene Harnesses nicht lesbar:', err.message);
      harnessCatalog = createHarnessCatalog({});
    }
    harnessDetect = createHarnessDetect({ catalog: harnessCatalog, env: process.env });
    modelSources = createModelSources({
      catalog: harnessCatalog, endpoints: endpointStore,
      // Model queries run the binary found by detection (login PATH) directly, never a shell.
      run: async (binary, argv, options) => {
        const entry = harnessCatalog.list().find((item) => item.binary === binary);
        const [found] = entry ? await harnessDetect.detect(entry.id) : [];
        if (!found || !found.installed || !found.path) throw new Error('CLI nicht gefunden.');
        return execFileAsync(found.path, argv, { ...options, env: process.env });
      },
    });
    launchContext = createLaunchContextService({
      dataDir, worktrees, decorateCommand: options => agentProfile.decorateCommand(options), readMemory: id => memoryLaunch.context(id),
      harnessCatalog,
      buildLaunch: ({ project, launch: spec, prompt }) => buildHarnessStart(project.id, spec, { prompt }),
    });
    settings = createSettingsService({ dataDir, loadsAtStart: (scope) => agentProfile.isEnabled(scope) });
    hotkeys = createHotkeyStore({ filePath: path.join(dataDir, 'hotkeys.json') });
    workspaceTemplates = createWorkspaceTemplateStore({ filePath: path.join(dataDir, 'workspace-templates.json') }); // F08
    accounts = createAccountStore({
      filePath: path.join(dataDir, 'accounts.json'),
      profilesDir: path.join(dataDir, 'profiles'),
    });
    // The status line script runs outside the app bundle, so it lives in the app's data folder.
    const usageScript = path.join(dataDir, 'usage-statusline.js');
    try {
      fs.copyFileSync(path.join(__dirname, 'usage-statusline.js'), usageScript);
    } catch (err) {
      // Without the copy the status line simply cannot be enabled.
    }
    usage = createUsageService({ usageDir: path.join(dataDir, 'usage') });
    usageSetup = createUsageSetup({
      settingsPath: path.join(os.homedir(), '.claude', 'settings.json'),
      execPath: process.execPath,
      scriptPath: usageScript,
    });
    git = createGitService({
      cloneDir: edition.cloneDir(HOME_DIR),
    });
    ptys = createPtyManager({
      onData: (id, data) => {
        if (pm.onPtyData(id, data)) return; // PM: Ausgabe des Managers geht ins Manager-Fenster
        memoryCapture.feed(String(id), data);
        sendToWindow('terminals:data', id, data);
      },
      onExit: (id, exitCode) => {
        if (pm.onPtyExit(id, exitCode)) return; // PM
        if (browserBridge) browserBridge.unregister(String(id));
        forgetTerminal(id);
        sendToWindow('terminals:exit', id, exitCode);
      },
    });
    ports = createPortService({ getTerminals: () => ptys.snapshot() });
    agentStore = createAgentStatusStore({ onChange: (list) => sendToWindow('agents:changed', pm.withoutManagers(list)) }); // PM
    agentSettings = createAgentSettings({ dataDir, mtEventPath: path.join(dataDir, 'bin', 'mt-event') });
    agentTasks = createAgentTaskMain({ dataDir, worktrees, launchContext,
      getTerminal: id => terminalMeta.has(id) ? { ...terminalMeta.get(id), terminalId: id } : null,
      listTerminals: pid => ptys.snapshot().filter(item => item.projectId === pid && terminalMeta.has(item.terminalId))
        .map(item => ({ ...terminalMeta.get(item.terminalId), terminalId: item.terminalId, title: item.terminalId,
          ...(sessions.load().projects[pid]?.terminals.find(term => term.id === item.terminalId)?.title ? { title: sessions.load().projects[pid].terminals.find(term => term.id === item.terminalId).title } : {}) })),
      getProject: id => projects.get(String(id)),
      sendToWindow: (channel, payload) => { if (!mainWindow || mainWindow.isDestroyed()) return false; sendToWindow(channel, payload); return true; },
    });
    try { agentSettings.sync(); } catch (err) { console.error('Agentenstatus: Hook-Datei nicht aktuell:', err.message); }
    browserReady = startBrowserBridge(dataDir).catch((err) => console.error('mt-browser nicht verfügbar:', err.message));
    // PM: Projektmanager-Brücke erst, wenn bin-Ordner und Wrapper stehen
    pm = createPmMain({
      electron: { BrowserWindow, ipcMain, shell },
      getMainWindow: () => mainWindow,
      getDataDir: () => dataDir,
      getProjects: () => projects,
      getSessions: () => sessions,
      getPtys: () => ptys,
      getWorktrees: () => worktrees,
      getPorts: () => ports,
      getAgentStore: () => agentStore,
      getAccounts: () => accounts,
      getTerminalMeta: () => terminalMeta,
      getBrowserBridge: () => browserBridge,
      getBinDir: () => browserBinDir,
      getZdotdir: () => zdotdirPath,
      statusEnabled: () => agentSettings.get().statusEnabled,
      forgetTerminal,
      createDiffService,
    });
    browserReady = browserReady.then(() => pm.startBridge(dataDir)).catch((err) => console.error('mt-pm nicht verfügbar:', err.message));

    // Diktat nur in der Entwicklerversion (dev-features.js); sonst bleibt dictation null.
    if (devFeatures && edition.features.dictation) {
      const testAudio = process.env.MULTITERMINAL_DICTATION_TEST_AUDIO;
      dictation = devFeatures.createDictation({
        home: HOME_DIR,
        write: (id, data) => ptys.write(id, data),
        notify: (event) => sendToWindow('dictation:event', event),
        extraArgs: testAudio ? ['--audio-file', testAudio] : [],
      });
    }

    // Websites in a mini browser get no camera, microphone, location etc.
    session.fromPartition(BROWSER_PARTITION).setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

    registerIpc();
    buildMenu();
    createWindow();
  });

  app.on('before-quit', (event) => {
    if (quitting || !mainWindow) return;
    event.preventDefault();
    mainWindow.close();
  });
  app.on('window-all-closed', () => app.quit());
}
