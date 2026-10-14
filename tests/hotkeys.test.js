'use strict';

const test = require('node:test');
const assert = require('node:assert');
const hk = require('../src/renderer/hotkeys.js');

test('positions 0..8 get keys 1..9 and position 9 gets 0', () => {
  assert.deepStrictEqual([0, 1, 8, 9].map(hk.keyForIndex), ['1', '2', '9', '0']);
});

test('only the first ten positions have a key', () => {
  for (const i of [-1, 10, 29, 1.5, NaN, '3', null]) assert.strictEqual(hk.keyForIndex(i), '');
});

test('keys map back to positions, 0 is the tenth tile', () => {
  assert.deepStrictEqual(['1', '5', '9', '0'].map(hk.indexForKey), [0, 4, 8, 9]);
  for (const k of ['a', '', '10', undefined, 5]) assert.strictEqual(hk.indexForKey(k), -1);
});

test('key and position are inverse for all ten slots', () => {
  for (let i = 0; i < 10; i++) assert.strictEqual(hk.indexForKey(hk.keyForIndex(i)), i);
});

test('actions round-trip and foreign actions are rejected', () => {
  assert.strictEqual(hk.actionFor(9), 'focus-terminal:0');
  assert.strictEqual(hk.actionFor(10), null);
  assert.strictEqual(hk.indexForAction('focus-terminal:3'), 2);
  for (const a of ['new-terminal', 'focus-terminal:', 'focus-terminal:x', null]) assert.strictEqual(hk.indexForAction(a), -1);
});

test('targetFor ignores numbers beyond the tiles of the project', () => {
  assert.strictEqual(hk.targetFor('focus-terminal:2', 5), 1);
  assert.strictEqual(hk.targetFor('focus-terminal:6', 5), -1);
  assert.strictEqual(hk.targetFor('focus-terminal:0', 10), 9);
  assert.strictEqual(hk.targetFor('focus-terminal:0', 9), -1);
  assert.strictEqual(hk.targetFor('focus-terminal:1', 0), -1);
});

test('shifted or alt digits are not hotkeys', () => {
  assert.strictEqual(hk.isHotkeyEvent({ ctrlKey: true, key: '1' }), true);
  assert.strictEqual(hk.isHotkeyEvent({ metaKey: true, key: '0' }), true);
  assert.strictEqual(hk.isHotkeyEvent({ ctrlKey: true, shiftKey: true, key: '1' }), false);
  assert.strictEqual(hk.isHotkeyEvent({ metaKey: true, altKey: true, key: '1' }), false);
  assert.strictEqual(hk.isHotkeyEvent({ key: '1' }), false);
  assert.strictEqual(hk.isHotkeyEvent({ ctrlKey: true, key: 'a' }), false);
});
