'use strict';

// Projektmanager im Main-Prozess: Fenster je Projekt, Manager-Terminal, Brücke für `mt-pm`
// und alle pm:*-Kanäle. main.js bindet dieses Modul nur ein; die Abhängigkeiten kommen als
// Getter, weil main.js seine Dienste erst in app.whenReady() anlegt.
//
// Sicherheit: Die pm:*-Kanäle des Manager-Fensters werden dem Projekt zugeordnet, das zu DIESEM
// Fenster gehört (nicht dem, was der Renderer nennt). Aufträge an Kacheln gehen nur als
// Promptvorschau über das Hauptfenster; hier wird nie in ein fremdes Terminal geschrieben.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createOutputBuffer } = require('./output-buffer');
const { createPmService, isValidManagerProject, managerIdFor } = require('./pm-service');
const { createPmBridge, MAX_SOCKET_PATH_BYTES } = require('./pm-bridge');
const { createPmSessions } = require('./pm-sessions');
const { createPmManager } = require('./pm-manager');
const mtPmCli = require('./mt-pm-cli');

const SEND_TIMEOUT_MS = 15000;

function createPmMain(ctx) {
  const { BrowserWindow, ipcMain, shell } = ctx.electron;
  const outputBuffer = createOutputBuffer();
  const windows = new Map(); // projectId -> BrowserWindow
  const windowProject = new Map(); // webContents.id -> projectId
  const pendingSends = new Map(); // requestId -> { resolve, timer }
  let bridge = null;
  let bridgeReady = false;
  let service = null;
  let manager = null;
  let sessionsStore = null;
  let diffs = null;

  function mainWin() {
    const w = ctx.getMainWindow();
    return w && !w.isDestroyed() ? w : null;
  }

  function fromMainApp(event) {
    const w = mainWin();
    return Boolean(w) && event.senderFrame === w.webContents.mainFrame;
  }

  // Projekt des Manager-Fensters, aus dem die Nachricht kam; sonst null.
  function projectOfSender(event) {
    const projectId = windowProject.get(event.sender.id);
    const win = projectId ? windows.get(projectId) : null;
    if (!win || win.isDestroyed() || event.senderFrame !== win.webContents.mainFrame) return null;
    return projectId;
  }

  function sendToPm(projectId, channel, ...args) {
    const win = windows.get(projectId);
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  }

  function pickSocketPath() {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    let dir = path.join(os.tmpdir(), `mt-${uid}`);
    let socketPath = path.join(dir, `${process.pid}.pm.sock`);
    if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES) {
      dir = `/tmp/mt-${uid}`; // os.tmpdir() kann auf macOS lang sein
      socketPath = path.join(dir, `${process.pid}.pm.sock`);
    }
    return socketPath;
  }

  function ensureServices() {
    if (service) return;
    const dataDir = ctx.getDataDir();
    sessionsStore = createPmSessions({ filePath: path.join(dataDir, 'pm', 'sessions.json') });
    diffs = ctx.createDiffService();
    service = createPmService({
      getProject: (id) => ctx.getProjects().get(String(id)),
      getSessionTerminals: (id) => {
        const entry = ctx.getSessions().load().projects[id];
        return entry ? entry.terminals : [];
      },
      getAgentStates: () => ctx.getAgentStore().list(),
      ptySnapshot: () => ctx.getPtys().snapshot(),
      worktrees: ctx.getWorktrees(),
      diffs,
      ports: ctx.getPorts(),
      outputBuffer,
      managerResumed: (id) => (manager ? manager.wasResumed(id) : false),
    });
    const socketPath = pickSocketPath();
    bridge = createPmBridge({ socketPath, service, requestSend });
    manager = createPmManager({
      dataDir,
      roleSource: path.join(__dirname, 'pm-role.md'),
      ptys: ctx.getPtys(),
      getProject: (id) => ctx.getProjects().get(String(id)),
      sessions: sessionsStore,
      outputBuffer,
      pmBridge: bridge,
      makeEnv,
    });
  }

  // Umgebung des Manager-Terminals: Konto, Mini-Browser/Agentenereignisse und mt-pm.
  async function makeEnv(terminalId, projectId, pmEnv) {
    const binDir = ctx.getBinDir();
    const browserBridge = ctx.getBrowserBridge();
    if (!binDir || !bridgeReady) throw new Error('Der Projektmanager ist nicht verfügbar (Werkzeuge der App nicht bereit).');
    const { env, accounts: applied } = ctx.getAccounts().envFor(undefined);
    const claude = applied.find((a) => a.provider === 'claude');
    let extraEnv = { ...env };
    if (browserBridge) {
      browserBridge.register(terminalId); // nötig, damit Agentenereignisse des Managers ankommen
      extraEnv = { ...extraEnv, ...browserBridge.envFor(terminalId) };
    }
    extraEnv = {
      ...extraEnv,
      ...pmEnv,
      MULTITERMINAL_PM_CLI: path.join(binDir, 'mt-pm'),
      PATH: binDir + path.delimiter + (process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'),
    };
    const zdotdir = ctx.getZdotdir();
    if (zdotdir && ctx.statusEnabled() && path.basename(process.env.SHELL || '/bin/zsh') === 'zsh') {
      extraEnv = { ...extraEnv, ZDOTDIR: zdotdir, MULTITERMINAL_ORIG_ZDOTDIR: process.env.ZDOTDIR || '' };
    }
    ctx.getTerminalMeta().set(terminalId, { projectId, accountId: claude ? claude.id : null, manager: true });
    return extraEnv;
  }

  // Auftrag an die Oberfläche des Hauptfensters: nur Promptvorschau, Bestätigung durch den Nutzer.
  function requestSend({ projectId, terminalId, text }) {
    return new Promise((resolve) => {
      const win = mainWin();
      if (!win) { resolve({ ok: false, error: 'Das Hauptfenster ist nicht verfügbar.' }); return; }
      const requestId = crypto.randomBytes(12).toString('hex');
      const timer = setTimeout(() => {
        pendingSends.delete(requestId);
        resolve({ ok: false, error: 'Keine Antwort des Hauptfensters (Zeitüberschreitung).' });
      }, SEND_TIMEOUT_MS);
      pendingSends.set(requestId, { resolve, timer });
      win.webContents.send('pm:sendRequest', { requestId, projectId, terminalId, text });
    });
  }

  function onSendResult(requestId, result) {
    const pending = typeof requestId === 'string' ? pendingSends.get(requestId) : null;
    if (!pending) return;
    pendingSends.delete(requestId);
    clearTimeout(pending.timer);
    const ok = Boolean(result) && result.ok === true;
    pending.resolve(ok ? { ok: true } : { ok: false, error: (result && typeof result.error === 'string' && result.error) || 'Promptvorschau nicht möglich.' });
  }

  function openWindow(projectId) {
    const id = String(projectId);
    if (!isValidManagerProject(id)) return { ok: false, error: 'Ungültige Projekt-ID für den Projektmanager.' };
    const project = ctx.getProjects().get(id);
    if (!project) return { ok: false, error: 'Projekt nicht gefunden.' };
    const existing = windows.get(id);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return { ok: true };
    }
    const win = new BrowserWindow({
      width: 1100,
      height: 760,
      minWidth: 720,
      minHeight: 480,
      backgroundColor: '#17131f',
      title: 'Projektmanager – ' + project.name,
      webPreferences: {
        preload: path.join(__dirname, 'pm-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const wcId = win.webContents.id;
    windows.set(id, win);
    windowProject.set(wcId, id);
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.on('page-title-updated', (event) => event.preventDefault());
    win.on('closed', () => {
      windowProject.delete(wcId);
      if (windows.get(id) === win) windows.delete(id);
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'pm.html'), { query: { project: id } });
    return { ok: true };
  }

  function registerIpc() {
    ensureServices();
    // Aus dem Hauptfenster
    ipcMain.handle('pm:openWindow', (event, projectId) => {
      if (!fromMainApp(event)) throw new Error('Nicht erlaubt.');
      return openWindow(projectId);
    });
    const sendResult = (event, requestId, result) => {
      if (fromMainApp(event)) onSendResult(requestId, result);
    };
    ipcMain.handle('pm:sendResult', (event, requestId, result) => {
      if (!fromMainApp(event)) throw new Error('Nicht erlaubt.');
      onSendResult(requestId, result);
      return true;
    });
    ipcMain.on('pm:sendResult', sendResult);

    // Aus dem Manager-Fenster: das Projekt kommt aus der Fensterzuordnung, nicht aus den Argumenten.
    function pmHandle(channel, fn) {
      ipcMain.handle(channel, (event, ...args) => {
        const projectId = projectOfSender(event);
        if (!projectId) throw new Error('Nicht erlaubt.');
        return fn(projectId, ...args.slice(1));
      });
    }
    function pmListen(channel, fn) {
      ipcMain.on(channel, (event, ...args) => {
        const projectId = projectOfSender(event);
        if (projectId) fn(projectId, ...args.slice(1));
      });
    }
    pmHandle('pm:start', (projectId, cols, rows) => manager.start(projectId, Number(cols), Number(rows)));
    pmHandle('pm:write', (projectId, data) => { manager.write(projectId, data); return true; });
    pmListen('pm:write', (projectId, data) => manager.write(projectId, data));
    pmHandle('pm:resize', (projectId, cols, rows) => { manager.resize(projectId, Number(cols), Number(rows)); return true; });
    pmListen('pm:resize', (projectId, cols, rows) => manager.resize(projectId, Number(cols), Number(rows)));
    pmHandle('pm:restart', (projectId) => manager.restart(projectId));
    pmHandle('pm:state', (projectId) => service.state(projectId));
  }

  // Socket-Server und `mt-pm` im bin-Ordner der App. Ein Fehler schaltet nur den Manager ab.
  async function startBridge(dataDir) {
    ensureServices();
    const cliPath = path.join(dataDir, 'mt-pm-cli.js');
    const binDir = path.join(dataDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'mt-pm-cli.js'), cliPath);
    fs.writeFileSync(path.join(binDir, 'mt-pm'), mtPmCli.wrapperScript({ execPath: process.execPath, scriptPath: cliPath }), { mode: 0o755 });
    fs.chmodSync(path.join(binDir, 'mt-pm'), 0o755);
    await bridge.start();
    bridgeReady = true;
  }

  // Alle PTYs füttern den Puffer; Ausgabe des Managers geht ins Manager-Fenster. -> true, wenn Manager.
  function onPtyData(id, data) {
    outputBuffer.append(id, data);
    const meta = ctx.getTerminalMeta().get(String(id));
    if (meta && meta.manager) {
      sendToPm(meta.projectId, 'pm:data', data);
      return true;
    }
    return false;
  }

  // -> true, wenn der beendete Prozess ein Manager war (dann übernimmt dieses Modul das Aufräumen).
  function onPtyExit(id, exitCode) {
    const meta = ctx.getTerminalMeta().get(String(id));
    if (!meta || !meta.manager) { outputBuffer.forget(id); return false; }
    // Neustart: der neue Prozess läuft schon oder wird gerade gestartet; das Ende des alten zählt nicht.
    if (!manager.exited(meta.projectId)) return true;
    outputBuffer.forget(id);
    const browserBridge = ctx.getBrowserBridge();
    if (browserBridge) browserBridge.unregister(String(id));
    ctx.forgetTerminal(id);
    sendToPm(meta.projectId, 'pm:exit', exitCode);
    return true;
  }

  // Agentenereignis eines Manager-Terminals: nur die Gesprächs-ID merken. -> true = nicht weiterverarbeiten.
  function handleAgentEvent(terminalId, entry) {
    const meta = ctx.getTerminalMeta().get(String(terminalId));
    if (!meta || !meta.manager) return false;
    if (entry && entry.nativeSessionId && sessionsStore) {
      sessionsStore.observe(meta.projectId, entry.nativeSessionId, entry.observedAt);
    }
    return true;
  }

  function withoutManagers(list) {
    const metas = ctx.getTerminalMeta();
    return list.filter((e) => !(metas.get(String(e.terminalId)) || {}).manager);
  }

  function removeProject(projectId) {
    if (manager) manager.remove(projectId);
    const win = windows.get(projectId);
    if (win && !win.isDestroyed()) win.destroy();
  }

  async function shutdown() {
    for (const win of [...windows.values()]) { if (!win.isDestroyed()) win.destroy(); }
    for (const p of pendingSends.values()) clearTimeout(p.timer);
    pendingSends.clear();
    if (bridge) await bridge.stop().catch(() => {});
  }

  return {
    registerIpc, startBridge, onPtyData, onPtyExit, handleAgentEvent, withoutManagers, removeProject, shutdown,
    openWindow, isManager: (id) => Boolean((ctx.getTerminalMeta().get(String(id)) || {}).manager), managerIdFor,
  };
}

module.exports = { createPmMain };
