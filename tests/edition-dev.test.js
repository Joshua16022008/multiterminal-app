'use strict';
// NUR ENTWICKLERVERSION (wird nicht exportiert): Die Entwicklerversion bleibt, wie sie war,
// und das Export-Manifest passt zu den Dateien.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const edition = require('../src/main/edition');
const dev = require('../src/main/dev-features');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'export-manifest.json'), 'utf8'));

test('this checkout is the developer version with today\'s identity', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'edition.json')), false, 'edition.json gehört nur in den Export');
  assert.equal(edition.edition, 'dev');
  assert.equal(edition.appName, 'Multiterminal');
  assert.equal(edition.bundleId, 'de.joshua.multiterminal');
  assert.deepEqual({ ...edition.features }, { dictation: true, taskLink: true, secondBrain: true });
  assert.equal(edition.devFeatures, dev);
});

test('developer hotkeys and menu label unchanged', () => {
  const HK = require('../src/renderer/hotkeys');
  const action = HK.actions.find((a) => a.id === 'task-link');
  assert.equal(action.label, 'Second-Brain-Aufgabe der Kachel');
  assert.deepEqual(HK.defaults('darwin')['task-link'], ['Cmd+Shift+L']);
  assert.deepEqual(HK.disabled, []);
  assert.equal(dev.TASK_LINK_LABEL, action.label);
});

test('developer clone folder: Second Brain projects when present, ~/Multiterminal otherwise', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-edition-home-'));
  try {
    assert.equal(edition.cloneDir(home), path.join(home, 'Multiterminal'));
    const projects = path.join(home, 'Desktop', 'Second_Brain', 'Arbeit', 'Ai Builds and projekts', 'Claude_code_tasks', 'Projekte');
    fs.mkdirSync(projects, { recursive: true });
    assert.equal(edition.cloneDir(home), projects);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('developer package keeps bundle id and microphone text', () => {
  const { packagerIdentity } = require('../scripts/build');
  assert.deepEqual(packagerIdentity(), {
    appBundleId: 'de.joshua.multiterminal',
    usageDescription: { Microphone: 'Für das Diktat in ein Terminal (Flüsterflow, lokal auf diesem Mac).' },
  });
  const pub = edition.createEdition({ file: path.join(ROOT, 'does-not-exist', 'x.json'), dev: null });
  assert.deepEqual(packagerIdentity(pub), { appBundleId: 'io.github.multiterminal' });
});

test('dictation keeps its service folder; tasks keep the local address rule', () => {
  let seen = null;
  const home = '/home/nutzer';
  const real = require('../src/main/dictation');
  const original = real.createDictation;
  real.createDictation = (options) => { seen = options; return {}; };
  try { dev.createDictation({ home, write() {}, notify() {} }); } finally { real.createDictation = original; }
  assert.equal(seen.serviceDir, path.join(home, 'Desktop', 'Second_Brain', 'Arbeit', 'Ai Builds and projekts', 'Claude_code_tasks', 'Projekte', 'Flüsterflow'));
  assert.equal(typeof dev.createTasks({}).list, 'function');
});

test('export manifest: every developer-only file exists, and shared code never loads one directly', () => {
  for (const file of manifest.devOnly) assert.ok(fs.existsSync(path.join(ROOT, file)), 'fehlt: ' + file);
  const shared = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + e.name;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|html)$/.test(e.name) && !manifest.devOnly.includes(rel)) shared.push(rel);
    }
  };
  walk('src'); walk('scripts');
  const direct = /require\(['"]\.{1,2}\/(?:main\/)?(dictation|second-brain-tasks)['"]\)/;
  for (const rel of shared) assert.ok(!direct.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')), rel + ' lädt ein Modul der Entwicklerversion direkt');
  // index.html: the developer-only tags carry the marker the export strips.
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8').split('\n');
  for (const name of ['dictation.js', 'task-link.js', 'task-link.css']) {
    const line = html.find((l) => l.includes('"' + name + '"'));
    assert.ok(line && line.includes(manifest.stripLines['src/renderer/index.html']), name + ' ohne dev-only-Markierung');
  }
});
