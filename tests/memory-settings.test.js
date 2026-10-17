'use strict';
// DOM-model checks execute the real settings controller and real Memory store.
// They exercise handlers/state only, not browser layout, native focus or Electron.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createMemoryService } = require('../src/main/memory-service');

function matches(el, selector) {
  selector = selector.trim().split(/\s+/).at(-1);
  const attributes = [...selector.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g)];
  if (attributes.some(([, key, value]) => el.getAttribute(key) === null || (value !== undefined && el.getAttribute(key) !== value))) return false;
  selector = selector.replace(/\[[^\]]+\]/g, '');
  const id = selector.match(/#([\w-]+)/)?.[1]; if (id && el.id !== id) return false;
  const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(x => x[1]);
  if (classes.some(c => !String(el.props.class || '').split(' ').includes(c))) return false;
  const tag = selector.match(/^[\w-]+/)?.[0]; return !tag || tag.toUpperCase() === el.tagName;
}
class Element {
  constructor(tag, props = {}, children = []) {
    this.tagName = tag.toUpperCase(); this.props = { ...props }; this.children = []; this.listeners = {}; this.hidden = !!props.hidden;
    this.value = props.value || ''; this.checked = !!props.checked; this.disabled = !!props.disabled; this.id = props.id;
    this._text = props.text || ''; this.isConnected = true; this.append(...children);
  }
  get textContent() { return this._text + this.children.map(x => x.textContent).join(''); }
  set textContent(text) { this._text = String(text); this.children = []; }
  append(...items) { for (const item of items.flat()) if (item) { this.children.push(item); item.parentElement = this; } }
  replaceChildren(...items) { this.children = []; this._text = ''; this.append(...items); }
  setAttribute(key, value) { this.props[key] = String(value); }
  getAttribute(key) { return this.props[key] == null ? null : String(this.props[key]); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  async dispatch(name, event = {}) { for (const fn of this.listeners[name] || []) await fn({ target: this, preventDefault() {}, ...event }); }
  querySelectorAll(selector) { const all = []; for (const child of this.children) { if (selector.split(',').some(s => matches(child, s))) all.push(child); all.push(...child.querySelectorAll(selector)); } return all; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(el) { return el === this || this.children.some(c => c.contains(el)); }
  focus() {} setSelectionRange() {} getClientRects() { return [1]; }
}
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
async function fixture(t, selected = 'one') {
  const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mt-memory-settings-')));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const memory = createMemoryService({ dataDir: rootDir });
  const root = new Element('div', { id: 'settings-panel' });
  let confirmation = true, copied = '', currentProject = selected;
  const prompts = [], errors = [];
  const h = (tag, props, ...children) => new Element(tag, props, children);
  const window = { DeckApp: { h, errText: e => e.message || String(e) }, DeckHotkeys: {}, confirm: text => { prompts.push(text); return confirmation; }, addEventListener() {},
    deck: { memory, projects: { list: async () => [{ id: 'one', name: 'Project One' }, { id: 'two', name: 'Project Two' }] },
      settings: { overview: async () => ({ providers: [] }), readProfile: async () => ({ text: '', revision: 0 }) }, hotkeys: { capture: async () => {} } } };
  const globals = {
    window, document: { activeElement: null, getElementById: () => root }, navigator: { clipboard: { writeText: async text => { copied = text; } } },
    setInterval, clearInterval, console: { error: (...args) => errors.push(args) },
  };
  vm.compileFunction(fs.readFileSync(path.join(__dirname, '../src/renderer/settings-panel.js'), 'utf8'), Object.keys(globals))(...Object.values(globals));
  const panel = window.DeckApp.settingsPanel; panel.init({ projectId: () => currentProject }); panel.toggle(true); await settle();
  const button = text => root.querySelectorAll('button').find(b => b.textContent === text);
  const click = async text => { const b = button(text); assert.ok(b, 'button ' + text); await b.props.onclick(); await settle(); };
  await click('Memory');
  return { memory, root, panel, click, prompts, button, copied: () => copied, confirm: value => { confirmation = value; }, selectProject: value => { currentProject = value; }, errors };
}

test('Memory is app-wide; editor handlers save, copy exact scope, toggle persisted settings and confirm clear', async t => {
  const f = await fixture(t);
  assert.equal(f.root.querySelectorAll('[role=tab]').length, 0);
  assert.match(f.root.textContent, /Project One/);
  let editor = f.root.querySelector('#memory-global-notes'); editor.value = 'SHARED'; await editor.dispatch('input'); await f.click('Gemeinsames Memory speichern');
  editor = f.root.querySelector('#memory-project-notes'); editor.value = '<script>untrusted</script> PROJECT'; await editor.dispatch('input'); await f.click('Projekt-Memory speichern');
  f.memory.saveNotes('two', 'OTHER PRIVATE', 0);
  await f.click('Kontext kopieren'); assert.equal(f.copied(), f.memory.context('one')); assert.ok(!f.copied().includes('OTHER PRIVATE'));
  assert.ok(f.root.querySelector('#memory-project-notes').value.includes('<script>'));
  const box = f.root.querySelector('#memory-auto-capture'); box.checked = false; await box.dispatch('change');
  assert.equal(f.memory.getSettings().autoCapture, false);
  f.confirm(false); await f.click('Projekt-Memory leeren'); assert.ok(f.memory.read('one').notes.includes('PROJECT'));
  f.confirm(true); await f.click('Projekt-Memory leeren'); assert.equal(f.memory.read('one').notes, ''); assert.equal(f.memory.read(null).notes, 'SHARED');
  assert.match(f.prompts.at(-1), /Project One.*Notizen, alle Checkpoints/);
  f.panel.toggle(false); f.panel.toggle(true); await settle(); assert.ok(f.root.querySelector('#memory-enabled'));
});
test('revision conflict preserves draft; reload asks before replacement; navigation and reopen preserve draft', async t => {
  const f = await fixture(t), editor = f.root.querySelector('#memory-project-notes');
  editor.value = 'MY DRAFT'; await editor.dispatch('input');
  f.memory.saveNotes('one', 'CONCURRENT CHANGE', 0);
  await f.click('Projekt-Memory speichern');
  assert.equal(f.root.querySelector('#memory-project-notes').value, 'MY DRAFT'); assert.match(f.root.textContent, /Entwurf bleibt erhalten/);
  f.confirm(false); await f.click('Projekt-Memory neu laden'); assert.equal(f.root.querySelector('#memory-project-notes').value, 'MY DRAFT');
  f.confirm(true); await f.click('Profil'); await f.click('Memory');
  assert.equal(f.root.querySelector('#memory-project-notes').value, 'MY DRAFT');
  await f.click('Projekt-Memory neu laden'); assert.equal(f.root.querySelector('#memory-project-notes').value, 'CONCURRENT CHANGE');
  assert.equal(f.memory.read('one').notes, 'CONCURRENT CHANGE');
});
test('no-project state offers shared notes only and stale async results cannot replace another scope', async t => {
  const f = await fixture(t, null);
  assert.ok(f.root.querySelector('#memory-global-notes')); assert.equal(f.root.querySelector('#memory-project-notes'), null); assert.match(f.root.textContent, /Kein Projekt ausgewählt/);
  f.panel.toggle(false); f.selectProject('one');
  let resolveRead; const originalRead = f.memory.read;
  f.memory.read = id => id === 'one' ? new Promise(resolve => { resolveRead = resolve; }) : originalRead(id);
  f.panel.toggle(true); await settle();
  await f.click('Profil');
  resolveRead(originalRead('one')); await settle();
  assert.equal(f.root.querySelector('#memory-project-notes'), null);
  f.memory.read = originalRead; await f.click('Memory');
  assert.ok(f.root.querySelector('#memory-project-notes'));
});
test('checkpoint rendering marks automatic output unverified and includes structured provenance fields safely', async t => {
  const f = await fixture(t);
  f.memory.checkpoint('one', { source: 'agent', provider: 'codex', cwd: '/work/tree', workspaceId: 'tree-one', summary: '<img src=x>', decisions: 'Choice', openQuestions: 'Question', nextStep: 'Next' });
  f.memory.checkpoint('one', { source: 'terminal', terminalId: 't', summary: 'AUTOMATIC EXCERPT' });
  await f.click('Kontext aktualisieren');
  for (const text of ['ungeprüft, unvollständig', 'Codex', '/work/tree', 'tree-one', '<img src=x>', 'Entscheidungen', 'Offene Fragen', 'Nächster Schritt']) assert.ok(f.root.textContent.includes(text), text);
  assert.equal(f.root.querySelectorAll('img').length, 0);
});

test('late post-save and post-toggle context responses cannot overwrite a reopened different project', async t => {
  for (const action of ['save', 'toggle']) {
    const f = await fixture(t);
    f.memory.saveNotes('two', 'PROJECT_TWO_FRESH_CONTEXT', 0);
    const originalContext = f.memory.context;
    let resolveOld;
    f.memory.context = id => id === 'one' ? new Promise(resolve => { resolveOld = resolve; }) : originalContext(id);
    let pending;
    if (action === 'save') {
      const editor = f.root.querySelector('#memory-project-notes'); editor.value = 'PROJECT_ONE_SAVED'; await editor.dispatch('input');
      pending = f.button('Projekt-Memory speichern').props.onclick();
    } else {
      const box = f.root.querySelector('#memory-auto-capture'); box.checked = false;
      pending = box.dispatch('change');
    }
    await settle(); assert.equal(typeof resolveOld, 'function', 'post-' + action + ' context pending');
    f.panel.toggle(false); f.selectProject('two'); f.panel.toggle(true); await settle();
    assert.ok(f.root.querySelector('.memory-context').textContent.includes('PROJECT_TWO_FRESH_CONTEXT'));
    resolveOld('PROJECT_ONE_STALE_RESPONSE'); await pending; await settle();
    assert.ok(f.root.querySelector('.memory-context').textContent.includes('PROJECT_TWO_FRESH_CONTEXT'), action + ' keeps current scope');
    assert.ok(!f.root.querySelector('.memory-context').textContent.includes('PROJECT_ONE_STALE_RESPONSE'), action + ' rejects stale response');
  }
});
