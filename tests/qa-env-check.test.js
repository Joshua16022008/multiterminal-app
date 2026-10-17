'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { diagnose } = require('../scripts/qa-env-check');

test('diagnose classifies probe results', () => {
  assert.equal(diagnose({ ok: true }), 'ok');
  assert.equal(diagnose({ ok: false, signal: 'SIGABRT' }), 'sandboxed');
  assert.equal(diagnose({ ok: false, timedOut: true }), 'sandboxed');
  assert.equal(diagnose({ ok: false, signal: null }), 'failed');
});
