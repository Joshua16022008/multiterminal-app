'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { diagnose, probe, main, exitCodeFor, EXIT } = require('../scripts/qa-env-check');

test('diagnose classifies probe results', () => {
  assert.equal(diagnose({ ok: true }), 'ok');
  assert.equal(diagnose({ ok: false, signal: 'SIGABRT' }), 'sandboxed');
  assert.equal(diagnose({ ok: false, signal: 'SIGTRAP' }), 'sandboxed');
  assert.equal(diagnose({ ok: false, timedOut: true }), 'sandboxed');
  assert.equal(diagnose({ ok: false, signal: null }), 'failed');
});

test('exit code mapping: ok 0, failed 1, sandboxed 2, unsupported 3', () => {
  assert.equal(exitCodeFor('ok'), 0);
  assert.equal(exitCodeFor('failed'), 1);
  assert.equal(exitCodeFor('sandboxed'), 2);
  assert.equal(exitCodeFor('unsupported'), 3);
  assert.equal(exitCodeFor('unknown'), 1);
  assert.equal(EXIT.unsupported, 3);
});

// Stand-in "electron" binaries: executable node scripts.
function stub(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-stub-'));
  const file = path.join(dir, 'fake-electron');
  fs.writeFileSync(file, '#!' + process.execPath + '\n' + body);
  fs.chmodSync(file, 0o755);
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('probe: READY output means ok', async () => {
  const s = stub("console.log('READY');");
  try {
    const r = await probe(s.file, 10000);
    assert.equal(r.ok, true);
    assert.equal(diagnose(r), 'ok');
  } finally { s.cleanup(); }
});

test('probe: SIGABRT is reported as sandboxed', async () => {
  const s = stub("process.kill(process.pid, 'SIGABRT');");
  try {
    const r = await probe(s.file, 10000);
    assert.equal(r.ok, false);
    assert.equal(r.signal, 'SIGABRT');
    assert.equal(diagnose(r), 'sandboxed');
  } finally { s.cleanup(); }
});

test('probe: hang is killed after timeout (timedOut)', async () => {
  const s = stub('setInterval(() => {}, 1000);');
  try {
    const r = await probe(s.file, 300);
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true);
    assert.equal(r.signal, 'SIGKILL');
    assert.equal(diagnose(r), 'sandboxed');
  } finally { s.cleanup(); }
});

test('probe: missing binary (ENOENT) is failed, not sandboxed', async () => {
  const r = await probe(path.join(os.tmpdir(), 'mt-does-not-exist-electron'), 5000);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ENOENT');
  assert.equal(diagnose(r), 'failed');
});

test('main: exit codes end to end with stand-in binaries', async () => {
  const quiet = (fn) => async (...a) => {
    const log = console.log, err = console.error;
    console.log = console.error = () => {};
    try { return await fn(...a); } finally { console.log = log; console.error = err; }
  };
  const run = quiet(main);
  const ok = stub("console.log('READY');");
  const abort = stub("process.kill(process.pid, 'SIGABRT');");
  try {
    assert.equal(await run({ platform: 'darwin', bin: ok.file, timeoutMs: 10000 }), 0);
    assert.equal(await run({ platform: 'darwin', bin: abort.file, timeoutMs: 10000 }), 2);
    assert.equal(await run({ platform: 'darwin', bin: '/nonexistent/electron', timeoutMs: 5000 }), 1);
    assert.equal(await run({ platform: 'linux' }), 3);
  } finally { ok.cleanup(); abort.cleanup(); }
});
