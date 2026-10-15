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
const progressFiles = require('./progress-files');
const { createGitService } = require('./git-service');
const { createWorktreeService } = require('./worktree-service');
const { createAttachmentStore, MAX_IMAGE_BYTES } = require('./attachment-store');
const { createDictation } = require('./dictation');
const { createPortService } = require('./port-service');
const { createBrowserBridge, MAX_SOCKET_PATH_BYTES } = require('./browser-bridge');
const { createBrowserControl, createConsoleStore, createRendererLink } = require('./browser-control');
const mtBrowserCli = require('./mt-browser-cli');
const { createAgentStatusStore, createAgentSettings } = require('./agent-events');
const { claudeWrapperScript, eventWrapperScript, zdotdirZshenv } = require('./agent-wrapper');
const attentionLabels = require('../renderer/attention-panel');

const BROWSER_PARTITION = 'persist:minibrowser';
const QUIT_FLUSH_TIMEOUT_MS = 2000;
// New clones go next to the existing projects; a plain folder in the home directory otherwise.
const SECOND_BRAIN_PROJECTS = path.join(
  os.homedir(), 'Desktop', 'Second_Brain', 'Arbeit', 'Ai Builds and projekts', 'Claude_code_tasks', 'Projekte',
);

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
let sessions;
let ptys;
let git;
let worktrees;
let attachments;
let dictation;
let ports;
let browserBridge = null; // null when it could not start; terminals then simply get no mt-browser
let browserBinDir = null;
let browserReady = Promise.resolve();
// Agent status (F01): state per terminal, switches, and what the page reports as visible.
let agentStore;
let agentSettings;
const terminalMeta = new Map(); // terminalId -> { projectId, accountId }
let visibleTerminal = null;
let zdotdirPath = null; // ZDOTDIR shim (zsh): brings our bin folder back in front of PATH after the user's startup files
const browserConsole = createConsoleStore();
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
  const title = project ? project.name : 'Multiterminal';
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
  if (result.notify && result.entry) notifyAgent(result.entry);
}

function forgetTerminal(id) {
  terminalMeta.delete(String(id));
  agentStore.terminalClosed(String(id));
  if (visibleTerminal === String(id)) visibleTerminal = null;
}

function registerIpc() {
  handle('agents:list', () => agentStore.list());
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
    return projects.remove(project.id);
  });

  handle('presets:list', () => presets.list());
  handle('presets:add', (preset) => presets.add(preset || {}));
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
    const { id, projectId, cols, rows, command, accountOverrides, workspaceId } = options || {};
    const project = projects.get(String(projectId));
    if (!project) return { ok: false, error: 'Projekt nicht gefunden.' };
    // A tile with a working copy starts there; a missing one is an error, never the project folder.
    let cwd = project.path;
    if (workspaceId) {
      const wt = await worktrees.resolveCwd(String(workspaceId), project.id, project.path);
      if (!wt.ok) return { ok: false, error: wt.error };
      cwd = wt.cwd;
    }
    // The working directory always comes from the stored project, never from the page.
    const { env, accounts: applied } = accounts.envFor(accountOverrides);
    // Claude Code writes its quota state to a per-account file through the status line script.
    const claude = applied.find((a) => a.provider === 'claude');
    let extraEnv = claude ? { ...env, MULTITERMINAL_USAGE_FILE: usage.usageFileFor(claude.id) } : env;
    // mt-browser: a token for exactly this terminal, the socket, and the command on its PATH.
    if (browserBridge && browserBinDir && typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      browserBridge.register(id);
      extraEnv = {
        ...extraEnv,
        ...browserBridge.envFor(id),
        MULTITERMINAL_BROWSER_CLI: path.join(browserBinDir, 'mt-browser'),
        PATH: browserBinDir + path.delimiter + (process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'),
      };
      // Only with the agent status switched on, and only for zsh (the shell pty-manager starts).
      if (zdotdirPath && agentSettings.get().statusEnabled && path.basename(process.env.SHELL || '/bin/zsh') === 'zsh') {
        extraEnv = { ...extraEnv, ZDOTDIR: zdotdirPath, MULTITERMINAL_ORIG_ZDOTDIR: process.env.ZDOTDIR || '' };
      }
    }
    const result = ptys.create({ id, projectId: project.id, cwd, cols, rows, command: agentProfile.decorateCommand({ command }), extraEnv, workspaceId: workspaceId ? String(workspaceId) : undefined });
    if (!result.ok && browserBridge) browserBridge.unregister(String(id));
    if (result.ok) terminalMeta.set(String(id), { projectId: project.id, accountId: claude ? claude.id : null });
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
    dictation.cancelFor(String(id));
    forgetTerminal(id);
    ptys.kill(id);
  });
  listen('terminals:write', (id, data) => ptys.write(id, data));
  // The app's own commands ("Fortsetzen"): decorated here, never on the raw input channel above.
  listen('terminals:runBuiltin', (id, command) => {
    const line = agentProfile.builtinLine(command);
    if (line !== null) ptys.write(id, line);
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
    if (sessionUsesWorkspace(rec.workspaceId)) {
      return { ok: false, error: 'Die Arbeitskopie wird noch von einer Kachel verwendet.' };
    }
    return worktrees.remove(rec.workspaceId, project.path);
  });

  handle('dictation:start', (terminalId, live) => dictation.start(terminalId, live));
  handle('dictation:stop', () => dictation.stop());
  handle('dictation:cancel', () => dictation.cancel());

  listen('browser:response', (reqId, response) => rendererLink.respond(reqId, response));
  listen('app:quit-ready', finishQuit);
}

