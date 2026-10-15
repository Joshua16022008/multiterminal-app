'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPmSessions } = require('../src/main/pm-sessions.js');

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-sessions-'));
  return { dir, file: path.join(dir, 'pm', 'sessions.json') };
}

test('speichert und liest eine gemeldete Gesprächs-ID', () => {
  const { file } = tmp();
  const s = createPmSessions({ filePath: file });
  assert.strictEqual(s.get('p1'), null);
  assert.strictEqual(s.observe('p1', 'abcd1234-ef56', 100), true);
  assert.strictEqual(s.get('p1'), 'abcd1234-ef56');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).p1.observedAt, 100);
  assert.strictEqual(createPmSessions({ filePath: file }).get('p1'), 'abcd1234-ef56');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['sessions.json']); // keine tmp-Reste
});

test('ungültige IDs und Projekte werden abgelehnt', () => {
  const { file } = tmp();
  const s = createPmSessions({ filePath: file });
  for (const bad of ['', 'kurz', 'a b c d e f g h', "x';rm -rf ~;'", '$(whoami)abc', 42, null, 'a'.repeat(129)]) {
    assert.strictEqual(s.observe('p1', bad), false, String(bad));
  }
  assert.strictEqual(s.observe('../p', 'abcd1234'), false);
  assert.strictEqual(s.get('p1'), null);
  assert.strictEqual(fs.existsSync(file), false);
});

test('ältere oder gleiche Meldung überschreibt nicht', () => {
  const { file } = tmp();
  const s = createPmSessions({ filePath: file });
  s.observe('p', 'neue-id-0001', 200);
  assert.strictEqual(s.observe('p', 'alte-id-0001', 100), false);
  assert.strictEqual(s.observe('p', 'neue-id-0001', 300), false);
  assert.strictEqual(s.get('p'), 'neue-id-0001');
  assert.strictEqual(s.observe('p', 'dritte-id-001', 400), true);
  assert.strictEqual(s.get('p'), 'dritte-id-001');
});

test('kaputte Datei und ungültige Einträge ergeben leeren Zustand ohne Wurf', () => {
  const { file } = tmp();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{kaputt');
  const s = createPmSessions({ filePath: file });
  assert.strictEqual(s.get('p'), null);
  assert.strictEqual(s.observe('p', 'abcd1234'), true);
  fs.writeFileSync(file, JSON.stringify({ gut: { nativeSessionId: 'abcd1234', observedAt: 1 }, boese: { nativeSessionId: 'a b' }, '../x': { nativeSessionId: 'abcd1234' }, arr: [] }));
  assert.deepStrictEqual(Object.keys(s.load()), ['gut']);
  fs.writeFileSync(file, '[1,2]');
  assert.deepStrictEqual(s.load(), {});
});

test('forget entfernt nur das eine Projekt', () => {
  const { file } = tmp();
  const s = createPmSessions({ filePath: file });
  s.observe('a', 'abcd1234'); s.observe('b', 'efgh5678');
  assert.strictEqual(s.forget('a'), true);
  assert.strictEqual(s.forget('a'), false);
  assert.strictEqual(s.get('a'), null);
  assert.strictEqual(s.get('b'), 'efgh5678');
});

test('relativer Pfad wird abgelehnt', () => {
  assert.throws(() => createPmSessions({ filePath: 'x.json' }));
});
