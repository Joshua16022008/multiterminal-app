'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const F = require('../src/main/browser-feedback.js');
const R = require('../src/renderer/browser-feedback.js');
const { createBrowserBridge } = require('../src/main/browser-bridge.js');
const { createBrowserControl } = require('../src/main/browser-control.js');
const mt = require('../src/main/mt-browser-cli.js');

/* ---------- Kürzen und Bereinigen ---------- */

test('lange Inhalte werden hart gekürzt und die Antwort der Seite bereinigt', () => {
  const long = 'x'.repeat(50000);
  const e = F.sanitizeElement({
    url: long, title: long, selector: long, tag: 'DIV', id: long, classes: Array(100).fill(long), text: long, html: long,
    rect: { x: -5, y: NaN, width: 1e12, height: '40.6' },
  });
  for (const [key, max] of Object.entries({ url: F.LIMITS.url, title: F.LIMITS.title, selector: F.LIMITS.selector, id: F.LIMITS.id, text: F.LIMITS.text, html: F.LIMITS.html })) {
    assert.ok(e[key].length <= max, key);
  }
  assert.equal(e.classes.length, F.LIMITS.classes);
  assert.ok(e.classes.every((c) => c.length <= F.LIMITS.className));
  assert.equal(e.tag, 'div');
  assert.deepEqual(e.rect, { x: 0, y: 0, width: 100000, height: 41 });
  assert.ok(JSON.stringify(e).length < 2600, 'Gesamtgröße ~2 KB');
  assert.deepEqual(F.sanitizeElement(null).classes, []);
  assert.equal(F.truncate('abc', 10), 'abc');
});

test('Selektor- und Textprüfung', () => {
  assert.equal(F.validateSelector('#a > b'), '#a > b');
  for (const bad of ['', '  ', 5, null, 'a'.repeat(F.MAX_SELECTOR_LENGTH + 1), 'a\nb', 'a\u0000b']) {
    assert.throws(() => F.validateSelector(bad));
  }
  assert.equal(F.validateTypeText(''), '');
  assert.throws(() => F.validateTypeText(5));
  assert.throws(() => F.validateTypeText('x'.repeat(F.MAX_TYPE_TEXT + 1)));
});

/* ---------- Kodierung gegen Injektion ---------- */

const NASTY = ['"; alert(1); "', "'; throw 1; '", '</script><script>x()</script>', '`${evil()}`', '\\', '\u2028\u2029', 'a\nb', '\0'.repeat(0) + '${1}'];

test('Argumente reichen nur als JSON-Literal in den Seitencode', () => {
  for (const nasty of NASTY) {
    const script = F.buildActionScript('type', '[name="' + nasty.replace(/[\n\u0000]/g, ' ') + '"]', nasty);
    assert.doesNotMatch(script.slice(script.lastIndexOf('})(')), /<\/script>|[\u2028\u2029]/);
    // Der Aufrufteil ist ein reines Literal: ausgewertet ergibt es genau die Argumente zurück.
    const tail = script.slice(script.lastIndexOf('})(') + 3, -1);
    const args = vm.runInNewContext('[' + tail + ']');
    assert.equal(args[0], 'type');
    assert.equal(args[2], nasty);
  }
  assert.throws(() => F.buildActionScript('eval', 'a'));
  assert.throws(() => F.buildActionScript('click', ''));
});

/* ---------- Seitencode in einer Attrappe ausführen ---------- */

function fakePage(make) {
  const events = [];
  class Ev { constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); } }
  class Input { }
  class Area { }
  const ctx = {
    HTMLInputElement: Input, HTMLTextAreaElement: Area, Event: Ev,
    getComputedStyle: (el) => ({ display: el.hidden ? 'none' : 'block', visibility: 'visible' }),
    document: {
      querySelector(sel) {
        if (sel === '!!') throw new SyntaxError('bad');
        return elements[sel] || null;
      },
    },
  };
  const elements = typeof make === 'function' ? make(Input, Area) : make;
  for (const el of Object.values(elements)) {
    el.getBoundingClientRect = () => ({ width: el.hidden ? 0 : 10, height: el.hidden ? 0 : 10 });
    el.getAttribute = () => null;
    el.scrollIntoView = () => {};
    el.focus = () => {};
    el.dispatchEvent = (ev) => { events.push([el.name, ev.type, ev.bubbles]); };
    el.clicks = 0;
    el.click = () => { el.clicks++; };
  }
  Object.defineProperty(Input.prototype, 'value', { set(v) { this._v = v; }, get() { return this._v; } });
  Object.defineProperty(Area.prototype, 'value', { set(v) { this._v = v; }, get() { return this._v; } });
  return { ctx: vm.createContext(ctx), events, Input, Area };
}

