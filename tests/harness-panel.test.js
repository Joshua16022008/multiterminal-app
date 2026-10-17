'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../src/renderer/harness-panel');

// Same lightweight DOM shape as the other renderer panel tests, plus native-like events.
function h(tag, props = {}, ...children) {
  const listeners = new Map();
  return { tag, ...props, value: props.value || '', children: children.flat().filter(Boolean),
    setAttribute(name, value) { this[name] = value; },
    replaceChildren(...items) { assert.ok(items.every(Boolean), 'no null DOM children'); this.children = items; },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); return !event.defaultPrevented; },
  };
}
class CustomEvent {
  constructor(type, options) { Object.assign(this, options); this.type = type; this.defaultPrevented = false; }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
}
const all = root => [root, ...root.children.flatMap(all)];
const text = root => all(root).map(el => el.text || '').join('\n');
const button = (root, label) => all(root).find(el => el.tag === 'button' && el.text === label);
const byId = (root, id) => all(root).find(el => el.id === id);
const change = (root, id, value, event = 'oninput') => { const el = byId(root, id); el.value = value; el[event]({ target: el }); return el; };
const entry = { id: 'claude', label: 'Claude Code', kind: 'tui', evidence: 'local', docsUrl: 'https://example.invalid/docs',
  install: [{ method: 'npm', display: 'npm install -g example' }], installed: true, path: '/fake/claude',
  builtin: true, endpointTypes: ['anthropic'], defaultModel: null };
const endpoint = { id: 'ep-test', label: 'DeepSeek', type: 'anthropic', baseUrl: 'https://api.example.invalid',
  defaultModel: 'deepseek-flash[1m]', modelMap: null, isolateClaudeConfig: true, hasSecret: true };
function setup(overrides = {}) {
  const calls = [], notices = [], copied = [];
  const api = {
    harness: { async list() { calls.push(['list']); return [entry]; },
      async detect(id) { calls.push(['detect', id]); return [{ id, installed: true, path: '/new/claude', version: '1.2.3' }]; },
      async models(...args) { calls.push(['models', ...args]); return { source: 'query', models: ['one', 'two'] }; },
      async typeInstall(...args) { calls.push(['typeInstall', ...args]); return true; },
      async export(id) { calls.push(['export', id]); return '{"id":"claude"}'; },
      async addOwn(value) { calls.push(['addOwn', value]); return value; },
      async removeOwn(id) { calls.push(['removeOwn', id]); return true; }, ...overrides.harness },
    endpoints: { async list() { return [endpoint]; }, async templates() { return [{ ...endpoint, id: 'template-deepseek' }]; },
      async save(...args) { calls.push(['save', ...args]); return endpoint; },
      async remove(id) { calls.push(['remove', id]); return true; }, ...overrides.endpoints },
  };
  const document = { defaultView: { CustomEvent, navigator: { clipboard: { async writeText(value) { copied.push(value); } } } } };
  const panel = create({ document, api, h, notify: message => notices.push(message), guard: () => assert.fail('raw API failures must not reach guard') });
  return { panel, root: panel.el, calls, notices, copied };
}

test('render shows installation, evidence and safe documentation without querying models', async () => {
  const s = setup(); await s.panel.render();
  assert.match(text(s.root), /Installiert/); assert.match(text(s.root), /Lokal geprüft/); assert.match(text(s.root), /\/fake\/claude/);
  assert.match(text(s.root), /Schlüssel gespeichert/);
  assert.equal(s.calls.filter(call => call[0] === 'models' || call[0] === 'detect').length, 0);
  const link = all(s.root).find(el => el.tag === 'a'); assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(byId(s.root, 'harness-endpoint-secret'), undefined);
  await button(s.root, 'Installation / Version prüfen').onclick();
  assert.match(text(s.root), /Version: 1.2.3/);
});

test('model source is requested only on explicit click, passing the compatible endpoint', async () => {
  const s = setup(); await s.panel.render();
  change(s.root, 'harness-endpoint-claude', endpoint.id, 'onchange');
  assert.equal(byId(s.root, 'harness-model-claude').value, endpoint.defaultModel);
  assert.equal(s.calls.some(call => call[0] === 'models'), false);
  await button(s.root, 'Modellliste aktualisieren').onclick();
  assert.deepEqual(s.calls.find(call => call[0] === 'models'), ['models', 'claude', endpoint.id]);
  assert.equal(byId(s.root, 'harness-models-claude').children.length, 2);
  assert.match(text(s.root), /Modellquelle: query/);
  assert.match(text(s.root), /Kontowahl entfällt/);
});

