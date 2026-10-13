'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_PRESETS, createPresetStore } = require('../src/main/presets.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-'));
  const filePath = path.join(dir, 'presets.json');
  return { dir, filePath, store: createPresetStore(filePath) };
}

test('DEFAULT_PRESETS holds exactly the three built-in presets', () => {
  assert.deepStrictEqual(DEFAULT_PRESETS, [
    { id: 'claude', label: 'Claude Code', command: 'claude', resumeCommand: 'claude --continue', builtin: true },
    { id: 'codex', label: 'Codex', command: 'codex', resumeCommand: 'codex resume --last', builtin: true },
    { id: 'kimi', label: 'Kimi Code', command: 'kimi', resumeCommand: 'kimi --continue', builtin: true },
  ]);
});

test('list returns the built-in presets when the file is missing', () => {
  const { dir, store } = setup();
  try {
    assert.deepStrictEqual(store.list(), DEFAULT_PRESETS);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('list ignores an invalid file and returns only the built-in presets', () => {
  const { dir, filePath, store } = setup();
  try {
    fs.writeFileSync(filePath, '{ kaputt');
    assert.deepStrictEqual(store.list(), DEFAULT_PRESETS);
    fs.writeFileSync(filePath, JSON.stringify({ nicht: 'ein Array' }));
    assert.deepStrictEqual(store.list(), DEFAULT_PRESETS);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('list skips invalid own entries and entries that reuse a built-in id', () => {
  const { dir, filePath, store } = setup();
  try {
    const good = { id: 'mine', label: 'Mein Tool', command: 'mytool', resumeCommand: null, builtin: false };
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        good,
        null,
        'text',
        { id: 'x', label: '', command: 'leer' },
        { id: 'y', label: 'ohne Befehl', command: '   ' },
        { id: 'claude', label: 'Fälschung', command: 'evil', resumeCommand: null },
        { id: 'z', label: 'falscher Resume', command: 'ok', resumeCommand: 42 },
      ])
    );
    const all = store.list();
    assert.deepStrictEqual(all.slice(0, 3), DEFAULT_PRESETS);
    assert.deepStrictEqual(all.slice(3), [good]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('list marks own presets with builtin false and puts them after the built-ins', () => {
  const { dir, store } = setup();
  try {
    const added = store.add({ label: 'Eigen', command: 'eigen' });
    const all = store.list();
    assert.strictEqual(all.length, 4);
    assert.deepStrictEqual(all[3], added);
    assert.strictEqual(all[3].builtin, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add stores a preset with a UUID id, trimmed values and persists it', () => {
  const { dir, filePath, store } = setup();
  try {
    const preset = store.add({ label: '  Mein Tool  ', command: '  mytool --x  ', resumeCommand: ' mytool --resume ' });
    assert.match(preset.id, UUID_RE);
    assert.strictEqual(preset.label, 'Mein Tool');
    assert.strictEqual(preset.command, 'mytool --x');
    assert.strictEqual(preset.resumeCommand, 'mytool --resume');
    assert.strictEqual(preset.builtin, false);
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.deepStrictEqual(onDisk, [preset]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add stores a missing or empty resumeCommand as null', () => {
  const { dir, store } = setup();
  try {
    assert.strictEqual(store.add({ label: 'a', command: 'a' }).resumeCommand, null);
    assert.strictEqual(store.add({ label: 'b', command: 'b', resumeCommand: null }).resumeCommand, null);
    assert.strictEqual(store.add({ label: 'c', command: 'c', resumeCommand: '   ' }).resumeCommand, null);
    assert.strictEqual(store.add({ label: 'd', command: 'd', resumeCommand: '' }).resumeCommand, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add throws for an empty label or command', () => {
  const { dir, store } = setup();
  try {
    assert.throws(() => store.add({ label: '', command: 'x' }), Error);
    assert.throws(() => store.add({ label: '   ', command: 'x' }), Error);
    assert.throws(() => store.add({ command: 'x' }), Error);
    assert.throws(() => store.add({ label: 'x', command: '' }), Error);
    assert.throws(() => store.add({ label: 'x', command: '   ' }), Error);
    assert.throws(() => store.add({ label: 'x' }), Error);
    assert.deepStrictEqual(store.list(), DEFAULT_PRESETS);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add accepts a label of exactly 40 characters and rejects 41', () => {
  const { dir, store } = setup();
  try {
    assert.strictEqual(store.add({ label: 'l'.repeat(40), command: 'ok' }).label.length, 40);
    assert.throws(() => store.add({ label: 'l'.repeat(41), command: 'ok' }), Error);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add accepts a command of exactly 2000 characters and rejects 2001', () => {
  const { dir, store } = setup();
  try {
    const exact = 'c'.repeat(2000);
    assert.strictEqual(store.add({ label: 'ok', command: exact }).command, exact);
    assert.throws(() => store.add({ label: 'ok', command: 'c'.repeat(2001) }), Error);
    assert.throws(() => store.add({ label: 'ok', command: 'ok', resumeCommand: 'r'.repeat(2001) }), Error);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add rejects line breaks in command and resumeCommand', () => {
  const { dir, store } = setup();
  try {
    assert.throws(() => store.add({ label: 'x', command: 'a\nb' }), Error);
    assert.throws(() => store.add({ label: 'x', command: 'a\rb' }), Error);
    assert.throws(() => store.add({ label: 'x', command: 'ok\n' }), Error);
    assert.throws(() => store.add({ label: 'x', command: 'ok', resumeCommand: 'r\nx' }), Error);
    assert.throws(() => store.add({ label: 'x', command: 'ok', resumeCommand: '\n' }), Error);
    assert.deepStrictEqual(store.list(), DEFAULT_PRESETS);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('remove deletes an own preset and returns true', () => {
  const { dir, filePath, store } = setup();
  try {
    const preset = store.add({ label: 'Weg', command: 'weg' });
    assert.strictEqual(store.remove(preset.id), true);
    assert.deepStrictEqual(store.list(), DEFAULT_PRESETS);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('remove returns false for unknown ids', () => {
  const { dir, store } = setup();
  try {
    store.add({ label: 'Bleibt', command: 'bleibt' });
    assert.strictEqual(store.remove('gibt-es-nicht'), false);
    assert.strictEqual(store.list().length, 4);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('remove never removes built-in presets', () => {
  const { dir, filePath, store } = setup();
  try {
    assert.strictEqual(store.remove('claude'), false);
    assert.strictEqual(store.remove('codex'), false);
    assert.strictEqual(store.remove('kimi'), false);
    assert.deepStrictEqual(store.list(), DEFAULT_PRESETS);
    assert.strictEqual(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('only own presets are written to the file', () => {
  const { dir, filePath, store } = setup();
  try {
    store.add({ label: 'Eigen', command: 'eigen' });
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.strictEqual(onDisk.length, 1);
    assert.strictEqual(onDisk[0].label, 'Eigen');
    assert.strictEqual(onDisk.some((p) => p.builtin === true), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writes leave no temp files behind', () => {
  const { dir, store } = setup();
  try {
    const preset = store.add({ label: 'Sauber', command: 'sauber' });
    store.remove(preset.id);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['presets.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
