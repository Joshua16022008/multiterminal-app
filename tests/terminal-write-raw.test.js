'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'src');
const main = fs.readFileSync(path.join(root, 'main', 'main.js'), 'utf8');

test('terminals:write passes raw input through untouched; only terminals:runBuiltin decorates', () => {
  assert.match(main, /listen\('terminals:write', \(id, data\) => ptys\.write\(id, data\)\);/);
  const write = main.match(/listen\('terminals:write'[^\n]*\n/)[0];
  assert.doesNotMatch(write, /agentProfile|decorate/);
  assert.match(main, /listen\('terminals:runBuiltin'[\s\S]*?agentProfile\.builtinLine\(command\)/);
});
