'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { cleanText, typingDiff } = require('../src/main/dictation');

test('cleanText removes line breaks and control characters', () => {
  assert.strictEqual(cleanText('rm -rf x\nls\r\n'), 'rm -rf x ls ');
  assert.strictEqual(cleanText('a\u0003b\u001b[2Jc\u007fd'), 'a b [2Jc d');
  assert.strictEqual(cleanText('Grüße, „Welt“ – ok'), 'Grüße, „Welt“ – ok');
  assert.strictEqual(cleanText(null), '');
});

test('typingDiff appends when the new text extends the old', () => {
  assert.strictEqual(typingDiff('', 'Hallo'), 'Hallo');
  assert.strictEqual(typingDiff('Hallo ', 'Hallo Welt'), 'Welt');
  assert.strictEqual(typingDiff('gleich', 'gleich'), '');
});

test('typingDiff backspaces over the part that changed', () => {
  assert.strictEqual(typingDiff('Hallo Welz', 'Hallo Welt'), '\x7ft');
  assert.strictEqual(typingDiff('abc', ''), '\x7f\x7f\x7f');
  assert.strictEqual(typingDiff('eins zwei', 'eins drei'), '\x7f'.repeat(4) + 'drei');
});

test('typingDiff counts an emoji as one backspace', () => {
  assert.strictEqual(typingDiff('ok 👍', 'ok '), '\x7f');
});
