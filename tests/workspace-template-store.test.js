'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceTemplateStore } = require('../src/main/workspace-template-store');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-templates-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'nested', 'workspace-templates.json');
  const warnings = [];
  return { dir, filePath, warnings, open: () => createWorkspaceTemplateStore({ filePath, warn: (m) => warnings.push(m) }) };
}

const tile = (o = {}) => ({ title: 'Agent', presetId: 'claude', startCommand: 'claude', color: 3, ...o });

test('Vorlage überlebt einen Neustart', (t) => {
  const f = fixture(t);
  const saved = f.open().save({ name: 'Arbeitstag', tiles: [tile(), tile({ title: 'Shell', presetId: null, startCommand: 'echo hi', browserUrl: 'http://localhost:3000' })] });
  const again = f.open().list();
  assert.equal(again.length, 1);
  assert.deepEqual(again[0], saved);
  assert.equal(again[0].tiles[1].browserUrl, 'http://localhost:3000');
});

test('nur Felder der Positivliste werden gespeichert', (t) => {
  const f = fixture(t);
  f.open().save({
    name: 'X',
    tiles: [tile({
      nativeSession: { id: 'abc' }, resumeCommand: 'claude --resume abc', workspaceId: 'ws1',
      accounts: { claude: 'acc1' }, accountId: 'acc1', token: 'geheim', futureField: 1, id: 'terminal-1',
    })],
  });
  const raw = fs.readFileSync(f.filePath, 'utf8');
  for (const bad of ['nativeSession', 'resumeCommand', 'workspaceId', 'accounts', 'accountId', 'geheim', 'futureField', 'abc', 'terminal-1']) {
    assert.ok(!raw.includes(bad), bad);
  }
  assert.deepEqual(Object.keys(f.open().list()[0].tiles[0]).sort(), ['color', 'presetId', 'startCommand', 'title']);
});

test('Lesen verwirft nachträglich eingeschleuste Felder', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.filePath), { recursive: true });
  fs.writeFileSync(f.filePath, JSON.stringify([{ id: 'a1', name: 'N', createdAt: new Date().toISOString(), tiles: [tile({ nativeSession: 'x', resumeCommand: 'y' })] }]));
  const tiles = f.open().list()[0].tiles;
  assert.equal(tiles[0].nativeSession, undefined);
  assert.equal(tiles[0].resumeCommand, undefined);
});

test('unsichere Werte werden entfernt', (t) => {
  const f = fixture(t);
  const saved = f.open().save({ name: 'U', tiles: [tile({ startCommand: 'a\nb', browserUrl: 'file:///etc/passwd', color: 99, presetId: '../x' })] });
  assert.deepEqual(saved.tiles[0], { title: 'Agent', presetId: null });
});

test('doppelter Name wird abgelehnt, replace ersetzt', (t) => {
  const f = fixture(t);
  const s = f.open();
  s.save({ name: 'Mein Aufbau', tiles: [tile()] });
  assert.throws(() => s.save({ name: '  mein   aufbau ', tiles: [tile()] }), /existiert bereits/);
  s.save({ name: 'mein aufbau', tiles: [tile(), tile()], replace: true });
  assert.equal(s.list().length, 1);
  assert.equal(s.list()[0].tiles.length, 2);
});

test('Kachelgrenze 30 und leere Aufbauten', (t) => {
  const f = fixture(t);
  const s = f.open();
  s.save({ name: 'Voll', tiles: Array.from({ length: 30 }, () => tile()) });
  assert.throws(() => s.save({ name: 'Zu viel', tiles: Array.from({ length: 31 }, () => tile()) }), /höchstens 30/);
  assert.throws(() => s.save({ name: 'Leer', tiles: [] }), /keine Kacheln/);
  assert.throws(() => s.save({ name: ' ', tiles: [tile()] }), /Name/);
});

test('löschen', (t) => {
  const f = fixture(t);
  const s = f.open();
  const a = s.save({ name: 'A', tiles: [tile()] });
  assert.equal(s.remove('gibtsnicht'), false);
  assert.equal(s.remove(a.id), true);
  assert.deepEqual(f.open().list(), []);
});

test('kaputte Datei ergibt leere Liste mit Warnung und Sicherung', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.filePath), { recursive: true });
  fs.writeFileSync(f.filePath, '{kaputt');
  const s = f.open();
  assert.deepEqual(s.list(), []);
  assert.equal(f.warnings.length, 1);
  assert.ok(fs.existsSync(f.filePath + '.corrupt'));
  s.save({ name: 'Neu', tiles: [tile()] });
  assert.equal(f.open().list().length, 1);
});

test('atomares Schreiben hinterlässt keine temporären Dateien', (t) => {
  const f = fixture(t);
  f.open().save({ name: 'A', tiles: [tile()] });
  assert.deepEqual(fs.readdirSync(path.dirname(f.filePath)).filter((n) => n.endsWith('.tmp')), []);
});