function run(page, kind, selector, text) {
  return vm.runInContext(F.buildActionScript(kind, selector, text), page.ctx);
}

test('click: fehlend, ungültig, unsichtbar, deaktiviert und Erfolg', () => {
  const btn = Object.assign(new (class extends Object {})(), { name: 'btn', tagName: 'BUTTON', innerText: ' Senden  ' });
  const hidden = { name: 'h', tagName: 'BUTTON', hidden: true };
  const off = { name: 'o', tagName: 'BUTTON', disabled: true };
  const page = fakePage({ '#btn': btn, '#hid': hidden, '#off': off });
  assert.match(run(page, 'click', '#nix').error, /Kein Element/);
  assert.match(run(page, 'click', '!!').error, /Ungültiger Selektor/);
  assert.match(run(page, 'click', '#hid').error, /nicht sichtbar/);
  assert.match(run(page, 'click', '#off').error, /deaktiviert/);
  const ok = run(page, 'click', '#btn');
  assert.deepEqual([ok.ok, ok.tag, ok.text], [true, 'button', 'Senden']);
  assert.equal(btn.clicks, 1);
  assert.equal(hidden.clicks + off.clicks, 0);
});

test('type: setzt den Wert wörtlich, löst input und change aus und lehnt Nicht-Felder ab', () => {
  let input, area, check, ro;
  const page = fakePage((Input, Area) => {
    input = Object.assign(Object.create(Input.prototype), { name: 'in', tagName: 'INPUT', type: 'text' });
    area = Object.assign(Object.create(Area.prototype), { name: 'ta', tagName: 'TEXTAREA' });
    check = { name: 'cb', tagName: 'INPUT', type: 'checkbox' };
    ro = Object.assign(Object.create(Input.prototype), { name: 'ro', tagName: 'INPUT', type: 'text', readOnly: true });
    return { '#in': input, '#ta': area, '#cb': check, '#ro': ro };
  });
  for (const nasty of NASTY) {
    assert.equal(run(page, 'type', '#in', nasty).ok, true);
    assert.equal(input.value, nasty);
  }
  page.events.length = 0;
  assert.equal(run(page, 'type', '#ta', 'Zeile 1\nZeile 2').ok, true);
  assert.equal(area.value, 'Zeile 1\nZeile 2');
  assert.deepEqual(page.events, [['ta', 'input', true], ['ta', 'change', true]]);
  assert.match(run(page, 'type', '#cb', 'x').error, /kein Texteingabefeld/);
  assert.match(run(page, 'type', '#ro', 'x').error, /schreibgeschützt/);
});

/* ---------- CLI, Bridge, Steuerung ---------- */

test('CLI kennt genau click und type', () => {
  assert.deepEqual(mt.parseArgs(['click', '#a']), { cmd: 'click', args: { selector: '#a' } });
  assert.deepEqual(mt.parseArgs(['type', 'input[name=q]', 'hallo welt']), { cmd: 'type', args: { selector: 'input[name=q]', text: 'hallo welt' } });
  assert.ok(mt.parseArgs(['click']).error);
  assert.ok(mt.parseArgs(['click', 'a', 'b']).error);
  assert.ok(mt.parseArgs(['type', 'a']).error);
  assert.ok(mt.parseArgs(['eval', '1+1']).error);
  assert.match(mt.HELP, /mt-browser click/);
  assert.equal(mt.formatResponse('click', { ok: true, result: 'Geklickt: <button>' }).out, 'Geklickt: <button>');
});

function bridgeWith(handler) {
  const b = createBrowserBridge({ socketPath: '/tmp/mt-f05-unit.sock', handler });
  const tokenA = b.register('tile-a');
  const tokenB = b.register('tile-b');
  return { b, tokenA, tokenB };
}

async function viaBridge(b, request) {
  // execute ist nicht exportiert; über den Socket ansprechen.
  const net = require('node:net');
  await b.start();
  try {
    return await new Promise((resolve, reject) => {
      const c = net.connect(b.socketPath, () => c.write(JSON.stringify(request) + '\n'));
      let data = '';
      c.on('data', (d) => { data += d; });
      c.on('close', () => resolve(JSON.parse(data)));
      c.on('error', reject);
    });
  } finally { await b.stop(); }
}

