'use strict';

const test = require('node:test');
const assert = require('node:assert');
const bv = require('../src/renderer/browser-view.js');

test('finds local addresses and returns them as localhost', () => {
  const text = 'Local: http://localhost:5173/\nalso http://127.0.0.1:3000/api and https://0.0.0.0:8443 and http://[::1]:4000/x?y=1#z';
  assert.deepStrictEqual(bv.findLocalUrls(text), [
    'http://localhost:5173/', 'http://localhost:3000/api', 'https://localhost:8443', 'http://localhost:4000/x?y=1#z',
  ]);
});

test('addresses without port and duplicates are handled', () => {
  assert.deepStrictEqual(bv.findLocalUrls('http://localhost and http://localhost'), ['http://localhost']);
});

test('other hosts are ignored', () => {
  assert.deepStrictEqual(bv.findLocalUrls('http://example.com:3000 http://192.168.1.5:3000 http://localhost.evil.com ftp://localhost:21'), []);
});

test('ANSI sequences are removed before matching', () => {
  const text = '  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\n';
  assert.deepStrictEqual(bv.findLocalUrls(text), ['http://localhost:5173/']);
  assert.strictEqual(bv.stripAnsi('\x1b]0;title\x07x\x1b[2K'), 'x');
});

test('trailing punctuation and unbalanced brackets are cut', () => {
  assert.deepStrictEqual(bv.findLocalUrls('see (http://localhost:3000/a).'), ['http://localhost:3000/a']);
  assert.deepStrictEqual(bv.findLocalUrls('"http://localhost:3000/a",'), ['http://localhost:3000/a']);
  assert.deepStrictEqual(bv.findLocalUrls('http://localhost:3000/a_(b)'), ['http://localhost:3000/a_(b)']);
  assert.deepStrictEqual(bv.findLocalUrls('<http://localhost:3000>, ok!'), ['http://localhost:3000']);
});

test('auto open: the first new address opens, repeats do not', () => {
  const a = bv.createAutoOpen();
  assert.strictEqual(a.feed('ready on http://localhost:3000/\n'), 'http://localhost:3000/');
  assert.strictEqual(a.feed('ready on http://localhost:3000/\n'), null);
  assert.strictEqual(a.feed('http://localhost:3000\n'), null); // same address, trailing slash aside
  assert.strictEqual(a.feed('http://localhost:4000/\n'), 'http://localhost:4000/');
});

test('auto open: an address split across chunks is still found', () => {
  const a = bv.createAutoOpen();
  assert.strictEqual(a.feed('Local: http://local'), null);
  assert.strictEqual(a.feed('host:51'), null);
  assert.strictEqual(a.feed('73/\nnext line\n'), 'http://localhost:5173/');
  assert.strictEqual(a.feed('Network: use --host\n'), null);
});

test('auto open: an unfinished last line can be flushed', () => {
  const a = bv.createAutoOpen();
  assert.strictEqual(a.feed('http://localhost:9000'), null);
  assert.strictEqual(a.flush(), 'http://localhost:9000');
  assert.strictEqual(a.flush(), null);
});

test('auto open: after the user closed the browser only a new address reopens it', () => {
  const a = bv.createAutoOpen();
  assert.strictEqual(a.feed('http://localhost:3000/\n'), 'http://localhost:3000/');
  a.userClosed();
  assert.strictEqual(a.isClosed(), true);
  assert.strictEqual(a.feed('restarted http://localhost:3000/\n'), null);
  assert.strictEqual(a.isClosed(), true);
  assert.strictEqual(a.feed('now http://localhost:3001/\n'), 'http://localhost:3001/');
  assert.strictEqual(a.isClosed(), false);
});

test('auto open: the shown address is not reloaded or reopened', () => {
  const a = bv.createAutoOpen();
  a.setCurrent('http://localhost:3000/');
  assert.strictEqual(a.feed('http://localhost:3000/\n'), null);
  assert.strictEqual(a.feed('http://localhost:3002/\n'), 'http://localhost:3002/');
  a.setCurrent('http://localhost:3002/');
  assert.strictEqual(a.feed('http://localhost:3002/ again\n'), null);
});

test('auto open: ANSI codes in a chunk do not hide the address', () => {
  const a = bv.createAutoOpen();
  assert.strictEqual(a.feed('\x1b[36mhttp://localhost:\x1b[1m7000\x1b[22m/\x1b[39m\r\n'), 'http://localhost:7000/');
});

test('modes cycle split, terminal, browser and unknown values fall back to split', () => {
  assert.deepStrictEqual(bv.MODES, ['split', 'terminal', 'browser']);
  assert.strictEqual(bv.nextMode('split'), 'terminal');
  assert.strictEqual(bv.nextMode('terminal'), 'browser');
  assert.strictEqual(bv.nextMode('browser'), 'split');
  assert.strictEqual(bv.nextMode('bogus'), 'terminal');
  assert.strictEqual(bv.nextMode(undefined), 'terminal');
});

test('viewFor derives visibility and classes from mode and open state', () => {
  assert.deepStrictEqual(bv.viewFor('split', true), { mode: 'split', showTerminal: true, showBrowser: true, classes: ['with-browser'] });
  assert.deepStrictEqual(bv.viewFor('terminal', true), { mode: 'terminal', showTerminal: true, showBrowser: false, classes: ['mode-terminal'] });
  assert.deepStrictEqual(bv.viewFor('browser', true), { mode: 'browser', showTerminal: false, showBrowser: true, classes: ['with-browser', 'mode-browser'] });
  for (const m of bv.MODES) {
    const v = bv.viewFor(m, false);
    assert.deepStrictEqual([v.showTerminal, v.showBrowser, v.classes], [true, false, []]);
  }
  assert.strictEqual(bv.viewFor('bogus', true).mode, 'split');
});
