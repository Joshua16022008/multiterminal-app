'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSessionStore } = require('../src/main/session-store');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mt-session-'));
}
const empty = { version: 1, activeProjectId: null, projects: {} };
const term = (id, extra = {}) => ({
  id, title: 'T ' + id, presetId: null, command: null, resumeCommand: null,
  browserUrl: null, browserOpen: false, accounts: {}, ...extra,
});

test('load returns empty session when file is missing', () => {
  const store = createSessionStore(path.join(tmp(), 'nope'));
  assert.deepStrictEqual(store.load(), empty);
});

test('load returns empty session for corrupt JSON and wrong shapes', () => {
  const dir = tmp();
  const store = createSessionStore(dir);
  for (const content of ['{not json', '[]', 'null', '"x"', '{"projects":[]}', '{"projects":5}']) {
    fs.writeFileSync(path.join(dir, 'session.json'), content);
    assert.deepStrictEqual(store.load(), empty, content);
  }
});

test('save/load round trip and atomic write leaves no temp files', () => {
  const dir = path.join(tmp(), 'sub', 'dir');
  const store = createSessionStore(dir);
  const session = {
    version: 1, activeProjectId: 'p1',
    projects: { p1: { terminals: [term('a', { presetId: 'claude', command: 'claude', resumeCommand: 'claude -c', browserUrl: 'http://localhost:3000', browserOpen: true }), term('b')] } },
  };
  store.save(session);
  assert.deepStrictEqual(store.load(), session);
  assert.deepStrictEqual(fs.readdirSync(dir), ['session.json']);
});

test('sanitising: malformed terminals dropped, optional fields coerced', () => {
  const dir = tmp();
  const store = createSessionStore(dir);
  store.save({
    version: 7, activeProjectId: 'p1',
    projects: {
      p1: { terminals: [
        { id: 'ok' },
        { id: '../evil', title: 'x' },
        { id: 'has space' },
        { title: 'no id' },
        null, 42, 'str',
        { id: 'dup' }, { id: 'dup', title: 'second' },
        { id: 'long', title: 'x'.repeat(500), command: 'c'.repeat(2001), resumeCommand: 5, browserUrl: 'u'.repeat(2001), browserOpen: 'yes', presetId: 12 },
      ] },
      'bad id!': { terminals: [{ id: 'z' }] },
      p3: 'nope',
      p4: { terminals: 'nope' },
    },
  });
  const s = store.load();
  assert.strictEqual(s.version, 1);
  assert.deepStrictEqual(Object.keys(s.projects), ['p1']);
  const ids = s.projects.p1.terminals.map((t) => t.id);
  assert.deepStrictEqual(ids, ['ok', 'dup', 'long']);
  assert.deepStrictEqual(s.projects.p1.terminals[0], term('ok', { title: '' }));
  const long = s.projects.p1.terminals[2];
  assert.strictEqual(long.title.length, 120);
  assert.strictEqual(long.command, null);
  assert.strictEqual(long.resumeCommand, null);
  assert.strictEqual(long.browserUrl, null);
  assert.strictEqual(long.browserOpen, false);
  assert.strictEqual(long.presetId, null);
});

test('sanitising on load of a hand-edited file; unknown activeProjectId becomes null', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({
    version: 1, activeProjectId: 'ghost', projects: { p1: { terminals: [{ id: 'a', browserOpen: true }] } },
  }));
  const s = createSessionStore(dir).load();
  assert.strictEqual(s.activeProjectId, null);
  assert.strictEqual(s.projects.p1.terminals[0].browserOpen, true);
});

test('caps terminals per project at 30', () => {
  const store = createSessionStore(tmp());
  const terminals = Array.from({ length: 35 }, (_, i) => term('t' + i));
  store.save({ version: 1, activeProjectId: null, projects: { p: { terminals } } });
  const loaded = store.load().projects.p.terminals;
  assert.strictEqual(loaded.length, 30);
  assert.strictEqual(loaded[29].id, 't29');
});

test('__proto__ project key does not pollute', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'session.json'), '{"projects":{"__proto__":{"terminals":[{"id":"x"}]}}}');
  const s = createSessionStore(dir).load();
  assert.deepStrictEqual(s.projects, {});
  assert.strictEqual(({}).terminals, undefined);
});

test('scrollback save/load/delete', () => {
  const store = createSessionStore(tmp());
  assert.strictEqual(store.loadScrollback('t1'), null);
  store.saveScrollback('t1', 'hello \u001b[31mworld\u001b[0m äöü');
  assert.strictEqual(store.loadScrollback('t1'), 'hello \u001b[31mworld\u001b[0m äöü');
  store.deleteScrollback('t1');
  assert.strictEqual(store.loadScrollback('t1'), null);
  assert.doesNotThrow(() => store.deleteScrollback('t1'));
});

