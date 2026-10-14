'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const cli = require('../src/main/mt-browser-cli.js');
const { createBrowserBridge } = require('../src/main/browser-bridge.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'main', 'mt-browser-cli.js');

test('parseArgs maps every command to a request', () => {
  assert.deepStrictEqual(cli.parseArgs(['open', 'localhost:3000']), { cmd: 'open', args: { url: 'localhost:3000' } });
  for (const c of ['reload', 'back', 'forward', 'url', 'show', 'hide']) assert.deepStrictEqual(cli.parseArgs([c]), { cmd: c, args: {} });
  assert.deepStrictEqual(cli.parseArgs(['console', '--limit', '20']), { cmd: 'console', args: { limit: 20 } });
  assert.deepStrictEqual(cli.parseArgs(['text', '--limit=7']), { cmd: 'text', args: { limit: 7 } });
  assert.deepStrictEqual(cli.parseArgs(['console']), { cmd: 'console', args: {} });
});

test('screenshot paths are made absolute against the caller directory', () => {
  assert.deepStrictEqual(cli.parseArgs(['screenshot']), { cmd: 'screenshot', args: {} });
  assert.deepStrictEqual(cli.parseArgs(['screenshot', 'a.png']), { cmd: 'screenshot', args: { out: path.resolve('a.png') } });
});

test('parseArgs reports wrong usage', () => {
  for (const argv of [['open'], ['open', 'a', 'b'], ['reload', 'x'], ['screenshot', 'a', 'b'], ['console', '--limit'], ['console', '--limit', 'x'],
    ['console', '--limit', '0'], ['text', 'foo'], ['explode']]) {
    assert.ok(cli.parseArgs(argv).error, argv.join(' '));
  }
});

test('help is requested by no arguments and by flags, and is English and complete', () => {
  for (const argv of [[], ['--help'], ['-h'], ['help']]) assert.deepStrictEqual(cli.parseArgs(argv), { help: true });
  for (const word of ['open', 'reload', 'back', 'forward', 'url', 'screenshot', 'console', 'text', 'show', 'hide', 'Examples', 'file path']) {
    assert.ok(cli.HELP.includes(word), word);
  }
});

test('buildRequest needs the environment of a Multiterminal tile', () => {
  const parsed = { cmd: 'url', args: {} };
  assert.deepStrictEqual(cli.buildRequest({}, parsed), { error: 'Nur in einem Multiterminal-Terminal verfügbar.' });
  assert.ok(cli.buildRequest({ MULTITERMINAL_BROWSER_SOCK: '/s' }, parsed).error);
  const r = cli.buildRequest({ MULTITERMINAL_BROWSER_SOCK: '/s', MULTITERMINAL_BROWSER_TOKEN: 'tok' }, parsed);
  assert.strictEqual(r.sock, '/s');
  assert.deepStrictEqual(JSON.parse(r.line), { token: 'tok', cmd: 'url', args: {} });
});

test('formatResponse turns answers into text', () => {
  assert.deepStrictEqual(cli.formatResponse('url', { ok: true, result: 'http://localhost:1/' }), { out: 'http://localhost:1/' });
  assert.deepStrictEqual(cli.formatResponse('reload', { ok: true, result: null }), { out: 'OK' });
  assert.deepStrictEqual(cli.formatResponse('screenshot', { ok: true, result: { path: '/tmp/a.png' } }), { out: '/tmp/a.png' });
  assert.deepStrictEqual(cli.formatResponse('console', { ok: true, result: [{ level: 'error', message: 'boom' }, 'plain'] }), { out: '[error] boom\nplain' });
  assert.deepStrictEqual(cli.formatResponse('console', { ok: true, result: [] }), { out: '' });
  assert.deepStrictEqual(cli.formatResponse('text', { ok: true, result: null }), { out: '' });
  assert.deepStrictEqual(cli.formatResponse('url', { ok: false, error: 'kaputt' }), { error: 'kaputt' });
  assert.ok(cli.formatResponse('url', null).error);
});

test('wrapperScript quotes paths with spaces and single quotes', () => {
  const s = cli.wrapperScript({ execPath: "/Apps/My App/Electron's/electron", scriptPath: '/x y/cli.js' });
  assert.ok(s.startsWith('#!/bin/sh\n'));
  assert.ok(s.includes(`ELECTRON_RUN_AS_NODE=1 exec '/Apps/My App/Electron'\\''s/electron' '/x y/cli.js' "$@"`));
  // The quoting must survive a real shell: the script runs echo-like node with those paths.
  const dir = fs.mkdtempSync('/tmp/mtw-');
  try {
    const script = path.join(dir, "it's here.js");
    fs.writeFileSync(script, 'process.stdout.write(process.env.ELECTRON_RUN_AS_NODE + ":" + process.argv.slice(2).join("|"));');
    const sh = path.join(dir, 'mt-browser');
    fs.writeFileSync(sh, cli.wrapperScript({ execPath: process.execPath, scriptPath: script }), { mode: 0o755 });
    const r = spawnSync(sh, ['a b', "c'd"], { encoding: 'utf8' });
    assert.strictEqual(r.stdout, "1:a b|c'd");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function runCli(args, env) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI_PATH, ...args], { env: { PATH: process.env.PATH, ...env } });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('started directly without environment: message and exit 2', async () => {
  const r = await runCli(['url'], {});
  assert.strictEqual(r.code, 2);
  assert.match(r.stderr, /Nur in einem Multiterminal-Terminal verfügbar/);
});

test('started directly with --help: text on stdout, exit 0', async () => {
  const r = await runCli(['--help'], {});
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /mt-browser/);
});

test('end to end: CLI process talks to the bridge', async () => {
  const dir = fs.mkdtempSync('/tmp/mte-');
  const seen = [];
  const bridge = createBrowserBridge({
    socketPath: path.join(dir, 'b.sock'),
    handler: async (id, cmd, args) => {
      seen.push({ id, cmd, args });
      if (cmd === 'console') return [{ level: 'warn', message: 'hi' }];
      if (cmd === 'screenshot') return { path: '/tmp/shot.png' };
      if (cmd === 'back') throw new Error('Kein Verlauf.');
      return cmd === 'open' ? args.url : null;
    },
  });
  await bridge.start();
  try {
    bridge.register('t9');
    const env = bridge.envFor('t9');
    let r = await runCli(['open', 'localhost:5173'], env);
    assert.deepStrictEqual([r.code, r.stdout], [0, 'http://localhost:5173/\n']);
    r = await runCli(['console', '--limit', '3'], env);
    assert.deepStrictEqual([r.code, r.stdout], [0, '[warn] hi\n']);
    r = await runCli(['screenshot'], env);
    assert.deepStrictEqual([r.code, r.stdout], [0, '/tmp/shot.png\n']);
    r = await runCli(['back'], env);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /Kein Verlauf/);
    r = await runCli(['file:///x'.replace('file', 'open file')], env); // unknown command
    assert.strictEqual(r.code, 2);
    r = await runCli(['open', 'file:///etc/passwd'], env);
    assert.strictEqual(r.code, 1);
    r = await runCli(['url'], { ...env, MULTITERMINAL_BROWSER_TOKEN: 'wrong' });
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /Nicht berechtigt/);
    assert.deepStrictEqual(seen.map((s) => s.id), ['t9', 't9', 't9', 't9']);
  } finally {
    await bridge.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a dead socket gives an error, not a hang', async () => {
  const r = await runCli(['url'], { MULTITERMINAL_BROWSER_SOCK: '/tmp/does-not-exist.sock', MULTITERMINAL_BROWSER_TOKEN: 't' });
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /Keine Verbindung/);
});
