'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { createPmBridge, validateCommand, cleanText, COMMANDS } = require('../src/main/pm-bridge.js');
const { createPmService } = require('../src/main/pm-service.js');
const { createOutputBuffer } = require('../src/main/output-buffer.js');

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

async function setup(opts = {}) {
  const dir = fs.mkdtempSync('/tmp/mtpm-');
  const sends = [];
  const outputBuffer = createOutputBuffer();
  outputBuffer.append('t1', 'zeile eins\nzeile zwei\n');
  outputBuffer.append('t3', 'fremd\n');
  const projects = { p1: { id: 'p1', name: 'Eins', path: '/tmp/e1' }, p2: { id: 'p2', name: 'Zwei', path: '/tmp/e2' } };
  const service = createPmService({
    getProject: (id) => projects[id] || null,
    getSessionTerminals: (id) => (id === 'p1'
      ? [{ id: 't1', title: 'Backend' }, { id: 't2', title: 'Beendet' }, { id: 'd1', title: 'Doppelt' }, { id: 'd2', title: 'Doppelt' }]
      : [{ id: 't3', title: 'Fremd' }]),
    getAgentStates: () => [],
    ptySnapshot: () => [
      { terminalId: 't1', projectId: 'p1' }, { terminalId: 'd1', projectId: 'p1' }, { terminalId: 'd2', projectId: 'p1' },
      { terminalId: 'pm-p1', projectId: 'p1' }, { terminalId: 't3', projectId: 'p2' },
    ],
    worktrees: { list: async () => [], inspect: async () => ({ ok: true, exists: true, changes: 0 }) },
    diffs: { listChanges: async () => ({ ok: true, branch: 'main', files: [] }) },
    ports: { list: async () => ({ ok: true, entries: [{ port: 3000, projectId: 'p1', terminalId: 't1', url: 'http://localhost:3000' }] }) },
    readDocs: () => ({ projectStatus: '## Nächster Schritt\n\nWeiter.\n' }),
    gitInfo: async () => ({ log: 'l', branches: 'b' }),
    outputBuffer,
  });
  const bridge = createPmBridge({
    socketPath: path.join(dir, 's', 'pm.sock'),
    service,
    requestSend: opts.requestSend || (async (req) => { sends.push(req); return { ok: true }; }),
    ...opts.bridge,
  });
  await bridge.start();
  const tokens = { p1: bridge.register('p1'), p2: bridge.register('p2') };
  return { bridge, sends, dir, sock: bridge.socketPath, tokens };
}

async function cleanup(ctx) {
  await ctx.bridge.stop();
  fs.rmSync(ctx.dir, { recursive: true, force: true });
}

test('Socket ist nur für den Besitzer, Token und Umgebung je Projekt', async () => {
  const ctx = await setup();
  try {
    assert.strictEqual(fs.statSync(ctx.sock).mode & 0o777, 0o600);
    const env = ctx.bridge.envFor('p1');
    assert.strictEqual(env.MULTITERMINAL_PM_SOCKET, ctx.sock);
    assert.strictEqual(env.MULTITERMINAL_PM_TOKEN, ctx.tokens.p1);
    assert.notStrictEqual(ctx.tokens.p1, ctx.tokens.p2);
    assert.deepStrictEqual(ctx.bridge.envFor('unbekannt'), {});
  } finally { await cleanup(ctx); }
});

test('Anfragen ohne oder mit falschem Token werden abgelehnt', async () => {
  const ctx = await setup();
  try {
    for (const bad of [{ cmd: 'status' }, { token: 'x', cmd: 'status' }, { token: 42, cmd: 'status' }, { token: ctx.tokens.p1 + 'a', cmd: 'status' }]) {
      const r = await ask(ctx.sock, bad);
      assert.deepStrictEqual(r, { ok: false, error: 'Nicht berechtigt.' });
    }
    ctx.bridge.unregister('p1');
    assert.strictEqual((await ask(ctx.sock, { token: ctx.tokens.p1, cmd: 'status' })).ok, false);
    assert.strictEqual((await ask(ctx.sock, { token: ctx.tokens.p2, cmd: 'status' })).ok, true);
  } finally { await cleanup(ctx); }
});