test('Bridge: click/type werden geprüft und laufen nur mit dem Token der eigenen Kachel', async () => {
  const calls = [];
  const { b, tokenA, tokenB } = bridgeWith(async (id, cmd, args) => { calls.push([id, cmd, args]); return 'ok'; });
  assert.deepEqual(await viaBridge(b, { token: 'falsch', cmd: 'click', args: { selector: '#a' } }), { ok: false, error: 'Nicht berechtigt.' });
  assert.deepEqual(calls, []);
  const r = await viaBridge(b, { token: tokenB, cmd: 'type', args: { selector: '#a', text: 'x', terminalId: 'tile-a' } });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, [['tile-b', 'type', { selector: '#a', text: 'x' }]]); // Kachel kommt nur aus dem Token
  assert.equal((await viaBridge(b, { token: tokenA, cmd: 'click', args: { selector: 'x'.repeat(600) } })).ok, false);
  assert.equal((await viaBridge(b, { token: tokenA, cmd: 'type', args: { selector: '#a' } })).ok, false);
  assert.equal((await viaBridge(b, { token: tokenA, cmd: 'eval', args: { code: '1' } })).ok, false);
  assert.equal(calls.length, 1);
});

function fakeWc(result) {
  const scripts = [];
  return { scripts, id: 7, isDestroyed: () => false, getURL: () => 'http://localhost:1/', executeJavaScript: async (s) => { scripts.push(s); return typeof result === 'function' ? result(s) : result; } };
}

function control(wc, state = {}) {
  const st = { open: true, visible: true, ...state };
  return createBrowserControl({
    callRenderer: async (id, op) => ({ isOpen: st.open, webContentsId: 7, visible: st.visible })[op],
    webContentsFromId: () => wc, isOurWebview: () => true, consoleStore: { get: () => [] },
  });
}

test('Steuerung: click meldet Fehler der Seite, geschlossenen und unsichtbaren Browser klar', async () => {
  const ok = fakeWc({ ok: true, tag: 'button', text: 'Senden' });
  assert.equal(await control(ok)('t', 'click', { selector: '#go' }), 'Geklickt: <button> "Senden"');
  assert.equal(ok.scripts.length, 1);
  assert.match(await control(fakeWc({ ok: true, tag: 'input', text: '4 Zeichen' }))('t', 'type', { selector: '#q', text: 'Test' }), /Eingegeben in <input> \(4 Zeichen\)/);
  await assert.rejects(control(fakeWc({ ok: false, error: 'Das Element ist nicht sichtbar.' }))('t', 'click', { selector: '#x' }), /nicht sichtbar/);
  const closed = fakeWc({ ok: true });
  await assert.rejects(control(closed, { open: false })('t', 'click', { selector: '#x' }), /Kein Mini-Browser offen/);
  await assert.rejects(control(closed, { visible: false })('t', 'type', { selector: '#x', text: 'a' }), /nicht sichtbar/);
  assert.equal(closed.scripts.length, 0);
});

/* ---------- Auswahl: Esc, Navigation, Ergebnis ---------- */

function pickWc(pickResult, { delay = 0, onScript } = {}) {
  const wc = new EventEmitter();
  Object.assign(wc, {
    isDestroyed: () => false,
    scripts: [],
    executeJavaScript(script) {
      wc.scripts.push(script);
      if (onScript) onScript(script);
      if (script.startsWith('(function(){ if (window.__mtPickCancel)') && wc.cancelResolve) {
        wc.cancelResolve({ cancelled: true });
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        wc.cancelResolve = resolve;
        if (pickResult !== 'wait') setTimeout(() => resolve(pickResult), delay);
      });
    },
    capturePage: async (rect) => { wc.rect = rect; return { isEmpty: () => false, toPNG: () => Buffer.from('PNG') }; },
  });
  return wc;
}

const RAW = { url: 'http://localhost:1/', title: 'T', selector: '#a', tag: 'BUTTON', id: 'a', classes: ['c'], text: 'Hi', html: '<button id="a">Hi</button>', rect: { x: 1, y: 2, width: 30, height: 10 } };

test('Auswahl liefert begrenzten Kontext und legt den Bildausschnitt ab', async () => {
  const wc = pickWc({ element: RAW });
  const saved = [];
  const fb = F.createBrowserFeedback({ pageOf: async () => wc, saveImage: (png) => { saved.push(png); return { path: '/tmp/anhang/bild.png' }; } });
  const r = await fb.pick('t1');
  assert.equal(r.ok, true);
  assert.equal(r.element.selector, '#a');
  assert.deepEqual(r.screenshot, { path: '/tmp/anhang/bild.png' });
  assert.deepEqual(wc.rect, { x: 1, y: 2, width: 30, height: 10 });
  assert.equal(saved.length, 1);
  assert.equal(fb.isPicking('t1'), false);
  assert.equal(wc.listenerCount('did-start-navigation'), 0);
});

