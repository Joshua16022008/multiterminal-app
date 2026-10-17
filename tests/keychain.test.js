'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKeychain } = require('../src/main/keychain');

// Model the security interpreter's double-quote/backslash token rules, without
// invoking security or a shell (all keychain operations in this suite are mocked).
function parseCommand(input) {
  const tokens = [];
  let word = '', quoted = false, escaped = false, active = false;
  for (const char of input) {
    if (escaped) { word += char; escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; active = true; continue; }
    if (!quoted && /\s/.test(char)) {
      if (active) { tokens.push(word); word = ''; active = false; }
    } else { word += char; active = true; }
  }
  assert.equal(quoted, false);
  assert.equal(escaped, false);
  return tokens;
}

test('keychain set transmits secret only through quoted security interpreter stdin', async () => {
  const secret = ' sk-"double" \\path\\ x\t$HOME $(echo nope) `tick` ; end ';
  const calls = [];
  const keychain = createKeychain({ run: async (...args) => { calls.push(args); return { status: 0 }; } });
  assert.equal(await keychain.set('ep-test', secret), true);
  const [file, argv, options] = calls[0];
  assert.equal(file, '/usr/bin/security');
  assert.deepEqual(argv, ['-i']);
  assert.equal(JSON.stringify(argv).includes(secret), false);
  assert.equal(options.timeout, 5000);
  assert.deepEqual(parseCommand(options.input), ['add-generic-password', '-U', '-s', 'de.multiterminal.endpoint', '-a', 'ep-test', '-w', secret]);
  assert.equal(options.input.split('\n').length, 2);
});

test('keychain rejects newline, CR, NUL and empty secret before invoking process', async () => {
  let calls = 0;
  const keychain = createKeychain({ run: async () => { calls++; return { status: 0 }; } });
  for (const secret of ['', null, 3, 'abc\nquit', 'abc\rquit', 'abc\0def', 'x'.repeat(16385)]) {
    await assert.rejects(keychain.set('ep-test', secret), /Schlüssel/);
  }
  assert.equal(calls, 0);
});

test('keychain validates every account without invoking process', async () => {
  let calls = 0;
  const keychain = createKeychain({ run: async () => { calls++; return { status: 0 }; } });
  for (const account of ['../path', "ep-a'; evil", 'ep\nfoo', 'x'.repeat(65), '', null]) {
    await assert.rejects(keychain.set(account, 'key'), /Endpunkt-ID/);
    await assert.rejects(keychain.has(account), /Endpunkt-ID/);
    await assert.rejects(keychain.remove(account), /Endpunkt-ID/);
    assert.throws(() => keychain.lookupExpression(account), /Endpunkt-ID/);
  }
  assert.equal(calls, 0);
});

test('keychain has checks metadata only; missing items and delete are expected states', async () => {
  const calls = [];
  let status = 0;
  const keychain = createKeychain({ run: async (...args) => { calls.push(args); return { status }; } });
  assert.equal(await keychain.has('ep-test'), true);
  status = 44;
  assert.equal(await keychain.has('ep-test'), false);
  assert.equal(await keychain.remove('ep-test'), false);
  status = 0;
  assert.equal(await keychain.remove('ep-test'), true);
  for (const [, argv] of calls) assert.equal(argv.includes('-w'), false);
  assert.deepEqual(calls[0][1], ['find-generic-password', '-s', 'de.multiterminal.endpoint', '-a', 'ep-test']);
  assert.equal(calls[3][1][0], 'delete-generic-password');
});

test('keychain errors never include stderr, stdout, input, or thrown provider errors', async () => {
  const secret = 'TOP_SECRET';
  for (const run of [async () => ({ status: 1, stdout: secret, stderr: secret }), async () => { throw new Error(secret); }, async () => ({ stdout: secret })]) {
    const keychain = createKeychain({ run });
    for (const operation of [() => keychain.set('ep-test', secret), () => keychain.has('ep-test'), () => keychain.remove('ep-test')]) {
      await assert.rejects(operation(), (error) => !String(error.stack).includes(secret));
    }
  }
});

test('keychain lookup is only command substitution; caller supplies environment assignment', () => {
  const keychain = createKeychain({ run: () => { throw new Error('must not run'); } });
  assert.equal(keychain.lookupExpression('ep-test'), "$(/usr/bin/security find-generic-password -s 'de.multiterminal.endpoint' -a 'ep-test' -w)");
});
