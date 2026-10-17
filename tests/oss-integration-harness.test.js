'use strict';

// Integration (Etappe 3b), main side: harness catalog, endpoints, keychain lookup and the
// launch path of terminals:create. Electron, PTY, keychain and CLI detection are stand-ins;
// the catalog, endpoint store, start service, Memory and session store run for real.
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
const realKeychain = appRequire('./keychain');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SECRET = 'FAKE_KEY_" \\ with spaces_' + process.pid;

function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const file = path.join(dir, item.name);
    return item.isDirectory() ? filesIn(file) : item.isFile() ? [file] : [];
  });
}

async function boot(dataDir) {
  const handles = new Map(), listeners = new Map(), sent = [];
  const created = [], writes = [], keys = new Map();
  let win, stopped = false, menu = null;
  const app = new EventEmitter();
  Object.assign(app, { name: 'Harness integration test', requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), getPath: (key) => (key === 'userData' ? dataDir : process.execPath),
    quit: () => { stopped = true; } });
  class Window extends EventEmitter {
    constructor() {
      super(); win = this;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { mainFrame: {}, send: (...args) => sent.push(args), setWindowOpenHandler() {}, setIgnoreMenuShortcuts() {} });
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
    return { create: (options) => { created.push(options); return { ok: true }; }, write: (id, data) => writes.push([id, data]),
      resize() {}, snapshot: () => [], countFor: () => 0, kill() {}, killProject() {}, killAll() {} };
  } };
  const pmMain = { createPmMain: () => ({
    onPtyData: () => false, onPtyExit: () => false, withoutManagers: (x) => x,
    startBridge: async () => {}, shutdown: async () => {}, registerIpc() {},
    handleMenuAction: () => false, handleAgentEvent: () => false,
  }) };
  // RAM keychain: same lookup expression as production, no security process.
  const keychain = { createKeychain: () => ({
    async set(account, secret) { keys.set(account, secret); return true; },
    async has(account) { return keys.has(account); },
    async remove(account) { return keys.delete(account); },
    lookupExpression: (account) => realKeychain.createKeychain({ run: async () => ({ status: 0 }) }).lookupExpression(account),
  }) };
  // Detection without a login shell: claude, codex, kimi and opencode count as installed.
  const detect = { createHarnessDetect: ({ catalog }) => ({
    async detect(id) {
      const entries = id === undefined ? catalog.list() : [catalog.get(id)].filter(Boolean);
      return entries.map((e) => ({ id: e.id, installed: ['claude', 'codex', 'kimi', 'opencode'].includes(e.id), path: '/fake/bin/' + e.binary, version: null }));
    },
    async version() { return 'QA 1.0'; },
  }) };
  const stubs = { electron, './pty-manager': ptyManager, './pm-main': pmMain, './keychain': keychain, './harness-detect': detect };
  const errors = [];
  const context = {
    require: (name) => stubs[name] || appRequire(name),
    __dirname: path.dirname(mainPath), __filename: mainPath,
    console: { ...console, error: (...args) => errors.push(args.map(String).join(' ')) },
    process, Buffer, URL, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.compileFunction(fs.readFileSync(mainPath, 'utf8'), Object.keys(context), { filename: mainPath })(...Object.values(context));
  const until = Date.now() + 5000;
  while (!win || !handles.has('harness:list') || !menu) {
    if (Date.now() > until) throw new Error('Main handlers unavailable: ' + errors.join('\n'));
    await sleep(10);
  }
  const event = () => ({ senderFrame: win.webContents.mainFrame, sender: win.webContents });
  const invoke = (name, ...args) => {
    assert.ok(handles.has(name), 'missing IPC ' + name);
    return Promise.resolve(handles.get(name)(event(), ...args));
  };
  const send = (name, ...args) => listeners.get(name)(event(), ...args);
  return { invoke, send, handles, menu: () => menu, errors, created, writes, sent, keys,
    async stop() { if (stopped) return; listeners.get('app:quit-ready')(event()); await sleep(40); } };
}