test('Screenshot-Fehler verhindert die Auswahl nicht', async () => {
  const wc = pickWc({ element: RAW });
  wc.capturePage = async () => { throw new Error('kaputt'); };
  const r = await F.createBrowserFeedback({ pageOf: async () => wc, saveImage: () => ({ path: 'x' }) }).pick('t1');
  assert.equal(r.ok, true);
  assert.equal(r.screenshot, null);
  assert.equal(r.screenshotError, 'kaputt');
});

test('Esc/Abbruch in der Seite und per Abbrechen-Knopf', async () => {
  const wc = pickWc({ cancelled: true });
  const fb = F.createBrowserFeedback({ pageOf: async () => wc, saveImage: () => ({ path: 'x' }) });
  assert.deepEqual(await fb.pick('t1'), { ok: false, cancelled: true });

  const wc2 = pickWc('wait');
  const fb2 = F.createBrowserFeedback({ pageOf: async () => wc2, saveImage: () => ({ path: 'x' }) });
  const pending = fb2.pick('t2');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(fb2.isPicking('t2'), true);
  // Eine neue Auswahl in derselben Kachel beendet die alte zuerst.
  const second = fb2.pick('t2');
  assert.deepEqual(await pending, { ok: false, cancelled: true });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(fb2.isPicking('t2'), true);
  assert.equal(await fb2.cancel('t2'), true);
  assert.deepEqual(await second, { ok: false, cancelled: true });
  assert.equal(await fb2.cancel('t2'), false);
});

test('Navigation während der Auswahl verwirft sie; Hash-Wechsel nicht', async () => {
  const wc = pickWc('wait');
  const fb = F.createBrowserFeedback({ pageOf: async () => wc, saveImage: () => ({ path: 'x' }) });
  const pending = fb.pick('t1');
  await new Promise((r) => setTimeout(r, 10));
  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  wc.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  assert.equal(fb.isPicking('t1'), true);
  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.deepEqual(await pending, { ok: false, navigated: true });
  assert.equal(wc.listenerCount('did-start-navigation'), 0);
});

test('Auswahl in geschlossenem Browser oder fremder Kachel schlägt klar fehl', async () => {
  const fb = F.createBrowserFeedback({ pageOf: async () => { throw new Error('Kein Mini-Browser offen.'); }, saveImage: () => ({}) });
  await assert.rejects(fb.pick('t1'), /Kein Mini-Browser/);
  assert.equal(fb.isPicking('t1'), false);
});

/* ---------- Oberfläche (Attrappe) ---------- */