test('quickstart emits selected launch data without inventing a presets API; invalid model is rejected', async () => {
  const s = setup(), selections = []; await s.panel.render();
  s.root.addEventListener('harness:quickstart', event => { event.preventDefault(); selections.push(event.detail); });
  change(s.root, 'harness-endpoint-claude', endpoint.id, 'onchange');
  change(s.root, 'harness-model-claude', 'provider/model[1m]');
  button(s.root, 'Als Schnellstart anlegen').onclick();
  assert.deepEqual(selections[0].launch, { harnessId: 'claude', model: 'provider/model[1m]', endpointId: endpoint.id });
  change(s.root, 'harness-model-claude', "model'; echo bad"); button(s.root, 'Als Schnellstart anlegen').onclick();
  assert.equal(selections.length, 1); assert.match(text(s.root), /Modellname ungültig/);
});

test('install copy and typing remain separate explicit actions; typing uses only typeInstall and one terminal', async () => {
  const s = setup({ harness: { async list() { return [{ ...entry, installed: false }]; } } });
  await s.panel.render(); assert.equal(s.calls.some(call => call[0] === 'typeInstall'), false);
  await button(s.root, 'Installationsbefehl kopieren').onclick();
  assert.deepEqual(s.copied, ['npm install -g example']);
  let complete;
  s.root.addEventListener('harness:install-terminal', event => {
    event.preventDefault(); complete = event.detail.acceptTerminal('terminal-test');
    event.detail.acceptTerminal('other-terminal');
  });
  button(s.root, 'Ohne Enter im Terminal anzeigen').onclick(); await complete;
  assert.deepEqual(s.calls.filter(call => call[0] === 'typeInstall'), [['typeInstall', 'claude', 'terminal-test']]);
  assert.match(s.notices.at(-1), /Enter.*selbst/);
});

test('manual documentation hints can be copied but are never offered as terminal installation commands', async () => {
  const s = setup({ harness: { async list() { return [{ ...entry, installed: false, install: [{ method: 'manual', display: 'https://example.invalid/install' }] }]; } } });
  await s.panel.render();
  assert.equal(all(s.root).some(el => el.text === 'Ohne Enter im Terminal anzeigen'), false);
  await button(s.root, 'Dokumentationshinweis kopieren').onclick();
  assert.deepEqual(s.copied, ['https://example.invalid/install']);
  assert.equal(s.calls.some(call => call[0] === 'typeInstall'), false);
});

test('endpoint password is cleared before async save, passed separately, and never retained in a rerender', async () => {
  let finish, sent;
  const s = setup({ endpoints: { save(profile, secret) { sent = { profile, secret }; return new Promise(resolve => { finish = resolve; }); } } });
  await s.panel.render(); button(s.root, 'Bearbeiten').onclick();
  const password = byId(s.root, 'harness-endpoint-secret'); assert.equal(password.value, '');
  password.value = 'transient "key" \\ value';
  const saving = button(s.root, 'Endpunkt speichern').onclick();
  assert.equal(password.value, ''); assert.equal(sent.secret, 'transient "key" \\ value');
  assert.equal('secret' in sent.profile, false); assert.equal('hasSecret' in sent.profile, false);
  assert.equal(byId(s.root, 'harness-endpoint-secret').value, '');
  assert.equal(JSON.stringify(s.root).includes(sent.secret), false);
  finish(endpoint); await saving; assert.equal(byId(s.root, 'harness-endpoint-secret'), undefined);
});

test('empty password keeps the saved key, templates create new profiles and isolation defaults on', async () => {
  const s = setup(); await s.panel.render();
  change(s.root, 'harness-endpoint-template', 'template-deepseek', 'onchange');
  assert.equal(byId(s.root, 'harness-endpoint-label').value, endpoint.label);
  await button(s.root, 'Endpunkt speichern').onclick();
  const saved = s.calls.find(call => call[0] === 'save');
  assert.equal(saved[2], undefined); assert.equal('id' in saved[1], false); assert.equal(saved[1].isolateClaudeConfig, true);
});

test('endpoint failure never reflects a secret supplied in an IPC exception', async () => {
  const secret = 'should-never-be-rendered';
  const s = setup({ endpoints: { async save() { throw new Error(secret); } } });
  await s.panel.render(); button(s.root, 'Bearbeiten').onclick();
  byId(s.root, 'harness-endpoint-secret').value = secret;
  await button(s.root, 'Endpunkt speichern').onclick();
  assert.doesNotMatch(text(s.root), new RegExp(secret)); assert.equal(s.notices.join('').includes(secret), false);
  assert.match(text(s.root), /konnte nicht gespeichert/); assert.equal(byId(s.root, 'harness-endpoint-secret').value, '');
});

