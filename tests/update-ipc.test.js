'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('PM preload exposes only token-based update actions and the bound project', async () => {
  const invokes = [];
  let api;
  const electron = {
    contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'pm'); api = value; } },
    ipcRenderer: { invoke(...args) { invokes.push(args); return Promise.resolve({ ok: true }); } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main/pm-preload.js'), 'utf8'), {
    require: name => { assert.equal(name, 'electron'); return electron; },
    URLSearchParams, location: { search: '?project=bound-project' },
  });
  await api.updateSelect('/arbitrary/path');
  await api.updateInstall('opaque-token', '/arbitrary/target');
  await api.updateStatus();
  assert.deepEqual(invokes, [
    ['pm:updateSelect', 'bound-project'],
    ['pm:updateInstall', 'bound-project', 'opaque-token'],
    ['pm:updateStatus', 'bound-project'],
  ]);
});
