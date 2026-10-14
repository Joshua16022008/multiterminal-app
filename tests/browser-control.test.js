'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { createBrowserControl, createConsoleStore, createRendererLink, normalizeConsoleEvent } = require('../src/main/browser-control.js');

function fakeWc(opts = {}) {
  const wc = new EventEmitter();
  let url = opts.url || 'http://localhost:1/';
  let canBack = opts.canBack !== false;
  Object.assign(wc, {
    id: 7,
    isDestroyed: () => false,
    getURL: () => url,
    getTitle: () => 'Titel',
    reload() { setTimeout(() => wc.emit('did-finish-load'), 5); },
    navigationHistory: {
      canGoBack: () => canBack, canGoForward: () => false,
      goBack() { url = 'http://localhost:1/prev'; setTimeout(() => wc.emit('did-navigate-in-page'), 5); },
    },
    executeJavaScript: async () => opts.text ?? 'Hallo Welt',
    capturePage: async () => ({ isEmpty: () => !!opts.empty, toPNG: () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('data')]) }),
  });
  return wc;
}

function setup(over = {}) {
  const calls = [];
  const wc = over.wc || fakeWc();
  const tmp = fs.mkdtempSync('/tmp/mtc-');
  const state = { open: true, visible: true, wcId: 7, ...over.state };
  const handler = createBrowserControl({
    callRenderer: async (id, op, arg) => {
      calls.push([id, op, arg]);
      if (op === 'isOpen') return state.open;
      if (op === 'webContentsId') return state.wcId;
      if (op === 'visible') return state.visible;
      if (op === 'open') return { ok: true, url: 'http://localhost:1/x' };
      if (op === 'show') { state.open = true; return true; }
      return true;
    },
    webContentsFromId: (id) => (id === 7 ? wc : null),
    isOurWebview: over.isOurWebview || (() => true),
    consoleStore: over.consoleStore || createConsoleStore(),
    revealWindow: over.revealWindow,
    tmpDir: tmp,
    now: () => new Date(2026, 9, 13, 23, 5, 9),
    sleep: async () => {},
  });
  return { handler, calls, wc, tmp, done: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

test('open goes through the page and returns the final url', async () => {
  const c = setup();
  assert.strictEqual(await c.handler('t1', 'open', { url: 'http://localhost:1/x' }), 'http://localhost:1/x');
  assert.deepStrictEqual(c.calls[0], ['t1', 'open', 'http://localhost:1/x']);
  c.done();
});

test('open reports a failed load as an error', async () => {
  const c = setup();
  const h = createBrowserControl({
    callRenderer: async () => ({ ok: false, error: 'ERR_CONNECTION_REFUSED: http://localhost:1/' }),
    webContentsFromId: () => null, isOurWebview: () => true, consoleStore: createConsoleStore(),
  });
  await assert.rejects(h('t1', 'open', { url: 'x' }), /ERR_CONNECTION_REFUSED/);
  c.done();
});

test('page commands fail clearly without an open browser', async () => {
  for (const state of [{ open: false }, { wcId: null }]) {
    const c = setup({ state });
    for (const cmd of ['url', 'reload', 'text', 'console', 'back']) await assert.rejects(c.handler('t1', cmd, {}), /mt-browser open/);
    c.done();
  }
});

test('a webContents that is not our webview is refused', async () => {
  const c = setup({ isOurWebview: () => false });
  await assert.rejects(c.handler('t1', 'url', {}), /nicht erreichbar/);
  c.done();
  const gone = setup({ state: { wcId: 99 } });
  await assert.rejects(gone.handler('t1', 'url', {}), /nicht erreichbar/);
  gone.done();
});

test('url, reload and back use the webview', async () => {
  const c = setup();
  assert.strictEqual(await c.handler('t1', 'url', {}), 'http://localhost:1/');
  assert.strictEqual(await c.handler('t1', 'reload', {}), 'http://localhost:1/');
  assert.strictEqual(await c.handler('t1', 'back', {}), 'http://localhost:1/prev');
  await assert.rejects(c.handler('t1', 'forward', {}), /Kein späterer/);
  c.done();
  const none = setup({ wc: fakeWc({ canBack: false }) });
  await assert.rejects(none.handler('t1', 'back', {}), /Kein früherer/);
  none.done();
});

test('a failed reload becomes an error', async () => {
  const wc = fakeWc();
  wc.reload = () => setTimeout(() => wc.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:1/', true), 5);
  const c = setup({ wc });
  await assert.rejects(c.handler('t1', 'reload', {}), /ERR_CONNECTION_REFUSED/);
  c.done();
});

test('text has title and url first and is cut at the limit', async () => {
  const c = setup({ wc: fakeWc({ text: 'abcdefghij' }) });
  const t = await c.handler('t1', 'text', { limit: 4 });
  assert.ok(t.startsWith('Titel | http://localhost:1/\n\nabcd'));
  assert.match(t, /gekürzt auf 4/);
  assert.ok(!(await c.handler('t1', 'text', {})).includes('gekürzt'));
  c.done();
});

test('console returns the last entries of this webview with their source', async () => {
  const store = createConsoleStore(3);
  for (let i = 0; i < 5; i++) store.add(7, [{ level: 'error', message: 'm' + i, lineNumber: i, sourceId: 'http://x/app.js' }]);
  store.add(8, [{ level: 'info', message: 'other' }]);
  const c = setup({ consoleStore: store });
  assert.deepStrictEqual(await c.handler('t1', 'console', {}), [
    { level: 'error', message: 'm2 (/app.js:2)' }, { level: 'error', message: 'm3 (/app.js:3)' }, { level: 'error', message: 'm4 (/app.js:4)' },
  ]);
  assert.strictEqual((await c.handler('t1', 'console', { limit: 1 })).length, 1);
  c.done();
});

test('console events in old and new Electron form are normalized', () => {
  assert.deepStrictEqual(normalizeConsoleEvent([{}, 3, 'boom', 12, 'file.js']), { level: 'error', message: 'boom', line: 12, source: 'file.js' });
  assert.deepStrictEqual(normalizeConsoleEvent([{ level: 'warning', message: 'w', lineNumber: 1, sourceId: 's' }]), { level: 'warning', message: 'w', line: 1, source: 's' });
});

test('screenshot shows the browser, writes a png into a private folder and returns the path', async () => {
  const c = setup({ state: { open: false } });
  const r = await c.handler('abcdef123456', 'screenshot', {});
  assert.ok(c.calls.some((x) => x[1] === 'show'));
  assert.ok(r.path.endsWith('terminal-abcdef12-20261013-230509.png'), r.path);
  assert.deepStrictEqual(fs.readFileSync(r.path).subarray(0, 4), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  c.done();
});

test('screenshot target rules: png only, folder must exist, no foreign files overwritten', async () => {
  const c = setup();
  await assert.rejects(c.handler('t', 'screenshot', { out: path.join(c.tmp, 'a.jpg') }), /\.png/);
  await assert.rejects(c.handler('t', 'screenshot', { out: path.join(c.tmp, 'nope', 'a.png') }), /Zielordner/);
  const foreign = path.join(c.tmp, 'notes.png');
  fs.writeFileSync(foreign, 'not a png');
  await assert.rejects(c.handler('t', 'screenshot', { out: foreign }), /kein PNG/);
  assert.strictEqual(fs.readFileSync(foreign, 'utf8'), 'not a png');
  const ok = path.join(c.tmp, 'ok.png');
  assert.deepStrictEqual(await c.handler('t', 'screenshot', { out: ok }), { path: ok });
  assert.deepStrictEqual(await c.handler('t', 'screenshot', { out: ok }), { path: ok }); // own png may be replaced
  c.done();
});

test('screenshot of an invisible or empty browser is an error', async () => {
  const hidden = setup({ state: { visible: false } });
  await assert.rejects(hidden.handler('t', 'screenshot', {}), /nicht sichtbar/);
  hidden.done();
  const empty = setup({ wc: fakeWc({ empty: true }) });
  await assert.rejects(empty.handler('t', 'screenshot', {}), /Screenshot fehlgeschlagen \(leeres Bild\)/);
  empty.done();
});

test('unknown commands are refused', async () => {
  const c = setup();
  await assert.rejects(c.handler('t', 'eval', {}), /Unbekannter Befehl/);
  c.done();
});

test('renderer link matches answers to requests and times out', async () => {
  const sent = [];
  const link = createRendererLink({ send: (r) => sent.push(r), timeoutMs: 50 });
  const a = link.call('t1', 'isOpen');
  link.respond(sent[0].reqId, { ok: true, result: true });
  assert.strictEqual(await a, true);
  const b = link.call('t1', 'open', 'u');
  link.respond(sent[1].reqId, { ok: false, error: 'kaputt' });
  await assert.rejects(b, /kaputt/);
  await assert.rejects(link.call('t1', 'x'), /Zeitüberschreitung/);
  link.respond(999, { ok: true }); // unknown ids are ignored
});

test('console store drops buffers and keeps webviews apart', () => {
  const s = createConsoleStore();
  s.add(1, [{ message: 'a' }]); s.add(2, [{ message: 'b' }]);
  s.drop(1);
  assert.deepStrictEqual(s.get(1), []);
  assert.strictEqual(s.get(2).length, 1);
});

test('the Electron dev-mode security warning is not stored', () => {
  const s = createConsoleStore();
  s.add(1, [{ level: 'warning', message: '%cElectron Security Warning (Insecure Content-Security-Policy)' }]);
  s.add(1, [{ level: 'info', message: 'real' }]);
  assert.deepStrictEqual(s.get(1).map((e) => e.message), ['real']);
});

test('screenshot retries after a failed capture', async () => {
  const wc = fakeWc();
  const real = wc.capturePage;
  let n = 0;
  wc.capturePage = async () => { if (++n < 4) throw new Error('UnknownVizError'); return real(); };
  const levels = [];
  const c = setup({ wc, revealWindow: (l) => levels.push(l) });
  const r = await c.handler('t', 'screenshot', {});
  assert.ok(r.path.endsWith('.png'));
  assert.strictEqual(n, 4);
  assert.deepStrictEqual(levels, [1, 2]); // escalates: forward without focus, then with focus
  c.done();
});

test('screenshot gives up with a clear message when capturing never works', async () => {
  const wc = fakeWc();
  wc.capturePage = async () => { throw new Error('UnknownVizError'); };
  const c = setup({ wc });
  await assert.rejects(c.handler('t', 'screenshot', {}), /UnknownVizError/);
  c.done();
});