test('endpoint and own entry deletion require a second explicit action', async () => {
  const s = setup({ harness: { async list() { return [{ ...entry, builtin: false }]; } } }); await s.panel.render();
  button(s.root, 'Endpunkt entfernen').onclick(); assert.equal(s.calls.some(call => call[0] === 'remove'), false);
  button(s.root, 'Behalten').onclick(); assert.equal(s.calls.some(call => call[0] === 'remove'), false);
  button(s.root, 'Endpunkt entfernen').onclick(); await button(s.root, 'Entfernen bestätigen').onclick();
  assert.deepEqual(s.calls.find(call => call[0] === 'remove'), ['remove', endpoint.id]);
  button(s.root, 'Eigenen Eintrag entfernen').onclick(); await button(s.root, 'Entfernen bestätigen').onclick();
  assert.deepEqual(s.calls.find(call => call[0] === 'removeOwn'), ['removeOwn', entry.id]);
});

test('JSON import parses and delegates validation; export remains plain selectable text', async () => {
  const s = setup(); await s.panel.render();
  change(s.root, 'harness-own-json', '{broken'); await button(s.root, 'JSON importieren').onclick();
  assert.equal(s.calls.some(call => call[0] === 'addOwn'), false); assert.match(text(s.root), /Ungültiges JSON/);
  change(s.root, 'harness-own-json', '{"id":"custom","label":"<img src=x>"}');
  await button(s.root, 'JSON importieren').onclick();
  assert.deepEqual(s.calls.find(call => call[0] === 'addOwn')[1], { id: 'custom', label: '<img src=x>' });
  await button(s.root, 'Katalog-JSON exportieren').onclick();
  assert.equal(byId(s.root, 'harness-export-json').value, '{"id":"claude"}');
  assert.equal(byId(s.root, 'harness-export-json').readonly, true);
});

test('unconfirmed entries disable model options and emit only the bare harness', async () => {
  const s = setup({ harness: { async list() { return [{ ...entry, evidence: 'unconfirmed', defaultModel: 'unverified' }]; } } });
  await s.panel.render();
  assert.equal(byId(s.root, 'harness-model-claude').disabled, true);
  assert.equal(button(s.root, 'Modellliste aktualisieren').disabled, true);
  let launch; s.root.addEventListener('harness:quickstart', event => { event.preventDefault(); launch = event.detail.launch; });
  button(s.root, 'Als Schnellstart anlegen').onclick(); assert.deepEqual(launch, { harnessId: 'claude' });
});

test('incompatible endpoint types and unsafe documentation links are not offered', async () => {
  const s = setup({ harness: { async list() { return [{ ...entry, docsUrl: 'javascript:alert(1)' }]; } },
    endpoints: { async list() { return [endpoint, { ...endpoint, id: 'ep-openai', type: 'openai', label: 'Incompatible' }]; } } });
  await s.panel.render();
  assert.equal(all(s.root).some(el => el.tag === 'a'), false);
  const options = byId(s.root, 'harness-endpoint-claude').children;
  assert.deepEqual(options.map(option => option.value), ['', endpoint.id]);
  assert.equal(byId(s.root, 'harness-model-claude').list, 'harness-models-claude');
});

test('failed model fetch permits free text and never prints raw provider errors', async () => {
  const s = setup({ harness: { async models() { throw new Error('API_TOKEN_SECRET'); } } }); await s.panel.render();
  await button(s.root, 'Modellliste aktualisieren').onclick();
  assert.match(text(s.root), /Freitext bleibt möglich/); assert.doesNotMatch(text(s.root), /API_TOKEN_SECRET/);
  assert.equal(byId(s.root, 'harness-model-claude').disabled, false);
});

test('late reload results cannot replace a newer catalog; loading errors clear stale entries', async () => {
  let resolve, count = 0;
  const s = setup({ harness: { list() { if (++count === 1) return new Promise(done => { resolve = done; }); if (count === 3) throw new Error('failed'); return [{ ...entry, label: 'Current catalog' }]; } } });
  const old = s.panel.render(); await s.panel.render(); resolve([{ ...entry, label: 'Old catalog' }]); await old;
  assert.match(text(s.root), /Current catalog/); assert.doesNotMatch(text(s.root), /Old catalog/);
  await s.panel.render(); assert.doesNotMatch(text(s.root), /Current catalog/); assert.match(text(s.root), /konnten nicht geladen/);
});
