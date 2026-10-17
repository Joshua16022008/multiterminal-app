'use strict';
// Kontextbezogene „?“-Links (Paket G-6). Jedes genannte Modul ruft help.link() mit einem Schlüssel
// 'seite' oder 'seite#anker' auf, dessen Seite in der Liste unten steht. Ohne Hilfe-Panel
// (window.DeckApp.help fehlt) darf nichts brechen: der Link entfällt einfach.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '../src/renderer');
const PAGES = ['einstellungen', 'harnesses-modelle', 'worktrees', 'terminals-und-agenten', 'ports', 'diff-und-git', 'uebergaben-und-anhaenge'];

// Modul -> Schlüssel, die es per Link anbietet (Seite bzw. Seite#anker).
const EXPECTED = {
  'settings-panel.js': ['einstellungen', 'harnesses-modelle'],
  'worktree-picker.js': ['worktrees'],
  'worktree-tree.js': ['worktrees'],
  'agent-launch.js': ['terminals-und-agenten'],
  'accounts-panel.js': ['einstellungen'],
  'ports-panel.js': ['ports'],
  'diff-panel.js': ['diff-und-git'],
  'workspace-templates.js': ['terminals-und-agenten'],
  'handoff-panel.js': ['uebergaben-und-anhaenge'],
};

const source = (file) => fs.readFileSync(path.join(dir, file), 'utf8');
const keysIn = (src) => [...src.matchAll(/helpLink\('([^']+)'/g)].map((m) => m[1].replace(/#.*$/, ''));

test('every listed module offers help links, and only for known guide pages', () => {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    const keys = keysIn(source(file));
    assert.deepEqual([...new Set(keys)].sort(), [...expected].sort(), file + ' link keys');
    for (const key of keys) {
      const [page, anchor] = key.split('#');
      assert.ok(PAGES.includes(page), file + ': unknown page in ' + key);
      if (anchor !== undefined) assert.match(anchor, /^[a-z0-9-]+$/, file + ': anchor form in ' + key);
    }
  }
});

test('every module uses the same shared helper (DeckHelp.linkFor) and no private guard', () => {
  const guard = "const helpLink = (key, opts) => (typeof window !== 'undefined' && window.DeckHelp && window.DeckHelp.linkFor ? window.DeckHelp.linkFor(key, opts) : null);";
  for (const file of Object.keys(EXPECTED)) {
    const src = source(file);
    assert.ok(src.includes(guard), file + ' uses the shared helper line');
    assert.ok(!/window\.DeckApp\.help\.link|D\.help\.link/.test(src), file + ' has no private guard');
  }
});

test('the modules still load in a bare context without a help panel', () => {
  for (const file of Object.keys(EXPECTED)) {
    const context = vm.createContext({ window: { DeckApp: {} }, document: {}, console });
    context.window.self = context.window;
    assert.doesNotThrow(() => vm.runInContext(source(file), context, { filename: file }), file);
  }
});

test('ports header shows the link when a help panel exists and nothing when it does not', () => {
  const { createPortsPanel } = require('../src/renderer/ports-panel');
  const h = (tag, props = {}, ...children) => ({ tag, ...props, children: children.flat().filter(Boolean), append(...i) { this.children.push(...i); }, replaceChildren(...i) { this.children = i.flat().filter(Boolean); } });
  const all = (el) => [el, ...el.children.flatMap(all)];
  const headOf = (root) => all(root).find((e) => e.className === 'ports-head' || e.class === 'ports-head');
  const make = () => {
    const root = h('aside');
    return { root, panel: createPortsPanel({ root, h, api: { list: async () => ({ ok: true, entries: [] }) }, getLabel: () => null, onJump() {}, onBrowser() {}, onClose() {}, schedule: () => 0, cancel() {} }) };
  };
  const saved = global.window;
  try {
    global.window = { DeckApp: { help: { link: (key) => h('button', { 'data-help': key, text: '?' }) } }, DeckHelp: require('../src/renderer/help-panel') };
    const { root, panel } = make();
    panel.toggle(true);
    const linked = all(headOf(root)).find((e) => e['data-help']);
    assert.equal(linked && linked['data-help'], 'ports');

    global.window = { DeckApp: {}, DeckHelp: require('../src/renderer/help-panel') };
    const plain = make();
    plain.panel.toggle(true);
    assert.equal(all(headOf(plain.root)).some((e) => e['data-help']), false);
    assert.ok(headOf(plain.root), 'header still renders');
  } finally {
    if (saved === undefined) delete global.window; else global.window = saved;
  }
});

