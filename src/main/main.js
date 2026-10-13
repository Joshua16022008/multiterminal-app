'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const { createPtyManager } = require('./pty-manager');
const { createProjectStore } = require('./project-store');
const { createPresetStore } = require('./presets');
const { createSessionStore } = require('./session-store');
const { createAccountStore } = require('./account-store');
const { createUsageService } = require('./usage-service');
const { createUsageSetup } = require('./usage-setup');
const progressFiles = require('./progress-files');
const { createGitService } = require('./git-service');
const { createDictation } = require('./dictation');

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
let sessions;
let ptys;
let git;
let dictation;

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

function requireProject(projectId) {
  const project = projects.get(String(projectId));
  if (!project) throw new Error('Projekt nicht gefunden.');
  return project;
}

function registerIpc() {
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

  handle('terminals:create', (options) => {
    const { id, projectId, cols, rows, command, accountOverrides } = options || {};
    const project = projects.get(String(projectId));
    if (!project) return { ok: false, error: 'Projekt nicht gefunden.' };
    // The working directory always comes from the stored project, never from the page.
    const { env, accounts: applied } = accounts.envFor(accountOverrides);
    // Claude Code writes its quota state to a per-account file through the status line script.
    const claude = applied.find((a) => a.provider === 'claude');
    const extraEnv = claude ? { ...env, MULTITERMINAL_USAGE_FILE: usage.usageFileFor(claude.id) } : env;
    const result = ptys.create({ id, projectId: project.id, cwd: project.path, cols, rows, command, extraEnv });
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

  handle('terminals:kill', (id) => {
    dictation.cancelFor(String(id));
    ptys.kill(id);
  });
  listen('terminals:write', (id, data) => ptys.write(id, data));
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
  handle('git:status', (projectId) => git.status(requireProject(projectId).path));
  handle('git:pull', (projectId) => git.pull(requireProject(projectId).path));
  handle('git:sync', (projectId) => git.sync(requireProject(projectId).path));

  handle('dictation:start', (terminalId, live) => dictation.start(terminalId, live));
  handle('dictation:stop', () => dictation.stop());
  handle('dictation:cancel', () => dictation.cancel());

  listen('app:quit-ready', finishQuit);
}

function finishQuit() {
  if (quitting) return;
  quitting = true;
  dictation.shutdown();
  ptys.killAll();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  app.quit();
}

function menuAction(action) {
  return () => sendToWindow('menu:action', action);
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'Terminal',
      submenu: [
        { label: 'Neues Terminal', accelerator: 'CmdOrCtrl+T', click: menuAction('new-terminal') },
        { label: 'Terminal schließen', accelerator: 'CmdOrCtrl+W', click: menuAction('close-terminal') },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Darstellung',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ]));
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
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// Pages inside a mini browser: web only, popups stay in the same mini browser.
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
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
      onExit: (id, exitCode) => sendToWindow('terminals:exit', id, exitCode),
    });

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
