'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createMemoryService, MAX_NOTES_CHARS, MAX_CHECKPOINTS, MAX_FIELD_CHARS, MAX_CONTEXT_CHARS } = require('../src/main/memory-service');

function setup(t) {
  const dir = fs.mkdtempSync('/private/tmp/mt-memory-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, memory: createMemoryService({ dataDir: dir }) };
}

test('notes persist across instances, global and project scopes stay isolated, revisions reject stale saves', (t) => {
  const { dir, memory } = setup(t);
  assert.deepEqual(memory.read(), { projectId: null, notes: '', revision: 0, checkpoints: [] });
  memory.saveNotes(null, 'global rule', 0);
  memory.saveNotes('p1', 'one', 0);
  const other = createMemoryService({ dataDir: dir });
  assert.equal(other.read('p1').notes, 'one');
  assert.equal(other.read('p2').notes, '');
  assert.equal(other.read().notes, 'global rule');
  other.saveNotes('p1', 'new', 1);
  assert.throws(() => memory.saveNotes('p1', 'stale', 1), /Revision|Konflikt/);
  assert.equal(memory.read('p1').notes, 'new');
  assert.throws(() => memory.clear('p1', 1), /Revision|Konflikt/);
  assert.equal(memory.clear('p1', 2).notes, '');
  assert.equal(other.read().notes, 'global rule');
});

test('checkpoints validate shape, are bounded and upsert automatic records per terminal only', (t) => {
  const { memory } = setup(t);
  assert.throws(() => memory.checkpoint(null, { summary: 'bad', source: 'manual' }), /Projekt/);
  for (const input of [{ summary: 4 }, { evil: 'x' }, { summary: 'x', source: 'evil' }, [], null, { summary: 'x'.repeat(MAX_FIELD_CHARS + 1) }, { summary: 'x', id: 'forged' }]) {
    assert.throws(() => memory.checkpoint('p1', input));
  }
  const a = memory.checkpoint('p1', { summary: 'first', source: 'terminal', terminalId: 't1' });
  assert.equal(a.checkpoints.length, 1);
  assert.ok(a.checkpoints[0].id && a.checkpoints[0].createdAt);
  memory.checkpoint('p1', { summary: 'last', source: 'terminal', terminalId: 't1' });
  assert.deepEqual(memory.read('p1').checkpoints.map((x) => x.summary), ['last']);
  for (let i = 0; i < MAX_CHECKPOINTS + 3; i++) memory.checkpoint('p1', { summary: String(i), source: 'agent' });
  const saved = memory.read('p1');
  assert.equal(saved.checkpoints.length, MAX_CHECKPOINTS);
  assert.equal(saved.checkpoints.at(-1).summary, String(MAX_CHECKPOINTS + 2));
  assert.equal(memory.read('p2').checkpoints.length, 0);
  saved.checkpoints[0].summary = 'outside mutation';
  assert.notEqual(memory.read('p1').checkpoints[0].summary, 'outside mutation');
});

test('context includes only global/current project, labels unverified excerpts and obeys disable/settings persistence', (t) => {
  const { dir, memory } = setup(t);
  memory.saveNotes(null, 'all providers', 0);
  memory.saveNotes('p1', 'project one', 0);
  memory.saveNotes('p2', 'SECRET OTHER PROJECT', 0);
  memory.checkpoint('p1', { source: 'terminal', terminalId: 't', summary: 'output', cwd: '/project/worktree' });
  const context = memory.context('p1');
  assert.match(context, /all providers/);
  assert.match(context, /project one/);
  assert.match(context, /ungeprüft/i);
  assert.match(context, /worktree/);
  assert.doesNotMatch(context, /SECRET OTHER/);
  assert.ok(context.length <= MAX_CONTEXT_CHARS);
  assert.throws(() => memory.setSettings({ enabled: 'false' }));
  memory.setSettings({ enabled: false });
  assert.equal(memory.context('p1'), '');
  assert.deepEqual(createMemoryService({ dataDir: dir }).getSettings(), { enabled: false, autoCapture: true });
  assert.throws(() => memory.saveNotes(null, 'x'.repeat(MAX_NOTES_CHARS + 1), 1));
});

test('private atomic store refuses corrupt state and preserves damaged bytes', (t) => {
  const { dir, memory } = setup(t);
  memory.saveNotes('p1', 'keep', 0);
  const store = path.join(dir, 'memory', 'store.json');
  assert.equal(fs.statSync(store).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(store)).mode & 0o777, 0o700);
  fs.writeFileSync(store, '{broken');
  assert.throws(() => memory.read('p1'), /beschädigt|Ungültig/);
  assert.throws(() => memory.saveNotes('p1', 'overwrite?', 1));
  assert.equal(fs.readFileSync(store, 'utf8'), '{broken');
  fs.writeFileSync(store, JSON.stringify({ version: 1, settings: { enabled: true, autoCapture: true }, scopes: {} }));
  assert.throws(() => memory.saveNotes('p1', 'overwrite malformed?', 0));
});

