'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHarnessCatalog, validateEntry, expandArgv, isValidModel } = require('../src/main/harness-catalog');
const fixture = () => JSON.parse(createHarnessCatalog().exportEntry('opencode'));

test('catalog: every bundled JSON entry validates; 15 unique harnesses have evidence', () => {
  const catalog = createHarnessCatalog();
  assert.equal(catalog.list().length, 15);
  for (const entry of catalog.list()) {
    const data = JSON.parse(catalog.exportEntry(entry.id));
    assert.deepEqual(validateEntry(data), { ok: true, errors: [] }, entry.id);
    assert.equal(entry.builtin, true);
    assert.ok(entry.verifiedWith);
    assert.ok(entry.install.length > 0, `${entry.id}: Installationshinweis oder manuelle Doku`);
    if (entry.evidence === 'unconfirmed') assert.deepEqual(entry.start, [entry.binary]);
  }
});

test('catalog: rejects unknown fields, executable paths, unsafe models and undeclared placeholders', () => {
  const cases = [
    (e) => { e.binary = '/bin/sh'; },
    (e) => { e.binary = ['opencode']; },
    (e) => { e.binary = 'opencode;touch'; },
    (e) => { e.start = ['another']; },
    (e) => { e.start.push('{secret}'); },
    (e) => { e.start.push('{model'); },
    (e) => { e.model.query.argv = ['curl', 'https://evil.test']; },
    (e) => { e.model.query.argv.push('{prompt}'); },
    (e) => { e.model.query.parse = 'eval'; },
    (e) => { e.model.args = ['--some-flag']; },
    (e) => { e.model.args = []; },
    (e) => { e.model.args = {}; },
    (e) => { e.prompt.args = ['--some-flag']; },
    (e) => { e.prompt.args = []; },
    (e) => { e.prompt.args = {}; },
    (e) => { e.model.query.argv = {}; },
    (e) => { e.resume.byId = {}; },
    (e) => { e.detect = { verify: { argv: {}, pattern: 'x' } }; },
    (e) => { e.model.static = ["x'$(touch)"]; },
    (e) => { e.model.extra = true; },
    (e) => { e.detect = { verify: { argv: ['opencode', '--help'], pattern: 'x', exec: 'bad' } }; },
    (e) => { e.endpoints = { openai: { env: { 'BAD-NAME': 'x' } } }; },
    (e) => { e.docsUrl = 'javascript:alert(1)'; },
    (e) => { e.docsUrl = 'https://user:pass@example.com'; },
    (e) => { e.fullAccess = ['--unsafe']; },
    (e) => { e.schema = 2; },
    (e) => { e.builtin = true; },
    (e) => { e.model = { args: 'opencode -m x', static: [], format: 'name' }; },
  ];
  for (const mutate of cases) { const entry = fixture(); mutate(entry); assert.equal(validateEntry(entry).ok, false, mutate.toString()); }
  assert.equal(validateEntry(JSON.parse('{"__proto__":{"polluted":true}}')).ok, false);
  assert.equal({}.polluted, undefined);
});

test('catalog: unconfirmed entries cannot gain launch capabilities and ambiguous binaries need identity', () => {
  const entry = fixture(); entry.evidence = 'unconfirmed';
  assert.equal(validateEntry(entry).ok, false);
  const cursor = JSON.parse(createHarnessCatalog().exportEntry('cursor'));
  delete cursor.detect;
  assert.equal(validateEntry(cursor).ok, false);
});

