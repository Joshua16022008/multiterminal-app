'use strict';

// Integration (Etappe 3a): main.js wires the Stammbaum (worktrees:tree/adopt/branchOf),
// the User Guide (guide:index/read) and the menus. Electron and the PTY are stand-ins;
// git runs for real against a temporary repository.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

const mainPath = path.resolve(__dirname, '../src/main/main.js');
const appRequire = createRequire(mainPath);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function boot(dataDir) {
  const handles = new Map(), listeners = new Map();
  let win, stopped = false, menu = null;
  const app = new EventEmitter();
  Object.assign(app, { name: 'OSS integration test', requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), getPath: (key) => (key === 'userData' ? dataDir : process.execPath),
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
    Menu: { buildFromTemplate: (items) => { menu = items; return { items }; }, setApplicationMenu() {} },
    Notification: { isSupported: () => false }, dialog: {},
    ipcMain: { handle: (name, fn) => handles.set(name, fn), on: (name, fn) => listeners.set(name, fn) },
    session: { fromPartition: () => ({ setPermissionRequestHandler() {} }) },
    shell: { beep() {} }, webContents: {}, clipboard: {}, nativeImage: {},
  };
  const ptyManager = { createPtyManager() {
    return { create: () => ({ ok: true }), write() {}, resize() {}, snapshot: () => [], countFor: () => 0, kill() {}, killProject() {}, killAll() {} };
  } };
  const pmMain = { createPmMain: () => ({
    onPtyData: () => false, onPtyExit: () => false, withoutManagers: (x) => x,
    startBridge: async () => {}, shutdown: async () => {}, registerIpc() {},
    handleMenuAction: () => false, handleAgentEvent: () => false,
  }) };
  const errors = [];
  const context = {
    require: (name) => (name === 'electron' ? electron : name === './pty-manager' ? ptyManager : name === './pm-main' ? pmMain : appRequire(name)),
    __dirname: path.dirname(mainPath), __filename: mainPath,
    console: { ...console, error: (...args) => errors.push(args.map(String).join(' ')) },
    process, Buffer, URL, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.compileFunction(fs.readFileSync(mainPath, 'utf8'), Object.keys(context), { filename: mainPath })(...Object.values(context));
  const until = Date.now() + 5000;
  while (!win || !handles.has('guide:index') || !menu) {
    if (Date.now() > until) throw new Error('Main handlers unavailable: ' + errors.join('\n'));
    await sleep(10);
  }
  const event = () => ({ senderFrame: win.webContents.mainFrame, sender: win.webContents });
  const invoke = (name, ...args) => {
    assert.ok(handles.has(name), 'missing IPC ' + name);
    return Promise.resolve(handles.get(name)(event(), ...args));
  };
  return { invoke, handles, menu: () => menu, errors,
    async stop() { if (stopped) return; listeners.get('app:quit-ready')(event()); await sleep(40); } };
}

function makeRepo(root) {
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'qa@example.com'); git('config', 'user.name', 'QA');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'eins\n'); git('add', '.'); git('commit', '-q', '-m', 'init');
  return { repo, git };
}

