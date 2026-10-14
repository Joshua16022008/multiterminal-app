'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSettingsService } = require('../src/main/settings-service');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home'); fs.mkdirSync(homeDir);
  const dataDir = path.join(root, 'app');
  const write = (name, text) => { const file = path.join(homeDir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
  return { root, homeDir, dataDir, write, service: createSettingsService({ homeDir, dataDir }) };
}
test('overview never creates folders; scoped profiles save atomically and preserve conflicts', t => {
  const f = fixture(t); f.service.overviewSync(); assert.equal(fs.existsSync(f.dataDir), false);
  const first = f.service.readProfile('claude');
  const saved = f.service.saveProfile('claude', 'My goals', first.revision);
  assert.equal(saved.appliesTo, 'app-only'); assert.equal(saved.text, 'My goals');
  assert.throws(() => f.service.saveProfile('claude', 'lost', first.revision), { code: 'REVISION_CONFLICT' });
  assert.equal(f.service.readProfile('claude').text, 'My goals');
  assert.equal(f.service.readProfile('codex').exists, false);
  assert.equal(f.service.readProfile('kimi').exists, false);
  assert.throws(() => f.service.readProfile('common'), /Unbekannter/);
  assert.throws(() => f.service.saveProfile('common', 'goals', first.revision), /Unbekannter/);
  assert.equal(Object.hasOwn(f.service.overviewSync(), 'common'), false);
  assert.throws(() => f.service.readProfile('../home'));
  assert.deepEqual(fs.readdirSync(f.homeDir), []);
});
test('inventory separates providers and projects and exposes only curated text', t => {
  const f = fixture(t);
  f.write('.claude/skills/foo/SKILL.md', 'Foo skill');
  f.write('.codex/AGENTS.md', 'Codex instructions');
  f.write('.claude/settings.json', JSON.stringify({ apiKey: 'SECRET', enabledPlugins: { 'foo@market': true } }));
  f.write('.claude/plugins/installed_plugins.json', JSON.stringify({ plugins: { 'foo@market': [{ installPath: path.join(f.homeDir, '.claude/plugins/cache/foo') }] } }));
  f.write('.claude/sessions/README.md', 'SECRET CHAT');
  const model = f.service.overviewSync(); const claude = model.providers[0];
  assert.equal(claude.categories.skills.length, 1);
  assert.equal(f.service.readResource(claude.categories.skills[0].id).text, 'Foo skill');
  assert.equal(claude.categories.plugins.at(-1).status, 'enabled');
  assert.equal(model.providers[1].instructions.length, 1);
  assert.equal(JSON.stringify(model).includes('SECRET'), false);
  assert.throws(() => f.service.readResource(path.join(f.homeDir, '.claude/settings.json')));
});
test('symlink loops terminate, out-of-tree documents and changed symlinks are rejected', t => {
  const f = fixture(t); const file = f.write('.codex/skills/foo/SKILL.md', 'safe');
  const secret = f.write('credentials/README.md', 'SECRET');
  fs.symlinkSync(path.join(f.homeDir, '.codex/skills'), path.join(f.homeDir, '.codex/skills/foo/loop'));
  fs.symlinkSync(secret, path.join(f.homeDir, '.codex/skills/foo/README.md'));
  const items = f.service.overviewSync().providers[1].categories.skills;
  assert.equal(items.length, 2);
  assert.equal(items.find(i => i.path.endsWith('README.md')).readable, false);
  fs.unlinkSync(file); fs.symlinkSync(secret, file);
  assert.throws(() => f.service.readResource(items.find(i => i.path.endsWith('SKILL.md')).id), /geändert/);
});
test('document size and inventory count are bounded', t => {
  const f = fixture(t); f.write('.codex/skills/large/SKILL.md', 'x'.repeat(129 * 1024));
  for (let i = 0; i < 650; i++) f.write(`.codex/skills/s${i}/SKILL.md`, 'skill');
  const model = f.service.overviewSync();
  assert.ok(model.providers[1].categories.skills.length < 600);
  assert.ok(model.providers[1].notes.some(n => n.includes('Scan-Grenze')));
  assert.throws(() => f.service.saveProfile('kimi', 'x'.repeat(129 * 1024), f.service.readProfile('kimi').revision));
  assert.equal(fs.existsSync(f.dataDir), false);
});

test('external linked skills remain visible without content preview', t => {
  const f = fixture(t); f.write('.agents/skills/local/SKILL.md', 'local');
  const external = path.join(f.root, 'external-skill'); fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, 'SKILL.md'), 'external secret');
  const link = path.join(f.homeDir, '.agents/skills/gstack'); fs.symlinkSync(external, link);
  const item = f.service.overviewSync().providers[1].categories.skills.find(i => i.name === 'gstack');
  assert.ok(item); assert.equal(item.path, link); assert.equal(item.source, 'Gemeinsame Agent-Skills');
  assert.equal(item.readable, false); assert.equal(item.status, 'found');
  assert.throws(() => f.service.readResource(item.id), /Textdokument/);
  assert.equal(f.service.revealPath(item.id), link);
});
test('Claude metadata maps exact plugin identities to explicit enablement', t => {
  const f = fixture(t);
  f.write('.claude/settings.json', JSON.stringify({ enabledPlugins: { 'foo@one': true, 'foo@two': false } }));
  f.write('.claude/plugins/installed_plugins.json', JSON.stringify({ plugins: { 'foo@one': [], 'foo@two': [], 'bar@one': [] } }));
  const items = f.service.overviewSync().providers[0].categories.plugins;
  assert.deepEqual(items.map(i => [i.name, i.status]), [['foo@one', 'enabled'], ['foo@two', 'disabled'], ['bar@one', 'installed']]);
  assert.equal(new Set(items.map(i => i.id)).size, 3);
  assert.ok(items.every(i => i.usage === 'unknown'));
});

