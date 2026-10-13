'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { MAX_TERMINALS, gridFor } = require('../src/renderer/layout.js');

test('MAX_TERMINALS is 10', () => {
  assert.strictEqual(MAX_TERMINALS, 10);
});

test('gridFor returns the expected grid for every count from 0 to 11', () => {
  const expected = {
    0: [1, 1],
    1: [1, 1],
    2: [2, 1],
    3: [2, 2],
    4: [2, 2],
    5: [3, 2],
    6: [3, 2],
    7: [3, 3],
    8: [3, 3],
    9: [3, 3],
    10: [4, 3],
    11: [4, 3],
  };
  for (let count = 0; count <= 11; count++) {
    const [cols, rows] = expected[count];
    assert.deepStrictEqual(gridFor(count), { cols, rows }, `count ${count}`);
  }
});

test('gridFor treats counts above 10 as 10', () => {
  assert.deepStrictEqual(gridFor(12), { cols: 4, rows: 3 });
  assert.deepStrictEqual(gridFor(1000), { cols: 4, rows: 3 });
  assert.deepStrictEqual(gridFor(Infinity), { cols: 4, rows: 3 });
});

test('gridFor treats negative numbers, NaN and non-numbers as 0', () => {
  const zero = { cols: 1, rows: 1 };
  assert.deepStrictEqual(gridFor(-1), zero);
  assert.deepStrictEqual(gridFor(-Infinity), zero);
  assert.deepStrictEqual(gridFor(NaN), zero);
  assert.deepStrictEqual(gridFor(undefined), zero);
  assert.deepStrictEqual(gridFor(null), zero);
  assert.deepStrictEqual(gridFor('5'), zero);
  assert.deepStrictEqual(gridFor('abc'), zero);
  assert.deepStrictEqual(gridFor({}), zero);
  assert.deepStrictEqual(gridFor([3]), zero);
});

test('gridFor rounds non-integers down', () => {
  assert.deepStrictEqual(gridFor(2.7), { cols: 2, rows: 1 });
  assert.deepStrictEqual(gridFor(4.99), { cols: 2, rows: 2 });
  assert.deepStrictEqual(gridFor(0.5), { cols: 1, rows: 1 });
  assert.deepStrictEqual(gridFor(9.9), { cols: 3, rows: 3 });
  assert.deepStrictEqual(gridFor(10.9), { cols: 4, rows: 3 });
});

test('gridFor always returns a fresh object with only cols and rows', () => {
  const a = gridFor(3);
  a.cols = 99;
  assert.deepStrictEqual(gridFor(3), { cols: 2, rows: 2 });
});
