'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEndpointStore } = require('../src/main/endpoint-store');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-endpoints-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'endpoints.json');
  const keys = new Map();
  const keychain = { has: async (id) => keys.has(id), set: async (id, key) => { keys.set(id, key); }, remove: async (id) => keys.delete(id) };
  return { dir, file, keys, keychain, store: createEndpointStore({ file, keychain }) };
}

const profile = (extra = {}) => ({ id: 'ep-test', label: ' Test ', type: 'anthropic', baseUrl: 'https://api.example.com/anthropic', ...extra });

test('endpoint store saves a private whitelist, returns only hasSecret and reloads', async (t) => {
  const { file, keys, store, keychain } = fixture(t);
  assert.deepEqual(await store.list(), []);
  const saved = await store.save(profile({ secret: 'NEVER_PERSIST_THIS', apiKey: 'ALSO_PRIVATE', arbitrary: { secret: 'hidden' }, hasSecret: false,
    defaultModel: 'org/deepseek-flash[1m]', modelMap: { haiku: 'deepseek-flash' } }));
  assert.equal(saved.label, 'Test');
  assert.equal(saved.isolateClaudeConfig, true);
  assert.equal(saved.hasSecret, true);
  assert.equal(saved.defaultModel, 'org/deepseek-flash[1m]');
  const expectedKeys = ['id', 'label', 'type', 'baseUrl', 'defaultModel', 'modelMap', 'isolateClaudeConfig'];
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes('PRIVATE'), false);
  assert.equal(raw.includes('NEVER_PERSIST_THIS'), false);
  assert.equal(raw.includes('secret'), false);
  assert.equal(raw.includes('hasSecret'), false);
  assert.deepEqual(Object.keys(JSON.parse(raw).endpoints[0]), expectedKeys);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(keys.get('ep-test'), 'NEVER_PERSIST_THIS');
  assert.deepEqual(await createEndpointStore({ file, keychain }).get('ep-test'), saved);
  saved.modelMap.haiku = 'mutated';
  assert.equal((await store.get('ep-test')).modelMap.haiku, 'deepseek-flash');
});

test('endpoint store updates keys only when supplied and removes keys with profiles', async (t) => {
  const { store, keys, dir } = fixture(t);
  await store.save(profile(), 'first');
  await store.save(profile({ label: 'Changed', secret: '' }));
  assert.equal(keys.get('ep-test'), 'first');
  await store.save(profile({ secret: 'second', isolateClaudeConfig: false }));
  assert.equal(keys.get('ep-test'), 'second');
  assert.equal((await store.get('ep-test')).isolateClaudeConfig, false);
  assert.equal(await store.remove('ep-test'), true);
  assert.equal(keys.has('ep-test'), false);
  assert.equal(await store.remove('ep-test'), false);
  assert.equal(await store.get('ep-test'), null);
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(fs.readdirSync(dir), ['endpoints.json']);
});

test('endpoint store generates IDs and serializes concurrent saves without lost updates', async (t) => {
  const { store } = fixture(t);
  const entries = await Promise.all(Array.from({ length: 12 }, (_, i) => store.save(profile({ id: undefined, label: 'Endpoint ' + i }))));
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 12);
  assert.equal((await store.list()).length, 12);
});

test('endpoint store rejects malformed endpoint data before writing keys or files', async (t) => {
  const { store, dir, keys } = fixture(t);
  for (const extra of [
    { id: '../escape' }, { id: "a'" }, { label: '' }, { label: '\nlabel' }, { label: 'x'.repeat(101) }, { type: 'unknown' },
    { baseUrl: 'file:///tmp/x' }, { baseUrl: 'https://user:password@api.example.com' }, { baseUrl: 'https://api.example.com?key=private' },
    { baseUrl: 'https://api.example.com#fragment' }, { baseUrl: ' https://api.example.com' }, { baseUrl: 'https://api.example.com\n' },
    { baseUrl: 'https:\\example.com' }, { defaultModel: "model'$(id)" }, { defaultModel: 'x'.repeat(201) },
    { modelMap: [] }, { modelMap: { haiku: "x'y" } }, { modelMap: JSON.parse('{"__proto__":"model"}') }, { isolateClaudeConfig: 'true' },
  ]) await assert.rejects(store.save(profile({ ...extra, secret: 'key' })));
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(keys.size, 0);
});