test('Befehlsliste und Ergebnisse; Token ist an sein Projekt gebunden', async () => {
  const ctx = await setup();
  try {
    assert.deepStrictEqual([...COMMANDS], ['status', 'output', 'changes', 'ports', 'docs', 'send']);
    const s = await ask(ctx.sock, { token: ctx.tokens.p1, cmd: 'status' });
    assert.strictEqual(s.ok, true);
    assert.strictEqual(s.result.project.id, 'p1');
    assert.ok(!s.result.terminals.some((t) => t.id === 'pm-p1' || t.id === 't3'));
    const s2 = await ask(ctx.sock, { token: ctx.tokens.p2, cmd: 'status' });
    assert.strictEqual(s2.result.project.id, 'p2');
    const o = await ask(ctx.sock, { token: ctx.tokens.p1, cmd: 'output', args: { terminal: 'Backend', lines: 1 } });
    assert.deepStrictEqual(o.result.lines, ['zeile zwei']);
    assert.strictEqual(o.result.title, 'Backend');
    assert.strictEqual((await ask(ctx.sock, { token: ctx.tokens.p1, cmd: 'ports' })).result.ports[0].port, 3000);
    assert.strictEqual((await ask(ctx.sock, { token: ctx.tokens.p1, cmd: 'changes' })).ok, true);
    assert.strictEqual((await ask(ctx.sock, { token: ctx.tokens.p1, cmd: 'docs' })).result.gitLog, 'l');
    // Fremde Kachel (anderes Projekt) ist über dieses Token nicht lesbar
    const foreign = await ask(ctx.sock, { token: ctx.tokens.p1, cmd: 'output', args: { terminal: 't3' } });
    assert.strictEqual(foreign.ok, false);
    assert.match(foreign.error, /Keine Kachel/);
    const bad = await ask(ctx.sock, { token: ctx.tokens.p1, cmd: 'rm' });
    assert.strictEqual(bad.ok, false);
    assert.match(bad.error, /Unbekannter Befehl/);
  } finally { await cleanup(ctx); }
});

test('send legt nur eine Vorschau an: richtige Kachel, bereinigter Text, Antworttext', async () => {
  const ctx = await setup();
  try {
    const r = await ask(ctx.sock, { token: ctx.tokens.p1, cmd: 'send', args: { terminal: 'Backend', text: 'Mach\x1b[31m das\r\n\tund dies\x07' } });
    assert.deepStrictEqual(r, { ok: true, result: 'In Promptvorschau von Backend gelegt – wartet auf Bestätigung durch Joshua.' });
    assert.deepStrictEqual(ctx.sends, [{ projectId: 'p1', terminalId: 't1', text: 'Mach[31m das\nund dies' }]);
  } finally { await cleanup(ctx); }
});

test('send: nie an den Manager, fremdes Projekt, beendete Kachel, mehrdeutigen Titel', async () => {
  const ctx = await setup();
  try {
    const t = ctx.tokens.p1;
    for (const [terminal, re] of [['pm-p1', /Keine Kachel/], ['t3', /Keine Kachel/], ['t2', /läuft nicht/], ['Doppelt', /mehrdeutig/], ['nix', /Keine Kachel/]]) {
      const r = await ask(ctx.sock, { token: t, cmd: 'send', args: { terminal, text: 'x' } });
      assert.strictEqual(r.ok, false, terminal);
      assert.match(r.error, re, terminal);
    }
    assert.deepStrictEqual(ctx.sends, []);
  } finally { await cleanup(ctx); }
});

test('send: Fehler der Oberfläche werden durchgereicht', async () => {
  const ctx = await setup({ requestSend: async () => ({ ok: false, error: 'Es ist bereits eine Vorschau offen.' }) });
  try {
    const r = await ask(ctx.sock, { token: ctx.tokens.p1, cmd: 'send', args: { terminal: 't1', text: 'x' } });
    assert.deepStrictEqual(r, { ok: false, error: 'Es ist bereits eine Vorschau offen.' });
  } finally { await cleanup(ctx); }
  const ctx2 = await setup({ requestSend: async () => { throw new Error('boom'); } });
  try {
    const r = await ask(ctx2.sock, { token: ctx2.tokens.p1, cmd: 'send', args: { terminal: 't1', text: 'x' } });
    assert.deepStrictEqual(r, { ok: false, error: 'boom' });
  } finally { await cleanup(ctx2); }
});