test('scan budgets are independent and libraries without documents are listed', t => {
  const f = fixture(t);
  for (let i = 0; i < 650; i++) f.write(`.claude/skills/s${i}/SKILL.md`, 'skill');
  f.write('.agents/skills/retained/SKILL.md', 'shared');
  fs.mkdirSync(path.join(f.homeDir, '.codex/plugins/marketplaces/bare-library'), { recursive: true });
  f.write('.codex/plugins/cache/vendor/plugin-one/v1/skills/nested/SKILL.md', 'nested');
  f.write('.codex/plugins/cache/vendor/plugin-one/v1/.codex-plugin/plugin.json', JSON.stringify({ name: 'plugin-one' }));
  const codex = f.service.overviewSync().providers[1];
  assert.ok(codex.categories.skills.some(i => i.name === 'retained'));
  assert.ok(codex.categories.skills.some(i => i.name === 'nested'));
  assert.deepEqual(codex.categories.plugins.map(i => i.name), ['plugin-one']);
  assert.ok(codex.categories.libraries.some(i => i.name === 'bare-library'));
  assert.equal(f.service.overviewSync().providers[2].notes.some(n => n.includes('Scan-Grenze')), false);
});

test('configured integration labels exclude commands and skipped build trees consume no quota', t => {
  const f = fixture(t);
  f.write('.claude/settings.json', JSON.stringify({ hooks: { Stop: [{ command: 'SECRET-COMMAND' }] }, statusLine: { command: 'SECRET-STATUS' } }));
  for (let i = 0; i < 650; i++) f.write(`.claude/skills/package/node_modules/s${i}/README.md`, 'ignore');
  f.write('.claude/skills/zretained/SKILL.md', 'retained');
  const model = f.service.overviewSync();
  assert.equal(model.providers[0].categories.mods.length, 2);
  assert.equal(JSON.stringify(model).includes('SECRET'), false);
  assert.ok(model.providers[0].categories.skills.some(i => i.name === 'zretained'));
  assert.equal(model.providers[0].notes.some(n => n.includes('Scan-Grenze')), false);
});

test('explicit folder creation is provider isolated and refuses ancestor escapes', t => {
  const f = fixture(t); const folder = f.service.ensureFolders('kimi');
  assert.equal(folder.path, path.join(f.dataDir, 'settings/kimi'));
  assert.deepEqual(fs.readdirSync(folder.path).sort(), ['library', 'mods', 'plugins', 'skills']);
  assert.equal(fs.existsSync(path.join(f.dataDir, 'settings/claude')), false);
  assert.deepEqual(fs.readdirSync(f.homeDir), []);
  assert.throws(() => f.service.ensureFolders('common'));
  const g = fixture(t); fs.mkdirSync(g.dataDir); fs.symlinkSync(g.homeDir, path.join(g.dataDir, 'settings'));
  assert.throws(() => g.service.ensureFolders('claude'), /außerhalb/);
  assert.deepEqual(fs.readdirSync(g.homeDir), []);
});
test('kimi inventory is read from ~/.kimi-code, not ~/.kimi', t => {
  const f = fixture(t);
  f.write('.kimi-code/skills/found/SKILL.md', 'Kimi skill');
  f.write('.kimi/skills/wrong/SKILL.md', 'Old folder');
  const kimi = f.service.overviewSync().providers.find(p => p.id === 'kimi');
  assert.deepEqual(kimi.categories.skills.map(s => s.name), ['found']);
});
