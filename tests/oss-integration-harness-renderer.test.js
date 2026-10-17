'use strict';

// Integration (Etappe 3b), renderer side: page wiring of the harness panel, the settings
// section, the context-start dialog with catalog harnesses, and the app.js launch helpers.
// The full GUI path (two native Electron processes) is scripts/qa-harness.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createController } = require('../src/renderer/agent-launch.js');
const { createSessionStore } = require('../src/main/session-store');
const { sanitizeLaunch } = require('../src/main/launch-spec');

const dir = path.join(__dirname, '../src/renderer');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const settings = fs.readFileSync(path.join(dir, 'settings-panel.js'), 'utf8');
const pos = (needle) => { const i = html.indexOf(needle); assert.ok(i >= 0, 'missing in index.html: ' + needle); return i; };

test('index.html loads the harness panel and its stylesheet before app.js', () => {
  const s = (name) => pos(`<script src="${name}"></script>`);
  assert.ok(s('harness-panel.js') < s('app.js'));
  assert.ok(s('terminal-pane.js') < s('harness-panel.js'), 'D.h exists before the panel is created');
  pos('<link rel="stylesheet" href="harness.css">');
});

test('settings: app-wide section "Harnesses & Modelle" with its own help link; show() opens a section', () => {
  assert.match(settings, /harness: 'Harnesses & Modelle'/);
  assert.match(settings, /APP_WIDE = new Set\(\['hotkeys', 'memory', 'harness'\]\)/);
  assert.match(settings, /helpLink\('harnesses-modelle'\)/);
  assert.match(settings, /DeckHarnessPanel\.create\(\{ document, api: window\.deck, h, notify: D\.notify, guard: D\.guard \}\)/);
  assert.match(settings, /D\.settingsPanel = \{ init, toggle, show, isOpen/);
});

test('app.js: palette entry, menu action and both panel events are acknowledged', () => {
  assert.match(app, /\{ id: 'harness-settings', label: 'Harnesses & Modelle'/);
  assert.match(app, /case 'harness-settings': closeMenu\(\); showSettings\(true\); D\.settingsPanel\.show\('harness'\)/);
  assert.match(app, /addEventListener\('harness:quickstart', \(e\) => \{[\s\S]*?e\.preventDefault\(\);/);
  assert.match(app, /addEventListener\('harness:install-terminal', \(e\) => \{[\s\S]*?e\.preventDefault\(\);[\s\S]*?detail\.acceptTerminal\(pane\.id\)/);
});

test('presetLaunch keeps only the three public fields', () => {
  const start = app.indexOf('  function presetLaunch(');
  const end = app.indexOf('\n  }\n', start) + 4;
  const context = vm.createContext({});
  vm.runInContext(app.slice(start, end) + '\nthis.presetLaunch = presetLaunch;', context);
  assert.equal(context.presetLaunch({ id: 'claude', command: 'claude' }), null, 'built-in presets stay command presets');
  assert.deepEqual({ ...context.presetLaunch({ harnessId: 'opencode', model: 'p/m', endpointId: '', command: 'x', env: { A: 1 } }) }, { harnessId: 'opencode', model: 'p/m' });
});

test('launch-spec: whitelist with validation, unknown fields reject the whole value', () => {
  assert.deepEqual(sanitizeLaunch({ harnessId: 'claude', model: 'opus', endpointId: 'ep-1' }), { harnessId: 'claude', model: 'opus', endpointId: 'ep-1' });
  assert.deepEqual(sanitizeLaunch({ harnessId: 'claude', model: '', endpointId: null }), { harnessId: 'claude' });
  for (const bad of [null, [], 'claude', { harnessId: 'Claude' }, { harnessId: 'claude', model: "a'b" }, { harnessId: 'claude', endpointId: '../x' }, { harnessId: 'claude', command: 'claude' }]) {
    assert.equal(sanitizeLaunch(bad), null, JSON.stringify(bad));
  }
});

test('session store: launch replaces the stored line; old sessions load unchanged', () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mt-launch-session-'));
  try {
    const store = createSessionStore(root);
    const old = { version: 1, activeProjectId: 'p1', projects: { p1: { terminals: [{ id: 't1', title: 'Claude', presetId: 'claude', command: 'claude', resumeCommand: 'claude --continue', browserUrl: null, browserOpen: false, accounts: {} }] } } };
    const before = store.save(old);
    assert.deepEqual(before.projects.p1.terminals[0], { id: 't1', title: 'Claude', presetId: 'claude', command: 'claude', resumeCommand: 'claude --continue', browserUrl: null, browserOpen: false, accounts: {} });
    const saved = store.save({ version: 1, projects: { p1: { terminals: [
      { id: 't2', title: 'H', command: "(set +x; K=\"$(/usr/bin/security find-generic-password -w)\") claude", launch: { harnessId: 'claude', model: 'opus', secret: 'x' } },
      { id: 't3', title: 'H2', command: 'opencode', launch: { harnessId: 'opencode' } },
      { id: 't4', title: 'H3', launchInvalid: true, command: 'claude' },
    ] } } });
    const [t2, t3, t4] = saved.projects.p1.terminals;
    assert.equal(t2.launchInvalid, true, 'unknown field (secret) invalidates the launch');
    assert.equal(t2.command, null);
    assert.equal('launch' in t2, false);
    assert.deepEqual(t3.launch, { harnessId: 'opencode' });
    assert.equal(t3.command, null);
    assert.equal(t4.launchInvalid, true);
    assert.equal(t4.command, null);
    assert.equal(fs.readFileSync(path.join(root, 'session.json'), 'utf8').includes('security'), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function fixture({ entries, endpoints = [] } = {}) {
  const project = { id: 'p1', name: 'Projekt', path: '/projects/one' };
  const calls = { prepare: [] };
  const api = {
    worktrees: { async list() { return []; }, async create() { return { ok: false }; }, async inspect() { return { ok: true, exists: true }; } },
    launch: {
      async preview(args) { return { ok: true, text: 'Kontext', cwd: project.path, branch: 'main', head: 'abc', workspaceId: args.workspaceId, warnings: [] }; },
      async prepare(args) { calls.prepare.push(args); return { ok: true, command: 'cmd', workspaceId: null }; },
    },
  };
  if (entries) {
    api.harness = { async list() { return entries; } };
    api.endpoints = { async list() { return endpoints; } };
  }
  const controller = createController({ api, launch: async () => undefined });
  return { controller, calls, project };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('context start: Claude/Codex always; installed prompt-capable harnesses join; Kimi and unconfirmed never', async () => {
  const entries = [
    { id: 'claude', label: 'Claude Code', installed: true, canPrompt: true, evidence: 'local', endpointTypes: ['anthropic', 'ollama'] },
    { id: 'kimi', label: 'Kimi Code', installed: true, canPrompt: true, evidence: 'local', endpointTypes: [] },
    { id: 'opencode', label: 'OpenCode', installed: true, canPrompt: true, evidence: 'third-party', endpointTypes: [] },
    { id: 'gemini', label: 'Gemini CLI', installed: false, canPrompt: true, evidence: 'doc', endpointTypes: [] },
    { id: 'amp', label: 'Amp', installed: true, canPrompt: false, evidence: 'unconfirmed', endpointTypes: [] },
  ];
  const endpoints = [{ id: 'ep-1', label: 'DeepSeek', type: 'anthropic' }, { id: 'ep-2', label: 'OpenRouter', type: 'openai' }];
  const f = fixture({ entries, endpoints });
  await f.controller.open({ project: f.project });
  await tick(); await tick();
  assert.deepEqual(f.controller.getState().providers.map((p) => p.id), ['claude', 'codex', 'opencode']);
  assert.equal(f.controller.update('provider', 'kimi'), false);
  assert.equal(f.controller.update('provider', 'gemini'), false);
  assert.deepEqual(f.controller.endpointsFor('claude').map((e) => e.id), ['ep-1']);
  assert.equal(f.controller.update('endpointId', 'ep-2'), false, 'endpoint type must match the harness');
  assert.equal(f.controller.update('endpointId', 'ep-1'), true);
  assert.equal(f.controller.update('provider', 'opencode'), true);
  assert.equal(f.controller.getState().endpointId, '', 'incompatible endpoint is cleared on provider change');
  f.controller.update('model', 'p/m');
  f.controller.update('folder', 'project');
  f.controller.update('task', 'Auftrag');
  assert.equal(await f.controller.preview(), true);
  assert.equal(await f.controller.start(), true);
  assert.equal(f.calls.prepare[0].provider, 'opencode');
  assert.equal(f.calls.prepare[0].model, 'p/m');
  assert.equal('endpointId' in f.calls.prepare[0], false);
});

test('context start without harness API or extras keeps the original prepare request', async () => {
  for (const entries of [undefined, []]) {
    const f = fixture({ entries });
    await f.controller.open({ project: f.project });
    await tick();
    assert.deepEqual(f.controller.getState().providers.map((p) => p.id), ['claude', 'codex']);
    f.controller.update('provider', 'codex');
    f.controller.update('folder', 'project');
    f.controller.update('task', 'Auftrag');
    await f.controller.preview();
    await f.controller.start();
    assert.deepEqual(Object.keys(f.calls.prepare[0]).sort(), ['expectedBranch', 'expectedCwd', 'expectedHead', 'projectId', 'provider', 'text', 'workspaceId']);
  }
});