async function setup(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join('/private/tmp', 'mt-harness-int-')));
  const dataDir = path.join(root, 'data'), home = path.join(root, 'home'), repo = path.join(root, 'repo');
  for (const dir of [dataDir, home, repo]) fs.mkdirSync(dir);
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'qa@example.com'); git('config', 'user.name', 'QA');
  fs.writeFileSync(path.join(repo, 'README.md'), '# QA\n'); git('add', '.'); git('commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(dataDir, 'projects.json'), JSON.stringify([{ id: 'p1', name: 'Repo', path: repo }]));
  const oldHome = os.homedir, oldTmp = os.tmpdir;
  os.homedir = () => home; os.tmpdir = () => root;
  const app = await boot(dataDir);
  t.after(async () => {
    try { await app.stop(); } finally { os.homedir = oldHome; os.tmpdir = oldTmp; fs.rmSync(root, { recursive: true, force: true }); }
  });
  return { app, root, dataDir, repo };
}

// Private Memory files carry a random name; everything else must match byte for byte.
const normalize = (line) => line.replace(/memory-contexts\/[0-9]+-[0-9a-f]+\.(md|agent\.md|toml-string)/g, 'memory-contexts/<file>.$1');
let counter = 0;
const tid = () => 'term-' + (++counter);

test('legacy starts stay byte-identical; launch without model/endpoint builds the same line', async (t) => {
  const { app } = await setup(t);
  for (const enabled of [false, true]) {
    await app.invoke('memory:setSettings', { enabled });
    for (const provider of ['claude', 'codex', 'kimi']) {
      const legacy = await app.invoke('terminals:create', { id: tid(), projectId: 'p1', cols: 80, rows: 24, command: provider });
      assert.equal(legacy.ok, true);
      assert.equal('launchInfo' in legacy, false, 'legacy result shape unchanged');
      const legacyLine = app.created.at(-1).command;
      if (!enabled) assert.equal(legacyLine, provider === 'codex' ? 'codex --dangerously-bypass-approvals-and-sandbox' : provider);
      else assert.match(legacyLine, /memory-contexts/);
      const viaLaunch = await app.invoke('terminals:create', { id: tid(), projectId: 'p1', cols: 80, rows: 24, command: null, launch: { harnessId: provider } });
      assert.equal(viaLaunch.ok, true, viaLaunch.error);
      assert.equal(normalize(app.created.at(-1).command), normalize(legacyLine), provider + ' memory=' + enabled);
      assert.deepEqual(viaLaunch.launchInfo, { harnessLabel: { claude: 'Claude Code', codex: 'Codex', kimi: 'Kimi Code' }[provider] || viaLaunch.launchInfo.harnessLabel, model: null, endpointLabel: null });
    }
  }
  // Custom commands are untouched by the harness path.
  await app.invoke('terminals:create', { id: tid(), projectId: 'p1', cols: 80, rows: 24, command: 'npm run dev' });
  assert.equal(app.created.at(-1).command, 'npm run dev');
});

