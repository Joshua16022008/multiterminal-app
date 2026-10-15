'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createOutputBuffer } = require('../src/main/output-buffer.js');

test('ANSI- und Steuersequenzen werden entfernt', () => {
  const b = createOutputBuffer();
  b.append('t1', '\x1b[31mrot\x1b[0m und \x1b[1;32mgrün\x1b[0m\r\n');
  b.append('t1', '\x1b]0;Titel\x07nach OSC\r\n');
  b.append('t1', '\x1b]8;;http://x\x1b\\Link\x1b]8;;\x1b\\\r\n');
  b.append('t1', '\x1b[?2004hPrompt\x1b[?2004l\n');
  assert.deepStrictEqual(b.tail('t1', 10), ['rot und grün', 'nach OSC', 'Link', 'Prompt']);
});

test('CRLF über zwei Datenblöcke verteilt löscht die Zeile nicht', () => {
  const b = createOutputBuffer();
  b.append('t1', 'LOCAL_TEST_TERMINAL\r');
  b.append('t1', '\n\x1b[?2004h');
  b.append('t1', 'abc\r');
  b.append('t1', '\x1b[Kxy\r\n');
  assert.deepStrictEqual(b.tail('t1', 10), ['LOCAL_TEST_TERMINAL', 'xy']);
});

test('Sequenzen über Datenblock-Grenzen hinweg', () => {
  const b = createOutputBuffer();
  b.append('t', 'ab\x1b[3');
  b.append('t', '1mcd\x1b]0;tit');
  b.append('t', 'el\x07ef\n');
  assert.deepStrictEqual(b.tail('t', 5), ['abcdef']);
});

test('Wagenrücklauf überschreibt die Zeile, CRLF ist ein Umbruch', () => {
  const b = createOutputBuffer();
  b.append('t', 'Lade 10%\rLade 90%\r\nfertig\n');
  assert.deepStrictEqual(b.tail('t', 5), ['Lade 90%', 'fertig']);
});

test('Angefangene Zeile erscheint im tail, leere nicht', () => {
  const b = createOutputBuffer();
  b.append('t', 'eins\nzwei');
  assert.deepStrictEqual(b.tail('t', 5), ['eins', 'zwei']);
  b.append('t', '\n');
  assert.deepStrictEqual(b.tail('t', 5), ['eins', 'zwei']);
});

test('Zeilenring begrenzt auf maxLines, tail begrenzt auf 500', () => {
  const b = createOutputBuffer({ maxLines: 10 });
  for (let i = 0; i < 25; i++) b.append('t', `z${i}\n`);
  assert.deepStrictEqual(b.tail('t', 100), Array.from({ length: 10 }, (_, i) => `z${i + 15}`));
  const big = createOutputBuffer({ maxLines: 2000 });
  for (let i = 0; i < 800; i++) big.append('t', `x${i}\n`);
  assert.strictEqual(big.tail('t', 100000).length, 500);
  assert.strictEqual(big.tail('t', 3).length, 3);
  assert.strictEqual(big.tail('t', 0).length, 50); // ungültig -> Standard
});

test('Rohpuffer bleibt unter der Byte-Grenze und behält das Ende', () => {
  const b = createOutputBuffer({ maxRawBytes: 1000 });
  for (let i = 0; i < 100; i++) b.append('t', 'äöü-' + String(i).padStart(3, '0') + '\n');
  const raw = b.raw('t');
  assert.ok(Buffer.byteLength(raw) <= 1000);
  assert.ok(raw.endsWith('099\n'));
  assert.ok(raw.length > 100);
});

test('Terminals sind getrennt; forget und unbekannte IDs', () => {
  const b = createOutputBuffer();
  b.append('a', 'A\n');
  b.append('b', 'B\n');
  assert.deepStrictEqual(b.tail('a', 5), ['A']);
  assert.deepStrictEqual(b.tail('b', 5), ['B']);
  b.forget('a');
  assert.deepStrictEqual(b.tail('a', 5), []);
  assert.strictEqual(b.raw('a'), '');
  assert.deepStrictEqual(b.tail('nie', 5), []);
  b.append('x', 42);
  b.append('x', '');
  assert.deepStrictEqual(b.tail('x', 5), []);
});
