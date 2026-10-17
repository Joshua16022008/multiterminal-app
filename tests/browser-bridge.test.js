'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { createBrowserBridge } = require('../src/main/browser-bridge.js');

// Unix socket paths are short-limited, so the temp folder lives directly in /tmp.
function tmpDir() {
  return fs.mkdtempSync('/tmp/mtb-');
}

function ask(sock, payload) {
  return new Promise((resolve, reject) => {
    const c = net.connect(sock);
    let data = '';
    c.on('connect', () => c.write(typeof payload === 'string' ? payload : JSON.stringify(payload) + '\n'));
    c.on('data', (d) => { data += d; });
    c.on('error', reject);
    c.on('close', () => resolve(JSON.parse(data.split('\n')[0])));
  });
}

async function setup(handler, opts) {
  const dir = tmpDir();
  const sub = path.join(dir, 's');
  const calls = [];
  const bridge = createBrowserBridge({
    socketPath: path.join(sub, 'b.sock'),
    handler: handler || (async (id, cmd, args) => { calls.push({ id, cmd, args }); return 'done'; }),
    ...opts,
  });
  await bridge.start();
  return { bridge, calls, dir, sub, sock: bridge.socketPath };
}

async function cleanup(ctx) {
  await ctx.bridge.stop();
  fs.rmSync(ctx.dir, { recursive: true, force: true });
}

test('valid token runs the command for exactly its terminal', async () => {
  const ctx = await setup();
  try {
    const a = ctx.bridge.register('t1');
    const b = ctx.bridge.register('t2');
    const r = await ask(ctx.sock, { token: b, cmd: 'reload', args: {} });
    assert.deepStrictEqual(r, { ok: true, result: 'done' });
    assert.deepStrictEqual(ctx.calls, [{ id: 't2', cmd: 'reload', args: {} }]);
    assert.notStrictEqual(a, b);
  } finally { await cleanup(ctx); }
});

test('wrong, missing and unregistered tokens are refused without detail', async () => {
  const ctx = await setup();
  try {
    const t = ctx.bridge.register('t1');
    for (const token of ['nope', '', undefined, 5, t + 'x']) {
      const r = await ask(ctx.sock, { token, cmd: 'url' });
      assert.deepStrictEqual(r, { ok: false, error: 'Nicht berechtigt.' });
    }
    ctx.bridge.unregister('t1');
    assert.strictEqual((await ask(ctx.sock, { token: t, cmd: 'url' })).ok, false);
    assert.strictEqual(ctx.calls.length, 0);
  } finally { await cleanup(ctx); }
});

test('envFor hands out socket and token of one terminal only', async () => {
  const ctx = await setup();
  try {
    const t = ctx.bridge.register('t1');
    assert.deepStrictEqual(ctx.bridge.envFor('t1'), { MULTITERMINAL_BROWSER_SOCK: ctx.sock, MULTITERMINAL_BROWSER_TOKEN: t });
    assert.deepStrictEqual(ctx.bridge.envFor('other'), {});
    ctx.bridge.unregister('t1');
    assert.deepStrictEqual(ctx.bridge.envFor('t1'), {});
  } finally { await cleanup(ctx); }
});

test('unknown commands are rejected', async () => {
  const ctx = await setup();
  try {
    const t = ctx.bridge.register('t1');
    for (const cmd of ['eval', 'exec', '', 5, undefined]) {
      const r = await ask(ctx.sock, { token: t, cmd });
      assert.strictEqual(r.ok, false);
      assert.match(r.error, /Unbekannter Befehl/);
    }
    assert.strictEqual(ctx.calls.length, 0);
  } finally { await cleanup(ctx); }
});

test('open normalizes addresses and refuses non-web schemes', async () => {
  const ctx = await setup();
  try {
    const t = ctx.bridge.register('t1');
    const r = await ask(ctx.sock, { token: t, cmd: 'open', args: { url: 'localhost:3000/app' } });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(ctx.calls[0].args, { url: 'http://localhost:3000/app' });
    await ask(ctx.sock, { token: t, cmd: 'open', args: { url: 'example.com' } });
    assert.strictEqual(ctx.calls[1].args.url, 'https://example.com/');
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x.de', '', '   ', 7]) {
      const bad = await ask(ctx.sock, { token: t, cmd: 'open', args: { url } });
      assert.strictEqual(bad.ok, false, String(url));
    }
    assert.strictEqual((await ask(ctx.sock, { token: t, cmd: 'open' })).ok, false);
    assert.strictEqual(ctx.calls.length, 2);
  } finally { await cleanup(ctx); }
});