test('catalog: model grammar and expansion preserve argv boundaries and validate values', () => {
  for (const model of ['deepseek-flash[1m]', 'provider/model:latest', 'org/model@v1+q4', 'a'.repeat(200)]) assert.equal(isValidModel(model), true);
  for (const model of ['', 'a'.repeat(201), "x'", 'x y', 'x\n', 'x;touch', '$(x)', 'x\\y']) assert.equal(isValidModel(model), false);
  assert.deepEqual(expandArgv(['opencode', '-m', '{model}', '--session={sessionId}'], { model: 'p/m', sessionId: 'session-123' }), ['opencode', '-m', 'p/m', '--session=session-123']);
  assert.deepEqual(expandArgv(['{opencodeProviderJson}'], { opencodeProviderJson: '{"provider":{}}' }), ['{"provider":{}}']);
  for (const [argv, values] of [[['{secret}'], { secret: 'x' }], [['{model}'], {}], [['{model}'], { model: "x'" }], [['{sessionId}'], { sessionId: '-option' }], [['{prompt}'], { prompt: 'a\nb' }], [['{model'], {}]]) assert.throws(() => expandArgv(argv, values));
});

test('catalog: private atomic own catalog survives reload, cannot override builtins, exports data only', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-harness-catalog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const userFile = path.join(dir, 'harnesses.json');
  const catalog = createHarnessCatalog({ userFile });
  const own = fixture(); own.id = 'my-opencode';
  const saved = catalog.addOwn(own);
  assert.equal(saved.builtin, false);
  assert.equal(fs.statSync(userFile).mode & 0o777, 0o600);
  assert.equal(createHarnessCatalog({ userFile }).get(own.id).label, own.label);
  assert.equal(JSON.parse(catalog.exportEntry(own.id)).builtin, undefined);
  saved.label = 'modified copy';
  assert.equal(catalog.get(own.id).label, own.label);
  assert.throws(() => catalog.addOwn(fixture()), /überschrieben/);
  assert.equal(catalog.removeOwn('opencode'), false);
  assert.equal(catalog.removeOwn(own.id), true);
  assert.equal(createHarnessCatalog({ userFile }).get(own.id), null);
  assert.equal(fs.readdirSync(dir).length, 1);
});

test('catalog: refuses invalid persisted entries and symlink writes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-harness-catalog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const userFile = path.join(dir, 'harnesses.json');
  fs.writeFileSync(userFile, '{bad');
  assert.throws(() => createHarnessCatalog({ userFile }), /gelesen/);
  fs.writeFileSync(userFile, JSON.stringify({ version: 1, harnesses: [fixture()] }));
  assert.throws(() => createHarnessCatalog({ userFile }), /Doppelte/);
  fs.writeFileSync(userFile, JSON.stringify({ version: 1, harnesses: [] }));
  const target = path.join(dir, 'target.json'); fs.renameSync(userFile, target); fs.symlinkSync(target, userFile);
  const catalog = createHarnessCatalog({ userFile }); const own = fixture(); own.id = 'own-code';
  assert.throws(() => catalog.addOwn(own), /symbolischer/);
  assert.equal(catalog.get(own.id), null);
});

test('catalog: imported entries cannot run shells, interpreters or arbitrary probe arguments', () => {
  const base = () => JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/main/harness-catalog/opencode.json'), 'utf8'));
  const evil = { ...base(), id: 'evil', binary: 'sh', start: ['sh'], resume: null, prompt: null, model: null,
    detect: { verify: { argv: ['sh', '-c', 'echo PWNED > /tmp/x'], pattern: 'x' } } };
  assert.equal(validateEntry(evil).ok, false);
  const viaProbe = base(); viaProbe.binary = 'mytool'; viaProbe.start = ['mytool'];
  viaProbe.resume = null; viaProbe.prompt = null; viaProbe.model = null;
  viaProbe.detect = { version: { argv: ['mytool', '--config', '/tmp/x'] } };
  assert.equal(validateEntry(viaProbe).ok, false);
  viaProbe.detect = { version: { argv: ['mytool', '--version'] } };
  assert.equal(validateEntry(viaProbe).ok, true);
  for (const bin of ['bash', 'python3', 'node', 'osascript', 'env']) {
    const e = base(); e.binary = bin; e.start = [bin]; e.resume = null; e.prompt = null; e.model = null; e.detect = undefined;
    assert.equal(validateEntry(e).ok, false, bin);
  }
});
