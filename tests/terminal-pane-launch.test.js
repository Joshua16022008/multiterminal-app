'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

/* Harness tiles in D.createPane: start hands only the public launch to main, the chip shows
   main's public info, and Fortsetzen asks main to rebuild the line. Minimal fake browser. */
function fakeEl(tag) {
  const listeners = {}, classes = new Set();
  return {
    tag, children: [], dataset: {}, hidden: false, textContent: '', title: '', className: '', clientWidth: 0, clientHeight: 0,
    style: { setProperty() {}, removeProperty() {} },
    classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    append(...c) { this.children.push(...c); }, remove() {}, setAttribute() {},
    fire(t, e = {}) { const ev = { stopPropagation() {}, preventDefault() {}, ...e }; for (const fn of listeners[t] || []) fn(ev); },
  };
}
function Noop() { return { loadAddon() {}, attachCustomKeyEventHandler() {}, dispose() {}, onData() {}, onKey() {}, open() {}, write() {}, focus() {}, cols: 80, rows: 24 }; }

global.window = global.window || {};
global.document = { createElement: fakeEl, getElementById: () => null };
global.Terminal = function () { return Noop(); };
global.FitAddon = { FitAddon: function () { return { fit() {} }; } };
global.SerializeAddon = { SerializeAddon: function () { return {}; } };
global.WebLinksAddon = { WebLinksAddon: function () { return {}; } };
global.ResizeObserver = function () { return { observe() {}, disconnect() {} }; };
global.requestAnimationFrame = (fn) => fn();
window.DeckHotkeys = { isHotkeyEvent: () => false };
const calls = { create: [], runBuiltin: [] };
window.deck = {
  worktrees: { branchOf: async () => null, inspect: async () => ({ ok: true }) },
  session: { loadScrollback: async () => null },
  terminals: {
    create: async (options) => { calls.create.push(options); return { ok: true, launchInfo: options.launch ? { harnessLabel: 'OpenCode', model: 'p/m', endpointLabel: null } : undefined }; },
    runBuiltin: (id, command) => calls.runBuiltin.push([id, command]),
    write() {}, resize() {},
  },
};
require('../src/renderer/terminal-pane.js');
const D = window.DeckApp;
D.tileColor = () => ({ bg: '#000', head: '#111', edge: '#222' });
D.xtermTheme = {};
D.guard = async (fn) => { try { return await fn(); } catch (_) { return null; } };
D.notify = () => {};

const noop = () => {};
const hooks = (extra) => ({ onChange: noop, onActivate: noop, onClose: noop, onMaximize: noop, onStatus: noop, presetLabel: () => '', ...extra });
const tick = () => new Promise((r) => setImmediate(r));
const find = (pane, predicate) => pane.head.children.find((c) => c && predicate(c));

test('a harness quick start sends launch (no command) and shows main\'s public chip info', async () => {
  calls.create.length = 0;
  const desc = { id: 'h1', title: 'OpenCode', color: 0, presetId: 'x', command: null, launch: { harnessId: 'opencode', model: 'p/m' } };
  const pane = D.createPane(desc, { id: 'p1' }, hooks(), { restored: false, runCommand: true });
  pane.ensureStarted();
  await tick(); await tick();
  assert.equal(calls.create.length, 1);
  assert.deepEqual(calls.create[0].launch, { harnessId: 'opencode', model: 'p/m' });
  assert.equal(calls.create[0].command, null);
  assert.ok(find(pane, (c) => c.textContent === 'OpenCode · p/m' && !c.hidden), 'launch chip shows harness and model');
  pane.dispose();
});

test('a prepared context line is sent once as command, never written into desc', async () => {
  calls.create.length = 0;
  const desc = { id: 'h2', title: 'OpenCode', color: 0, command: null, launch: { harnessId: 'opencode' } };
  const pane = D.createPane(desc, { id: 'p1' }, hooks(), { restored: false, runCommand: true, command: "opencode --prompt 'x'" });
  pane.ensureStarted();
  await tick(); await tick();
  assert.equal(calls.create[0].command, "opencode --prompt 'x'");
  assert.equal('launch' in calls.create[0], false, 'main recognises the prepared line itself');
  assert.equal(desc.command, null);
  pane.dispose();
});

test('ordinary preset starts keep the original request shape', async () => {
  calls.create.length = 0;
  const pane = D.createPane({ id: 'h3', title: 'Claude', color: 0, presetId: 'claude', command: 'claude', resumeCommand: 'claude --continue' }, { id: 'p1' }, hooks(), { restored: false, runCommand: true });
  pane.ensureStarted();
  await tick(); await tick();
  assert.deepEqual(Object.keys(calls.create[0]).sort(), ['accountOverrides', 'cols', 'command', 'id', 'projectId', 'rows', 'workspaceId']);
  assert.equal(calls.create[0].command, 'claude');
  pane.dispose();
});

test('restored harness tile: Fortsetzen asks main to rebuild; an invalid launch offers no start', async () => {
  calls.create.length = 0; calls.runBuiltin.length = 0;
  const desc = { id: 'h4', title: 'Claude · DS', color: 0, command: null, launch: { harnessId: 'claude', endpointId: 'ep-1' }, nativeSession: null };
  const pane = D.createPane(desc, { id: 'p1' }, hooks({ launchInfo: async () => ({ harnessLabel: 'Claude Code', model: null, endpointLabel: 'DS' }), harnessCanResume: () => true }), { restored: true });
  await tick();
  const resume = find(pane, (c) => c.className === 'btn-resume');
  assert.equal(resume.hidden, false);
  assert.equal(resume.textContent, 'Fortsetzen');
  assert.ok(find(pane, (c) => c.textContent === 'Claude Code' && !c.hidden), 'restored chip from public labels');
  resume.fire('click');
  await tick(); await tick();
  assert.equal(calls.create.length, 1);
  assert.equal('launch' in calls.create[0], false, 'the shell starts plain; the agent line comes from main');
  assert.deepEqual(calls.runBuiltin, [['h4', { launch: { harnessId: 'claude', endpointId: 'ep-1' }, resume: true, nativeSession: null }]]);
  pane.dispose();

  const broken = D.createPane({ id: 'h5', title: 'Kaputt', color: 0, command: null, launchInvalid: true }, { id: 'p1' }, hooks(), { restored: true });
  await tick();
  assert.equal(find(broken, (c) => c.className === 'btn-resume').hidden, true);
  assert.ok(find(broken, (c) => c.textContent === 'Harness-Start ungültig' && !c.hidden));
  broken.dispose();
});
