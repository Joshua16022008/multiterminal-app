'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { formatPercent, formatReset, levelOf } = require('../src/renderer/usage-view');

const NOW = new Date(2026, 9, 13, 12, 0, 0).getTime();

test('formatPercent rounds and clamps', () => {
  assert.strictEqual(formatPercent(12.4), '12 %');
  assert.strictEqual(formatPercent(150), '100 %');
  assert.strictEqual(formatPercent(-3), '0 %');
  assert.strictEqual(formatPercent(NaN), '–');
  assert.strictEqual(formatPercent('5'), '–');
});

test('formatReset shows relative time within a day', () => {
  assert.strictEqual(formatReset(NOW + (2 * 60 + 10) * 60000, NOW), 'in 2 Std. 10 Min.');
  assert.strictEqual(formatReset(NOW + 3 * 3600000, NOW), 'in 3 Std.');
  assert.strictEqual(formatReset(NOW + 35 * 60000, NOW), 'in 35 Min.');
  assert.strictEqual(formatReset(NOW + 5000, NOW), 'in 1 Min.');
});

test('formatReset shows weekday and time later on', () => {
  const target = new Date(2026, 9, 19, 14, 0, 0).getTime(); // Montag
  assert.strictEqual(formatReset(target, NOW), 'Mo 14:00');
});

test('formatReset handles past and missing values', () => {
  assert.strictEqual(formatReset(NOW - 1, NOW), 'jetzt');
  assert.strictEqual(formatReset(null, NOW), '');
});

test('levelOf picks the bar colour', () => {
  assert.strictEqual(levelOf(0), 'ok');
  assert.strictEqual(levelOf(70), 'warn');
  assert.strictEqual(levelOf(95), 'high');
});
