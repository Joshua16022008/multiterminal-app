'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs, buildRequest, wrapperScript, run } = require('../src/main/mt-memory-cli');

function output() {
  let stdout = '', stderr = '';
  return { io: { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } }, read: () => ({ stdout, stderr }) };
}

test('CLI maps structured flags and rejects unknown, duplicate and missing values', async () => {
  assert.deepEqual(parseArgs(['save', '--summary', 'done', '--next', 'review', '--questions', '?']), { cmd: 'memory-save', args: { summary: 'done', nextStep: 'review', openQuestions: '?' } });
  assert.deepEqual(parseArgs(['read']), { cmd: 'memory-read', args: {} });
  for (const args of [['save'], ['save', '--notes', 'bad'], ['read', '--project', 'p2'], ['save', '--summary'], ['save', '--summary', 'x', '--summary', 'y'], ['save', '--summary', 'x'.repeat(8001)]]) assert.ok(parseArgs(args).error);
  assert.ok(buildRequest({}, parseArgs(['read'])).error);
  const out = output();
  assert.notEqual(await run(['read'], {}, out.io), 0);
  assert.match(out.read().stderr, /Multiterminal/);
  assert.match(wrapperScript({ execPath: "/a/it's node", scriptPath: '/x/cli.js' }), /ELECTRON_RUN_AS_NODE=1 exec/);
});

test('CLI reads Markdown and saves through the authenticated local protocol', async (t) => {
  const dir = fs.mkdtempSync('/private/tmp/mtmc-');
  const sock = dir + '/s';
  const requests = [];
  const server = net.createServer((socket) => {
    socket.once('data', (data) => {
      const req = JSON.parse(data.toString());
      requests.push(req);
      socket.end(JSON.stringify({ ok: true, result: req.cmd === 'memory-read' ? '# Memory\nnotes' : { id: 'saved' } }) + '\n');
    });
  });
  await new Promise((resolve) => server.listen(sock, resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const env = { MULTITERMINAL_BROWSER_SOCK: sock, MULTITERMINAL_BROWSER_TOKEN: 'token' };
  const read = output();
  assert.equal(await run(['read'], env, read.io), 0);
  assert.equal(read.read().stdout, '# Memory\nnotes\n');
  const saved = output();
  assert.equal(await run(['save', '--summary', 'done'], env, saved.io), 0);
  assert.deepEqual(JSON.parse(saved.read().stdout), { id: 'saved' });
  assert.deepEqual(requests[1], { token: 'token', cmd: 'memory-save', args: { summary: 'done' } });
});

test('CLI closes hung sockets with a finite deadline', async (t) => {
  const dir = fs.mkdtempSync('/private/tmp/mtmc-');
  const sock = dir + '/s';
  const server = net.createServer((socket) => socket.resume());
  await new Promise((resolve) => server.listen(sock, resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const out = output();
  assert.equal(await run(['read'], { MULTITERMINAL_BROWSER_SOCK: sock, MULTITERMINAL_BROWSER_TOKEN: 't' }, out.io, 25), 1);
  assert.match(out.read().stderr, /Zeitüberschreitung/);
});

test('CLI runs independently after copying its single file, with a quoted executable wrapper', (t) => {
  const dir = fs.mkdtempSync('/private/tmp/mt cli-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, "it's cli.js");
  const wrapper = path.join(dir, 'mt-memory');
  fs.copyFileSync(path.join(__dirname, '../src/main/mt-memory-cli.js'), script);
  fs.writeFileSync(wrapper, wrapperScript({ execPath: process.execPath, scriptPath: script }), { mode: 0o700 });
  const help = spawnSync('/bin/sh', [wrapper, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /mt-memory read/);
  const missingEnv = spawnSync(process.execPath, [script, 'read'], { env: {}, encoding: 'utf8' });
  assert.equal(missingEnv.status, 2);
  assert.match(missingEnv.stderr, /Socket und Token/);
});
