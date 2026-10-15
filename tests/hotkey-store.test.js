'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const hk = require('../src/renderer/hotkeys');
const { createHotkeyStore } = require('../src/main/hotkey-store');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiterminal-hotkeys-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, filePath: path.join(dir, 'nested', 'hotkeys.json') };
}

test('missing settings use platform defaults without writing files', t => {
  const { filePath } = fixture(t);
  const store = createHotkeyStore({ filePath, platform: 'linux' });
  assert.deepEqual(store.get(), hk.defaults('linux'));
  assert.equal(fs.existsSync(filePath), false);
  const result = store.get();
  result.settings.length = 0;
  assert.deepEqual(store.get().settings, ['Ctrl+,']);
});

test('save persists canonical bindings across restart and clones input/output', t => {
  const { filePath, dir } = fixture(t);
  const store = createHotkeyStore({ filePath, platform: 'darwin' });
  const input = hk.defaults();
  input.settings = ['shift+cmd+f12'];
  input['close-terminal'] = [];
  const saved = store.save(input);
  assert.deepEqual(saved.settings, ['Cmd+Shift+F12']);
  input.settings.length = 0;
  saved.settings.length = 0;
  assert.deepEqual(store.get().settings, ['Cmd+Shift+F12']);
  const restarted = createHotkeyStore({ filePath, platform: 'darwin' });
  assert.deepEqual(restarted.get(), store.get());
  assert.deepEqual(restarted.get()['close-terminal'], []);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'nested')), ['hotkeys.json']);
  restarted.save(hk.defaults());
  assert.deepEqual(createHotkeyStore({ filePath, platform: 'darwin' }).get(), hk.defaults());
});

test('malformed or unsafe persisted settings fall back without overwriting source', t => {
  const { filePath } = fixture(t);
  fs.mkdirSync(path.dirname(filePath));
  for (const data of ['{bad', 'null', '{}', JSON.stringify({ ...hk.defaults(), settings: ['Cmd+Q'] }), JSON.stringify({ ...hk.defaults(), settings: ['Cmd+T'] })]) {
    fs.writeFileSync(filePath, data);
    assert.deepEqual(createHotkeyStore({ filePath, platform: 'darwin' }).get(), hk.defaults());
    assert.equal(fs.readFileSync(filePath, 'utf8'), data);
  }
});

test('invalid save preserves previous memory and persisted settings', t => {
  const { filePath } = fixture(t);
  const store = createHotkeyStore({ filePath, platform: 'darwin' });
  store.save(hk.defaults());
  const before = fs.readFileSync(filePath, 'utf8');
  assert.throws(() => store.save({ ...hk.defaults(), settings: ['Cmd+T'] }), /Konflikt/);
  assert.deepEqual(store.get(), hk.defaults());
  assert.equal(fs.readFileSync(filePath, 'utf8'), before);
});

test('failed atomic rename preserves previous memory and cleans temporary file', t => {
  const { filePath } = fixture(t);
  const store = createHotkeyStore({ filePath, platform: 'darwin' });
  store.save(hk.defaults());
  // A directory at the target deterministically rejects rename, even under root.
  fs.unlinkSync(filePath);
  fs.mkdirSync(filePath);
  const next = hk.defaults();
  next.settings = ['Cmd+F12'];
  assert.throws(() => store.save(next), /nicht gespeichert/);
  assert.deepEqual(store.get(), hk.defaults());
  assert.equal(fs.statSync(filePath).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['hotkeys.json']);
});

test('failed directory creation preserves defaults', t => {
  const { dir } = fixture(t);
  const parent = path.join(dir, 'file');
  fs.writeFileSync(parent, 'preserve');
  const store = createHotkeyStore({ filePath: path.join(parent, 'hotkeys.json'), platform: 'darwin' });
  assert.throws(() => store.save(hk.defaults()), /nicht gespeichert/);
  assert.deepEqual(store.get(), hk.defaults());
  assert.equal(fs.readFileSync(parent, 'utf8'), 'preserve');
});
