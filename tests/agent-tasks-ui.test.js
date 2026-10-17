'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../src/renderer/agent-tasks');
class Node {
  constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.listeners = {}; this.dataset = {}; this.style = {}; this.attrs = {}; this.classList = { add() {} }; this.textContent = ''; }
  appendChild(n) { this.children.push(n); return n; }
  replaceChildren() { this.children = []; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, v) { this.listeners[k] = v; }
  async click() { if (!this.disabled && this.listeners.click) await this.listeners.click(); }
}
function fixture(overrides = {}) {
  const doc = { createElement(tag) { return new Node(tag, doc); }, defaultView: { navigator: {} } };
  const root = new Node('aside', doc), button = new Node('button', doc), calls = [];
  let project = 'p';
  const data = { peers: [{ terminalId: 'a', title: 'Codex', provider: 'codex' }], grants: {}, tasks: [] };
  const api = { snapshot: async pid => { calls.push(['snapshot', pid]); return data; }, grant: async (...a) => calls.push(['grant', ...a]), cancel: async (...a) => calls.push(['cancel', ...a]), onChanged(cb) { this.changed = cb; }, ...overrides };
  const panel = create({ root, button, api, getProject: () => project });
  const all = () => { const result = []; function walk(n) { result.push(n); n.children.forEach(walk); } walk(root); return result; };
  return { root, button, panel, data, api, calls, all, setProject(p) { project = p; } };
}
const find = (f, text) => f.all().find(n => n.textContent === text);
test('permission defaults disabled and requires explicit save; cap defaults 2', async () => {
  const f = fixture(); await f.panel.toggle();
  const inputs = f.all().filter(n => n.tagName === 'input');
  assert.deepEqual(inputs.map(n => n.checked), [false, false]);
  assert.equal(f.calls.filter(c => c[0] === 'grant').length, 0);
  inputs.forEach(n => { n.checked = true; });
  const cap = f.all().find(n => n.attrs['aria-label'] === 'Maximale neue Worker'); assert.equal(cap.value, '2'); cap.value = '4';
  await find(f, 'Freigabe speichern').click();
  assert.deepEqual(f.calls.find(c => c[0] === 'grant'), ['grant', 'p', 'a', { enabled: true, allowNew: true, maxNewWorkers: 4 }]);
});
test('tree, statuses, dependencies and complete unsafe-looking result rendered as text', async () => {
  const f = fixture();
  f.data.tasks = ['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'].map((status, i) => ({ id: `t${i}`, title: 'Task', status, depth: 1, parentId: 'root', dependsOn: ['dep'], sourceTerminalId: 'a', targetTerminalId: 'b', text: 'work', result: { text: '<script>full result</script>\n' + 'x'.repeat(16000) }, delivery: { state: 'inbox' } }));
  await f.panel.toggle();
  assert.ok(find(f, 'Teilauftrag von: root')); assert.ok(find(f, 'Abhängigkeiten: dep'));
  assert.ok(find(f, f.data.tasks[0].result.text)); assert.equal(f.all().filter(n => n.tagName === 'script').length, 0);
  assert.equal(f.all().filter(n => n.textContent === 'Abbrechen').length, 2);
  assert.ok(find(f, 'Unterbrochen · t5'));
});
test('cancel failure is visible and closing never cancels', async () => {
  const f = fixture({ cancel: async () => { throw new Error('Abbruch nicht gespeichert'); } });
  f.data.tasks = [{ id: 't', status: 'running' }]; await f.panel.toggle();
  await find(f, 'Abbrechen').click(); assert.ok(find(f, 'Abbruch nicht gespeichert'));
  await find(f, 'Schließen').click(); assert.equal(f.panel.isOpen(), false); assert.equal(f.root.hidden, true);
});
test('late responses cannot replace a newly selected project snapshot', async () => {
  const pending = {}; const f = fixture({ snapshot: pid => new Promise(resolve => { pending[pid] = resolve; }) });
  const first = f.panel.toggle(); f.setProject('q'); const second = f.panel.refresh();
  pending.q({ peers: [], grants: {}, tasks: [{ id: 'q-task', title: 'Q', status: 'completed' }] }); await second;
  pending.p({ peers: [], grants: {}, tasks: [{ id: 'p-task', title: 'P', status: 'completed' }] }); await first;
  assert.ok(find(f, 'Q')); assert.equal(find(f, 'P'), undefined);
});
test('refresh errors and no project are visible; changed event only refreshes open panel', async () => {
  const f = fixture({ snapshot: async () => { throw new Error('Store beschädigt'); } });
  await f.panel.toggle(); assert.ok(find(f, 'Store beschädigt'));
  f.setProject(null); await f.panel.refresh(); assert.ok(find(f, 'Zuerst ein Projekt auswählen.'));
  await f.panel.toggle(false); f.api.changed(); assert.equal(f.root.hidden, true);
});
test('saved source grant is displayed and selecting another source makes no writes', async () => {
  const f = fixture(); f.data.peers.push({ id: 'b', title: 'Claude', provider: 'claude' });
  f.data.grants.a = { enabled: true, allowNew: true, maxNewWorkers: 3 };
  await f.panel.toggle();
  assert.deepEqual(f.all().filter(n => n.tagName === 'input').map(n => n.checked), [true, true]);
  assert.equal(f.all().find(n => n.attrs['aria-label'] === 'Maximale neue Worker').value, '3');
  const source = f.all().find(n => n.attrs['aria-label'] === 'Ursprungsterminal'); source.value = 'b'; source.listeners.change();
  assert.deepEqual(f.all().filter(n => n.tagName === 'input').map(n => n.checked), [false, false]);
  assert.equal(f.calls.filter(c => c[0] === 'grant').length, 0);
});
test('permission failure keeps error visible and makes no follow-up write', async () => {
  let count = 0; const f = fixture({ grant: async () => { count++; throw new Error('Freigabe verweigert'); } });
  await f.panel.toggle(); await find(f, 'Freigabe speichern').click();
  assert.equal(count, 1); assert.ok(find(f, 'Freigabe verweigert')); assert.equal(find(f, 'Freigabe speichern').disabled, false);
});