test('invalid terminal ids are rejected everywhere (path traversal guard)', () => {
  const dir = tmp();
  const store = createSessionStore(dir);
  const bad = ['', '../x', 'a/b', 'a\\b', '..', '.', 'x'.repeat(65), 'a b', 'a\0b', null, undefined, 5, {}];
  for (const id of bad) {
    assert.throws(() => store.saveScrollback(id, 'x'), /Invalid terminal id/);
    assert.throws(() => store.loadScrollback(id), /Invalid terminal id/);
    assert.throws(() => store.deleteScrollback(id), /Invalid terminal id/);
  }
  assert.doesNotThrow(() => store.saveScrollback('x'.repeat(64), 'ok'));
  assert.strictEqual(fs.existsSync(path.join(dir, 'x')), false);
});

test('scrollback longer than 2,000,000 chars keeps only the end', () => {
  const store = createSessionStore(tmp());
  const text = 'A'.repeat(500000) + 'B'.repeat(2000000);
  store.saveScrollback('big', text);
  const back = store.loadScrollback('big');
  assert.strictEqual(back.length, 2000000);
  assert.ok(/^B+$/.test(back));
  store.saveScrollback('edge', 'x'.repeat(2000000));
  assert.strictEqual(store.loadScrollback('edge').length, 2000000);
});

test('pruneScrollback removes unknown ids and returns the count', () => {
  const dir = tmp();
  const store = createSessionStore(dir);
  assert.strictEqual(store.pruneScrollback(['a']), 0); // no scrollback dir yet
  for (const id of ['a', 'b', 'c']) store.saveScrollback(id, id);
  assert.strictEqual(store.pruneScrollback(['a', 'zzz']), 2);
  assert.strictEqual(store.loadScrollback('a'), 'a');
  assert.strictEqual(store.loadScrollback('b'), null);
  assert.strictEqual(store.loadScrollback('c'), null);
  assert.strictEqual(store.pruneScrollback([]), 1);
  assert.strictEqual(store.pruneScrollback([]), 0);
});

test('accounts per terminal are kept, invalid entries dropped', () => {
  const store = createSessionStore(tmp());
  const saved = store.save({
    version: 1,
    activeProjectId: null,
    projects: { p1: { terminals: [
      term('a', { accounts: { claude: 'claude-1a2b3c4d', codex: 'bad id!', 'x y': 'ok' } }),
      term('b', { accounts: 'nope' }),
    ] } },
  });
  assert.deepStrictEqual(saved.projects.p1.terminals[0].accounts, { claude: 'claude-1a2b3c4d' });
  assert.deepStrictEqual(saved.projects.p1.terminals[1].accounts, {});
  assert.deepStrictEqual(store.load(), saved);
});

test('terminal color and titleLocked survive a round trip, bad values are dropped', () => {
  const dir = tmp();
  const store = createSessionStore(dir);
  store.save({ version: 1, activeProjectId: null, projects: { p1: { terminals: [
    term('a', { color: 3, titleLocked: true }),
    term('b', { color: 99, titleLocked: 'yes' }),
  ] } } });
  const [a, b] = store.load().projects.p1.terminals;
  assert.strictEqual(a.color, 3);
  assert.strictEqual(a.titleLocked, true);
  assert.ok(!('color' in b));
  assert.ok(!('titleLocked' in b));
});

test('browserMode is kept only for the non-default modes', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({
    version: 1, activeProjectId: null,
    projects: { p1: { terminals: [
      { id: 'a', browserMode: 'terminal' }, { id: 'b', browserMode: 'browser' },
      { id: 'c', browserMode: 'split' }, { id: 'd', browserMode: 'bogus' }, { id: 'e' },
    ] } },
  }));
  const modes = createSessionStore(dir).load().projects.p1.terminals.map((t) => t.browserMode);
  assert.deepStrictEqual(modes, ['terminal', 'browser', undefined, undefined, undefined]);
});

// F02
test('nativeSession round trip, old files without the field and invalid values', () => {
  const dir = tmp();
  const store = createSessionStore(dir);
  const ns = { provider: 'claude', accountId: 'acc1', projectId: 'p1', nativeSessionId: 'a1b2c3d4-0000-4000-8000-123456789abc', observedAt: 1700000000000 };
  store.save({ version: 1, activeProjectId: 'p1', projects: { p1: { terminals: [
    term('a', { nativeSession: ns }), term('b'),
    term('c', { nativeSession: { ...ns, nativeSessionId: 'x; rm -rf ~' } }),
    term('d', { nativeSession: { ...ns, provider: 'evil' } }),
    term('e', { nativeSession: 'str' }),
  ] } } });
  const t = store.load().projects.p1.terminals;
  assert.deepStrictEqual(t[0].nativeSession, ns);
  for (const x of t.slice(1)) assert.ok(!('nativeSession' in x), x.id);
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ version: 1, activeProjectId: 'p1', projects: { p1: { terminals: [{ id: 'old', title: 'Alt', command: 'claude', resumeCommand: 'claude --continue' }] } } }));
  const old = store.load().projects.p1.terminals[0];
  assert.equal(old.id, 'old');
  assert.ok(!('nativeSession' in old));
});
