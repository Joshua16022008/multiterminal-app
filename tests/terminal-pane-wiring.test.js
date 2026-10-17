'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

/* Smoke test for the branch-chip wiring inside D.createPane, with just enough fake browser to build a tile. */
function fakeEl(tag) {
  const listeners = {}, classes = new Set();
  const el = {
    tag, children: [], dataset: {}, hidden: false, textContent: '', title: '', className: '', clientWidth: 0, clientHeight: 0,
    style: { setProperty() {}, removeProperty() {} },
    classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    append(...c) { this.children.push(...c); }, remove() {}, setAttribute() {},
    fire(t, e = {}) { const ev = { stopPropagation() {}, preventDefault() {}, ...e }; for (const fn of listeners[t] || []) fn(ev); },
  };
  return el;
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
window.deck = { worktrees: { branchOf: async () => { branchReads++; return 'main'; }, inspect: async () => ({ ok: true }) } };
let branchReads = 0;
require('../src/renderer/terminal-pane.js');
const D = window.DeckApp;
D.tileColor = () => ({ bg: '#000', head: '#111', edge: '#222' });
D.xtermTheme = {};
D.guard = async (fn) => { try { return await fn(); } catch (_) { return null; } };

function build(hooks) {
  const noop = () => {};
  return D.createPane({ id: 't1', title: 'T', color: 0 }, { id: 'p1' }, { onChange: noop, onActivate: noop, onClose: noop, onMaximize: noop, onStatus: noop, ...hooks }, {});
}
const tick = () => new Promise((r) => setImmediate(r));

test('branch chip click calls hooks.onBranchClick with the pane itself', async () => {
  const seen = [];
  const pane = build({ onBranchClick: (p) => seen.push(p) });
  await tick();
  const head = pane.head;
  const chip = head.children.find((c) => c.classList && c.classList.contains('clickable'));
  assert.ok(chip, 'branch chip is part of the tile head');
  chip.fire('click');
  assert.deepEqual(seen, [pane]);
  pane.dispose();
});

test('setActive(true) triggers a throttled branch refresh; setLaunchInfo is exposed; dispose stops the chip', async () => {
  const pane = build({});
  await tick();
  const initial = branchReads;
  assert.ok(initial >= 1, 'created with a forced first read');
  pane.setActive(true);
  await tick();
  assert.equal(branchReads, initial, 'within the throttle window no second read');
  assert.equal(typeof pane.setLaunchInfo, 'function');
  pane.setLaunchInfo({ harnessLabel: 'Claude Code', model: 'opus' });
  const launch = pane.head.children.find((c) => c.textContent === 'Claude Code · opus');
  assert.ok(launch && launch.hidden === false);
  pane.setLaunchInfo(null);
  assert.equal(launch.hidden, true);
  pane.dispose();
  const after = branchReads;
  await pane.refreshBranch(true);
  assert.equal(branchReads, after, 'disposed chip no longer reads');
});
