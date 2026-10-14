'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createPortService } = require('../src/main/port-service');

const terminals = [
  { terminalId: 'one', projectId: 'project-a', pid: 100, cwd: '/tmp/a' },
  { terminalId: 'two', projectId: 'project-b', pid: 200, cwd: '/tmp/b', workspaceId: 'worktree-b' },
];
const parents = '1 0\n100 1\n110 100\n111 110\n200 1\n210 200\n999 1\n';
const listeners = 'p111\ncnode\nn127.0.0.1:3000\np210\ncpython\nn[::1]:8000\np999\ncnode\nn*:5000\n';

function fixture({ stdout = listeners, stderr = '', ps = parents, getTerminals = () => terminals, lsofError, psError } = {}) {
  const calls = [];
  const service = createPortService({ getTerminals, run: async (file, args, options) => {
    calls.push({ file, args, options });
    if (file === '/usr/sbin/lsof') {
      if (lsofError) throw lsofError;
      return { stdout, stderr };
    }
    if (psError) throw psError;
    return { stdout: ps, stderr: '' };
  } });
  return { service, calls };
}

test('ports: attributes only listening-process ancestry, including multiple projects and workspaces', async () => {
  const { service, calls } = fixture();
  const result = await service.list();
  assert.equal(result.ok, true);
  assert.equal(result.warning, undefined);
  assert.equal(Number.isNaN(Date.parse(result.capturedAt)), false);
  assert.equal(result.entries.length, 3);
  const a = result.entries.find((e) => e.pid === 111);
  assert.deepEqual(a, {
    id: 'tcp:111:127.0.0.1:3000', pid: 111, process: 'node', host: '127.0.0.1', port: 3000,
    url: 'http://127.0.0.1:3000', terminalId: 'one', projectId: 'project-a', cwd: '/tmp/a',
  });
  const b = result.entries.find((e) => e.pid === 210);
  assert.equal(b.terminalId, 'two');
  assert.equal(b.workspaceId, 'worktree-b');
  assert.equal(b.cwd, '/tmp/b');
  const foreign = result.entries.find((e) => e.pid === 999);
  assert.equal(foreign.terminalId, null);
  assert.equal(foreign.projectId, null);
  assert.equal(foreign.cwd, undefined);
  assert.equal(foreign.url, 'http://localhost:5000');
  assert.deepEqual(calls.map(({ file, args }) => [file, args]), [
    ['/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']],
    ['/bin/ps', ['-axo', 'pid=,ppid=']],
  ]);
  for (const { options } of calls) {
    assert.equal(options.shell, undefined);
    assert.ok(options.timeout > 0 && options.timeout <= 5000);
    assert.ok(options.maxBuffer <= 4 * 1024 * 1024);
  }
});

test('ports: exact duplicates collapse but distinct IPv4/IPv6 bindings and PIDs survive', async () => {
  const { service } = fixture({ stdout: 'p111\ncnode\nn127.0.0.1:3000\nn127.0.0.1:3000\nn[::1]:3000\nn::1:3000\np210\ncnode\nn127.0.0.1:3000\n' });
  const { entries } = await service.list();
  assert.equal(entries.length, 3);
  assert.equal(new Set(entries.map((e) => e.id)).size, 3);
  assert.equal(entries.find((e) => e.host === '::1').url, 'http://[::1]:3000');
});

test('ports: wildcard URLs use loopback while specific interface addresses remain specific', async () => {
  const { service } = fixture({ stdout: 'p111\ncnode\nn*:3000\nn0.0.0.0:3001\nn[::]:3002\nn192.168.1.7:3003\nn[2001:db8::2]:3004\nn[fe80::1%en0]:3005\n' });
  assert.deepEqual((await service.list()).entries.map((e) => [e.host, e.url]), [
    ['*', 'http://localhost:3000'], ['0.0.0.0', 'http://127.0.0.1:3001'], ['::', 'http://[::1]:3002'],
    ['192.168.1.7', 'http://192.168.1.7:3003'], ['2001:db8::2', 'http://[2001:db8::2]:3004'], ['fe80::1%en0', null],
  ]);
});