test('endpoint start: keychain lookup only, isolated Claude config without account, nothing secret persisted', async (t) => {
  const { app, dataDir } = await setup(t);
  await app.invoke('memory:setSettings', { enabled: false });
  const endpoint = await app.invoke('endpoints:save', { label: 'QA DeepSeek', type: 'anthropic', baseUrl: 'https://qa.example.invalid/anthropic', defaultModel: 'qa-model' }, SECRET);
  assert.equal(endpoint.hasSecret, true);
  assert.equal(JSON.stringify(endpoint).includes('FAKE_KEY'), false);
  assert.equal(app.keys.get(endpoint.id), SECRET, 'secret went to the keychain');
  const listed = await app.invoke('endpoints:list');
  assert.equal(JSON.stringify(listed).includes('FAKE_KEY'), false);

  const id = tid();
  const result = await app.invoke('terminals:create', { id, projectId: 'p1', cols: 80, rows: 24, command: null, launch: { harnessId: 'claude', endpointId: endpoint.id } });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.launchInfo, { harnessLabel: 'Claude Code', model: 'qa-model', endpointLabel: 'QA DeepSeek' });
  assert.equal(result.accounts.some((a) => a.provider === 'claude'), false, 'no Claude account with an isolated endpoint');
  const pty = app.created.at(-1);
  assert.equal(pty.extraEnv.CLAUDE_CONFIG_DIR, null, 'account config dir is not applied');
  assert.equal(pty.extraEnv.MULTITERMINAL_USAGE_FILE, undefined);
  assert.match(pty.command, /^\(set \+x; ANTHROPIC_AUTH_TOKEN="\$\(\/usr\/bin\/security find-generic-password -s 'de\.multiterminal\.endpoint' -a 'ep-[0-9a-f-]+' -w\)"/);
  assert.ok(pty.command.includes("ANTHROPIC_BASE_URL='https://qa.example.invalid/anthropic'"));
  assert.ok(pty.command.includes("CLAUDE_CONFIG_DIR='" + path.join(dataDir, 'endpoint-configs', 'claude', endpoint.id) + "'"));
  assert.ok(pty.command.endsWith('claude --model qa-model)'));
  assert.equal(JSON.stringify(pty).includes('FAKE_KEY'), false, 'secret never in command or env');

  // Unknown endpoint: visible error, no fallback start.
  const before = app.created.length;
  const missing = await app.invoke('terminals:create', { id: tid(), projectId: 'p1', cols: 80, rows: 24, launch: { harnessId: 'claude', endpointId: 'ep-gone' } });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Endpunkt nicht gefunden/);
  assert.equal(app.created.length, before, 'no terminal without a valid start');
  const invalid = await app.invoke('terminals:create', { id: tid(), projectId: 'p1', cols: 80, rows: 24, launch: { harnessId: 'claude', command: 'rm -rf /' } });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /Ungültige Harness-Startvorgabe/);

  // Resume through runBuiltin: line rebuilt in main with --continue.
  app.send('terminals:runBuiltin', id, { launch: { harnessId: 'claude', endpointId: endpoint.id }, resume: true, nativeSession: null });
  await sleep(50);
  const [writtenId, line] = app.writes.at(-1);
  assert.equal(writtenId, id);
  assert.ok(line.endsWith('claude --continue --model qa-model)\r'));
  app.send('terminals:runBuiltin', id, { launch: { harnessId: 'nope' }, resume: true });
  await sleep(50);
  assert.equal(app.writes.at(-1)[1], line, 'unknown harness writes nothing');
  assert.ok(app.sent.some(([channel, tile, text]) => channel === 'terminals:data' && tile === id && /Harness konnte nicht gestartet werden/.test(text)));

  // session.json: only the public launch whitelist; the line, lookup and URL never land there.
  await app.invoke('session:save', { version: 1, activeProjectId: 'p1', projects: { p1: { terminals: [
    { id, title: 'Claude · QA', command: pty.command, resumeCommand: 'x', launch: { harnessId: 'claude', endpointId: endpoint.id, model: 'qa-model' } },
    { id: 'bad', title: 'Kaputt', command: 'claude', launch: { harnessId: 'claude', env: { A: '1' } } },
    { id: 'old', title: 'Alt', presetId: 'claude', command: 'claude', resumeCommand: 'claude --continue' },
  ] } } });
  const text = fs.readFileSync(path.join(dataDir, 'session', 'session.json'), 'utf8');
  for (const needle of ['find-generic-password', 'ANTHROPIC_', 'qa.example.invalid', 'FAKE_KEY', '"env"']) assert.equal(text.includes(needle), false, needle);
  const saved = JSON.parse(text).projects.p1.terminals;
  assert.deepEqual(saved[0].launch, { harnessId: 'claude', model: 'qa-model', endpointId: endpoint.id });
  assert.equal(saved[0].command, null);
  assert.equal(saved[0].resumeCommand, null);
  assert.equal(saved[1].launchInvalid, true);
  assert.equal(saved[1].command, null, 'invalid launch never falls back to a stored line');
  assert.equal('launch' in saved[1], false);
  assert.equal(saved[2].command, 'claude', 'legacy tiles keep their command');
  assert.equal('launch' in saved[2] || 'launchInvalid' in saved[2], false);

  for (const file of filesIn(dataDir)) assert.equal(fs.readFileSync(file).includes(Buffer.from('FAKE_KEY')), false, 'secret persisted in ' + path.relative(dataDir, file));
  assert.equal(await app.invoke('endpoints:remove', endpoint.id), true);
  assert.equal(app.keys.has(endpoint.id), false, 'removing the endpoint removes its key');
});