test('endpoint store preserves corrupt JSON and invalid schemas with private backups', async (t) => {
  const { store, file, dir } = fixture(t);
  for (const corrupt of ['{ broken', JSON.stringify({ version: 2, endpoints: [] }), JSON.stringify({ version: 1, endpoints: [profile(), profile()] })]) {
    fs.writeFileSync(file, corrupt, { mode: 0o644 });
    assert.deepEqual(await store.list(), []);
    const backups = fs.readdirSync(dir).filter((name) => name.includes('.corrupt-'));
    const preserved = backups.find((name) => fs.readFileSync(path.join(dir, name), 'utf8') === corrupt);
    assert.ok(preserved);
    assert.equal(fs.statSync(path.join(dir, preserved)).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(file), false);
  }
  await store.save(profile());
  assert.equal((await store.list()).length, 1);
});

test('endpoint store repairs permissions on existing files and filters imported unknown fields', async (t) => {
  const { store, file } = fixture(t);
  fs.writeFileSync(file, JSON.stringify({ version: 1, endpoints: [profile({ secret: 'untrusted-import', hasSecret: true })] }), { mode: 0o644 });
  const [entry] = await store.list();
  assert.equal(entry.hasSecret, false);
  assert.equal('secret' in entry, false);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  await store.save(entry);
  assert.equal(fs.readFileSync(file, 'utf8').includes('untrusted-import'), false);
});

test('endpoint store hides keychain failures and preserves profiles on failed removal', async (t) => {
  const { store, keychain, file } = fixture(t);
  await store.save(profile());
  keychain.remove = async () => { throw new Error('SECRET_FAILURE'); };
  await assert.rejects(store.remove('ep-test'), (err) => !String(err.stack).includes('SECRET_FAILURE'));
  assert.equal(JSON.parse(fs.readFileSync(file)).endpoints.length, 1);
  keychain.set = async () => { throw new Error('SECRET_FAILURE'); };
  await assert.rejects(store.save(profile({ secret: 'SECRET_FAILURE' })), (err) => !String(err.stack).includes('SECRET_FAILURE'));
  keychain.has = async () => { throw new Error('SECRET_FAILURE'); };
  await assert.rejects(store.list(), (err) => !String(err.stack).includes('SECRET_FAILURE'));
});

test('endpoint templates cover all providers and are safe independent copies', async (t) => {
  const { store, keys, dir } = fixture(t);
  const entries = store.templates();
  assert.deepEqual(entries.map((entry) => entry.label), ['DeepSeek', 'Z.ai', 'Moonshot', 'OpenRouter', 'Ollama']);
  for (const entry of entries) {
    assert.equal(entry.hasSecret, false);
    assert.equal(entry.isolateClaudeConfig, true);
    assert.equal('secret' in entry, false);
  }
  entries[0].label = 'changed';
  assert.equal(store.templates()[0].label, 'DeepSeek');
  assert.equal(keys.size, 0);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('endpoint failed atomic replacement preserves the original and cleans its private temp file', async (t) => {
  const { store, file, dir } = fixture(t);
  await store.save(profile());
  const before = fs.readFileSync(file, 'utf8');
  const rename = fs.renameSync;
  let temporaryMode;
  fs.renameSync = (source, destination) => {
    if (destination === file) {
      temporaryMode = fs.statSync(source).mode & 0o777;
      throw new Error('PRIVATE_FAILURE');
    }
    return rename(source, destination);
  };
  try {
    await assert.rejects(store.save(profile({ label: 'Changed' })), (error) => !String(error.stack).includes('PRIVATE_FAILURE'));
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(temporaryMode, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dir), ['endpoints.json']);
  assert.equal((await store.save(profile({ label: 'Recovered' }))).label, 'Recovered');
});
