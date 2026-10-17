'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryCapture, MAX_EXCERPT_CHARS } = require('../src/main/memory-capture');

function setup(t, opts = {}) {
  const calls = [];
  const settings = { enabled: true, autoCapture: true };
  const capture = createMemoryCapture({ memory: { getSettings: () => ({ ...settings }), checkpoint: (projectId, input) => calls.push({ projectId, input }) }, ...opts });
  t.after(() => capture.dispose());
  capture.attach({ terminalId: 't1', projectId: 'p1', provider: 'codex', cwd: '/p/worktree', workspaceId: 'w1' });
  return { calls, settings, capture };
}

test('capture cleans ANSI across chunks and redacts common credentials before persistence', (t) => {
  const { capture, calls } = setup(t);
  capture.feed('t1', '\x1b[3');
  capture.feed('t1', '1mresult\x1b[0m\n\x1b]0;private title');
  capture.feed('t1', '\x07API_KEY=sk-secret123\nAuthorization: Bearer secretBearer\nhttps://user:password@example.com\n');
  capture.flush('t1');
  assert.equal(calls.length, 1);
  const { input, projectId } = calls[0];
  assert.equal(projectId, 'p1');
  assert.equal(input.source, 'terminal');
  assert.equal(input.cwd, '/p/worktree');
  assert.match(input.summary, /result/);
  assert.doesNotMatch(input.summary, /\x1b|private title|secret123|secretBearer|password/);
  assert.match(input.summary, /REDACTED/);
});

test('capture throttles disk work, bounds tails, flushes all and detach releases terminal', async (t) => {
  const { capture, calls } = setup(t, { flushIntervalMs: 25 });
  capture.feed('t1', 'a'.repeat(MAX_EXCERPT_CHARS * 3) + 'tail');
  assert.equal(calls.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.summary.length, MAX_EXCERPT_CHARS);
  assert.ok(calls[0].input.summary.endsWith('tail'));
  capture.feed('t1', ' final');
  capture.detach('t1');
  assert.equal(calls.length, 2);
  capture.feed('t1', 'ignored');
  capture.flush();
  assert.equal(calls.length, 2);
});

test('disabled capture and scope clear discard pending text, errors never escape feed/flush/dispose', (t) => {
  const { capture, settings, calls } = setup(t);
  capture.feed('t1', 'before clear');
  capture.clear('p1');
  capture.flush();
  assert.equal(calls.length, 0);
  capture.feed('t1', 'pending before disable');
  settings.enabled = false;
  capture.flush();
  settings.enabled = true;
  capture.feed('t1', 'after enable');
  capture.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.summary, 'after enable');
  settings.autoCapture = false;
  capture.feed('t1', 'disabled output');
  settings.autoCapture = true;
  capture.flush();
  assert.equal(calls.length, 1);
  const errors = [];
  const failing = createMemoryCapture({ memory: { getSettings: () => ({ enabled: true, autoCapture: true }), checkpoint: () => { throw Error('disk full'); } }, onError: (e) => errors.push(e.message) });
  failing.attach({ terminalId: 't', projectId: 'p' });
  failing.feed('t', 'output');
  assert.doesNotThrow(() => failing.dispose());
  assert.deepEqual(errors, ['disk full']);
});

test('redaction survives split token keys and oversized credential lines, including private key blocks', (t) => {
  const { capture, calls } = setup(t);
  capture.feed('t1', 'MULTITERMINAL_BROW');
  capture.feed('t1', 'SER_TOKEN=');
  capture.flush();
  capture.feed('t1', 'leaked-secret'.repeat(4000));
  capture.feed('t1', '\n-----BEGIN PRIVATE KEY-----\nabc123privatebody\n-----END PRIVATE KEY-----\nsafe\n');
  capture.flush();
  for (const call of calls) assert.doesNotMatch(call.input.summary, /leaked-secret|abc123privatebody/);
  assert.match(calls.at(-1).input.summary, /safe/);
  assert.ok(calls.at(-1).input.summary.length <= MAX_EXCERPT_CHARS);
  capture.clear('p1');
  const bridgeToken = 'a1b2c3'.repeat(8);
  capture.feed('t1', bridgeToken.slice(0, 21));
  capture.feed('t1', bridgeToken.slice(21) + '\n');
  capture.flush();
  assert.doesNotMatch(calls.at(-1).input.summary, new RegExp(bridgeToken));
  assert.match(calls.at(-1).input.summary, /REDACTED/);
});

test('clear discards only the matching project and escape payloads never become stored text', (t) => {
  const { capture, calls } = setup(t);
  capture.attach({ terminalId: 't2', projectId: 'p2' });
  capture.feed('t1', 'clear this');
  capture.feed('t2', '\x1bP' + 'hidden'.repeat(5000));
  capture.feed('t2', '\x1b');
  capture.feed('t2', '\\keep this\n');
  capture.clear('p1');
  capture.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].projectId, 'p2');
  assert.equal(calls[0].input.summary, 'keep this');
});
