'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../src/renderer/pm.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/pm-update.js'), 'utf8');
// DOM event/state fixture: runs the shipped controller; does not prove browser layout.
function fixture(overrides = {}) {
  const elements = new Map();
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], {
    hidden: false, disabled: false, textContent: '', attrs: {}, listeners: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    focus() { this.focused = true; },
  });
  const calls = [];
  const pm = {
    updateStatus: async () => ({ ok: true, supported: true }),
    updateSelect: async () => ({ ok: true, token: 'opaque', currentVersion: '0.2.0', version: '0.2.0', packagePath: '<img onerror=bad>', targetPath: '/Applications/Multiterminal.app' }),
    updateInstall: async token => { calls.push(token); return { ok: true, started: true }; },
    ...overrides,
  };
  vm.runInNewContext(source, { window: { pm }, document: { getElementById: id => elements.get(id) } });
  return { pm, calls, get: id => elements.get('pm-update' + (id ? '-' + id : '')), click: id => elements.get('pm-update-' + id).onclick() };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('selection previews text safely and only installation forwards opaque token', async () => {
  const f = fixture();
  await f.click('open'); await f.click('select');
  assert.equal(f.get('preview').hidden, false);
  assert.equal(f.get('package').textContent, '<img onerror=bad>');
  assert.equal(f.get('current').textContent, '0.2.0');
  assert.equal(f.get('version').textContent, '0.2.0');
  assert.equal(f.get('install').disabled, false);
  assert.deepEqual(f.calls, []);
  await f.click('install');
  assert.deepEqual(f.calls, ['opaque']);
  assert.match(f.get('feedback').textContent, /wieder geöffnet/);
  assert.equal(f.get('install').disabled, true);
});

test('pending picker locks every preview control and guards programmatic duplicate events', async () => {
  const d = deferred(); let count = 0;
  const f = fixture({ updateSelect: () => { count++; return d.promise; } });
  const pending = f.click('select');
  for (const id of ['open', 'select', 'install', 'close']) assert.equal(f.get(id).disabled, true);
  await f.click('select'); f.click('close');
  assert.equal(count, 1);
  d.resolve({ ok: false, cancelled: true }); await pending;
  assert.match(f.get('feedback').textContent, /abgebrochen/);
  assert.equal(f.get('select').disabled, false);
});

test('picker cancellation, structured error and rejection invalidate prior token and allow retry', async () => {
  for (const response of [{ ok: false, cancelled: true }, { ok: false, error: 'Prüfsumme falsch' }, new Error('Picker ausgefallen')]) {
    const f = fixture(); await f.click('select');
    f.pm.updateSelect = async () => { if (response instanceof Error) throw response; return response; };
    await f.click('select');
    assert.equal(f.get('preview').hidden, true);
    assert.equal(f.get('install').disabled, true);
    assert.equal(f.get('select').disabled, false);
    await f.click('install'); assert.deepEqual(f.calls, []);
  }
});

test('cancelled, failed or rejected install consumes renderer token and permits new selection', async () => {
  for (const response of [{ ok: false, cancelled: true }, { ok: false, error: 'Nicht bereit' }, new Error('IPC ausgefallen')]) {
    let count = 0;
    const f = fixture({ updateInstall: async () => { count++; if (response instanceof Error) throw response; return response; } });
    await f.click('select'); await f.click('install'); await f.click('install');
    assert.equal(count, 1);
    assert.equal(f.get('install').disabled, true);
    assert.equal(f.get('select').disabled, false);
    await f.click('select'); assert.equal(f.get('install').disabled, false);
  }
});

test('native confirmation pending prevents repeated install and replacement selection', async () => {
  const d = deferred(); let count = 0;
  const f = fixture({ updateInstall: () => { count++; return d.promise; } });
  await f.click('select'); const pending = f.click('install');
  await f.click('install'); await f.click('select'); await f.click('open');
  assert.equal(count, 1);
  for (const id of ['open', 'select', 'install', 'close']) assert.equal(f.get(id).disabled, true);
  d.resolve({ ok: false, cancelled: true }); await pending;
});

test('persistent success/failure and unsupported status are visible', async () => {
  for (const lastResult of [{ state: 'installed' }, { state: 'installed' }, { state: 'parent_timeout' }]) {
    const f = fixture({ updateStatus: async () => ({ ok: true, supported: false, message: 'Nur installierte App', lastResult }) });
    await f.click('open');
    assert.equal(f.get('last').hidden, false);
    assert.match(f.get('last').textContent, lastResult.state === 'parent_timeout' ? /nicht rechtzeitig/ : /erfolgreich/);
    assert.equal(f.get('select').disabled, true);
    assert.equal(f.get('close').disabled, false);
  }
});

test('status rejection keeps panel closable; Escape restores trigger focus and clears preview', async () => {
  const f = fixture({ updateStatus: async () => { throw new Error('Status fehlt'); } });
  await f.click('open');
  assert.match(f.get('feedback').textContent, /Status fehlt/);
  await f.click('select');
  f.get('').listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(f.get('').hidden, true);
  assert.equal(f.get('open').focused, true);
  assert.equal(f.get('open').attrs['aria-expanded'], 'false');
  assert.equal(f.get('install').disabled, true);
});

test('HTML keeps manager controls and contains update warning and keyboard-native controls', () => {
  for (const id of ['pm-toggle-situation', 'pm-refresh', 'pm-fresh', 'pm-restart', 'pm-term', 'pm-exit-restart']) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /alle laufenden Terminals und Manager-Agenten beendet/);
  assert.match(html, /pm-update.js/);
  assert.match(html, /aria-live="polite"/);
});

test('helper outcomes use German feedback and distinguish restored app from rollback failure', async () => {
  for (const state of ['installed', 'waiting_for_exit', 'parent_timeout', 'invalid_checksums', 'relaunch_failed', 'target_running', 'replacement_failed', 'rollback_failed', 'start_cancelled', 'start_failed', 'invalid_stage', 'invalid_manifest', 'invalid_inventory', 'invalid_symlink', 'invalid_identity', 'backup_failed']) {
    const f = fixture({ updateStatus: async () => ({ ok: true, lastResult: { state, message: state } }) });
    await f.click('open');
    assert.ok(!f.get('last').textContent.includes(state), state);
    if (['relaunch_failed', 'replacement_failed'].includes(state)) assert.match(f.get('last').textContent, /vorherige App wurde wiederhergestellt/);
    if (state === 'rollback_failed') assert.match(f.get('last').textContent, /nicht wiederhergestellt/);
    if (state === 'waiting_for_exit') assert.equal(f.get('last').className, '');
  }
});