test('ports: malformed endpoints, connection arrows, unsafe PIDs and invalid ports are ignored', async () => {
  const { service } = fixture({ stdout: 'p111\ncnode\nn127.0.0.1:65535\nn127.0.0.1:0\nn127.0.0.1:65536\nn127.0.0.1:3000->127.0.0.1:5000\nnexample.com:42\nn$(touch /tmp/unsafe):42\np0\nn*:42\np9007199254740993\nn*:43\np-1\nn*:44\n' });
  assert.deepEqual((await service.list()).entries.map((e) => e.port), [65535]);
});

test('ports: listener process may itself be the PTY PID', async () => {
  const { service } = fixture({ stdout: 'p100\ncnode\nn*:3000\n' });
  assert.equal((await service.list()).entries[0].terminalId, 'one');
});

test('ports: arbitrary PID, missing ancestry and cycles stay unassigned', async () => {
  for (const ps of ['111 9999\n100 1\n1 0\n', '111 110\n110 111\n100 1\n1 0\n', '111 100\n100 100\n']) {
    const { service } = fixture({ stdout: 'p111\ncnode\nn*:3000\n', ps });
    assert.equal((await service.list()).entries[0].terminalId, null, ps);
  }
});

test('ports: ambiguous terminal PID roots and duplicate terminal IDs stay unassigned', async () => {
  for (const current of [
    [terminals[0], { ...terminals[0], terminalId: 'duplicate' }],
    [terminals[0], { ...terminals[1], terminalId: 'one' }],
    [terminals[0], terminals[0]],
    [terminals[0], { ...terminals[1], pid: 110 }],
  ]) {
    const { service } = fixture({ stdout: 'p111\ncnode\nn*:3000\n', getTerminals: () => current });
    assert.equal((await service.list()).entries[0].terminalId, null);
  }
});

test('ports: duplicate conflicting process-parent data cannot justify attribution', async () => {
  const { service } = fixture({ stdout: 'p111\ncnode\nn*:3000\n', ps: parents + '110 200\n' });
  assert.equal((await service.list()).entries[0].terminalId, null);
});

test('ports: terminal closure, PID replacement and scope changes during scan invalidate attribution', async () => {
  for (const after of [[], [{ ...terminals[0], pid: 110 }], [{ ...terminals[0], cwd: '/tmp/replaced' }], [{ ...terminals[0], workspaceId: 'new' }]]) {
    let snapshots = 0;
    const { service } = fixture({ stdout: 'p111\ncnode\nn*:3000\n', getTerminals: () => ++snapshots === 1 ? [terminals[0]] : after });
    assert.equal((await service.list()).entries[0].terminalId, null);
    assert.equal(snapshots, 2);
  }
});

test('ports: each list obtains fresh listener and terminal snapshots without stale cache', async () => {
  let current = terminals;
  let output = listeners;
  const service = createPortService({ getTerminals: () => current, run: async (file) => ({ stdout: file.endsWith('lsof') ? output : parents }) });
  assert.equal((await service.list()).entries.find((e) => e.pid === 111).terminalId, 'one');
  current = [];
  assert.equal((await service.list()).entries.find((e) => e.pid === 111).terminalId, null);
  output = '';
  assert.deepEqual((await service.list()).entries, []);
});

test('ports: lsof exit 1 with no output is empty success; denied/partial scans fail closed', async () => {
  const { service, calls } = fixture({ lsofError: { code: 1, stdout: '', stderr: '' } });
  assert.deepEqual((await service.list()).entries, []);
  assert.equal(calls.length, 1);
  for (const lsofError of [
    { code: 1, stderr: 'Permission denied' },
    { code: 1, stdout: listeners },
    { code: 'ENOENT' },
    { code: 1, killed: true },
    { code: 1, signal: 'SIGTERM' },
  ]) {
    const result = await fixture({ lsofError }).service.list();
    assert.equal(result.ok, false);
    assert.deepEqual(result.entries, []);
    assert.ok(result.error);
  }
});

test('ports: successful lsof partial-visibility diagnostic is visible', async () => {
  const result = await fixture({ stderr: 'lsof: cannot inspect protected process' }).service.list();
  assert.equal(result.ok, true);
  assert.match(result.warning, /protected process/);
});