function fakeDocument() {
  const listeners = [];
  const make = (tag) => {
    const el = {
      tag, className: '', children: [], attrs: {}, listeners: {}, textContent: '', hidden: false, value: '', parent: null,
      classList: { toggle(c, on) { const s = new Set(el.className.split(' ').filter(Boolean)); if (on) s.add(c); else s.delete(c); el.className = [...s].join(' '); } },
      setAttribute(k, v) { el.attrs[k] = v; if (k === 'hidden') el.hidden = true; },
      append(...kids) { for (const k of kids) { k.parent = el; el.children.push(k); } },
      remove() { if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el); el.parent = null; },
      addEventListener(t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); },
      focus() {},
      find(cls) { for (const c of el.children) { if (c.className.split(' ').includes(cls)) return c; const d = c.find(cls); if (d) return d; } return null; },
      click() { (el.listeners.click || []).forEach((f) => f({})); },
    };
    return el;
  };
  return {
    createElement: make,
    addEventListener(t, fn) { listeners.push([t, fn]); },
    removeEventListener(t, fn) { const i = listeners.findIndex((l) => l[0] === t && l[1] === fn); if (i >= 0) listeners.splice(i, 1); },
    press(key) { listeners.filter((l) => l[0] === 'keydown').forEach((l) => l[1]({ key })); },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

function ui({ pickResult, currentUrl = 'http://localhost:1/' }) {
  const document = fakeDocument();
  const notes = [];
  const opened = [];
  const cancels = [];
  let release;
  const api = {
    pick: () => (pickResult === 'wait' ? new Promise((r) => { release = r; }) : Promise.resolve(pickResult)),
    pickCancel: async (id) => { cancels.push(id); if (release) release({ ok: false, cancelled: true }); },
  };
  const draft = { open: (o) => { opened.push(o); } };
  const fb = R.createBrowserFeedback({ document, api, getPromptDraft: () => draft, notify: (m, k) => notes.push([m, k]) });
  const host = document.createElement('div');
  const state = { url: currentUrl };
  const handle = fb.attach({ terminalId: 'tile-1', getUrl: () => state.url, host });
  return { document, notes, opened, cancels, host, handle, state };
}

const PICKED = { ok: true, element: { ...F.sanitizeElement(RAW) }, screenshot: { path: '/tmp/a/bild.png' } };

test('Oberfläche: markieren, kommentieren, Promptvorschau mit Bild und eigener Kachel', async () => {
  const t = ui({ pickResult: PICKED });
  t.handle.button.click();
  await tick();
  const panel = t.host.find('bf-panel');
  assert.ok(panel);
  // ohne Kommentar nichts senden
  panel.find('bf-send').click();
  assert.equal(t.opened.length, 0);
  panel.find('bf-comment').value = 'Abstand fehlt';
  panel.find('bf-send').click();
  assert.equal(t.opened.length, 1);
  assert.equal(t.opened[0].terminalId, 'tile-1');
  assert.deepEqual(t.opened[0].files, [{ path: '/tmp/a/bild.png', kind: 'image' }]);
  assert.match(t.opened[0].text, /^Im Browser \(http:\/\/localhost:1\/\) Element #a \(„Hi“\):\n<button id="a">Hi<\/button>\n\nKommentar: Abstand fehlt$/);
  assert.equal(t.host.find('bf-panel'), null);
  assert.equal(t.handle.state(), 'idle');
});

test('Oberfläche: Seite hat sich geändert -> Auswahl verworfen, nichts gesendet', async () => {
  const t = ui({ pickResult: PICKED });
  t.handle.button.click();
  await tick();
  t.state.url = 'http://localhost:1/andere-seite';
  const panel = t.host.find('bf-panel');
  panel.find('bf-comment').value = 'Hallo';
  panel.find('bf-send').click();
  assert.equal(t.opened.length, 0);
  assert.equal(t.host.find('bf-panel'), null);
  assert.deepEqual(t.notes.at(-1), ['Seite hat sich geändert – Auswahl verworfen.', 'error']);
  assert.equal(R.samePage('http://a/x#1', 'http://a/x#2'), true);
  assert.equal(R.samePage('http://a/x', 'http://a/y'), false);
});

test('Oberfläche: Navigation während der Auswahl meldet den Hinweis', async () => {
  const t = ui({ pickResult: { ok: false, navigated: true } });
  t.handle.button.click();
  await tick();
  assert.deepEqual(t.notes.at(-1), ['Seite hat sich geändert – Auswahl verworfen.', 'error']);
  assert.equal(t.handle.state(), 'idle');
});

test('Oberfläche: Esc bricht Auswahl und Kommentarfeld ab', async () => {
  const t = ui({ pickResult: 'wait' });
  t.handle.button.click();
  await tick();
  assert.equal(t.handle.state(), 'picking');
  t.document.press('Escape');
  await tick();
  assert.equal(t.handle.state(), 'idle');
  assert.deepEqual(t.cancels, ['tile-1']);
  assert.equal(t.host.find('bf-panel'), null);

  const t2 = ui({ pickResult: PICKED });
  t2.handle.button.click();
  await tick();
  t2.host.find('bf-panel').find('bf-drop').click();
  assert.equal(t2.host.find('bf-panel'), null);
  assert.equal(t2.opened.length, 0);
});

test('Oberfläche: Promptvorschau-Fehler bleibt im Feld sichtbar', async () => {
  const t = ui({ pickResult: PICKED });
  const fb = R.createBrowserFeedback({ document: t.document, api: { pick: async () => PICKED, pickCancel: async () => {} }, getPromptDraft: () => ({ open() { throw new Error('Bitte die offene Vorschau zuerst einfügen oder schließen.'); } }) });
  const host = t.document.createElement('div');
  const h = fb.attach({ terminalId: 'x', getUrl: () => 'http://localhost:1/', host });
  h.button.click();
  await tick();
  const p = host.find('bf-panel');
  p.find('bf-comment').value = 'x';
  p.find('bf-send').click();
  assert.match(p.find('bf-warn').textContent, /offene Vorschau/);
  assert.ok(host.find('bf-panel'));
});
