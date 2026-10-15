'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidSessionId, buildResume, sanitizeNativeSession, resumePlan, createAgentSessionService,
} = require('../src/main/agent-session-service');
const { createAgentStatusStore } = require('../src/main/agent-events');

const ID1 = 'a1b2c3d4-0000-4000-8000-111111111111';
const ID2 = 'a1b2c3d4-0000-4000-8000-222222222222';
const rec = (o = {}) => ({ provider: 'claude', accountId: 'acc1', projectId: 'p1', nativeSessionId: ID1, observedAt: 100, ...o });

test('ID validation is strict', () => {
  assert.equal(isValidSessionId(ID1), true);
  for (const bad of ['', 'short', 'a'.repeat(129), 'abc def ghi', 'abcdefgh;id', 'abcdefgh$(id)', "abcdefgh'", 'abcdefgh\n', '../../etc/passwd', null, 42, undefined]) {
    assert.equal(isValidSessionId(bad), false, String(bad));
  }
});

test('buildResume gives the exact CLI form per provider and refuses bad input', () => {
  assert.equal(buildResume('claude', ID1).line, 'claude --resume ' + ID1);
  assert.deepEqual(buildResume('claude', ID1).argv, ['claude', '--resume', ID1]);
  assert.equal(buildResume('codex', ID1).line, 'codex resume ' + ID1);
  assert.equal(buildResume('kimi', ID1).line, 'kimi --session ' + ID1);
  assert.equal(buildResume('bash', ID1), null);
  assert.equal(buildResume('claude', 'x; rm -rf ~'), null);
  assert.equal(buildResume('claude', ID1 + ' --dangerously-skip-permissions'), null);
});

test('sanitizeNativeSession drops invalid records and keeps clean ones', () => {
  assert.deepEqual(sanitizeNativeSession(rec()), rec());
  assert.equal(sanitizeNativeSession(null), null);
  assert.equal(sanitizeNativeSession([]), null);
  assert.equal(sanitizeNativeSession(rec({ provider: 'x' })), null);
  assert.equal(sanitizeNativeSession(rec({ nativeSessionId: '$(id)xxxxxx' })), null);
  assert.equal(sanitizeNativeSession(rec({ accountId: 'bad id!' })).accountId, null);
});

test('resumePlan: exact with ID, reasons without', () => {
  const ok = resumePlan({ provider: 'claude', stored: rec(), currentAccountId: 'acc1', projectId: 'p1' });
  assert.equal(ok.exact, true);
  assert.equal(ok.command, 'claude --resume ' + ID1);
  const none = resumePlan({ provider: 'claude', stored: null });
  assert.deepEqual([none.exact, none.command], [false, null]);
  assert.match(none.reason, /Keine Gesprächs-ID/);
  assert.match(resumePlan({ provider: 'claude', stored: rec({ nativeSessionId: 'bad;id;bad' }) }).reason, /ungültig/);
  assert.match(resumePlan({ provider: 'codex', stored: rec() }).reason, /anderen Anbieter/);
  assert.match(resumePlan({ provider: 'claude', stored: rec(), currentAccountId: 'acc2' }).reason, /anderen Konto/);
  assert.match(resumePlan({ provider: 'claude', stored: rec(), currentAccountId: 'acc1', projectId: 'p2' }).reason, /anderen Projekt/);
  assert.match(resumePlan({ provider: 'custom', stored: rec() }).reason, /ohne feste/);
  assert.equal(resumePlan({}).exact, false);
});

test('injection attempt in a stored ID never yields a command', () => {
  for (const evil of ['x;touch /tmp/pwn', ID1 + '`id`', ID1 + '\nrm -rf ~', "' || echo '"]) {
    const p = resumePlan({ provider: 'claude', stored: rec({ nativeSessionId: evil }) });
    assert.equal(p.exact, false);
    assert.equal(p.command, null);
  }
});

test('service keeps two tiles of the same provider apart and ignores unbelegte events', () => {
  const s = createAgentSessionService();
  const ev = (terminalId, id, at, extra = {}) => ({ terminalId, provider: 'claude', accountId: 'acc1', projectId: 'p1', nativeSessionId: id, observedAt: at, ...extra });
  assert.ok(s.observe(ev('t1', ID1, 100)));
  assert.ok(s.observe(ev('t2', ID2, 100)));
  assert.equal(s.get('t1').nativeSessionId, ID1);
  assert.equal(s.get('t2').nativeSessionId, ID2);
  assert.equal(s.observe(ev('t1', ID1, 200)), null, 'duplicate');
  assert.equal(s.observe(ev('t1', ID2, 50)), null, 'stale');
  assert.equal(s.get('t1').nativeSessionId, ID1);
  assert.ok(s.observe(ev('t1', ID2, 300)), 'newer ID (e.g. after /clear) wins');
  assert.equal(s.observe(ev('t3', undefined, 100)), null, 'no ID, nothing guessed');
  assert.equal(s.get('t3'), null);
  assert.equal(s.observe(ev('t4', 'bad;id;bad', 100)), null);
  assert.equal(s.observe(ev('../t', ID1, 100)), null);
  assert.equal(s.forget('t1'), true);
  assert.equal(s.get('t1'), null);
});

test('hook events through the status store reach the service per tile, with account', () => {
  const store = createAgentStatusStore({ now: () => 1000 });
  const s = createAgentSessionService();
  const feed = (tid, sid, acc) => {
    const r = store.ingest(tid, { hook_event_name: 'SessionStart', session_id: sid }, { projectId: 'p1', accountId: acc, provider: 'claude' });
    return r.entry && r.entry.nativeSessionId ? s.observe(r.entry) : null;
  };
  assert.ok(feed('t1', ID1, 'acc1'));
  assert.ok(feed('t2', ID2, 'acc2'));
  assert.equal(resumePlan({ provider: 'claude', stored: s.get('t2'), currentAccountId: 'acc2', projectId: 'p1' }).command, 'claude --resume ' + ID2);
  assert.equal(resumePlan({ provider: 'claude', stored: s.get('t1'), currentAccountId: 'acc1', projectId: 'p1' }).command, 'claude --resume ' + ID1);
  assert.equal(feed('t3', undefined, 'acc1'), null);
});
