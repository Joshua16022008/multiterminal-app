'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAccountStore } = require('../src/main/account-store');
const { shellEnv } = require('../src/main/pty-manager');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-accounts-'));
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(path.join(homeDir, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(homeDir, '.claude', 'settings.json'), '{}');
  fs.writeFileSync(path.join(homeDir, '.claude', '.credentials.json'), 'secret');
  fs.writeFileSync(path.join(homeDir, '.claude', '.claude.json'), 'secret');
  fs.mkdirSync(path.join(homeDir, '.claude', 'projects'));
  const filePath = path.join(root, 'data', 'accounts.json');
  const profilesDir = path.join(root, 'data', 'profiles');
  const store = createAccountStore({ filePath, profilesDir, homeDir });
  return { root, homeDir, filePath, profilesDir, store };
}

const claude = (store) => store.list().find((g) => g.provider === 'claude');

test('list shows a builtin active default per provider', () => {
  const { store } = setup();
  const groups = store.list();
  assert.deepStrictEqual(groups.map((g) => g.provider), ['claude', 'codex']);
  for (const g of groups) {
    assert.strictEqual(g.accounts.length, 1);
    assert.strictEqual(g.accounts[0].id, `${g.provider}-default`);
    assert.strictEqual(g.accounts[0].builtin, true);
    assert.strictEqual(g.accounts[0].active, true);
  }
  assert.strictEqual(claude(store).loginCommand, 'claude');
  assert.strictEqual(store.loginCommand('codex'), 'codex login');
});

test('add creates folder and links only shared settings', () => {
  const { store, homeDir, profilesDir } = setup();
  const acc = store.add({ provider: 'claude', label: '  Arbeit ' });
  assert.strictEqual(acc.label, 'Arbeit');
  const folder = path.join(profilesDir, 'claude', acc.id);
  assert.ok(fs.statSync(folder).isDirectory());
  assert.strictEqual(fs.readlinkSync(path.join(folder, 'settings.json')), path.join(homeDir, '.claude', 'settings.json'));
  assert.ok(fs.lstatSync(path.join(folder, 'skills')).isSymbolicLink());
  const names = fs.readdirSync(folder).sort();
  assert.deepStrictEqual(names, ['settings.json', 'skills']);
  assert.strictEqual(claude(store).accounts.length, 2);
});

test('add works when the default folder does not exist', () => {
  const { store } = setup();
  const acc = store.add({ provider: 'codex', label: 'Privat' });
  assert.deepStrictEqual(fs.readdirSync(acc.folder), []);
});

test('add survives a failing symlink', () => {
  const { store, homeDir } = setup();
  // A dangling shared entry whose link target cannot be created must not abort the add.
  fs.rmSync(path.join(homeDir, '.claude', 'settings.json'));
  fs.symlinkSync('/nonexistent-target', path.join(homeDir, '.claude', 'settings.json'));
  fs.chmodSync(homeDir, 0o700);
  const acc = store.add({ provider: 'claude', label: 'B' });
  assert.ok(fs.statSync(acc.folder).isDirectory());
  assert.strictEqual(claude(store).accounts.length, 2);
});

test('validation', () => {
  const { store } = setup();
  assert.throws(() => store.add({ provider: 'claude', label: '  ' }), /nicht leer/);
  assert.throws(() => store.add({ provider: 'claude', label: 'x'.repeat(41) }), /länger/);
  assert.throws(() => store.add({ provider: 'kimi', label: 'A' }), /Anbieter/);
  assert.throws(() => store.add({ provider: '__proto__', label: 'A' }), /Anbieter/);
  store.add({ provider: 'claude', label: 'Arbeit' });
  assert.throws(() => store.add({ provider: 'claude', label: 'arbeit' }), /vergeben/);
  assert.throws(() => store.add({ provider: 'claude', label: 'Standard' }), /vergeben/);
  assert.doesNotThrow(() => store.add({ provider: 'codex', label: 'Arbeit' }));
});

test('rename and setActive', () => {
  const { store } = setup();
  const a = store.add({ provider: 'claude', label: 'A' });
  const b = store.add({ provider: 'claude', label: 'B' });
  store.rename(a.id, 'Neu');
  assert.throws(() => store.rename(b.id, 'neu'), /vergeben/);
  assert.throws(() => store.rename('missing-default', 'X'), /nicht gefunden/);
  store.setActive('claude', b.id);
  assert.deepStrictEqual(claude(store).accounts.filter((x) => x.active).map((x) => x.label), ['B']);
  assert.throws(() => store.setActive('codex', b.id), /nicht gefunden/);
  store.setActive('claude', 'claude-default');
  assert.strictEqual(claude(store).accounts[0].active, true);
});

test('default account names persist for every provider without changing account identity or folders', () => {
  const { store, filePath, profilesDir, homeDir } = setup();
  for (const group of store.list()) {
    const before = group.accounts[0];
    const label = `${group.provider} privat`;
    assert.strictEqual(store.rename(before.id, `  ${label}  `).label, label);
    const again = createAccountStore({ filePath, profilesDir, homeDir });
    assert.deepStrictEqual(again.list().find((g) => g.provider === group.provider).accounts[0], { ...before, label });
    assert.strictEqual(again.envFor().accounts.find((a) => a.id === before.id).label, label);
    assert.strictEqual(again.remove(before.id), null);
    assert.deepStrictEqual(again.envFor().env, { CLAUDE_CONFIG_DIR: null, CODEX_HOME: null });
    const own = again.add({ provider: group.provider, label: 'Arbeit' });
    again.setActive(group.provider, own.id);
    assert.strictEqual(again.envFor({ [group.provider]: before.id }).accounts.find((a) => a.provider === group.provider).label, label);
    again.remove(own.id);
  }
  assert.strictEqual(fs.existsSync(profilesDir), true); // only the explicitly added accounts create profiles
});

