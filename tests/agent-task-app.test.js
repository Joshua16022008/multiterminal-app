'use strict';
// Actual main/IPC, authenticated copied CLI, task persistence and real Git
// worktree/context services. Electron and PTYs are stand-ins; no model is run.
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
  const handles = new Map(), listeners = new Map(), live = new Map(), messages = [], errors = [];
  let win, stopped = false;
  const app = new EventEmitter();
  Object.assign(app, { name: 'Task wiring test', requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), getPath: key => key === 'userData' ? dataDir : process.execPath,
    quit: () => { stopped = true; } });
  class Window extends EventEmitter {
    constructor() { super(); win = this; this.webContents = new EventEmitter();
      Object.assign(this.webContents, { mainFrame: {}, send: (channel, value) => messages.push({ channel, value }), setWindowOpenHandler() {}, setIgnoreMenuShortcuts() {} }); }
    loadFile() {} isDestroyed() { return false; } isFocused() { return false; } isMinimized() { return false; }
    destroy() {} showInactive() {} moveTop() {} static getFocusedWindow() { return win; }
  }
  const electron = { app, BrowserWindow: Window, Menu: { buildFromTemplate: items => ({ items }), setApplicationMenu() {} },
    Notification: { isSupported: () => false }, dialog: {}, ipcMain: { handle: (name, fn) => handles.set(name, fn), on: (name, fn) => listeners.set(name, fn) },
    session: { fromPartition: () => ({ setPermissionRequestHandler() {} }) }, shell: { beep() {} }, webContents: {}, clipboard: {}, nativeImage: {} };
  const ptyManager = { createPtyManager(callbacks) { return {
    create(options) { if (live.has(options.id)) return { ok: false, error: 'duplicate' }; live.set(options.id, options); return { ok: true }; },
    write(id, value) { const term = live.get(id); if (term) term.written = (term.written || '') + value; }, resize() {},
    snapshot: () => [...live.values()].map(item => ({ ...item, terminalId: item.id })),
    countFor: pid => [...live.values()].filter(item => item.projectId === pid).length,
    kill(id) { live.delete(id); callbacks.onExit(id, 0); },
    killAll() { for (const id of [...live.keys()]) this.kill(id); },
  }; } };
  const pmMain = { createPmMain: () => ({ onPtyData: () => false, onPtyExit: () => false, withoutManagers: list => list,
    startBridge: async () => {}, shutdown: async () => {}, registerIpc() {}, handleMenuAction: () => false, handleAgentEvent: () => false }) };
  const bindings = { require: name => name === 'electron' ? electron : name === './pty-manager' ? ptyManager : name === './pm-main' ? pmMain : appRequire(name),
    __dirname: path.dirname(mainPath), __filename: mainPath, console: { ...console, error: (...args) => errors.push(args.map(String).join(' ')) },
    process, Buffer, URL, setTimeout, clearTimeout, setInterval, clearInterval };
  vm.compileFunction(fs.readFileSync(mainPath, 'utf8'), Object.keys(bindings), { filename: mainPath })(...Object.values(bindings));
  const end = Date.now() + 5000;
  while (!win || !handles.has('agentTasks:snapshot')) {
    if (Date.now() > end) throw new Error('Main task handlers unavailable: ' + errors.join('\n'));
    await sleep(10);
  }
  const event = () => ({ senderFrame: win.webContents.mainFrame, sender: win.webContents });
  return { live, messages, errors, handles,
    invoke: (name, ...args) => Promise.resolve().then(() => handles.get(name)(event(), ...args)),
    send: (name, ...args) => listeners.get(name)(event(), ...args),
    async stop() { if (stopped) return; listeners.get('app:quit-ready')(event()); await sleep(40); },
  };
}