test('main wires Stammbaum, adopt with project path, branchOf, removal lock and guide channels', async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join('/private/tmp', 'mt-oss-int-')));
  const dataDir = path.join(root, 'data'), home = path.join(root, 'home');
  fs.mkdirSync(dataDir); fs.mkdirSync(home);
  const { repo, git } = makeRepo(root);
  const external = path.join(home, '.codex', 'worktrees', '7', 'repo');
  fs.mkdirSync(path.dirname(external), { recursive: true });
  git('worktree', 'add', '-q', '-b', 'codex/x', external);
  fs.writeFileSync(path.join(dataDir, 'projects.json'), JSON.stringify([{ id: 'p1', name: 'Repo', path: repo }]));
  const oldHome = os.homedir, oldTmp = os.tmpdir;
  os.homedir = () => home; os.tmpdir = () => root;
  let app;
  t.after(async () => {
    try { await app?.stop(); } finally { os.homedir = oldHome; os.tmpdir = oldTmp; fs.rmSync(root, { recursive: true, force: true }); }
  });
  app = await boot(dataDir);

  // Only the app's own page may call the new channels.
  for (const name of ['worktrees:tree', 'worktrees:adopt', 'worktrees:branchOf', 'guide:index', 'guide:read']) {
    assert.throws(() => app.handles.get(name)({ senderFrame: {} }, 'p1'), /Nicht erlaubt/, name);
  }

  const tree = await app.invoke('worktrees:tree', 'p1');
  assert.equal(tree.isGit, true);
  assert.equal(tree.trunk.name, 'main');
  const ext = tree.nodes.find((n) => n.branch === 'codex/x');
  assert.equal(ext.kind, 'external');
  assert.equal(ext.origin, 'codex');
  assert.ok(tree.nodes.some((n) => n.kind === 'project'));
  await assert.rejects(async () => app.invoke('worktrees:tree', 'nope'), /Projekt nicht gefunden/);

  assert.equal(await app.invoke('worktrees:branchOf', 'p1'), 'main');
  assert.equal(await app.invoke('worktrees:branchOf', 'p1', 'unknown-ws'), null);

  // adopt works from projectId alone: main.js hands the project path to the service.
  const adopted = await app.invoke('worktrees:adopt', 'p1', ext.path);
  assert.equal(adopted.ok, true, adopted.error);
  assert.equal(adopted.workspace.managed, false);
  const ws = adopted.workspace.workspaceId;
  assert.equal(await app.invoke('worktrees:branchOf', 'p1', ws), 'codex/x');
  // The cache is invalidated: the node is now linked, not external.
  const after = await app.invoke('worktrees:tree', 'p1');
  assert.equal(after.nodes.find((n) => n.branch === 'codex/x').kind, 'linked');
  assert.equal((await app.invoke('worktrees:adopt', 'p1', repo)).ok, false, 'project folder itself is refused');

  // Forgetting a linked record is blocked while a saved tile uses it.
  await app.invoke('session:save', { version: 1, activeProjectId: 'p1', projects: { p1: { terminals: [{ id: 't1', title: 'T', workspaceId: ws }] } } });
  const blocked = await app.invoke('worktrees:remove', ws);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Kachel/);
  await app.invoke('session:save', { version: 1, activeProjectId: 'p1', projects: { p1: { terminals: [] } } });
  const forgotten = await app.invoke('worktrees:remove', ws);
  assert.deepEqual(forgotten, { ok: true, forgotten: true });
  assert.ok(fs.existsSync(external), 'a linked folder is never deleted');
  assert.equal((await app.invoke('worktrees:tree', 'p1')).nodes.find((n) => n.branch === 'codex/x').kind, 'external');

  // Guide: synchronous index and slug-checked pages from docs/guide.
  const index = await app.invoke('guide:index');
  assert.ok(Array.isArray(index.pages) && index.pages.some((p) => p.slug === 'erste-schritte'));
  const page = await app.invoke('guide:read', 'erste-schritte');
  assert.equal(page.slug, 'erste-schritte');
  assert.match(page.markdown, /Erste Schritte/);
  for (const bad of ['../package', 'README', '', null, 42]) assert.equal(await app.invoke('guide:read', bad), null, String(bad));
  assert.deepEqual(app.errors, []);
});

test('menus carry the Stammbaum entry and a native help menu bound to the hotkeys', async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join('/private/tmp', 'mt-oss-menu-')));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir);
  const oldTmp = os.tmpdir;
  os.tmpdir = () => root;
  let app;
  t.after(async () => { try { await app?.stop(); } finally { os.tmpdir = oldTmp; fs.rmSync(root, { recursive: true, force: true }); } });
  app = await boot(dataDir);
  const menu = app.menu();
  const help = menu.find((m) => m.role === 'help');
  assert.ok(help, 'help menu present');
  assert.equal(help.submenu[0].label, 'Multiterminal-Hilfe');
  assert.equal(help.submenu[0].accelerator, process.platform === 'darwin' ? 'Cmd+Shift+H' : 'Ctrl+Alt+H');
  const features = menu.find((m) => m.label === 'Funktionen').submenu;
  const tree = features.find((i) => i.label === 'Arbeitskopien-Stammbaum…');
  assert.ok(tree, 'Stammbaum menu entry');
  assert.equal(tree.accelerator, process.platform === 'darwin' ? 'Cmd+Shift+Y' : 'Ctrl+Alt+Y');
});

test('package keeps docs/guide but leaves developer docs out', () => {
  const { IGNORE } = require('../scripts/build.js');
  const ignored = (p) => IGNORE.some((r) => r.test(p));
  for (const p of ['/docs', '/docs/guide', '/docs/guide/erste-schritte.md', '/src/main/guide-service.js', '/src/renderer/guide-markdown.js']) assert.equal(ignored(p), false, p);
  for (const p of ['/docs/dev', '/docs/dev/ipc-contract.md', '/docs/superpowers/plans/x.md', '/docs/guide-old/x.md']) assert.equal(ignored(p), true, p);
});
