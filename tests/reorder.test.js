'use strict';

const test = require('node:test');
const assert = require('node:assert');
const ro = require('../src/renderer/reorder.js');

test('swaps two places and leaves the ones in between alone', () => {
  assert.deepStrictEqual(ro.swapped(['a', 'b', 'c', 'd', 'e', 'f'], 5, 0), ['f', 'b', 'c', 'd', 'e', 'a']);
  assert.deepStrictEqual(ro.swapped(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
});

test('does not touch the input list', () => {
  const l = ['a', 'b', 'c'];
  ro.swapped(l, 0, 2);
  assert.deepStrictEqual(l, ['a', 'b', 'c']);
});

test('same place, out of range or bad input give null', () => {
  const l = ['a', 'b', 'c'];
  for (const [a, b] of [[1, 1], [-1, 0], [0, 3], [0.5, 1], ['0', 1], [NaN, 1], [undefined, 1]]) {
    assert.strictEqual(ro.swapped(l, a, b), null, `${a},${b}`);
  }
  assert.strictEqual(ro.swapped(null, 0, 1), null);
  assert.strictEqual(ro.swapped([], 0, 0), null);
  assert.strictEqual(ro.swapped(['a'], 0, 0), null);
});

test('swapInPlace mutates and reports whether anything changed', () => {
  const l = ['a', 'b', 'c'];
  assert.strictEqual(ro.swapInPlace(l, 2, 0), true);
  assert.deepStrictEqual(l, ['c', 'b', 'a']);
  assert.strictEqual(ro.swapInPlace(l, 1, 1), false);
  assert.strictEqual(ro.swapInPlace(l, 0, 9), false);
  assert.deepStrictEqual(l, ['c', 'b', 'a']);
});

test('a swapped list survives the session round trip in order', () => {
  const panes = [{ desc: { id: 1 } }, { desc: { id: 2 } }, { desc: { id: 3 } }];
  ro.swapInPlace(panes, 0, 2);
  const saved = JSON.parse(JSON.stringify({ terminals: panes.map((x) => ({ ...x.desc })) }));
  assert.deepStrictEqual(saved.terminals.map((t) => t.id), [3, 2, 1]);
});