// ---- Verhalten zur Laufzeit: Dialoge entstehen vor dem Hilfe-Panel, der Link kommt beim Öffnen ----
class FakeEl {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.value = ''; this.open = false; this.hidden = false; this.disabled = false; this.textContent = ''; this.isConnected = true; this.classList = { add() {}, toggle() {} }; this.dataset = {}; }
  get options() { return this.children.filter((c) => c.tagName === 'OPTION'); }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'value') this.value = v; }
  append(...c) { this.children.push(...c.flat().filter(Boolean)); }
  replaceChildren(...c) { this.children = c.flat().filter(Boolean); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatch(t, e = {}) { for (const fn of this.listeners[t] || []) fn({ preventDefault() {}, stopPropagation() {}, ...e }); }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  find(pred) { return pred(this) ? this : this.children.reduce((a, c) => a || (c.find && c.find(pred)), null); }
}
const fakeDoc = () => ({ body: new FakeEl('body'), activeElement: null, createElement: (t) => new FakeEl(t) });
const fakeH = (tag, props = {}, ...children) => {
  const e = new FakeEl(tag);
  for (const [k, v] of Object.entries(props || {})) { if (k === 'text') e.textContent = v; else if (k === 'onclick') e.addEventListener('click', v); else e[k] = v; e.attrs[k] = v; }
  e.append(...children);
  return e;
};
const helpButton = (key, opts) => { const b = fakeH('button', { 'data-help': key }); b.opts = opts; return b; };
const withHelp = (fn) => {
  const saved = global.window;
  global.window = { DeckApp: {}, DeckHelp: require('../src/renderer/help-panel') };
  try { return fn(global.window); } finally { if (saved === undefined) delete global.window; else global.window = saved; }
};

test('linkFor: no help panel gives null; later-created help panel is used', () => {
  withHelp((w) => {
    const { linkFor } = w.DeckHelp;
    assert.equal(linkFor('ports'), null);
    w.DeckApp.help = { link: (k, o) => ({ k, o }) };
    assert.deepEqual(linkFor('ports', { beforeOpen: 1 }), { k: 'ports', o: { beforeOpen: 1 } });
  });
});

test('handoff dialog: link appears when the dialog opens after help was created later, and closes the dialog first', async () => {
  await withHelp(async (w) => {
    const ctx = vm.createContext({ window: w });
    vm.runInContext(source('handoff-panel.js'), ctx);
    const { createHandoffDialog } = w.DeckHandoff;
    const doc = fakeDoc();
    const pane = { id: 'a', project: { name: 'P' }, desc: { title: 'T' } };
    const dlg = createHandoffDialog({ document: doc, h: fakeH, getSource: () => pane, getTargets: () => [pane, { id: 'b', project: { name: 'P' }, desc: { title: 'U' } }], getProjectId: () => 'p', readProgress: async () => null, promptDraft: { open: () => true }, notify() {} });
    const dialog = dlg.element;
    const has = () => Boolean(dialog.find((e) => e.attrs && e.attrs['data-help']));
    assert.equal(has(), false, 'not yet: no help panel at build time');
    w.DeckApp.help = { link: (k, o) => helpButton(k, o) };
    await dlg.open();
    assert.equal(has(), true);
    const btn = dialog.find((e) => e.attrs && e.attrs['data-help']);
    assert.equal(btn.attrs['data-help'], 'uebergaben-und-anhaenge');
    assert.equal(dialog.find((e) => e.tagName === 'H2').children.length, 0, 'link is beside, not inside the heading');
    assert.equal(dialog.open, true);
    btn.opts.beforeOpen();
    assert.equal(dialog.open, false, 'the modal is closed before the help opens');
  });
});

test('agent-launch dialog: link appears when opened after help was created later; closing leaves state closed', async () => {
  await withHelp(async (w) => {
    const { create } = require('../src/renderer/agent-launch');
    const doc = fakeDoc();
    const launcher = create({ document: doc, api: { worktrees: { list: async () => [] } }, notify() {}, launch() {} });
    const dialog = doc.body.children[0];
    const find = () => dialog.find((e) => e.attrs && e.attrs['data-help']);
    w.DeckApp.help = { link: (k, o) => helpButton(k, o) };
    await launcher.open({ project: { id: 'p', path: '/x', name: 'X' } });
    const btn = find();
    assert.ok(btn, 'help link present after open');
    assert.equal(btn.attrs['data-help'], 'terminals-und-agenten');
    assert.equal(dialog.open, true);
    btn.opts.beforeOpen();
    assert.equal(dialog.open, false);
  });
});