test('malicious IDs and symlink directories/files never redirect writes', (t) => {
  const { dir, memory } = setup(t);
  for (const id of ['../other', '/tmp/x', '..', '__proto__', '', 42]) assert.throws(() => memory.read(id));
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(dir, 'memory'));
  assert.throws(() => memory.saveNotes('p1', 'bad', 0), /Symlink|symbolisch/);
  fs.unlinkSync(path.join(dir, 'memory'));
  memory.saveNotes('p1', 'good', 0);
  const store = path.join(dir, 'memory', 'store.json');
  const target = path.join(outside, 'target');
  fs.writeFileSync(target, 'untouched');
  fs.unlinkSync(store);
  fs.symlinkSync(target, store);
  assert.throws(() => memory.clear('p1', 1), /Symlink|symbolisch/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
});

test('failed atomic replacement preserves the prior store and cleans its temporary file', (t) => {
  const { dir, memory } = setup(t);
  memory.saveNotes('p1', 'last durable value', 0);
  const store = path.join(dir, 'memory', 'store.json');
  const before = fs.readFileSync(store, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('fixture rename failure'); };
  try { assert.throws(() => memory.saveNotes('p1', 'lost?', 1), /fixture rename failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(store, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.dirname(store)), ['store.json']);
  assert.equal(memory.read('p1').revision, 1);
});

test('large retained context is bounded and newest checkpoints precede older records', (t) => {
  const { memory } = setup(t);
  memory.saveNotes(null, 'g'.repeat(MAX_NOTES_CHARS), 0);
  memory.saveNotes('p1', 'p'.repeat(MAX_NOTES_CHARS), 0);
  for (let i = 0; i < MAX_CHECKPOINTS; i++) memory.checkpoint('p1', { source: 'manual', summary: `record-${i} ` + 's'.repeat(7000) });
  const context = memory.context('p1');
  assert.equal(context.length, MAX_CONTEXT_CHARS);
  assert.match(context, /gekürzt/);
  assert.ok(context.indexOf('record-7') < context.indexOf('record-6'));
  assert.throws(() => memory.checkpoint('p1', { summary: 'x'.repeat(8000), goal: 'x'.repeat(8000), nextStep: 'x' }), /groß/);
});

test('terminal churn cannot evict explicit handoffs, including a full explicit record set', (t) => {
  const { memory } = setup(t);
  memory.checkpoint('p1', { source: 'agent', goal: 'semantic goal', nextStep: 'semantic next step' });
  for (let i = 0; i < MAX_CHECKPOINTS * 2; i++) memory.checkpoint('p1', { source: 'terminal', terminalId: `t${i}`, summary: `output ${i}` });
  let records = memory.read('p1').checkpoints;
  assert.ok(records.some((record) => record.goal === 'semantic goal'));
  assert.ok(records.filter((record) => record.source === 'terminal').length <= 4);
  for (let i = 0; i < MAX_CHECKPOINTS; i++) memory.checkpoint('p1', { source: 'terminal', terminalId: `t${i}`, summary: `updated output ${i}` });
  assert.ok(memory.read('p1').checkpoints.some((record) => record.nextStep === 'semantic next step'));
  for (let i = 0; i < MAX_CHECKPOINTS; i++) memory.checkpoint('p1', { source: 'manual', summary: `explicit ${i}` });
  const explicitBefore = memory.read('p1').checkpoints.map((record) => record.id);
  assert.equal(explicitBefore.length, MAX_CHECKPOINTS);
  memory.checkpoint('p1', { source: 'terminal', terminalId: 'latest', summary: 'must not overwrite explicit handoffs' });
  records = memory.read('p1').checkpoints;
  assert.deepEqual(records.map((record) => record.id), explicitBefore);
});

test('notes revision ignores captures while preserving genuine editor conflicts and checkpoint data', (t) => {
  const { dir, memory } = setup(t);
  const editor = memory.saveNotes('p1', 'original', 0);
  const background = createMemoryService({ dataDir: dir });
  background.checkpoint('p1', { source: 'terminal', terminalId: 't1', summary: 'new output' });
  background.checkpoint('p1', { source: 'agent', summary: 'explicit handoff' });
  assert.equal(memory.read('p1').revision, editor.revision);
  const saved = memory.saveNotes('p1', 'edited while output arrived', editor.revision);
  assert.equal(saved.checkpoints.length, 2);
  assert.equal(saved.notes, 'edited while output arrived');
  assert.throws(() => background.saveNotes('p1', 'stale second editor', editor.revision), /Revision|Konflikt/);
  const cleared = memory.clear('p1', saved.revision);
  assert.ok(cleared.revision > saved.revision);
  assert.equal(cleared.checkpoints.length, 0);
  assert.throws(() => background.saveNotes('p1', 'stale before clear', saved.revision), /Revision|Konflikt/);
});

test('nonregular FIFO store is refused promptly without changing or opening it as a blocking reader', (t) => {
  const { dir } = setup(t);
  const directory = path.join(dir, 'memory');
  fs.mkdirSync(directory);
  const file = path.join(directory, 'store.json');
  const made = spawnSync('mkfifo', [file], { encoding: 'utf8', timeout: 1000 });
  assert.equal(made.status, 0, made.stderr);
  const before = fs.lstatSync(file);
  const script = `const {createMemoryService}=require(${JSON.stringify(path.join(__dirname, '../src/main/memory-service.js'))});try{createMemoryService({dataDir:process.argv[1]}).read('p1');process.exitCode=2;}catch(e){process.stderr.write(e.message);}`;
  const child = spawnSync(process.execPath, ['-e', script, dir], { encoding: 'utf8', timeout: 1000 });
  assert.equal(child.error, undefined, 'store read blocked until child timeout');
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stderr, /Memory-Datei/);
  const after = fs.lstatSync(file);
  assert.ok(after.isFIFO());
  assert.equal(after.ino, before.ino);
  assert.deepEqual(fs.readdirSync(directory), ['store.json']);
});

test('bounded context places semantic handoffs before newer terminal excerpts', (t) => {
  const { memory } = setup(t);
  memory.saveNotes(null, 'g'.repeat(MAX_NOTES_CHARS), 0);
  memory.saveNotes('p1', 'p'.repeat(MAX_NOTES_CHARS), 0);
  memory.checkpoint('p1', { source: 'agent', goal: 'preserve semantic goal', nextStep: 'perform semantic next action' });
  memory.checkpoint('p1', { source: 'manual', summary: 'latest explicit handoff' });
  for (let i = 0; i < 4; i++) memory.checkpoint('p1', { source: 'terminal', terminalId: `t${i}`, summary: `terminal-${i} ` + 'x'.repeat(7900) });
  const context = memory.context('p1');
  assert.equal(context.length, MAX_CONTEXT_CHARS);
  assert.match(context, /gekürzt/);
  assert.ok(context.includes('preserve semantic goal'));
  assert.ok(context.includes('perform semantic next action'));
  assert.ok(context.indexOf('latest explicit handoff') < context.indexOf('preserve semantic goal'));
  assert.ok(context.indexOf('perform semantic next action') < context.indexOf('terminal-3'));
  assert.ok(context.indexOf('terminal-3') < context.indexOf('terminal-2'));
});
