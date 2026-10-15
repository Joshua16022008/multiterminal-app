'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { activityOf, sortByActivity } = require('../src/renderer/activity');

test('agent states map to working, waiting and idle', () => {
  assert.equal(activityOf({ state: 'working' }), 'working');
  assert.equal(activityOf({ state: 'needs-input' }), 'waiting');
  assert.equal(activityOf({ state: 'error' }), 'waiting');
  assert.equal(activityOf({ state: 'turn-complete', unread: true }), 'waiting');
  assert.equal(activityOf({ state: 'turn-complete', unread: false }), 'idle');
  assert.equal(activityOf({ state: 'unknown' }), 'idle');
});

test('no agent or a stopped terminal is not marked', () => {
  assert.equal(activityOf(null), null);
  assert.equal(activityOf({ state: 'working' }, false), null);
});

test('sorting: waiting first, working in the middle, idle and plain shells last; manual order kept per group', () => {
  const tiles = [
    { id: 'shell', a: null }, { id: 'idle1', a: 'idle' }, { id: 'work1', a: 'working' },
    { id: 'wait1', a: 'waiting' }, { id: 'work2', a: 'working' }, { id: 'wait2', a: 'waiting' }, { id: 'idle2', a: 'idle' },
  ];
  const sorted = sortByActivity(tiles, (t) => t.a).map((t) => t.id);
  assert.deepEqual(sorted, ['wait1', 'wait2', 'work1', 'work2', 'shell', 'idle1', 'idle2']);
  assert.deepEqual(tiles.map((t) => t.id)[0], 'shell', 'input list is not changed');
});

test('without any agent status the manual order stays exactly as it is', () => {
  const tiles = ['a', 'b', 'c'].map((id) => ({ id }));
  assert.deepEqual(sortByActivity(tiles, () => null).map((t) => t.id), ['a', 'b', 'c']);
});
