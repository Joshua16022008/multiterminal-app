'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/sidebar-tooltips.js'), 'utf8');

// Deliberately small DOM model: verifies event/state behavior, not browser layout.
function setup() {
  class Element {
    constructor() { this.attrs = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.isConnected = true; this.hidden = false; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    emit(name, event = {}) { for (const fn of this.listeners[name] || []) fn(event); }
    setAttribute(key, value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    removeAttribute(key) { delete this.attrs[key]; }
    closest() { return this.dataset.tooltip ? this : null; }
    contains(el) { return el?.isConnected && el.inList; }
    getBoundingClientRect() { return this.box || { left: 10, top: 10, bottom: 30, width: 280, height: 50 }; }
  }
  const list = new Element(), document = new Element(), window = new Element();
  let popup, hit = null, observer;
  const queue = [];
  document.getElementById = () => list;
  document.createElement = () => (popup = new Element());
  document.body = { append() {} };
  document.elementFromPoint = () => hit;
  const context = { document, window, Element, innerWidth: 400, innerHeight: 300,
    requestAnimationFrame: fn => (queue.push(fn), queue.length),
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} },
  };
  vm.runInNewContext(source, context);
  const target = (text = '7 Commits noch nicht auf GitHub') => {
    const el = new Element(); el.inList = true; el.dataset.tooltip = text; return el;
  };
  const flush = () => { while (queue.length) queue.shift()(); };
  const hover = el => { hit = el; list.emit('pointermove', { clientX: 20, clientY: 20 }); flush(); };
  return { list, document, window, target, hover, flush, popup, mutate: () => observer(), hit: el => { hit = el; } };
}

test('stationary hover follows replacement rows and current tooltip text', () => {
  const t = setup(), old = t.target();
  old.setAttribute('aria-describedby', 'existing-description');
  t.hover(old);
  assert.equal(t.popup.hidden, false);
  assert.equal(t.popup.textContent, old.dataset.tooltip);
  assert.equal(old.getAttribute('aria-describedby'), 'existing-description sidebar-tooltip');
  old.isConnected = false;
  const replacement = t.target('8 Commits noch nicht auf GitHub');
  t.hit(replacement); t.mutate(); t.flush();
  assert.equal(t.popup.hidden, false);
  assert.equal(t.popup.textContent, replacement.dataset.tooltip);
  assert.equal(old.getAttribute('aria-describedby'), 'existing-description');
  assert.equal(replacement.getAttribute('aria-describedby'), 'sidebar-tooltip');
  replacement.dataset.tooltip = '9 Commits'; t.mutate(); t.flush();
  assert.equal(t.popup.textContent, '9 Commits');
  replacement.isConnected = false; t.hit(null); t.mutate(); t.flush();
  assert.equal(t.popup.hidden, true);
});

test('keyboard focus, Escape and focus loss show and dismiss without stale callbacks', () => {
  const t = setup(), target = t.target();
  t.list.emit('focusin', { target }); t.flush();
  assert.equal(t.popup.hidden, false);
  t.mutate(); t.document.emit('keydown', { key: 'Escape' }); t.flush();
  assert.equal(t.popup.hidden, true, 'queued render must not reopen after Escape');
  t.list.emit('focusin', { target }); t.flush();
  t.list.emit('focusout'); t.flush();
  assert.equal(t.popup.hidden, true);
  assert.equal(target.getAttribute('aria-describedby'), null);
});

test('leave, click, scroll, resize and window blur dismiss the popup', () => {
  const t = setup(), target = t.target();
  for (const [emitter, event] of [[t.list, 'pointerleave'], [t.list, 'click'], [t.document, 'scroll'], [t.window, 'resize'], [t.window, 'blur']]) {
    t.hover(target); assert.equal(t.popup.hidden, false);
    emitter.emit(event); t.flush(); assert.equal(t.popup.hidden, true, event);
  }
});

test('popup stays inside viewport near right and bottom edges', () => {
  const t = setup(), target = t.target();
  target.box = { left: 370, top: 260, bottom: 280 };
  t.hover(target);
  assert.equal(t.popup.style.left, '112px');
  assert.equal(t.popup.style.top, '202px');
});

test('outside targets and empty explanations never show a popup', () => {
  const t = setup(), outside = t.target(); outside.inList = false;
  t.hover(outside); assert.equal(t.popup.hidden, true);
  t.hover(t.target('')); assert.equal(t.popup.hidden, true);
});

test('real sidebar producers supply explanations for every requested indicator', async () => {
  const make = (tag, props = {}, ...children) => ({ tag, props, children: children.flat(),
    addEventListener() {}, append(child) { this.children.push(child); }, replaceChildren(...kids) { this.children = kids; } });
  const list = make('ul'), empty = {};
  const status = { isRepo: true, branch: 'main', changes: 1, ahead: 7, behind: 4 };
  const D = { h: make };
  const window = { DeckApp: D, deck: { git: { status: async () => status, pull: async () => status } }, addEventListener() {} };
  const context = vm.createContext({ window, document: {}, setInterval() {}, setTimeout() {},
    S: { projects: [{ id: 'qa', name: 'QA', path: '/tmp/qa' }], activeId: 'qa' },
    D, h: make, $: id => id === 'project-list' ? list : empty,
    panesOf: () => Array.from({ length: 4 }, () => ({ status: 'running' })),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/github-panel.js'), 'utf8'), context);
  D.git.init({ projects: () => [{ id: 'qa' }], activeId: () => 'qa', render() {} });
  D.git.onSelect({ id: 'qa' }); await new Promise(resolve => setImmediate(resolve));
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  vm.runInContext(app.slice(app.indexOf('  function renderSidebar()'), app.indexOf('  function renderHeader()')) + '\nrenderSidebar();', context);
  const nodes = [];
  const visit = node => { if (!node?.props) return; nodes.push(node); node.children.forEach(visit); };
  visit(list);
  for (const [cls, text] of [['git-ind ahead', '7 Commits'], ['git-ind behind', '4 Commits'], ['git-ind changes', '1 nicht committete Änderung'], ['proj-count live', '4 laufende Terminals'], ['proj-pm', 'Projektmanager öffnen'], ['git-branch', 'Branch: main'], ['proj-sync', 'Mit GitHub synchronisieren']]) {
    const node = nodes.find(n => n.props.class === cls);
    assert.ok(node, cls);
    assert.ok(node.props['data-tooltip'].includes(text), cls);
    assert.equal(node.props.title, '', 'suppress native title inherited from activity row');
    assert.ok(node.tag === 'button' || node.props.tabindex === '0', 'keyboard reachable');
  }
});