test('ports: denied ps preserves listeners but marks all unassigned with warning', async () => {
  const result = await fixture({ psError: { code: 1, stderr: 'Operation not permitted' } }).service.list();
  assert.equal(result.ok, true);
  assert.equal(result.entries.length, 3);
  assert.ok(result.entries.every((e) => e.terminalId === null));
  assert.match(result.warning, /Operation not permitted/);
});

test('ports: terminal callback failure degrades to unassigned, bounded visible warning', async () => {
  const result = await fixture({ getTerminals: () => { throw new Error('snapshot gone'); } }).service.list();
  assert.equal(result.ok, true);
  assert.ok(result.entries.every((e) => e.terminalId === null));
  assert.match(result.warning, /snapshot gone/);
});

test('ports: oversized scan output is not presented as current listeners', async () => {
  const result = await fixture({ stdout: 'a'.repeat(4 * 1024 * 1024 + 1) }).service.list();
  assert.equal(result.ok, false);
  assert.deepEqual(result.entries, []);
  assert.match(result.error, /Größenbegrenzung/);
});

async function temporaryServer(t) {
  // Keep the shell alive as an actual ancestor of the child server. This
  // fixture owns both processes and shuts down only its own server via stdin.
  const code = `const net = require('node:net'); const s = net.createServer();
    s.listen(0, '127.0.0.1', () => console.log(JSON.stringify({pid:process.pid,port:s.address().port})));
    process.stdin.resume(); process.stdin.on('data', () => s.close(() => process.exit(0)));
    setTimeout(() => s.close(() => process.exit(0)), 20000).unref();`;
  const child = spawn('/bin/sh', ['-c', '"$1" -e "$2"; result=$?; exit "$result"', 'mt-port-test', process.execPath, code], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let closed = false;
  child.on('exit', () => { closed = true; });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  t.after(async () => {
    if (!closed) {
      const exited = once(child, 'exit');
      child.stdin.write('stop\n');
      await exited;
    }
  });
  const info = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Temporary TCP server did not start: ' + stderr)), 6000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (exit) => { clearTimeout(timer); reject(new Error('Temporary server exited ' + exit + ': ' + stderr)); });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
      if (output.includes('\n')) {
        clearTimeout(timer);
        try { resolve(JSON.parse(output.split('\n')[0])); } catch (error) { reject(error); }
      }
    });
  });
  return { ...info, rootPid: child.pid, stop: async () => {
    if (!closed) {
      const exited = once(child, 'exit');
      child.stdin.write('stop\n');
      await exited;
    }
  } };
}

test('ports: real temporary servers appear/disappear and an unrelated shell server stays unassigned', { timeout: 30000 }, async (t) => {
  const mine = await temporaryServer(t);
  const foreign = await temporaryServer(t);
  assert.notEqual(mine.rootPid, mine.pid, 'fixture needs a live shell ancestor');
  const service = createPortService({ getTerminals: () => [{ terminalId: 'real', projectId: 'fixture-project', pid: mine.rootPid, cwd: '/tmp/fixture' }] });
  const first = await service.list();
  assert.equal(first.ok, true, first.error);
  assert.equal(first.warning, undefined, first.warning);
  const known = first.entries.find((e) => e.pid === mine.pid && e.port === mine.port);
  const unknown = first.entries.find((e) => e.pid === foreign.pid && e.port === foreign.port);
  assert.ok(known, 'own server listener must be found by native lsof');
  assert.equal(known.terminalId, 'real');
  assert.ok(unknown, 'foreign server listener must be found without affecting it');
  assert.equal(unknown.terminalId, null);
  await mine.stop();
  const second = await service.list();
  assert.equal(second.ok, true, second.error);
  assert.equal(second.entries.some((e) => e.pid === mine.pid && e.port === mine.port), false);
  assert.equal(second.entries.some((e) => e.pid === foreign.pid && e.port === foreign.port), true);
  await foreign.stop();
  const third = await service.list();
  assert.equal(third.ok, true, third.error);
  assert.equal(third.entries.some((e) => e.pid === foreign.pid && e.port === foreign.port), false);
});
