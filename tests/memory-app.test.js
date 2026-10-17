'use strict';

// Application wiring with Electron/PTY stand-ins. Real stores, bridge socket,
// CLI subprocess and shell argument serialization; this does not prove GUI use.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const mainPath = path.resolve(__dirname, '../src/main/main.js');
const appRequire = createRequire(mainPath);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function boot(dataDir) {
  const handles = new Map(), listeners = new Map(), live = new Map();
  let win, ptyCallbacks, stopped = false;
  const app = new EventEmitter();
  Object.assign(app, { name: 'Memory wiring test', requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), getPath: key => key === 'userData' ? dataDir : process.execPath,
    quit: () => { stopped = true; } });
  class Window extends EventEmitter {
    constructor() {
      super(); win = this;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { mainFrame: {}, send() {}, setWindowOpenHandler() {}, setIgnoreMenuShortcuts() {} });
    }
    loadFile() {} isDestroyed() { return false; } isFocused() { return false; }
    isMinimized() { return false; } destroy() {} showInactive() {} moveTop() {}
    static getFocusedWindow() { return win; }
  }
  const electron = {
    app, BrowserWindow: Window,
    Menu: { buildFromTemplate: items => ({ items }), setApplicationMenu() {} },
    Notification: { isSupported: () => false }, dialog: {},
    ipcMain: { handle: (name, fn) => handles.set(name, fn), on: (name, fn) => listeners.set(name, fn) },
    session: { fromPartition: () => ({ setPermissionRequestHandler() {} }) },
    shell: { beep() {} }, webContents: {}, clipboard: {}, nativeImage: {},
  };
  const ptyManager = { createPtyManager(callbacks) {
    ptyCallbacks = callbacks;
    return {
      create(options) { if (live.has(options.id)) return { ok: false, error: 'duplicate' }; live.set(options.id, options); return { ok: true }; },
      write(id, data) { const term = live.get(id); if (term) term.written = (term.written || '') + data; },
      resize() {}, snapshot: () => [...live.values()].map(x => ({ ...x, terminalId: x.id })),
      countFor: projectId => [...live.values()].filter(x => x.projectId === projectId).length,
      kill(id) { live.delete(id); callbacks.onExit(id, 0); },
      killProject(projectId) { for (const x of [...live.values()]) if (x.projectId === projectId) this.kill(x.id); },
      killAll() { for (const id of [...live.keys()]) this.kill(id); },
    };
  } };
  const pmMain = { createPmMain: () => ({
    onPtyData: () => false, onPtyExit: () => false, withoutManagers: x => x,
    startBridge: async () => {}, shutdown: async () => {}, registerIpc() {},
    handleMenuAction: () => false, handleAgentEvent: () => false,
  }) };
  const errors = [];
  const context = {
    require: name => name === 'electron' ? electron : name === './pty-manager' ? ptyManager : name === './pm-main' ? pmMain : appRequire(name),
    __dirname: path.dirname(mainPath), __filename: mainPath,
    console: { ...console, error: (...args) => errors.push(args.map(String).join(' ')) },
    process, Buffer, URL, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  // Compile like a CommonJS module in the same JS realm: separate VM object
  // prototypes would spuriously trip the production plain-object validator.
  vm.compileFunction(fs.readFileSync(mainPath, 'utf8'), Object.keys(context), { filename: mainPath })(...Object.values(context));
  const until = Date.now() + 5000;
  while (!win || !handles.has('memory:read')) {
    if (Date.now() > until) {
      const finish = listeners.get('app:quit-ready');
      if (finish && win) finish({ senderFrame: win.webContents.mainFrame });
      throw new Error('Main memory handlers unavailable: ' + errors.join('\n'));
    }
    await sleep(10);
  }
  const event = () => ({ senderFrame: win.webContents.mainFrame, sender: win.webContents });
  const invoke = (name, ...args) => {
    assert.ok(handles.has(name), 'missing IPC ' + name);
    return Promise.resolve(handles.get(name)(event(), ...args));
  };
  const send = (name, ...args) => listeners.get(name)(event(), ...args);
  return { invoke, send, live, handles, errors, feed: (id, text) => ptyCallbacks.onData(id, text),
    async stop() { if (stopped) return; send('app:quit-ready'); await sleep(40); },
  };
}