test('isAllowedUrl can narrow the allowed addresses', async () => {
  const ctx = await setup(null, { isAllowedUrl: (u) => u.startsWith('http://localhost') });
  try {
    const t = ctx.bridge.register('t1');
    assert.strictEqual((await ask(ctx.sock, { token: t, cmd: 'open', args: { url: 'localhost:1' } })).ok, true);
    assert.strictEqual((await ask(ctx.sock, { token: t, cmd: 'open', args: { url: 'https://example.com' } })).ok, false);
  } finally { await cleanup(ctx); }
});

test('optional args are validated and unknown ones are dropped', async () => {
  const ctx = await setup();
  try {
    const t = ctx.bridge.register('t1');
    await ask(ctx.sock, { token: t, cmd: 'console', args: { limit: 5, evil: 1 } });
    await ask(ctx.sock, { token: t, cmd: 'screenshot', args: { out: '/tmp/x.png' } });
    assert.deepStrictEqual(ctx.calls.map((c) => c.args), [{ limit: 5 }, { out: '/tmp/x.png' }]);
    assert.strictEqual((await ask(ctx.sock, { token: t, cmd: 'text', args: { limit: -1 } })).ok, false);
    assert.strictEqual((await ask(ctx.sock, { token: t, cmd: 'text', args: { limit: '5' } })).ok, false);
    assert.strictEqual((await ask(ctx.sock, { token: t, cmd: 'screenshot', args: { out: 5 } })).ok, false);
  } finally { await cleanup(ctx); }
});

test('handler errors become the error message', async () => {
  const ctx = await setup(async () => { throw new Error('Browser ist nicht offen.'); });
  try {
    const t = ctx.bridge.register('t1');
    assert.deepStrictEqual(await ask(ctx.sock, { token: t, cmd: 'reload' }), { ok: false, error: 'Browser ist nicht offen.' });
  } finally { await cleanup(ctx); }
});

test('a handler that never answers runs into the time limit', async () => {
  const ctx = await setup(() => new Promise(() => {}), { handlerTimeoutMs: 100 });
  try {
    const t = ctx.bridge.register('t1');
    const r = await ask(ctx.sock, { token: t, cmd: 'reload' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Zeitüberschreitung/);
  } finally { await cleanup(ctx); }
});

test('broken JSON and non-object requests get a clean answer', async () => {
  const ctx = await setup();
  try {
    assert.deepStrictEqual(await ask(ctx.sock, '{not json\n'), { ok: false, error: 'Ungültiges JSON.' });
    assert.strictEqual((await ask(ctx.sock, '[1]\n')).ok, false);
    assert.strictEqual((await ask(ctx.sock, 'null\n')).ok, false);
  } finally { await cleanup(ctx); }
});

test('oversized requests are refused', async () => {
  const ctx = await setup();
  try {
    const r = await ask(ctx.sock, 'x'.repeat(200 * 1024));
    assert.deepStrictEqual(r, { ok: false, error: 'Anfrage zu groß.' });
  } finally { await cleanup(ctx); }
});

test('a request that never ends is cut off by the read timeout', async () => {
  const ctx = await setup(null, { requestTimeoutMs: 100 });
  try {
    const r = await ask(ctx.sock, '{"token":');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Zeitüberschreitung/);
  } finally { await cleanup(ctx); }
});

test('socket file and a folder created by the bridge are private', async () => {
  const ctx = await setup();
  try {
    assert.strictEqual(fs.statSync(ctx.sock).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(ctx.sub).mode & 0o777, 0o700);
  } finally { await cleanup(ctx); }
});

