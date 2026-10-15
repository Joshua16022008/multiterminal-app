'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, bodyClasses, load, DEFAULTS, KEY } = require('../src/renderer/qol-panel');

const mem = (data = {}) => ({ getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } });

test('defaults: everything on, no body classes', () => {
  assert.deepEqual(normalize(null), DEFAULTS);
  assert.deepEqual(bodyClasses(DEFAULTS), []);
});

test('only known boolean keys are taken over', () => {
  assert.deepEqual(normalize({ animate: false, autoSort: 'nein', evil: true }), { ...DEFAULTS, animate: false });
});

test('switched off options become body classes', () => {
  const s = { ...DEFAULTS, markWorking: false, markIdle: false, animate: false, taskChip: false, autoSort: false };
  assert.deepEqual(bodyClasses(s).sort(), ['qol-no-idle', 'qol-no-taskchip', 'qol-no-working', 'qol-static']);
});

test('load: stored settings, the former single sort switch, and broken storage', () => {
  assert.equal(load(mem({ [KEY]: JSON.stringify({ markWaiting: false }) })).markWaiting, false);
  assert.equal(load(mem({ 'mt.autoSort': 'off' })).autoSort, false);
  assert.deepEqual(load(mem({ [KEY]: '{kaputt' })), DEFAULTS);
  assert.deepEqual(load({ getItem: () => { throw new Error('blocked'); } }), DEFAULTS);
});