test('harness IPC: views without secrets, guarded channels, install hint typed without Enter', async (t) => {
  const { app } = await setup(t);
  for (const name of ['harness:list', 'harness:detect', 'harness:models', 'harness:addOwn', 'harness:removeOwn', 'harness:export', 'harness:typeInstall', 'endpoints:list', 'endpoints:save', 'endpoints:remove', 'endpoints:templates']) {
    assert.throws(() => app.handles.get(name)({ senderFrame: {} }), /Nicht erlaubt/, name);
  }
  const list = await app.invoke('harness:list');
  const claude = list.find((e) => e.id === 'claude'), opencode = list.find((e) => e.id === 'opencode'), amp = list.find((e) => e.id === 'amp');
  assert.deepEqual(Object.keys(claude).sort(), ['accounts', 'builtin', 'canPrompt', 'canResume', 'defaultModel', 'docsUrl', 'endpointTypes', 'evidence', 'id', 'install', 'installed', 'kind', 'label', 'path', 'supportsHooks'].sort());
  assert.equal(claude.installed, true);
  assert.deepEqual(claude.endpointTypes, ['anthropic', 'ollama']);
  assert.equal(opencode.canPrompt, true);
  assert.equal(amp.evidence, 'unconfirmed');
  assert.equal(amp.canPrompt, false);
  const [detected] = await app.invoke('harness:detect', 'claude');
  assert.equal(detected.version, 'QA 1.0');
  await assert.rejects(async () => app.invoke('harness:detect', '../x'), /Ungültige Harness-ID/);

  const id = tid();
  await app.invoke('terminals:create', { id, projectId: 'p1', cols: 80, rows: 24, command: null });
  assert.equal(await app.invoke('harness:typeInstall', 'opencode', id), true);
  const [tile, typed] = app.writes.at(-1);
  assert.equal(tile, id);
  assert.equal(typed, 'curl -fsSL https://opencode.ai/install | bash');
  assert.equal(/[\r\n]/.test(typed), false, 'never Enter');
  await assert.rejects(async () => app.invoke('harness:typeInstall', 'opencode', 'unknown-terminal'), /Terminal nicht gefunden/);
  assert.equal(await app.invoke('harness:typeInstall', 'aider', id), false, 'manual hints are never typed');

  assert.equal((await app.invoke('endpoints:templates')).length, 5);
  assert.match(await app.invoke('harness:export', 'opencode'), /"id": "opencode"/);
  // Menu: "Harnesses & Modelle…" under Funktionen sends the settings action.
  const functions = app.menu().find((item) => item.label === 'Funktionen');
  assert.ok(functions.submenu.some((item) => item.label === 'Harnesses & Modelle…'));
});

