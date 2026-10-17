'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// terminal-pane.js is a browser IIFE; the chip helpers need nothing but the DeckApp namespace.
global.window = global.window || {};
require('../src/renderer/terminal-pane.js');
const D = global.window.DeckApp;

function fakeEl(tag, props = {}, ...kids) {
  const listeners = {}, classes = new Set(String(props.class || '').split(' ').filter(Boolean)), style = {};
  const el = {
    tag, hidden: !!props.hidden, textContent: props.text || '', title: props.title || '', children: kids.flat().filter(Boolean),
    style: { setProperty: (k, v) => { style[k] = v; }, removeProperty: (k) => { delete style[k]; }, vars: style },
    classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    fire(t, e = {}) { const ev = { stopPropagation() { ev.stopped = true; }, preventDefault() { ev.prevented = true; }, ...e }; for (const fn of listeners[t] || []) fn(ev); return ev; },
  };
  return el;
}
const tick = () => new Promise((r) => setImmediate(r));

function setup({ desc = {}, api = {}, onClick, now } = {}) {
  const calls = [];
  const fullApi = { worktrees: {
    branchOf: async (...a) => { calls.push(['branchOf', ...a]); return 'main'; },
    inspect: async (...a) => { calls.push(['inspect', ...a]); return { ok: true, exists: true, branch: 'feature/x', changes: 0, worktree: { branch: 'feature/x', cwd: '/w/x' } }; },
    ...api.worktrees,
  } };
  let t = 1000;
  const chip = D.createBranchChip({ h: fakeEl, api: fullApi, desc, project: { id: 'p1' }, onClick,
    colorFor: (b) => (b === 'feature/x' ? '#112233' : '#445566'), now: now || (() => t), throttleMs: 4000 });
  return { chip, calls, advance: (ms) => { t += ms; } };
}

test('shortBranch cuts from the left and keeps the tail', () => {
  assert.equal(D.shortBranch('main'), 'main');
  const s = D.shortBranch('feature/very-long-branch-name-here', 12);
  assert.equal(s.length, 12);
  assert.ok(s.startsWith('…') && s.endsWith('name-here'));
});

test('project-folder tile: dimmed trunk chip with the branch from branchOf', async () => {
  const s = setup();
  await s.chip.refresh(true); await tick();
  assert.equal(s.chip.el.hidden, false);
  assert.equal(s.chip.el.children[0].textContent, '⑂ main');
  assert.ok(s.chip.el.classList.contains('trunk'));
  assert.equal(s.chip.el.style.vars['--wt-color'], undefined);
  assert.deepEqual(s.calls[0], ['branchOf', 'p1']);
  assert.match(s.chip.el.title, /Projektordner, Branch main/);
});

test('project folder without a repository or a branch keeps the chip hidden', async () => {
  const s = setup({ api: { worktrees: { branchOf: async () => null } } });
  await s.chip.refresh(true);
  assert.equal(s.chip.el.hidden, true);
});

test('workspace tile: branch colour, change dot and the old title information stay', async () => {
  const s = setup({ desc: { workspaceId: 'w1' }, api: { worktrees: { inspect: async () => ({ ok: true, exists: true, branch: 'feature/x', changes: 3, worktree: { branch: 'feature/x', cwd: '/w/x' } }) } } });
  const first = s.chip.refresh(true);
  assert.equal(s.chip.el.children[0].textContent, '⑂ …'); // visible while loading, as before
  await first;
  assert.equal(s.chip.el.children[0].textContent, '⑂ feature/x');
  assert.equal(s.chip.el.style.vars['--wt-color'], '#112233');
  assert.equal(s.chip.el.children[1].hidden, false); // dirty dot
  assert.match(s.chip.el.title, /Arbeitskopie feature\/x: \/w\/x – 3 Änderungen/);
  assert.ok(!s.chip.el.classList.contains('trunk'));
});

test('missing folder and unreadable record are flagged bad', async () => {
  let s = setup({ desc: { workspaceId: 'w1' }, api: { worktrees: { inspect: async () => ({ ok: true, exists: false, branch: 'gone', changes: 0, worktree: { branch: 'gone', cwd: '/w/g' } }) } } });
  await s.chip.refresh(true);
  assert.equal(s.chip.el.children[0].textContent, '⑂ gone (fehlt)');
  assert.ok(s.chip.el.classList.contains('bad'));
  s = setup({ desc: { workspaceId: 'w1' }, api: { worktrees: { inspect: async () => ({ ok: false }) } } });
  await s.chip.refresh(true);
  assert.equal(s.chip.el.children[0].textContent, '⑂ unbekannt');
  assert.ok(s.chip.el.classList.contains('bad'));
  s = setup({ desc: { workspaceId: 'w1' }, api: { worktrees: { inspect: async () => { throw new Error('x'); } } } });
  await s.chip.refresh(true);
  assert.equal(s.chip.el.children[0].textContent, '⑂ unbekannt');
});

test('refresh is throttled unless forced, and a checkout shows up afterwards', async () => {
  let branch = 'main';
  const s = setup({ api: { worktrees: { branchOf: async () => branch } } });
  await s.chip.refresh(); // first call always reads
  branch = 'dev';
  await s.chip.refresh(); // within the throttle window
  assert.equal(s.chip.el.children[0].textContent, '⑂ main');
  s.advance(5000);
  await s.chip.refresh();
  assert.equal(s.chip.el.children[0].textContent, '⑂ dev');
  branch = 'topic';
  await s.chip.refresh(true);
  assert.equal(s.chip.el.children[0].textContent, '⑂ topic');
});

test('click opens the tree without bubbling; a drag never starts from the chip', async () => {
  let clicks = 0;
  const s = setup({ onClick: () => { clicks++; } });
  await s.chip.refresh(true);
  const ev = s.chip.el.fire('click');
  assert.equal(clicks, 1); assert.ok(ev.stopped);
  const drag = s.chip.el.fire('dragstart');
  assert.ok(drag.prevented && drag.stopped);
  s.chip.el.fire('keydown', { key: 'Enter' });
  assert.equal(clicks, 2);
  assert.ok(s.chip.el.classList.contains('clickable'));
});

test('a stale answer after dispose is ignored', async () => {
  let release;
  const s = setup({ api: { worktrees: { branchOf: () => new Promise((r) => { release = r; }) } } });
  const p = s.chip.refresh(true);
  s.chip.dispose();
  release('main');
  await p;
  assert.equal(s.chip.el.hidden, true);
});

test('launch chip slot: set shows harness and model, null hides', () => {
  const s = setup();
  assert.equal(s.chip.launchEl.hidden, true);
  s.chip.setLaunchInfo({ harnessLabel: 'Claude Code', model: 'opus', endpointLabel: 'DeepSeek' });
  assert.equal(s.chip.launchEl.hidden, false);
  assert.equal(s.chip.launchEl.textContent, 'Claude Code · opus');
  assert.match(s.chip.launchEl.title, /Endpunkt: DeepSeek/);
  s.chip.setLaunchInfo({ endpointLabel: 'Ollama' });
  assert.equal(s.chip.launchEl.textContent, 'Ollama');
  s.chip.setLaunchInfo(null);
  assert.equal(s.chip.launchEl.hidden, true);
});
