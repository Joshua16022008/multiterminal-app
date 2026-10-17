'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createAccountStore } = require('../src/main/account-store');

const all = (el) => [el, ...(el.children || []).flatMap(all)];
const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-accounts-panel-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createAccountStore({ filePath: path.join(dir, 'accounts.json'), profilesDir: path.join(dir, 'profiles'), homeDir: path.join(dir, 'home') });
  const own = store.add({ provider: 'claude', label: 'Arbeit' });
  function h(tag, props = {}, ...children) {
    return {
      tag, ...props, children: children.flat().filter(Boolean), events: {},
      append(...items) { this.children.push(...items.filter(Boolean)); },
      replaceChildren(...items) { this.children = items.filter(Boolean); },
      addEventListener(event, fn) { this.events[event] = fn; },
      querySelector(selector) { return all(this).find((el) => (el.class || '').split(' ').includes(selector.slice(1))); },
      focus() {}, select() {},
    };
  }
  const root = h('aside');
  const window = { DeckApp: { h, errText: (e) => e.message }, deck: {
    accounts: { list: async () => store.list(), rename: async (...args) => store.rename(...args) },
    usage: { list: async () => [], claudeStatus: async () => ({ state: 'aus' }) },
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/accounts-panel.js'), 'utf8'), {
    window, document: { getElementById: () => root }, setInterval: () => 1, clearInterval() {},
  });
  const panel = window.DeckApp.accountsPanel;
  panel.init({ onChange() {}, onClose() {}, onLogin() {} });
  panel.toggle(true);
  return { root, store, own, panel };
}

const rows = (root) => all(root).filter((el) => (el.class || '').split(' ').includes('acct-row'));
const button = (root, title) => all(root).find((el) => el.tag === 'button' && el.title === title);

test('every account offers rename and saves through the panel, including both built-in accounts', async (t) => {
  const { root, store, own, panel } = setup(t);
  await settle();
  const ids = ['claude-default', own.id, 'codex-default'];
  assert.equal(rows(root).length, ids.length);
  for (let i = 0; i < ids.length; i++) {
    const row = rows(root)[i];
    assert.ok(button(row, 'Umbenennen'));
    assert.equal(!!button(row, 'Entfernen'), ids[i] === own.id);
    button(row, 'Umbenennen').onclick();
    const input = root.querySelector('.acct-edit');
    assert.ok(input);
    input.value = `Konto ${i + 1}`;
    input.events.keydown({ key: 'Enter' });
    await settle();
    assert.equal(store.list().flatMap((g) => g.accounts).find((a) => a.id === ids[i]).label, input.value);
    assert.ok(all(rows(root)[i]).some((el) => el.text === input.value));
    assert.equal(root.querySelector('.acct-edit'), undefined);
  }
  panel.toggle(false);
  panel.toggle(true);
  await settle();
  assert.deepEqual(rows(root).map((row) => all(row).find((el) => el.class === 'acct-name').text), ['Konto 1', 'Konto 2', 'Konto 3']);
});

test('default rename supports Escape, blur save, and displays duplicate-name errors', async (t) => {
  const { root, store } = setup(t);
  await settle();
  button(rows(root)[0], 'Umbenennen').onclick();
  let input = root.querySelector('.acct-edit');
  input.value = 'Abgebrochen';
  input.events.keydown({ key: 'Escape' });
  assert.equal(store.list()[0].accounts[0].label, 'Standard');
  button(rows(root)[0], 'Umbenennen').onclick();
  input = root.querySelector('.acct-edit');
  input.value = 'Privat';
  input.events.blur();
  await settle();
  assert.equal(store.list()[0].accounts[0].label, 'Privat');
  button(rows(root)[0], 'Umbenennen').onclick();
  input = root.querySelector('.acct-edit');
  input.value = 'Arbeit';
  input.events.keydown({ key: 'Enter' });
  await settle();
  assert.equal(store.list()[0].accounts[0].label, 'Privat');
  assert.ok(all(root).some((el) => /schon vergeben/.test(el.text || '')));
});