test('stop removes the socket file', async () => {
  const ctx = await setup();
  await ctx.bridge.stop();
  assert.strictEqual(fs.existsSync(ctx.sock), false);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('an orphaned socket file is replaced, a live server is not', async () => {
  const dir = tmpDir();
  const sock = path.join(dir, 'b.sock');
  try {
    // Leave a stale socket file behind: bind, then destroy the server's fd without unlinking.
    const child = require('child_process').spawnSync(process.execPath, ['-e',
      `const s=require('net').createServer().listen(${JSON.stringify(sock)},()=>process.kill(process.pid,'SIGKILL'))`]);
    assert.ok(child.signal === 'SIGKILL' || child.status !== 0);
    assert.strictEqual(fs.existsSync(sock), true);
    const first = createBrowserBridge({ socketPath: sock, handler: async () => 'ok' });
    await first.start();
    const t = first.register('t1');
    assert.strictEqual((await ask(sock, { token: t, cmd: 'url' })).ok, true);
    const second = createBrowserBridge({ socketPath: sock, handler: async () => 'ok' });
    await assert.rejects(second.start(), /läuft bereits/);
    assert.strictEqual(fs.existsSync(sock), true);
    await first.stop();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a too long socket path is refused with a clear message', async () => {
  const bridge = createBrowserBridge({ socketPath: '/tmp/' + 'a'.repeat(120) + '/b.sock', handler: async () => null });
  await assert.rejects(bridge.start(), /Socket-Pfad zu lang/);
});

test('construction checks its arguments', () => {
  assert.throws(() => createBrowserBridge({ socketPath: 'rel.sock', handler: () => {} }), /absolut/);
  assert.throws(() => createBrowserBridge({ socketPath: '/tmp/x.sock' }), /handler/);
});

test('the read timeout does not cut off a slow handler', async () => {
  const ctx = await setup(() => new Promise((r) => setTimeout(() => r('late'), 300)), { requestTimeoutMs: 100 });
  try {
    const t = ctx.bridge.register('t1');
    assert.deepStrictEqual(await ask(ctx.sock, { token: t, cmd: 'reload' }), { ok: true, result: 'late' });
  } finally { await cleanup(ctx); }
});

test('event command goes to the event handler only, with the terminal of the token and cleaned fields', async () => {
  const events = [];
  const ctx = await setup(undefined, { eventHandler: async (id, args) => { events.push({ id, args }); } });
  try {
    const t = ctx.bridge.register('t7');
    const r = await ask(ctx.sock, {
      token: t, cmd: 'event',
      args: { hook_event_name: 'Notification', notification_type: 'permission_prompt', session_id: 's1', at: 5, prompt: 'geheim', transcript_path: '/x', error: 'rate_limit' },
    });
    assert.deepStrictEqual(r, { ok: true, result: null });
    assert.deepStrictEqual(events, [{ id: 't7', args: { hook_event_name: 'Notification', notification_type: 'permission_prompt', session_id: 's1', error: 'rate_limit', at: 5 } }]);
    assert.deepStrictEqual(ctx.calls, []); // the browser handler never saw it
  } finally { await cleanup(ctx); }
});

test('event command refuses unknown events, bad tokens and a bridge without event handler', async () => {
  const events = [];
  const ctx = await setup(undefined, { eventHandler: (id, args) => { events.push({ id, args }); } });
  try {
    const t = ctx.bridge.register('t1');
    assert.strictEqual((await ask(ctx.sock, { token: t, cmd: 'event', args: { hook_event_name: 'PreToolUse' } })).ok, false);
    assert.strictEqual((await ask(ctx.sock, { token: t, cmd: 'event', args: {} })).ok, false);
    assert.strictEqual((await ask(ctx.sock, { token: 'bad', cmd: 'event', args: { hook_event_name: 'Stop' } })).error, 'Nicht berechtigt.');
    assert.deepStrictEqual(events, []);
  } finally { await cleanup(ctx); }
  const plain = await setup();
  try {
    const t = plain.bridge.register('t1');
    const r = await ask(plain.sock, { token: t, cmd: 'event', args: { hook_event_name: 'Stop' } });
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(plain.calls, []);
  } finally { await cleanup(plain); }
});

test('memory routing authenticates terminal identity, never invokes browser, and rejects scope/provenance overrides', async () => {
  const memoryCalls = [];
  const ctx = await setup(undefined, { memoryHandler: async (id, operation, input) => { memoryCalls.push({ id, operation, input }); return operation === 'read' ? '# Memory' : { saved: true }; } });
  try {
    const token = ctx.bridge.register('t-memory');
    assert.deepStrictEqual(await ask(ctx.sock, { token, cmd: 'memory-read' }), { ok: true, result: '# Memory' });
    assert.deepStrictEqual(await ask(ctx.sock, { token, cmd: 'memory-save', args: { summary: 'done', nextStep: 'review' } }), { ok: true, result: { saved: true } });
    assert.deepStrictEqual(memoryCalls, [{ id: 't-memory', operation: 'read', input: {} }, { id: 't-memory', operation: 'save', input: { summary: 'done', nextStep: 'review' } }]);
    for (const args of [{ projectId: 'another' }, { notes: 'bad' }, { source: 'manual', summary: 'x' }, { cwd: '/other', summary: 'x' }, { terminalId: 'other', summary: 'x' }, { summary: 'x'.repeat(8001) }, { summary: 4 }, []]) {
      assert.strictEqual((await ask(ctx.sock, { token, cmd: 'memory-save', args })).ok, false);
    }
    assert.strictEqual((await ask(ctx.sock, { token, cmd: 'memory-read', args: { projectId: 'other' } })).ok, false);
    assert.strictEqual((await ask(ctx.sock, { token: 'bad', cmd: 'memory-read' })).error, 'Nicht berechtigt.');
    assert.strictEqual(memoryCalls.length, 2);
    assert.deepStrictEqual(ctx.calls, []);
  } finally { await cleanup(ctx); }
  const plain = await setup();
  try {
    const token = plain.bridge.register('t');
    assert.strictEqual((await ask(plain.sock, { token, cmd: 'memory-read' })).ok, false);
    assert.deepStrictEqual(plain.calls, []);
  } finally { await cleanup(plain); }
});

test('memory handlers share the finite execution deadline', async () => {
  const ctx = await setup(undefined, { memoryHandler: () => new Promise(() => {}), handlerTimeoutMs: 25 });
  try {
    const token = ctx.bridge.register('t');
    const result = await ask(ctx.sock, { token, cmd: 'memory-read' });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /Zeitüberschreitung/);
  } finally { await cleanup(ctx); }
});

test('strict task route authenticates and preserves task-only handler boundary', async () => {
  const calls=[];
  const ctx=await setup(undefined,{taskHandler:(id,operation,input)=>{calls.push({id,operation,input});return {id:'result'};}});
  try {
    const token=ctx.bridge.register('task-source');
    const valid=[['peers',{}],['list',{box:'inbox'}],['get',{id:'a'}],['send',{to:'target',title:'t',text:'x',requestId:'r'}],['send',{provider:'claude',title:'t',text:'x',parentId:'a',dependsOn:['b'],requestId:'s'}],['accept',{id:'a'}],['reply',{id:'a',status:'completed',text:'done'}],['cancel',{id:'a'}]];
    for(const [op,args] of valid) assert.strictEqual((await ask(ctx.sock,{token,cmd:'task-'+op,args})).ok,true);
    assert.strictEqual(calls.length,8);assert.strictEqual(calls[0].id,'task-source');assert.deepStrictEqual(ctx.calls,[]);
    const bad=[['peers',{projectId:'x'}],['get',{id:'a',sourceTerminalId:'other'}],['send',{to:'x',provider:'codex',title:'x',text:'x',requestId:'a'}],['send',{provider:'kimi',title:'x',text:'x',requestId:'a'}],['send',{to:'x',title:'x',text:'x'.repeat(3001),requestId:'a'}],['reply',{id:'a',status:'running',text:'x'}],['reply',{id:'a',status:'failed',text:'x'.repeat(16001)}],['list',{box:'foreign'}],['wat',{}],['cancel',[]]];
    for(const [op,args] of bad) assert.strictEqual((await ask(ctx.sock,{token,cmd:'task-'+op,args})).ok,false);
    assert.strictEqual((await ask(ctx.sock,{token,cmd:'task-peers',projectId:'spoof'})).ok,false);
    assert.strictEqual(calls.length,8);
  } finally { await cleanup(ctx); }
  const plain=await setup();try {const token=plain.bridge.register('t'); assert.strictEqual((await ask(plain.sock,{token,cmd:'task-peers'})).ok,false);} finally {await cleanup(plain);}
});