test('presets keep the built-ins and store harness quick starts without any command', async (t) => {
  const { app, dataDir } = await setup(t);
  const { DEFAULT_PRESETS } = appRequire('./presets');
  const before = await app.invoke('presets:list');
  assert.deepEqual(before, DEFAULT_PRESETS.map((p) => ({ ...p })));
  const pr = await app.invoke('presets:add', { label: 'OpenCode · p/m', harnessId: 'opencode', model: 'p/m' });
  assert.deepEqual({ ...pr, id: 'x' }, { id: 'x', label: 'OpenCode · p/m', command: null, resumeCommand: null, builtin: false, harnessId: 'opencode', model: 'p/m' });
  await assert.rejects(async () => app.invoke('presets:add', { label: 'X', harnessId: 'does-not-exist' }), /Unbekanntes Harness/);
  await assert.rejects(async () => app.invoke('presets:add', { label: 'X', harnessId: 'claude', model: "a'b" }), /ungültig/);
  await assert.rejects(async () => app.invoke('presets:add', { label: 'X', harnessId: 'claude', command: 'claude' }), /keinen eigenen Befehl/);
  const custom = await app.invoke('presets:add', { label: 'Dev', command: 'npm run dev' });
  assert.deepEqual(Object.keys(custom).sort(), ['builtin', 'command', 'id', 'label', 'resumeCommand']);
  const after = await app.invoke('presets:list');
  assert.deepEqual(after.slice(0, 3), before);
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'presets.json'), 'utf8'));
  assert.equal(stored.length, 2);
  assert.equal(stored[0].command, null);
});

test('context start with a catalog harness: built once, not decorated again, one-time only', async (t) => {
  const { app, repo } = await setup(t);
  await app.invoke('memory:setSettings', { enabled: false });
  const preview = await app.invoke('launch:preview', { projectId: 'p1', workspaceId: null, task: 'QA-Auftrag' });
  assert.equal(preview.ok, true, preview.error);
  const base = { projectId: 'p1', workspaceId: null, text: preview.text, expectedHead: preview.head, expectedCwd: preview.cwd, expectedBranch: preview.branch };
  const kimi = await app.invoke('launch:prepare', { ...base, provider: 'kimi' });
  assert.equal(kimi.ok, false);
  const amp = await app.invoke('launch:prepare', { ...base, provider: 'amp' });
  assert.equal(amp.ok, false, 'unconfirmed harness gets no prompt');
  // Claude/Codex without model or endpoint: the original command, no launch fields.
  const legacy = await app.invoke('launch:prepare', { ...base, provider: 'claude' });
  assert.equal(legacy.ok, true, legacy.error);
  assert.equal('launch' in legacy || 'launchInfo' in legacy || 'launchMeta' in legacy, false);
  assert.match(legacy.command, /^claude 'Lies zuerst die Auftragsdatei /);

  const prepared = await app.invoke('launch:prepare', { ...base, provider: 'opencode', model: 'p/m' });
  assert.equal(prepared.ok, true, prepared.error);
  assert.deepEqual(prepared.launch, { harnessId: 'opencode', model: 'p/m' });
  assert.equal('launchMeta' in prepared, false, 'internal metadata stays in main');
  assert.deepEqual(prepared.launchInfo, { harnessLabel: 'OpenCode', model: 'p/m', endpointLabel: null });
  assert.match(prepared.command, /^opencode -m p\/m --prompt 'Lies zuerst die Auftragsdatei .+launch-contexts\/.+\.md vollständig/);
  const first = await app.invoke('terminals:create', { id: tid(), projectId: 'p1', cols: 80, rows: 24, command: prepared.command });
  assert.equal(first.ok, true);
  assert.equal(app.created.at(-1).command, prepared.command, 'not decorated a second time');
  assert.equal(app.created.at(-1).cwd, repo);
  assert.equal(first.launchInfo.harnessLabel, 'OpenCode');
  const second = await app.invoke('terminals:create', { id: tid(), projectId: 'p1', cols: 80, rows: 24, command: prepared.command });
  assert.equal('launchInfo' in second, false, 'the prepared start is used once');
});
