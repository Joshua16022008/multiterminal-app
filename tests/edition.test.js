'use strict';
// Edition switch (dev/public): resolving edition.json, what the public edition leaves out,
// and that unknown or broken files never switch developer features on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createEdition, resolveEdition, loadDevFeatures, FEATURES, PUBLIC_DEFAULTS } = require('../src/main/edition');

// Stand-in for the developer-only module; the real one is tested in edition-dev.test.js.
const FAKE_DEV = {
  EDITION: { appName: 'Devterm', bundleId: 'org.example.devterm', features: { dictation: true, taskLink: true, secondBrain: true } },
  projectsDir: (home) => path.join(home, 'Eigene Projekte'),
};
const allOff = Object.fromEntries(FEATURES.map((k) => [k, false]));
const allOn = Object.fromEntries(FEATURES.map((k) => [k, true]));

function tempFile(t, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-edition-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'edition.json');
  if (content !== undefined) fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

test('without edition.json: developer version with its values, public when the developer module is missing', () => {
  assert.deepEqual(resolveEdition({ raw: null, dev: FAKE_DEV }), { edition: 'dev', appName: 'Devterm', bundleId: 'org.example.devterm', features: allOn });
  assert.deepEqual(resolveEdition({ raw: null, dev: null }), { edition: 'public', ...PUBLIC_DEFAULTS, features: allOff });
});

test('public edition switches every developer feature off, even with the developer module present', () => {
  const e = resolveEdition({ raw: { edition: 'public', features: allOn }, dev: FAKE_DEV });
  assert.equal(e.edition, 'public');
  assert.deepEqual(e.features, allOff);
  assert.equal(e.bundleId, PUBLIC_DEFAULTS.bundleId);
  assert.equal(e.appName, PUBLIC_DEFAULTS.appName);
});

test('app name and bundle id come from the file when valid; broken or unknown values fall back', () => {
  assert.deepEqual(resolveEdition({ raw: { edition: 'public', appName: 'Mein Term', bundleId: 'io.example.term' } }),
    { edition: 'public', appName: 'Mein Term', bundleId: 'io.example.term', features: allOff });
  const bad = resolveEdition({ raw: { edition: 'public', appName: '../x', bundleId: 'kein punkt' } });
  assert.equal(bad.appName, PUBLIC_DEFAULTS.appName);
  assert.equal(bad.bundleId, PUBLIC_DEFAULTS.bundleId);
  // An unknown edition name is never the developer version.
  assert.equal(resolveEdition({ raw: { edition: 'beta' }, dev: FAKE_DEV }).edition, 'public');
  assert.deepEqual(resolveEdition({ raw: {}, dev: FAKE_DEV }).features, allOff);
});

test('dev edition: single features can be switched off, never on without the module', () => {
  assert.deepEqual(resolveEdition({ raw: { edition: 'dev', features: { dictation: false } }, dev: FAKE_DEV }).features,
    { ...allOn, dictation: false });
  assert.deepEqual(resolveEdition({ raw: { edition: 'dev' }, dev: null }).features, allOff);
});

test('createEdition reads the file; missing, broken and non-object files are handled', (t) => {
  const pub = createEdition({ file: tempFile(t, { edition: 'public' }), dev: FAKE_DEV });
  assert.equal(pub.isPublic(), true);
  assert.equal(pub.isDev(), false);
  assert.equal(pub.devFeatures, null);
  assert.deepEqual(pub.publicInfo(), { edition: 'public', appName: PUBLIC_DEFAULTS.appName, features: allOff });
  assert.equal(pub.cloneDir('/home/nutzer'), path.join('/home/nutzer', PUBLIC_DEFAULTS.appName, 'Projekte'));

  const dev = createEdition({ file: tempFile(t), dev: FAKE_DEV });
  assert.equal(dev.isDev(), true);
  assert.equal(dev.devFeatures, FAKE_DEV);
  assert.equal(dev.cloneDir('/home/nutzer'), path.join('/home/nutzer', 'Eigene Projekte'));
  const noFolder = createEdition({ file: tempFile(t), dev: { ...FAKE_DEV, projectsDir: () => null } });
  assert.equal(noFolder.cloneDir('/home/nutzer'), path.join('/home/nutzer', 'Multiterminal'));

  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    assert.equal(createEdition({ file: tempFile(t, '{kaputt'), dev: FAKE_DEV }).edition, 'public');
    assert.equal(createEdition({ file: tempFile(t, '[]'), dev: FAKE_DEV }).edition, 'public');
  } finally { console.error = original; }
  assert.equal(errors.length, 2);
});

test('publicInfo carries no paths and cannot change the edition', (t) => {
  const e = createEdition({ file: tempFile(t), dev: FAKE_DEV });
  const info = e.publicInfo();
  assert.deepEqual(Object.keys(info).sort(), ['appName', 'edition', 'features']);
  info.features.dictation = false;
  assert.equal(e.features.dictation, true);
  assert.throws(() => { 'use strict'; e.features.dictation = false; });
});

test('loadDevFeatures: a missing developer module is null, other errors are not hidden', () => {
  const missing = Object.assign(new Error("Cannot find module './dev-features'"), { code: 'MODULE_NOT_FOUND' });
  assert.equal(loadDevFeatures(() => { throw missing; }), null);
  const inner = Object.assign(new Error("Cannot find module './dictation'"), { code: 'MODULE_NOT_FOUND' });
  assert.throws(() => loadDevFeatures(() => { throw inner; }), /dictation/);
  assert.throws(() => loadDevFeatures(() => { throw new SyntaxError('kaputt'); }), SyntaxError);
});