test('renaming validates all names against the current default name', () => {
  const { store } = setup();
  const own = store.add({ provider: 'claude', label: 'Arbeit' });
  assert.throws(() => store.rename('claude-default', 'arbeit'), /vergeben/);
  assert.throws(() => store.rename('claude-default', '  '), /nicht leer/);
  assert.throws(() => store.rename('codex-default', 'x'.repeat(41)), /länger/);
  store.rename('claude-default', 'Privat');
  assert.throws(() => store.add({ provider: 'claude', label: 'PRIVAT' }), /vergeben/);
  assert.throws(() => store.rename(own.id, 'privat'), /vergeben/);
  assert.doesNotThrow(() => store.rename('codex-default', 'Privat'));
  assert.doesNotThrow(() => store.rename(own.id, 'Standard'));
  assert.throws(() => store.rename('claude-default', 'Standard'), /vergeben/);
  store.rename(own.id, 'Arbeit');
  assert.doesNotThrow(() => store.rename('claude-default', 'Standard'));
});

test('invalid stored default names fall back to Standard', () => {
  const { store, filePath } = setup();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  for (const defaultLabels of [null, [], 'invalid', { claude: '', codex: 42 }, { claude: 'x'.repeat(41) }]) {
    fs.writeFileSync(filePath, JSON.stringify({ accounts: [], active: {}, defaultLabels }));
    assert.ok(store.list().every((g) => g.accounts[0].label === 'Standard'));
  }
});

test('remove returns the folder, keeps it on disk, and falls back to default', () => {
  const { store } = setup();
  const a = store.add({ provider: 'claude', label: 'A' });
  store.setActive('claude', a.id);
  const removed = store.remove(a.id);
  assert.deepStrictEqual(removed, { provider: 'claude', folder: a.folder });
  assert.ok(fs.existsSync(a.folder));
  assert.strictEqual(claude(store).accounts.length, 1);
  assert.strictEqual(claude(store).accounts[0].active, true);
  assert.strictEqual(store.remove(a.id), null);
  assert.strictEqual(store.remove('claude-default'), null);
});

test('envFor: default sets nothing, active and overrides apply', () => {
  const { store } = setup();
  let r = store.envFor();
  assert.deepStrictEqual(r.env, { CLAUDE_CONFIG_DIR: null, CODEX_HOME: null });
  assert.deepStrictEqual(r.accounts, [
    { provider: 'claude', id: 'claude-default', label: 'Standard' },
    { provider: 'codex', id: 'codex-default', label: 'Standard' },
  ]);
  const a = store.add({ provider: 'claude', label: 'A' });
  const c = store.add({ provider: 'codex', label: 'C' });
  store.setActive('claude', a.id);
  r = store.envFor();
  assert.strictEqual(r.env.CLAUDE_CONFIG_DIR, a.folder);
  assert.strictEqual(r.env.CODEX_HOME, null);
  r = store.envFor({ claude: 'claude-default', codex: c.id });
  assert.strictEqual(r.env.CLAUDE_CONFIG_DIR, null);
  assert.strictEqual(r.env.CODEX_HOME, c.folder);
  assert.strictEqual(r.accounts[1].label, 'C');
  // unknown, foreign or malformed overrides fall back to the active account
  r = store.envFor({ claude: 'claude-deadbeef', codex: a.id });
  assert.strictEqual(r.env.CLAUDE_CONFIG_DIR, a.folder);
  assert.strictEqual(r.env.CODEX_HOME, null);
  assert.doesNotThrow(() => store.envFor('x'));
});

test('overrides keep working for a non-active account and survive removal gracefully', () => {
  const { store } = setup();
  const a = store.add({ provider: 'claude', label: 'A' });
  assert.strictEqual(store.envFor({ claude: a.id }).env.CLAUDE_CONFIG_DIR, a.folder);
  store.remove(a.id);
  assert.strictEqual(store.envFor({ claude: a.id }).env.CLAUDE_CONFIG_DIR, null);
});

test('state persists and a corrupt file is kept aside', () => {
  const { store, filePath, root, homeDir, profilesDir } = setup();
  const a = store.add({ provider: 'claude', label: 'A' });
  store.setActive('claude', a.id);
  const again = createAccountStore({ filePath, profilesDir, homeDir });
  assert.strictEqual(claude(again).accounts[1].active, true);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(filePath)).filter((n) => n.endsWith('.tmp')), []);

  fs.writeFileSync(filePath, '{kaputt');
  assert.strictEqual(claude(again).accounts.length, 1);
  assert.strictEqual(fs.readFileSync(filePath + '.corrupt', 'utf8'), '{kaputt');
  assert.ok(root);
  fs.writeFileSync(filePath, JSON.stringify({ accounts: [{ id: '../x', provider: 'claude', label: 'Bad' }], active: { claude: '../x' } }));
  assert.strictEqual(claude(again).accounts.length, 1);
  assert.strictEqual(claude(again).accounts[0].active, true);
});

test('shellEnv merges extraEnv and removes inherited variables for null', () => {
  process.env.CLAUDE_CONFIG_DIR = '/inherited';
  process.env.CODEX_HOME = '/inherited-codex';
  try {
    const env = shellEnv({ CLAUDE_CONFIG_DIR: null, CODEX_HOME: '/own', BAD: 5 });
    assert.ok(!('CLAUDE_CONFIG_DIR' in env));
    assert.strictEqual(env.CODEX_HOME, '/own');
    assert.ok(!('BAD' in env));
    assert.strictEqual(shellEnv().CLAUDE_CONFIG_DIR, '/inherited');
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CODEX_HOME;
  }
});
