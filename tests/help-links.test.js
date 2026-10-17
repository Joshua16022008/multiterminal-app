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
const PAGES = ['einstellungen', 'worktrees', 'terminals-und-agenten', 'ports', 'diff-und-git', 'uebergaben-und-anhaenge'];

// Modul -> Schlüssel, die es per Link anbietet (Seite bzw. Seite#anker).
const EXPECTED = {
  'settings-panel.js': ['einstellungen'],
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
const keysIn = (src) => [...src.matchAll(/(?:helpLink|help\.link)\('([^']+)'\)/g)].map((m) => m[1]);

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

test('the link is guarded: a missing help panel yields null, never a call on undefined', () => {
  for (const file of Object.keys(EXPECTED)) {
    const src = source(file);
    assert.match(src, /window\.DeckApp && window\.DeckApp\.help && window\.DeckApp\.help\.link|D\.help && D\.help\.link/, file + ' guard');
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
    global.window = { DeckApp: { help: { link: (key) => h('button', { 'data-help': key, text: '?' }) } } };
    const { root, panel } = make();
    panel.toggle(true);
    const linked = all(headOf(root)).find((e) => e['data-help']);
    assert.equal(linked && linked['data-help'], 'ports');

    global.window = { DeckApp: {} };
    const plain = make();
    plain.panel.toggle(true);
    assert.equal(all(headOf(plain.root)).some((e) => e['data-help']), false);
    assert.ok(headOf(plain.root), 'header still renders');
  } finally {
    if (saved === undefined) delete global.window; else global.window = saved;
  }
});
