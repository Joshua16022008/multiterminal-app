'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProjectStore } = require('../src/main/project-store.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-'));
  const filePath = path.join(dir, 'projects.json');
  return { dir, filePath, store: createProjectStore(filePath) };
}

test('list returns [] when the file is missing', () => {
  const { dir, store } = setup();
  try {
    assert.deepStrictEqual(store.list(), []);
    assert.strictEqual(fs.existsSync(path.join(dir, 'projects.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('list returns [] and keeps a copy when the file is invalid JSON', () => {
  const { dir, filePath, store } = setup();
  try {
    const broken = '{ this is not json';
    fs.writeFileSync(filePath, broken);
    assert.deepStrictEqual(store.list(), []);
    assert.strictEqual(fs.readFileSync(filePath + '.corrupt', 'utf8'), broken);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('list returns [] and keeps a copy when the JSON is not an array', () => {
  const { dir, filePath, store } = setup();
  try {
    const notArray = JSON.stringify({ projects: [] });
    fs.writeFileSync(filePath, notArray);
    assert.deepStrictEqual(store.list(), []);
    assert.strictEqual(fs.readFileSync(filePath + '.corrupt', 'utf8'), notArray);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('list skips entries that are not valid projects', () => {
  const { dir, filePath, store } = setup();
  try {
    const good = { id: 'a1', name: 'Gut', path: '/tmp/gut' };
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        good,
        null,
        'text',
        42,
        { name: 'ohne id', path: '/tmp/x' },
        { id: '', name: 'leere id', path: '/tmp/y' },
        { id: 'b2', name: 'relativ', path: 'relative/path' },
        { id: 'c3', path: '/tmp/ohne-name' },
        { id: 'd4', name: 'Pfad fehlt' },
      ])
    );
    assert.deepStrictEqual(store.list(), [good]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add stores a project with a UUID id and trimmed name', () => {
  const { dir, filePath, store } = setup();
  try {
    const project = store.add({ name: '  Mein Projekt  ', path: '/Users/nutzer/proj' });
    assert.match(project.id, UUID_RE);
    assert.strictEqual(project.name, 'Mein Projekt');
    assert.strictEqual(project.path, '/Users/nutzer/proj');
    assert.deepStrictEqual(store.list(), [project]);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), [project]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add uses the last path segment when the name is empty after trimming', () => {
  const { dir, store } = setup();
  try {
    assert.strictEqual(store.add({ name: '   ', path: '/Users/nutzer/alpha' }).name, 'alpha');
    assert.strictEqual(store.add({ path: '/Users/nutzer/beta/' }).name, 'beta');
    assert.strictEqual(store.add({ name: '', path: '/Users/nutzer/gamma' }).name, 'gamma');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add cuts the name to 80 characters', () => {
  const { dir, store } = setup();
  try {
    const project = store.add({ name: 'x'.repeat(100), path: '/tmp/long' });
    assert.strictEqual(project.name.length, 80);
    assert.strictEqual(project.name, 'x'.repeat(80));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add returns the existing project when the path is already known', () => {
  const { dir, store } = setup();
  try {
    const first = store.add({ name: 'Eins', path: '/Users/nutzer/same' });
    const second = store.add({ name: 'Zwei', path: '/Users/nutzer/same' });
    assert.deepStrictEqual(second, first);
    assert.strictEqual(store.list().length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add rejects paths that are not absolute strings', () => {
  const { dir, store } = setup();
  try {
    assert.throws(() => store.add({ name: 'x', path: 'relativ/pfad' }), Error);
    assert.throws(() => store.add({ name: 'x', path: '' }), Error);
    assert.throws(() => store.add({ name: 'x', path: 42 }), Error);
    assert.throws(() => store.add({ name: 'x' }), Error);
    assert.deepStrictEqual(store.list(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add creates the parent folder when it is missing', () => {
  const { dir } = setup();
  try {
    const nested = path.join(dir, 'a', 'b', 'projects.json');
    const store = createProjectStore(nested);
    store.add({ name: 'Tief', path: '/tmp/tief' });
    assert.strictEqual(store.list().length, 1);
    assert.strictEqual(fs.existsSync(nested), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add keeps a corrupt file as a copy before rewriting it', () => {
  const { dir, filePath, store } = setup();
  try {
    const broken = 'kaputt';
    fs.writeFileSync(filePath, broken);
    const project = store.add({ name: 'Neu', path: '/tmp/neu' });
    assert.strictEqual(fs.readFileSync(filePath + '.corrupt', 'utf8'), broken);
    assert.deepStrictEqual(store.list(), [project]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rename trims, cuts to 80 characters and persists', () => {
  const { dir, filePath, store } = setup();
  try {
    const project = store.add({ name: 'Alt', path: '/tmp/rename' });
    const renamed = store.rename(project.id, '  ' + 'y'.repeat(120) + '  ');
    assert.strictEqual(renamed.id, project.id);
    assert.strictEqual(renamed.name, 'y'.repeat(80));
    assert.strictEqual(store.get(project.id).name, 'y'.repeat(80));
    assert.strictEqual(JSON.parse(fs.readFileSync(filePath, 'utf8'))[0].name, 'y'.repeat(80));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rename throws for an empty name', () => {
  const { dir, store } = setup();
  try {
    const project = store.add({ name: 'Alt', path: '/tmp/empty-name' });
    assert.throws(() => store.rename(project.id, '   '), Error);
    assert.throws(() => store.rename(project.id, ''), Error);
    assert.strictEqual(store.get(project.id).name, 'Alt');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rename throws for an unknown id', () => {
  const { dir, store } = setup();
  try {
    store.add({ name: 'Da', path: '/tmp/known' });
    assert.throws(() => store.rename('gibt-es-nicht', 'Neu'), Error);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('remove returns true for a known id and false for an unknown one', () => {
  const { dir, store } = setup();
  try {
    const project = store.add({ name: 'Weg', path: '/tmp/weg' });
    assert.strictEqual(store.remove('unbekannt'), false);
    assert.strictEqual(store.remove(project.id), true);
    assert.strictEqual(store.remove(project.id), false);
    assert.deepStrictEqual(store.list(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('remove does not delete the project folder on disk', () => {
  const { dir, store } = setup();
  try {
    const projectDir = path.join(dir, 'echter-ordner');
    fs.mkdirSync(projectDir);
    const project = store.add({ name: 'Ordner', path: projectDir });
    store.remove(project.id);
    assert.strictEqual(fs.existsSync(projectDir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('get returns the project or null', () => {
  const { dir, store } = setup();
  try {
    const project = store.add({ name: 'Finden', path: '/tmp/finden' });
    assert.deepStrictEqual(store.get(project.id), project);
    assert.strictEqual(store.get('unbekannt'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writes leave no temp files behind', () => {
  const { dir, filePath, store } = setup();
  try {
    const project = store.add({ name: 'Sauber', path: '/tmp/sauber' });
    store.rename(project.id, 'Sauber 2');
    store.remove(project.id);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['projects.json']);
    assert.strictEqual(fs.existsSync(filePath), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