test('Argumentprüfung: Text, Zeilenzahl, Kachel', () => {
  assert.throws(() => validateCommand('send', { terminal: 't1', text: 'a'.repeat(4001) }), /zu lang/);
  assert.deepStrictEqual(validateCommand('send', { terminal: 't1', text: 'a'.repeat(4000) }).text.length, 4000);
  assert.throws(() => validateCommand('send', { terminal: 't1', text: '' }), /leer/);
  assert.throws(() => validateCommand('send', { terminal: 't1', text: '\x1b\x07  ' }), /leer/);
  assert.throws(() => validateCommand('send', { terminal: 't1', text: 5 }), /Text/);
  assert.throws(() => validateCommand('send', { text: 'x' }), /Kachel/);
  assert.throws(() => validateCommand('output', { terminal: 't', lines: 501 }), /1 bis 500/);
  assert.throws(() => validateCommand('output', { terminal: 't', lines: 0 }), /1 bis 500/);
  assert.throws(() => validateCommand('output', { terminal: 't', lines: 1.5 }), /1 bis 500/);
  assert.strictEqual(validateCommand('output', { terminal: 't' }).lines, 50);
  assert.deepStrictEqual(validateCommand('status', 'quatsch'), {});
  assert.strictEqual(cleanText('a\u0000b\u0085c\u007fd\ne'), 'abcd\ne');
});

test('Größen- und Zeitlimits, kaputtes JSON', async () => {
  const ctx = await setup({ bridge: { requestTimeoutMs: 150 } });
  try {
    const big = await ask(ctx.sock, 'x'.repeat(70 * 1024));
    assert.deepStrictEqual(big, { ok: false, error: 'Anfrage zu groß.' });
    assert.deepStrictEqual(await ask(ctx.sock, 'kein json\n'), { ok: false, error: 'Ungültiges JSON.' });
    const slow = await new Promise((resolve) => {
      const c = net.connect(ctx.sock);
      let data = '';
      c.on('connect', () => c.write('{"token"'));
      c.on('data', (d) => { data += d; });
      c.on('close', () => resolve(JSON.parse(data.split('\n')[0])));
    });
    assert.match(slow.error, /Zeitüberschreitung/);
  } finally { await cleanup(ctx); }
});

test('Zeitlimit des Befehls', async () => {
  const ctx = await setup({ bridge: { handlerTimeoutMs: 100 }, requestSend: () => new Promise(() => {}) });
  try {
    const r = await ask(ctx.sock, { token: ctx.tokens.p1, cmd: 'send', args: { terminal: 't1', text: 'x' } });
    assert.match(r.error, /Zeitüberschreitung/);
  } finally { await cleanup(ctx); }
});

test('stop widerruft alle Tokens und entfernt den Socket', async () => {
  const ctx = await setup();
  await ctx.bridge.stop();
  assert.strictEqual(fs.existsSync(ctx.sock), false);
  assert.deepStrictEqual(ctx.bridge.envFor('p1'), {});
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('Antworten über 1 MB werden durch einen Fehler ersetzt', async () => {
  const dir = fs.mkdtempSync('/tmp/mtpm-');
  const service = {
    state: async () => ({ ok: true, big: 'x'.repeat(2 * 1024 * 1024) }),
    output: async () => ({ ok: true }), changes: async () => ({ ok: true }), ports: async () => ({ ok: true }), docs: async () => ({ ok: true }),
    resolveTerminal: () => ({ ok: false, error: 'x' }),
  };
  const bridge = createPmBridge({ socketPath: path.join(dir, 's', 'pm.sock'), service, requestSend: async () => ({ ok: true }) });
  await bridge.start();
  try {
    const token = bridge.register('p1');
    const r = await ask(bridge.socketPath, { token, cmd: 'status', args: {} });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /zu groß/);
  } finally {
    await bridge.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