test('actual Main/socket/CLI delegates, starts isolated worker and returns explicit results', async t => {
  const root = fs.mkdtempSync('/private/tmp/mt-task-app-'), data = path.join(root, 'data'), repo = path.join(root, 'repo'), home = path.join(root, 'home');
  for (const dir of [data, repo, home]) fs.mkdirSync(dir);
  const originalHome = os.homedir, originalTmp = os.tmpdir;
  os.homedir = () => home; os.tmpdir = () => root;
  let app;
  t.after(async () => { if (app) await app.stop(); os.homedir = originalHome; os.tmpdir = originalTmp; fs.rmSync(root, { recursive: true, force: true }); });
  const git = (...args) => execute('git', args, { cwd: repo });
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Task Test'); await git('config', 'user.email', 'task-test@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), 'Fixture project\n'); await git('add', 'README.md'); await git('commit', '-m', 'fixture');
  fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'p', name: 'Project', path: repo }, { id: 'other', name: 'Other', path: home }]));
  app = await boot(data);
  const start = (id, provider, projectId = 'p') => app.invoke('terminals:create', { id, projectId, command: provider, cols: 80, rows: 24 });
  assert.equal((await start('source', 'claude')).ok, true); assert.equal((await start('target', 'codex')).ok, true);
  assert.equal((await start('outsider', 'codex', 'other')).ok, true);
  const harness = await app.invoke('terminals:create', { id: 'harness-source', projectId: 'p', launch: { harnessId: 'claude', model: 'sonnet' }, cols: 80, rows: 24 });
  assert.equal(harness.ok, true, 'catalog starts remain available alongside agent tasks');
  assert.equal(harness.launchInfo.harnessLabel, 'Claude Code');
  assert.match(app.live.get('harness-source').command, /--model.*sonnet/);
  const cli = async (id, args) => {
    const term = app.live.get(id);
    const result = await execute(process.execPath, [path.join(data, 'mt-agent-cli.js'), ...args, '--json'], { env: { ...process.env, ...term.extraEnv }, timeout: 12000 });
    return JSON.parse(result.stdout);
  };
  await assert.rejects(cli('source', ['send', '--to', 'target', '--title', 'Test', '--text', 'Inspect this']), /freigabe/i);
  await app.invoke('agentTasks:grant', 'p', 'source', { enabled: true, allowNew: true, maxNewWorkers: 2 });
  const task = await cli('source', ['send', '--to', 'target', '--title', 'Check', '--text', 'Inspect and report actual tests.']);
  assert.equal(task.status, 'queued');
  assert.equal((await cli('target', ['inbox']))[0].id, task.id);
  await cli('target', ['accept', task.id]);
  await cli('target', ['reply', task.id, '--status', 'completed', '--text', 'Inspected; tests green.']);
  assert.equal((await cli('source', ['task', task.id])).result.text, 'Inspected; tests green.');
  await assert.rejects(cli('outsider', ['task', task.id]), /nicht gefunden/);
  assert.equal(app.live.get('target').written, undefined, 'never types into existing agent input');
  const worker = await cli('source', ['spawn', '--provider', 'codex', '--title', 'Worker', '--text', 'Verify isolated working copy.']);
  const end = Date.now() + 12000;
  while (!app.messages.some(message => message.channel === 'agentTasks:launch' && message.value.taskId === worker.id)) {
    if (Date.now() > end) throw new Error('worker not prepared: ' + JSON.stringify(await app.invoke('agentTasks:snapshot', 'p')));
    await sleep(20);
  }
  const request = app.messages.find(message => message.channel === 'agentTasks:launch' && message.value.taskId === worker.id).value;
  const override = await app.invoke('terminals:create', { id: request.terminalId, projectId: 'p', command: request.command, workspaceId: request.workspaceId, launch: { harnessId: 'claude' } });
  assert.equal(override.ok, false, 'catalog launch cannot replace an authorized task command');
  assert.equal(app.live.has(request.terminalId), false);
  const bad = await app.invoke('terminals:create', { id: request.terminalId, projectId: 'p', command: 'arbitrary', workspaceId: request.workspaceId });
  assert.equal(bad.ok, false, 'renderer cannot replace prepared command');
  const result = await app.invoke('terminals:create', { id: request.terminalId, projectId: 'p', command: request.command, workspaceId: request.workspaceId, cols: 80, rows: 24 });
  assert.equal(result.ok, true);
  const launched = app.live.get(request.terminalId);
  assert.notEqual(launched.cwd, repo);
  assert.ok(launched.command.includes('--dangerously-bypass-approvals-and-sandbox'), 'existing Codex permissions preserved');
  const contextFiles = fs.readdirSync(path.join(data, 'launch-contexts'));
  assert.ok(contextFiles.some(file => fs.readFileSync(path.join(data, 'launch-contexts', file), 'utf8').includes(`mt-agent accept ${worker.id}`)));
  assert.equal((await app.invoke('agentTasks:snapshot', 'p')).tasks.find(item => item.id === worker.id).status, 'queued', 'process launch is not acceptance');
  await cli(request.terminalId, ['accept', worker.id]);
  await cli(request.terminalId, ['reply', worker.id, '--status', 'completed', '--text', 'Real socket result from fixture worker.']);
  assert.equal((await cli('source', ['wait', worker.id, '--timeout', '1'])).status, 'completed');
  const raw = 'echo UNCHANGED_RAW_INPUT\r';
  app.send('terminals:write', 'source', raw);
  assert.equal(app.live.get('source').written, raw, 'raw input still bypasses task dispatch unchanged');
  await app.stop(); app = await boot(data);
  const persisted = await app.invoke('agentTasks:snapshot', 'p');
  assert.equal(persisted.grants.source.enabled, false, 'restart requires new user grant');
  assert.equal(persisted.tasks.find(item => item.id === worker.id).result.text, 'Real socket result from fixture worker.');
  assert.equal(app.messages.filter(message => message.channel === 'agentTasks:launch').length, 0, 'restart never replays a worker');
  const replay = await app.invoke('terminals:create', { id: request.terminalId, projectId: 'p', workspaceId: request.workspaceId, launch: { harnessId: 'claude' } });
  assert.equal(replay.ok, false, 'restored task identity cannot replay through the catalog route');
  const file = path.join(data, 'agent-tasks/tasks.json');
  assert.equal((await start('runtime-ordinary', 'claude')).ok, true);
  fs.writeFileSync(file, 'damaged while running');
  await assert.rejects(app.invoke('agentTasks:snapshot', 'p'));
  assert.equal((await start('runtime-next', 'codex')).ok, true, 'runtime task damage preserves ordinary creation');
  await app.invoke('terminals:kill', 'runtime-ordinary');
  assert.equal(app.live.has('runtime-ordinary'), false, 'runtime task damage preserves terminal cleanup and kill');
  assert.equal(fs.readFileSync(file, 'utf8'), 'damaged while running');
  await app.stop();
  fs.writeFileSync(file, 'broken task store');
  app = await boot(data);
  await assert.rejects(app.invoke('agentTasks:snapshot', 'p'), /Agentenaufgaben nicht verfügbar/);
  assert.equal((await start('ordinary', 'claude')).ok, true, 'damaged optional task store preserves ordinary terminals');
  assert.equal(fs.readFileSync(file, 'utf8'), 'broken task store', 'no silent reset of damaged data');
});