/* Shared hotkey model as the page loads it: the edition comes from the preload (window.deck.edition). */
function hotkeysFor(edition) {
  const window = { deck: edition ? { edition } : {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/hotkeys.js'), 'utf8'), { window });
  return window.DeckHotkeys;
}

test('public hotkeys: the task action does not exist (menu, palette, help table, bindings)', () => {
  const pub = hotkeysFor({ edition: 'public', features: allOff });
  assert.equal(pub.actions.some((a) => a.id === 'task-link'), false);
  assert.deepEqual([...pub.disabled], ['task-link']);
  const defaults = pub.defaults('darwin');
  assert.equal('task-link' in defaults, false);
  assert.doesNotThrow(() => pub.validate(defaults));
  assert.throws(() => pub.validate({ ...defaults, 'task-link': ['Cmd+Shift+L'] }), /Unbekannte/);
  // Its former shortcut is free for another action in the public edition.
  assert.doesNotThrow(() => pub.validate({ ...defaults, help: ['Cmd+Shift+L'] }));
});

test('developer edition keeps the full hotkey model; missing renderer handshake disables developer actions', () => {
  for (const edition of [{ edition: 'dev', features: allOn }]) {
    const hk = hotkeysFor(edition);
    assert.equal(hk.actions.some((a) => a.id === 'task-link'), true);
    assert.deepEqual([...hk.disabled], []);
    assert.deepEqual([...hk.defaults('darwin')['task-link']], ['Cmd+Shift+L']);
  }
  for (const answer of [null, {}, { edition: 'public' }]) {
    const hk = hotkeysFor(answer);
    assert.equal(hk.actions.some(a => a.id === 'task-link'), false);
    assert.equal(hk.actions.some(a => a.id === 'help'), true);
  }
});

test('setLabel renames an existing action only', () => {
  const hk = hotkeysFor({ edition: 'dev', features: allOn });
  hk.setLabel('task-link', 'Eigene Aufgabe');
  assert.equal(hk.actions.find((a) => a.id === 'task-link').label, 'Eigene Aufgabe');
  hk.setLabel('gibt-es-nicht', 'x');
  hk.setLabel('help', '');
  assert.equal(hk.actions.find((a) => a.id === 'help').label, 'Hilfe öffnen');
});

/* Preload with a stand-in electron: which APIs the page gets per edition. */
function preloadDeck(answer) {
  let deck = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (key, value) => { if (key === 'deck') deck = value; } },
    ipcRenderer: {
      sendSync: (channel) => { assert.equal(channel, 'edition:get'); if (answer instanceof Error) throw answer; return answer; },
      invoke: () => Promise.resolve(), on() {}, removeListener() {}, send() {},
    },
    webUtils: { getPathForFile: () => '' },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main/preload.js'), 'utf8'), { require: (name) => { assert.equal(name, 'electron'); return electron; } });
  return deck;
}

test('preload: public edition gets neither dictation nor task API, the developer version both', () => {
  const pub = preloadDeck({ edition: 'public', appName: 'Multiterminal', features: allOff });
  assert.equal(pub.edition.edition, 'public');
  assert.equal('dictation' in pub, false);
  assert.equal('secondBrain' in pub, false);
  for (const answer of [{ edition: 'dev', appName: 'Multiterminal', features: allOn }]) {
    const dev = preloadDeck(answer);
    assert.equal(typeof dev.dictation.start, 'function');
    assert.equal(typeof dev.secondBrain.getTask, 'function');
  }
  for (const answer of [null, {}, new Error('kein Hauptprozess')]) {
    const closed = preloadDeck(answer);
    assert.equal('dictation' in closed, false);
    assert.equal('secondBrain' in closed, false);
  }
});

test('comfort panel offers the task chip switch only with task module and task API', () => {
  const load = (window) => {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/qol-panel.js'), 'utf8'), { window });
    return window.DeckQol.items().map(([key]) => key);
  };
  const ITEM = ['taskChip', 'Aufgabe', 'Hinweis'];
  assert.equal(load({}).includes('taskChip'), false);
  assert.equal(load({ DeckTaskLink: { QOL_ITEM: ITEM }, deck: {} }).includes('taskChip'), false);
  assert.equal(load({ DeckTaskLink: { QOL_ITEM: ITEM }, deck: { secondBrain: {} } }).at(-1), 'taskChip');
});

test('hotkey store drops actions of switched-off features instead of discarding all own bindings', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-edition-hk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'hotkeys.json');
  const pub = hotkeysFor({ edition: 'public', features: allOff });
  const saved = { ...pub.defaults('darwin'), help: ['Cmd+Shift+F1'], 'task-link': ['Cmd+Shift+L'] };
  fs.writeFileSync(file, JSON.stringify(saved));
  // hotkey-store requires the shared model; hand it the public one.
  const storePath = require.resolve('../src/main/hotkey-store');
  const modelPath = require.resolve('../src/renderer/hotkeys');
  const cached = { store: require.cache[storePath], model: require.cache[modelPath] };
  delete require.cache[storePath];
  require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: pub };
  try {
    const { createHotkeyStore } = require('../src/main/hotkey-store');
    const bindings = createHotkeyStore({ filePath: file, platform: 'darwin' }).get();
    assert.deepEqual(bindings.help, ['Cmd+Shift+F1']);
    assert.equal('task-link' in bindings, false);
  } finally {
    if (cached.model) require.cache[modelPath] = cached.model; else delete require.cache[modelPath];
    if (cached.store) require.cache[storePath] = cached.store; else delete require.cache[storePath];
  }
});
