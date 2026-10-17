'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarnessCatalog } = require('../src/main/harness-catalog');
const { createHarnessDetect, LOOKUP_SCRIPT } = require('../src/main/harness-detect');

test('detection: fixed login-shell script uses positional binary, direct version only on request, cached scans', async () => {
  const calls = [];
  const service = createHarnessDetect({ catalog: createHarnessCatalog(), env: { SHELL: '/bin/zsh', PATH: '/fake' }, run: async (file, argv, options) => {
    calls.push({ file, argv, options });
    return { stdout: file === '/bin/zsh' ? 'startup message\n/fake/claude\n' : 'Claude 2.1.302\n', exitCode: 0 };
  } });
  assert.deepEqual(await service.detect('claude'), [{ id: 'claude', installed: true, path: '/fake/claude', version: null }]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, ['-lc', 'command -v -- "$1"', 'mt-harness-detect', 'claude']);
  assert.equal(LOOKUP_SCRIPT, 'command -v -- "$1"');
  assert.equal(calls[0].file, '/bin/zsh');
  await service.detect('claude'); assert.equal(calls.length, 1);
  assert.equal(await service.version('claude'), 'Claude 2.1.302');
  assert.deepEqual(calls[1].argv, ['--version']);
  assert.equal(calls[1].file, '/fake/claude');
  assert.equal((await service.detect('claude'))[0].version, 'Claude 2.1.302');
  for (const { options } of calls) { assert.equal(options.shell, undefined); assert.ok(options.timeout <= 10000); assert.equal(options.env.PATH, '/fake'); }
});

test('detection: ambiguous names verify identity with help, never implicit version', async () => {
  for (const [id, output, installed] of [['kimi', 'Kimi Code CLI usage', true], ['kimi', 'another kimi program', false], ['kimi', 'unrelated CLI', false], ['cursor', 'Cursor Agent', true], ['cursor', 'ssh-agent', false]]) {
    const calls = [];
    const service = createHarnessDetect({ catalog: createHarnessCatalog(), run: async (file, argv) => {
      calls.push(argv); return { stdout: file === '/bin/zsh' ? '/fake/program\n' : output };
    }, env: { SHELL: '/evil/shell' } });
    assert.equal((await service.detect(id))[0].installed, installed);
    assert.deepEqual(calls[1], ['--help']);
    assert.equal(calls.flat().includes('--version'), false);
  }
});

test('detection: missing programs, command failures, aliases and unknown IDs return expected values', async () => {
  for (const response of [{ stdout: '' }, { stdout: 'alias claude=bad' }, { stdout: '/fake/claude', status: 1 }, new Error('provider secret must not escape')]) {
    const service = createHarnessDetect({ catalog: createHarnessCatalog(), run: async () => { if (response instanceof Error) throw response; return response; } });
    assert.deepEqual(await service.detect('claude'), [{ id: 'claude', installed: false, path: null, version: null }]);
    assert.equal(await service.version('claude'), null);
    assert.deepEqual(await service.detect('unknown'), []);
  }
});

test('detection: validates binary before the approved shell exception even with a catalog adapter', async () => {
  for (const binary of ['/bin/sh', '--bad', 'claude;touch', 'claude\n', ['claude']]) {
    let called = false;
    const service = createHarnessDetect({ catalog: { get: () => ({ id: 'bad', binary }) }, run: async () => { called = true; } });
    assert.equal((await service.detect('bad'))[0].installed, false);
    assert.equal(called, false);
  }
});

test('detection: concurrent scans coalesce and versions sanitize terminal escapes', async () => {
  let count = 0;
  const service = createHarnessDetect({ catalog: createHarnessCatalog(), run: async (file) => {
    count++; await new Promise((resolve) => setTimeout(resolve, 5));
    return { stdout: file === '/bin/zsh' ? '/fake/codex' : '\x1b[31mcodex 1.0\x1b[0m\nextra' };
  } });
  await Promise.all([service.detect('codex'), service.detect('codex')]);
  assert.equal(count, 1);
  assert.equal(await service.version('codex'), 'codex 1.0');
});

test('detection: injected runner that ignores process timeout still resolves as unavailable', async () => {
  const service = createHarnessDetect({ catalog: createHarnessCatalog(), run: () => new Promise(() => {}) });
  assert.equal((await service.detect('claude'))[0].installed, false);
});
