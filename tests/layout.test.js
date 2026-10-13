'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { MAX_TERMINALS, gridFor } = require('../src/renderer/layout.js');

test('MAX_TERMINALS is the safety ceiling of 30', () => {
  assert.strictEqual(MAX_TERMINALS, 30);
});

test('one or two terminals sit side by side in a single row', () => {
  assert.deepStrictEqual(gridFor(0), { cols: 1, rows: 1, visibleRows: 1 });
  assert.deepStrictEqual(gridFor(1), { cols: 1, rows: 1, visibleRows: 1 });
  assert.deepStrictEqual(gridFor(2), { cols: 2, rows: 1, visibleRows: 1 });
});

test('from three terminals on the grid is always three wide', () => {
  const expected = { 3: 1, 4: 2, 6: 2, 7: 3, 9: 3, 10: 4, 12: 4, 15: 5, 30: 10 };
  for (const [count, rows] of Object.entries(expected)) {
    const grid = gridFor(Number(count));
    assert.strictEqual(grid.cols, 3, `cols for ${count}`);
    assert.strictEqual(grid.rows, rows, `rows for ${count}`);
  }
});

test('at most two rows share the visible height, the rest scrolls', () => {
  assert.strictEqual(gridFor(3).visibleRows, 1);
  assert.strictEqual(gridFor(4).visibleRows, 2);
  assert.strictEqual(gridFor(6).visibleRows, 2);
  assert.strictEqual(gridFor(7).visibleRows, 2);
  assert.strictEqual(gridFor(30).visibleRows, 2);
});

test('counts above the ceiling are treated as the ceiling', () => {
  for (const count of [31, 1000, Infinity]) assert.deepStrictEqual(gridFor(count), gridFor(30));
});

test('negative numbers, NaN and non-numbers are treated as 0', () => {
  const zero = gridFor(0);
  for (const bad of [-1, -Infinity, NaN, undefined, null, '5', 'abc', {}, [3]]) {
    assert.deepStrictEqual(gridFor(bad), zero);
  }
});

test('non-integers are rounded down', () => {
  assert.deepStrictEqual(gridFor(3.9), gridFor(3));
  assert.deepStrictEqual(gridFor(6.5), gridFor(6));
});