function finishQuit() {
  if (quitting) return;
  quitting = true;
  dictation.shutdown();
  ptys.killAll();
  if (browserBridge) browserBridge.stop().catch(() => {});
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  app.quit();
}

function menuAction(action) {
  return () => sendToWindow('menu:action', action);
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
        ...jump.hidden,
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
    const m = /^(\d+)\.sock$/.exec(name);
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
  const bridge = createBrowserBridge({ socketPath, handler: control, eventHandler: agentEventHandler, isAllowedUrl: isWebUrl });
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
    title: 'Multiterminal',
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
    projects = createProjectStore(path.join(dataDir, 'projects.json'));
    presets = createPresetStore(path.join(dataDir, 'presets.json'));
    sessions = createSessionStore(path.join(dataDir, 'session'));
    worktrees = createWorktreeService({ dataDir });
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
      cloneDir: fs.existsSync(SECOND_BRAIN_PROJECTS) ? SECOND_BRAIN_PROJECTS : path.join(os.homedir(), 'Multiterminal'),
    });
    ptys = createPtyManager({
      onData: (id, data) => sendToWindow('terminals:data', id, data),
      onExit: (id, exitCode) => {
        if (browserBridge) browserBridge.unregister(String(id));
        forgetTerminal(id);
        sendToWindow('terminals:exit', id, exitCode);
      },
    });
    ports = createPortService({ getTerminals: () => ptys.snapshot() });
    agentStore = createAgentStatusStore({ onChange: (list) => sendToWindow('agents:changed', list) });
    agentSettings = createAgentSettings({ dataDir, mtEventPath: path.join(dataDir, 'bin', 'mt-event') });
    try { agentSettings.sync(); } catch (err) { console.error('Agentenstatus: Hook-Datei nicht aktuell:', err.message); }
    browserReady = startBrowserBridge(dataDir).catch((err) => console.error('mt-browser nicht verfügbar:', err.message));

    const testAudio = process.env.MULTITERMINAL_DICTATION_TEST_AUDIO;
    dictation = createDictation({
      serviceDir: path.join(SECOND_BRAIN_PROJECTS, 'Flüsterflow'),
      write: (id, data) => ptys.write(id, data),
      notify: (event) => sendToWindow('dictation:event', event),
      extraArgs: testAudio ? ['--audio-file', testAudio] : [],
    });

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
