'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPortsPanel } = require('../src/renderer/ports-panel');

function h(tag, props = {}, ...children) {
  return { tag, ...props, children: children.flat().filter(Boolean), hidden: false,
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
  };
}
const all = el => [el, ...el.children.flatMap(all)];
const text = root => all(root).map(e => e.text || '').join('\n');
const button = (root, label) => all(root).find(e => e.tag === 'button' && e.text === label);
const tick = () => new Promise(resolve => setImmediate(resolve));
const entry = { id: 'tcp:123:127.0.0.1:3000', pid: 123, process: 'node', host: '127.0.0.1',
  port: 3000, url: 'http://127.0.0.1:3000', terminalId: 'one', projectId: 'p1', cwd: '/project one' };

function setup(overrides = {}) {
  const root = h('aside'), timers = new Map(), calls = [], jumps = [], browsers = [];
  let id = 0;
  const api = { async list() { calls.push('list'); return { ok: true, entries: [entry], capturedAt: Date.now() }; },
    async resolve(value) { calls.push(value); return { ok: true, entry }; }, ...overrides.api };
  const panel = createPortsPanel({ root, h, api, getLabel: e => e.terminalId ? 'Projekt 1 · Terminal 1' : null,
    onJump: e => jumps.push(e), onBrowser: e => browsers.push(e), onClose: () => panel.toggle(false),
    schedule(fn) { timers.set(++id, fn); return id; }, cancel(key) { timers.delete(key); },
    ...overrides, api });
  return { panel, root, timers, calls, jumps, browsers };
}

test('ports panel shows assigned and unknown processes without guessing an owner', async () => {
  const s = setup({ api: { async list() { return { ok: true, entries: [entry, { ...entry, id: 'foreign', terminalId: null, projectId: null, process: '<img src=x>' }], capturedAt: Date.now() }; } } });
  s.panel.toggle(true); await tick();
  assert.match(text(s.root), /Projekt 1 · Terminal 1/);
  assert.match(text(s.root), /Nicht zugeordnet/);
  assert.match(text(s.root), /<img src=x>/); // text-only rendering, no HTML API
  const actions = all(s.root).filter(e => e.tag === 'button' && e.text === 'Zum Terminal');
  assert.equal(actions[0].disabled, false); assert.equal(actions[1].disabled, true);
});

test('jump and browser actions resolve the live listener again before selecting a target', async () => {
  const s = setup(); s.panel.toggle(true); await tick();
  await button(s.root, 'Zum Terminal').onclick();
  await button(s.root, 'HTTP im Browser').onclick();
  assert.deepEqual(s.calls, ['list', entry.id, entry.id]);
  assert.equal(s.jumps[0].terminalId, 'one'); assert.equal(s.browsers[0].url, entry.url);
});

test('an ended listener or changed owner never routes an action to another terminal', async () => {
  for (const resolved of [{ ok: false, error: 'Port wurde beendet.' }, { ok: true, entry: { ...entry, terminalId: 'other' } }]) {
    const s = setup({ api: { async resolve() { return resolved; } } });
    s.panel.toggle(true); await tick(); await button(s.root, 'HTTP im Browser').onclick();
    assert.equal(s.browsers.length, 0); assert.equal(s.jumps.length, 0);
    assert.match(text(s.root), /Port wurde beendet|Zuordnung hat sich geändert/);
  }
});

test('polling removes vanished listeners and stops on close and dispose', async () => {
  let present = true;
  const s = setup({ api: { async list() { return { ok: true, entries: present ? [entry] : [], capturedAt: Date.now() }; } } });
  s.panel.toggle(true); await tick(); assert.equal(s.timers.size, 1);
  present = false; const poll = [...s.timers.values()][0]; s.timers.clear(); await poll();
  assert.match(text(s.root), /Keine sichtbaren/); assert.equal(button(s.root, 'Zum Terminal'), undefined);
  s.panel.toggle(false); assert.equal(s.timers.size, 0); assert.equal(s.root.hidden, true);
  s.panel.toggle(true); await tick(); s.panel.dispose(); assert.equal(s.timers.size, 0);
});

test('permission errors clear previous rows instead of presenting stale listeners', async () => {
  let failed = false;
  const s = setup({ api: { async list() { return failed ? { ok: false, error: 'Keine Leserechte.' } : { ok: true, entries: [entry], capturedAt: Date.now() }; } } });
  s.panel.toggle(true); await tick(); failed = true; await s.panel.refresh();
  assert.match(text(s.root), /Keine Leserechte/); assert.equal(button(s.root, 'Zum Terminal'), undefined);
});

test('closing during a scan ignores its late result and schedules no further polling', async () => {
  let resolve;
  const s = setup({ api: { list: () => new Promise(r => { resolve = r; }) } });
  s.panel.toggle(true); s.panel.toggle(false);
  resolve({ ok: true, entries: [entry], capturedAt: Date.now() }); await tick();
  assert.equal(s.timers.size, 0); assert.equal(s.root.hidden, true); assert.doesNotMatch(text(s.root), /Projekt 1/);
});

test('closing during action revalidation prevents a late jump or browser opening', async () => {
  let resolve;
  const s = setup({ api: { resolve: () => new Promise(r => { resolve = r; }) } });
  s.panel.toggle(true); await tick(); const action = button(s.root, 'Zum Terminal').onclick();
  s.panel.toggle(false); resolve({ ok: true, entry }); await action;
  assert.equal(s.jumps.length, 0); assert.equal(s.browsers.length, 0);
});
