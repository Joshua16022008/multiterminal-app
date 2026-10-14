'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const w = require('../src/main/agent-wrapper');

let pty = null;
try { pty = require('node-pty'); } catch (_) { /* tty cases are skipped */ }

// Sandbox: bin/claude (the wrapper), fake/claude (prints its arguments), a path with a space.
function sandbox({ withHooks }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt aw-'));
  const bin = path.join(root, 'bin');
  const fake = path.join(root, 'fake dir');
  fs.mkdirSync(bin); fs.mkdirSync(fake);
  const hooksFile = path.join(root, 'claude-hooks.json');
  fs.writeFileSync(path.join(bin, 'claude'), w.claudeWrapperScript({ hooksFile }), { mode: 0o755 });
  fs.writeFileSync(path.join(fake, 'claude'), '#!/bin/sh\nfor a in "$@"; do printf "[%s]" "$a"; done\necho\nexit 7\n', { mode: 0o755 });
  if (withHooks) fs.writeFileSync(hooksFile, '{}');
  return { root, bin, hooksFile, env: { ...process.env, PATH: `${bin}:${fake}:${process.env.PATH}` }, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function runPiped(sb, args) {
  return new Promise((resolve) => {
    const c = spawn('claude', args, { env: sb.env });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ out: out.trim(), code }));
  });
}

function runTty(sb, args) {
  return new Promise((resolve) => {
    const p = pty.spawn('claude', args, { env: sb.env, cols: 400, rows: 10 });
    let out = '';
    p.onData((d) => { out += d; });
    p.onExit(({ exitCode }) => resolve({ out: out.replace(/\r/g, '').trim(), code: exitCode }));
  });
}

test('hook settings: one command hook per event, absolute quoted path with spaces, notification matcher', () => {
  const s = w.hookSettings({ mtEventPath: "/Users/a b/it's/bin/mt-event" });
  assert.deepEqual(Object.keys(s.hooks), w.HOOK_EVENTS);
  for (const name of w.HOOK_EVENTS) {
    const hook = s.hooks[name][0].hooks[0];
    assert.equal(hook.type, 'command');
    assert.equal(hook.command, `'/Users/a b/it'\\''s/bin/mt-event' ${name}`);
    assert.ok(hook.timeout <= 2);
  }
  assert.match(s.hooks.Notification[0].matcher, /permission_prompt/);
  assert.equal(s.hooks.Stop[0].matcher, undefined);
  assert.equal('PreToolUse' in s.hooks, false);
  assert.equal('PostToolUse' in s.hooks, false);
  assert.deepEqual(JSON.parse(w.hookSettingsJson({ mtEventPath: '/x/mt-event' })).hooks.Stop[0].hooks[0].command, "'/x/mt-event' Stop");
  assert.throws(() => w.hookSettings({ mtEventPath: 'relative/mt-event' }));
  assert.throws(() => w.claudeWrapperScript({ hooksFile: 'relative.json' }));
});

test('interactive decision: subcommands, version/help/print, own settings and non-tty pass through', () => {
  const yes = [[], ['--model', 'opus'], ['fix the bug'], ['--resume', 'abc'], ['--continue'], ['update the readme']];
  const no = [['--version'], ['-v'], ['mcp', 'list'], ['mcp', '--help'], ['--help'], ['-h'], ['-p', 'hi'], ['--print', 'hi'],
    ['update'], ['doctor'], ['auth', 'status'], ['plugin', 'list'], ['setup-token'], ['install'], ['gateway'], ['import'],
    ['--settings', 'x.json'], ['--settings=x.json'], ['--model', 'x', '-p', 'hi']];
  for (const a of yes) assert.equal(w.isInteractiveInvocation(a), true, JSON.stringify(a));
  for (const a of no) assert.equal(w.isInteractiveInvocation(a), false, JSON.stringify(a));
  assert.equal(w.isInteractiveInvocation([], false), false);
});

test('wrapper without a hooks file passes everything through unchanged (exit code kept)', async () => {
  const sb = sandbox({ withHooks: false });
  try {
    assert.deepEqual(await runPiped(sb, ['--model', 'x', 'a b']), { out: '[--model][x][a b]', code: 7 });
    if (pty) assert.deepEqual(await runTty(sb, ['--model', 'x']), { out: '[--model][x]', code: 7 });
  } finally { sb.cleanup(); }
});

test('wrapper adds --settings only for interactive sessions and only with a hooks file', async (t) => {
  const sb = sandbox({ withHooks: true });
  try {
    assert.deepEqual(await runPiped(sb, ['hello']), { out: '[hello]', code: 7 }); // piped: not interactive
    if (!pty) { t.skip('node-pty not available'); return; }
    const added = `[--settings][${sb.hooksFile}]`;
    assert.deepEqual(await runTty(sb, ['--model', 'x', 'a b']), { out: `${added}[--model][x][a b]`, code: 7 });
    assert.deepEqual(await runTty(sb, []), { out: added, code: 7 });
    for (const args of [['--version'], ['mcp', '--help'], ['-p', 'q'], ['update'], ['--settings', 'own.json'], ['doctor']]) {
      const r = await runTty(sb, args);
      assert.equal(r.out, args.map((a) => `[${a}]`).join(''), JSON.stringify(args));
      assert.equal(r.code, 7);
    }
  } finally { sb.cleanup(); }
});

test('wrapper never calls itself and explains a missing claude with exit 127', async () => {
  const sb = sandbox({ withHooks: true });
  try {
    const env = { ...process.env, PATH: `${sb.bin}:/usr/bin:/bin` };
    const r = await new Promise((resolve) => {
      const c = spawn(path.join(sb.bin, 'claude'), ['x'], { env });
      let err = '';
      c.stderr.on('data', (d) => { err += d; });
      c.on('close', (code) => resolve({ err, code }));
    });
    assert.equal(r.code, 127);
    assert.match(r.err, /claude wurde nicht gefunden/);
  } finally { sb.cleanup(); }
});

test('event wrapper is silent, keeps stdin and always exits 0', () => {
  const s = w.eventWrapperScript({ execPath: '/a b/Electron', scriptPath: "/c d/mt-event-cli.js" });
  assert.match(s, /ELECTRON_RUN_AS_NODE=1 '\/a b\/Electron' '\/c d\/mt-event-cli\.js' "\$@" >\/dev\/null 2>&1/);
  assert.match(s, /exit 0\n$/);
});
