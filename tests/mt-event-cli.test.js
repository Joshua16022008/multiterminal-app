'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const { createBrowserBridge } = require('../src/main/browser-bridge');
const { createAgentStatusStore } = require('../src/main/agent-events');
const { buildEventArgs, buildRequest, run } = require('../src/main/mt-event-cli');

// Async on purpose: the bridge lives in this process and must keep answering.
function runProcess(args, input, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env });
    let out = 0;
    child.stdout.on('data', (d) => { out += d.length; });
    child.stderr.on('data', (d) => { out += d.length; });
    child.on('close', (status) => resolve({ status, out }));
    child.stdin.end(input);
  });
}

const CLI = path.join(__dirname, '..', 'src', 'main', 'mt-event-cli.js');

async function bridgeWithStore() {
  const dir = fs.mkdtempSync('/tmp/mte-');
  const store = createAgentStatusStore();
  const bridge = createBrowserBridge({
    socketPath: path.join(dir, 's', 'b.sock'),
    handler: async () => 'browser',
    eventHandler: (terminalId, args) => store.ingest(terminalId, args, { projectId: 'p', accountId: 'a' }),
  });
  await bridge.start();
  return { dir, store, bridge, cleanup: async () => { await bridge.stop(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const stdinOf = (obj) => Readable.from([typeof obj === 'string' ? obj : JSON.stringify(obj)]);
const FIXTURES = [
  [{ hook_event_name: 'SessionStart', session_id: 'sid', source: 'startup' }, 'unknown'],
  [{ hook_event_name: 'UserPromptSubmit', session_id: 'sid', prompt: 'SECRET PROMPT' }, 'working'],
  [{ hook_event_name: 'Notification', session_id: 'sid', notification_type: 'permission_prompt', message: 'Claude needs your permission' }, 'needs-input'],
  [{ hook_event_name: 'PermissionRequest', session_id: 'sid', tool_name: 'Bash', tool_input: { command: 'rm x' } }, 'needs-input'],
  [{ hook_event_name: 'Stop', session_id: 'sid', last_assistant_message: 'SECRET ANSWER', transcript_path: '/secret' }, 'turn-complete'],
  [{ hook_event_name: 'StopFailure', session_id: 'sid', error: 'rate_limit', error_details: '429' }, 'error'],
];

test('buildEventArgs keeps only the five allowed fields and never prompts or answers', () => {
  const a = buildEventArgs({ hook_event_name: 'Stop', session_id: 's', prompt: 'P', last_assistant_message: 'A', transcript_path: '/t', cwd: '/c', error: 'rate_limit', notification_type: 'x' }, 'Stop', 99);
  assert.deepEqual(a, { hook_event_name: 'Stop', at: 99, notification_type: 'x', session_id: 's', error: 'rate_limit' });
  assert.equal(buildEventArgs(null, 'Stop', 1).hook_event_name, 'Stop'); // name from argv when stdin is unusable
  assert.equal(buildEventArgs(null, undefined, 1), null);
  assert.equal(buildRequest({}, { hook_event_name: 'Stop' }), null);
  assert.equal(buildRequest({ MULTITERMINAL_BROWSER_SOCK: '/s' }, { hook_event_name: 'Stop' }), null);
});

test('hook JSON of every event over stdin lands in the store of the right terminal', async () => {
  const ctx = await bridgeWithStore();
  try {
    const t1 = ctx.bridge.register('one');
    ctx.bridge.register('two');
    let time = Date.now();
    for (const [input, state] of FIXTURES) {
      const env = ctx.bridge.envFor('one');
      assert.equal(await run([input.hook_event_name], env, { stdin: stdinOf(input) }), 0);
      assert.equal(ctx.store.get('one').state, state, input.hook_event_name);
      time += 3000;
      await new Promise((r) => setTimeout(r, 2));
    }
    assert.equal(ctx.store.get('one').nativeSessionId, 'sid');
    assert.equal(ctx.store.get('one').errorType, 'rate_limit');
    assert.equal(ctx.store.get('two'), null);
    assert.equal(JSON.stringify(ctx.store.list()).includes('SECRET'), false);
    assert.ok(t1);
  } finally { await ctx.cleanup(); }
});

test('wrong, missing or foreign token changes nothing and still exits 0', async () => {
  const ctx = await bridgeWithStore();
  try {
    ctx.bridge.register('one');
    const good = ctx.bridge.envFor('one');
    const input = { hook_event_name: 'Stop', session_id: 's' };
    for (const env of [
      { ...good, MULTITERMINAL_BROWSER_TOKEN: 'wrong' },
      { MULTITERMINAL_BROWSER_SOCK: good.MULTITERMINAL_BROWSER_SOCK },
      { MULTITERMINAL_BROWSER_TOKEN: good.MULTITERMINAL_BROWSER_TOKEN },
      {},
    ]) assert.equal(await run(['Stop'], env, { stdin: stdinOf(input) }), 0);
    assert.deepEqual(ctx.store.list(), []);
  } finally { await ctx.cleanup(); }
});

test('broken stdin, missing socket and silent bridge all end with exit 0 inside the time limit', async () => {
  assert.equal(await run(['Stop'], { MULTITERMINAL_BROWSER_SOCK: '/nonexistent/x.sock', MULTITERMINAL_BROWSER_TOKEN: 't' }, { stdin: stdinOf({ hook_event_name: 'Stop' }) }), 0);
  assert.equal(await run(['Stop'], {}, { stdin: stdinOf('not json at all') }), 0);
  // a server that accepts and never answers: stopped by the time limit
  const net = require('net');
  const dir = fs.mkdtempSync('/tmp/mte-');
  const sock = path.join(dir, 'h.sock');
  const srv = net.createServer(() => {});
  await new Promise((r) => srv.listen(sock, r));
  try {
    const t = Date.now();
    assert.equal(await run(['Stop'], { MULTITERMINAL_BROWSER_SOCK: sock, MULTITERMINAL_BROWSER_TOKEN: 't' }, { stdin: stdinOf({ hook_event_name: 'Stop' }), totalTimeoutMs: 300 }), 0);
    assert.ok(Date.now() - t < 1000, 'stopped by the time limit');
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the real process prints nothing on stdout or stderr and exits 0, with and without a bridge', async () => {
  const ctx = await bridgeWithStore();
  try {
    ctx.bridge.register('one');
    const input = JSON.stringify({ hook_event_name: 'Stop', session_id: 's' });
    const withBridge = await runProcess([CLI, 'Stop'], input, { ...process.env, ...ctx.bridge.envFor('one') });
    assert.equal(withBridge.status, 0);
    assert.equal(withBridge.out, 0);
    assert.equal(ctx.store.get('one').state, 'turn-complete');
    const env = { ...process.env };
    delete env.MULTITERMINAL_BROWSER_SOCK; delete env.MULTITERMINAL_BROWSER_TOKEN;
    const without = await runProcess([CLI, 'Stop'], input, env);
    assert.equal(without.status, 0);
    assert.equal(without.out, 0);
  } finally { await ctx.cleanup(); }
});