test('main IPC, authenticated CLI, capture and a fresh app runtime share durable project memory', async t => {
  // Keep the socket below macOS sun_path limits and away from user sockets.
  const root = fs.mkdtempSync(path.join('/private/tmp', 'mt-memory-app-'));
  const dataDir = path.join(root, 'data'), repo = path.join(root, 'repo'), home = path.join(root, 'home');
  fs.mkdirSync(dataDir); fs.mkdirSync(repo); fs.mkdirSync(home);
  const oldHome = os.homedir, oldTmp = os.tmpdir;
  os.homedir = () => home; os.tmpdir = () => root;
  let app;
  t.after(async () => {
    try { await app?.stop(); }
    finally { os.homedir = oldHome; os.tmpdir = oldTmp; fs.rmSync(root, { recursive: true, force: true }); }
  });
  fs.writeFileSync(path.join(dataDir, 'projects.json'), JSON.stringify([
    { id: 'one', name: 'One', path: repo }, { id: 'two', name: 'Two', path: repo },
  ]));
  app = await boot(dataDir);
  const save = async (projectId, text) => {
    const old = await app.invoke('memory:read', projectId);
    return app.invoke('memory:saveNotes', projectId, text, old.revision);
  };
  await save(null, 'SHARED_NOTE'); await save('one', 'PROJECT_ONE_NOTE'); await save('two', 'PROJECT_TWO_PRIVATE');
  assert.throws(() => app.handles.get('memory:read')({ senderFrame: {} }, 'one'), /Nicht erlaubt/);
  await assert.rejects(async () => app.invoke('memory:read', 'missing'), /Projekt/);
  const stale = await app.invoke('memory:read', 'one'); await save('one', 'PROJECT_ONE_UPDATED');
  await assert.rejects(async () => app.invoke('memory:saveNotes', 'one', 'STALE', stale.revision), /geändert|Konflikt|revision/i);
  const created = await app.invoke('terminals:create', { id: 'local-one', projectId: 'one', command: 'codex', cols: 80, rows: 24 });
  assert.equal(created.ok, true, created.error);
  const term = app.live.get('local-one');
  assert.ok(term.command.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.equal(term.extraEnv.MULTITERMINAL_MEMORY_PROJECT_ID, 'one');
  const cli = term.extraEnv.MULTITERMINAL_MEMORY_CLI;
  assert.ok(cli && fs.existsSync(cli), 'CLI installed in app-owned bin folder');
  const env = { ...process.env, ...term.extraEnv };
  const runCli = (...args) => execute(cli, args, { env, timeout: 5000 });
  await runCli('save', '--summary', 'CLI_STRUCTURED_RESULT', '--next', 'NEXT_FROM_OTHER_HARNESS');
  const read = await runCli('read');
  for (const marker of ['SHARED_NOTE', 'PROJECT_ONE_UPDATED', 'CLI_STRUCTURED_RESULT']) assert.ok(read.stdout.includes(marker));
  assert.ok(!read.stdout.includes('PROJECT_TWO_PRIVATE'));
  await assert.rejects(() => execute(cli, ['read'], { env: { ...env, MULTITERMINAL_BROWSER_TOKEN: 'invalid-token' }, timeout: 5000 }), /berechtigt|authorized|Berechtigung/i);
  app.feed('local-one', '\x1b[32mOBSERVED_AUTOMATIC_CHECKPOINT\x1b[0m\r\n');
  await app.invoke('terminals:kill', 'local-one');
  assert.ok((await app.invoke('memory:read', 'one')).checkpoints.some(x => x.source === 'terminal' && x.summary.includes('OBSERVED_AUTOMATIC_CHECKPOINT')));
  await app.stop();

  // A fresh main runtime opens the same durable files, with no in-memory state.
  app = await boot(dataDir);
  const restored = await app.invoke('memory:read', 'one');
  assert.equal(restored.notes, 'PROJECT_ONE_UPDATED');
  assert.ok(restored.checkpoints.some(x => x.summary === 'CLI_STRUCTURED_RESULT'));
  const context = await app.invoke('memory:context', 'one');
  assert.ok(context.includes('NEXT_FROM_OTHER_HARNESS'));
  assert.ok(!context.includes('PROJECT_TWO_PRIVATE'));
  assert.equal((await app.invoke('terminals:create', { id: 'restored-shell', projectId: 'one', command: null })).ok, true);
  app.send('terminals:runBuiltin', 'restored-shell', 'claude --continue');
  const resumedClaude = app.live.get('restored-shell').written;
  assert.ok(resumedClaude.startsWith('claude --continue'));
  assert.match(resumedClaude, /Memory|memory|Kontext/);
  assert.ok(resumedClaude.endsWith('\r'));
  app.send('terminals:runBuiltin', 'restored-shell', 'codex resume --last');
  const resumedCodex = app.live.get('restored-shell').written.slice(resumedClaude.length);
  assert.ok(resumedCodex.includes('developer_instructions='));
  assert.ok(resumedCodex.includes('--dangerously-bypass-approvals-and-sandbox'));
  const beforeRaw = app.live.get('restored-shell').written;
  app.send('terminals:write', 'restored-shell', 'literal $() user keystrokes');
  assert.equal(app.live.get('restored-shell').written, beforeRaw + 'literal $() user keystrokes');
  app.feed('restored-shell', 'PENDING_BEFORE_DISABLE');
  await app.invoke('memory:setSettings', { enabled: false, autoCapture: false });
  await app.invoke('memory:setSettings', { enabled: true, autoCapture: true });
  await app.invoke('terminals:kill', 'restored-shell');
  assert.ok(!(await app.invoke('memory:read', 'one')).checkpoints.some(x => x.summary.includes('PENDING_BEFORE_DISABLE')));
  assert.equal((await app.invoke('terminals:create', { id: 'clear-pending', projectId: 'one', command: null })).ok, true);
  app.feed('clear-pending', 'PENDING_BEFORE_CLEAR');
  await app.invoke('memory:clear', 'one', restored.revision);
  await app.invoke('terminals:kill', 'clear-pending');
  const cleared = await app.invoke('memory:read', 'one');
  assert.equal(cleared.notes, ''); assert.equal(cleared.checkpoints.length, 0);
  await app.invoke('memory:setSettings', { enabled: false, autoCapture: false });
  assert.equal(await app.invoke('memory:context', 'one'), '');
  const custom = 'printf CUSTOM_COMMAND_UNCHANGED';
  assert.equal((await app.invoke('terminals:create', { id: 'own', projectId: 'one', command: custom })).ok, true);
  assert.equal(app.live.get('own').command, custom);
  assert.equal((await app.invoke('memory:read', null)).notes, 'SHARED_NOTE');
  await app.stop();
});
