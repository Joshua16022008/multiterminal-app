'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createExtensionManager } = require('../src/main/extension-manager');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ext-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home'), dataDir = path.join(root, 'app');
  fs.mkdirSync(homeDir); fs.mkdirSync(dataDir);
  const skill = (rel, name = 'SKILL.md') => { const dir = path.join(homeDir, rel); fs.mkdirSync(dir, { recursive: true }); if (name) fs.writeFileSync(path.join(dir, name), '# s'); return dir; };
  return { root, homeDir, dataDir, skill, mgr: createExtensionManager({ dataDir, homeDir }) };
}
const manifest = f => JSON.parse(fs.readFileSync(path.join(f.dataDir, 'settings', 'assignments.json'), 'utf8'));

test('assign creates a symlink and a manifest entry; unassign removes only that link', t => {
  const f = fixture(t); const src = f.skill('.agents/skills/review');
  const r = f.mgr.assign({ provider: 'claude', sourceDir: src });
  const link = path.join(f.homeDir, '.claude/skills/review');
  assert.equal(r.target, link);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(link), src);
  assert.deepEqual(manifest(f).items.map(i => [i.provider, i.name, i.target, i.source]), [['claude', 'review', link, src]]);
  assert.equal(f.mgr.stateOf('claude', 'review'), 'app'); assert.equal(f.mgr.stateOf('codex', 'review'), 'none');
  assert.equal(f.mgr.unassign({ provider: 'claude', name: 'review' }).ok, true);
  assert.equal(fs.existsSync(link), false); assert.equal(fs.existsSync(path.join(src, 'SKILL.md')), true);
  assert.deepEqual(manifest(f).items, []);
});

test('paths per provider: Claude, Codex shared folder, Kimi', t => {
  const f = fixture(t); const src = f.skill('.somewhere/x');
  assert.equal(f.mgr.target('claude').path, path.join(f.homeDir, '.claude/skills'));
  assert.equal(f.mgr.target('codex').path, path.join(f.homeDir, '.agents/skills'));
  assert.equal(f.mgr.target('kimi').path, path.join(f.homeDir, '.kimi-code/skills'));
  assert.equal(f.mgr.target('kimi').exists, false);
  f.mgr.assign({ provider: 'kimi', sourceDir: src });
  assert.equal(fs.lstatSync(path.join(f.homeDir, '.kimi-code/skills/x')).isSymbolicLink(), true);
  assert.match(f.mgr.target('codex').note, /mehreren Agenten/);
});

test('never overwrites a folder, file or foreign link at the target name', t => {
  const f = fixture(t); const src = f.skill('.agents/skills/a');
  fs.mkdirSync(path.join(f.homeDir, '.claude/skills/a'), { recursive: true });
  assert.throws(() => f.mgr.assign({ provider: 'claude', sourceDir: src }), /überschrieben/);
  assert.equal(fs.lstatSync(path.join(f.homeDir, '.claude/skills/a')).isDirectory(), true);
  const b = f.skill('.agents/skills/b'); fs.writeFileSync(path.join(f.homeDir, '.claude/skills/b'), 'file');
  assert.throws(() => f.mgr.assign({ provider: 'claude', sourceDir: b }), /überschrieben/);
  const c = f.skill('.agents/skills/c'); fs.symlinkSync('/nonexistent', path.join(f.homeDir, '.claude/skills/c'));
  assert.throws(() => f.mgr.assign({ provider: 'claude', sourceDir: c }), /überschrieben/);
  assert.equal(fs.readlinkSync(path.join(f.homeDir, '.claude/skills/c')), '/nonexistent');
  assert.equal(fs.existsSync(path.join(f.dataDir, 'settings', 'assignments.json')), false);
});

test('rejects bad names, sources without SKILL.md and skills already in the agent folder', t => {
  const f = fixture(t); const src = f.skill('.agents/skills/ok');
  for (const name of ['..', '.', 'a/b', '', '-x', 'x'.repeat(101), '../up']) assert.throws(() => f.mgr.assign({ provider: 'claude', sourceDir: src, name }), /Ungültiger/, name);
  assert.throws(() => f.mgr.assign({ provider: 'claude', sourceDir: f.skill('.agents/skills/empty', null) }), /SKILL\.md/);
  assert.throws(() => f.mgr.assign({ provider: 'claude', sourceDir: path.join(f.homeDir, 'missing') }), /SKILL\.md/);
  assert.throws(() => f.mgr.assign({ provider: 'common', sourceDir: src }), /Unbekannter/);
  const own = f.skill('.claude/skills/mine');
  assert.throws(() => f.mgr.assign({ provider: 'claude', sourceDir: own }), /schon im Skill-Ordner/);
  assert.throws(() => f.mgr.assign({ provider: 'codex', sourceDir: src }), /schon im Skill-Ordner/);
});

test('a second assignment of the same skill is refused', t => {
  const f = fixture(t); const src = f.skill('.kimi-code/skills/dup');
  f.mgr.assign({ provider: 'claude', sourceDir: src });
  assert.throws(() => f.mgr.assign({ provider: 'claude', sourceDir: src }), /bereits zugeordnet/);
});

test('unassign refuses foreign entries and changed links and deletes nothing', t => {
  const f = fixture(t); const src = f.skill('.agents/skills/s'); const other = f.skill('.agents/skills/t');
  const real = f.skill('.claude/skills/native');
  assert.throws(() => f.mgr.unassign({ provider: 'claude', name: 'native' }), /nicht von Multiterminal/);
  assert.equal(fs.existsSync(real), true);
  const link = f.mgr.assign({ provider: 'claude', sourceDir: src }).target;
  fs.unlinkSync(link); fs.symlinkSync(other, link);
  assert.equal(f.mgr.stateOf('claude', 's'), 'changed');
  assert.throws(() => f.mgr.unassign({ provider: 'claude', name: 's' }), e => e.state === 'changed' && /verändert/.test(e.message));
  assert.equal(fs.readlinkSync(link), other); assert.equal(manifest(f).items.length, 1);
  fs.unlinkSync(link); fs.mkdirSync(link);
  assert.throws(() => f.mgr.unassign({ provider: 'claude', name: 's' }), /verändert/);
  assert.equal(fs.statSync(link).isDirectory(), true);
  assert.equal(f.mgr.list('claude')[0].state, 'changed');
});

test('a link that vanished is only forgotten in the manifest', t => {
  const f = fixture(t); const src = f.skill('.agents/skills/gone');
  const link = f.mgr.assign({ provider: 'claude', sourceDir: src }).target;
  fs.unlinkSync(link);
  assert.equal(f.mgr.unassign({ provider: 'claude', name: 'gone' }).wasMissing, true);
  assert.deepEqual(manifest(f).items, []);
});

test('a native skill folder that is itself a symlink is resolved', t => {
  const f = fixture(t); const src = f.skill('.agents/skills/viaLink');
  const real = path.join(f.root, 'realskills'); fs.mkdirSync(real);
  fs.mkdirSync(path.join(f.homeDir, '.claude')); fs.symlinkSync(real, path.join(f.homeDir, '.claude/skills'));
  const r = f.mgr.assign({ provider: 'claude', sourceDir: src });
  assert.equal(r.target, path.join(real, 'viaLink'));
  assert.equal(f.mgr.target('claude').path, real);
  f.mgr.unassign({ provider: 'claude', name: 'viaLink' });
  assert.equal(fs.readdirSync(real).length, 0);
});

test('a damaged manifest counts as empty and a settings symlink out of the data folder is refused', t => {
  const f = fixture(t); const src = f.skill('.agents/skills/m');
  fs.mkdirSync(path.join(f.dataDir, 'settings')); fs.writeFileSync(path.join(f.dataDir, 'settings', 'assignments.json'), '{broken');
  assert.deepEqual(f.mgr.list(), []);
  const g = fixture(t); const s2 = g.skill('.agents/skills/m'); const outside = path.join(g.root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(g.dataDir, 'settings'));
  assert.throws(() => g.mgr.assign({ provider: 'claude', sourceDir: s2 }), /außerhalb/);
  assert.equal(fs.existsSync(path.join(g.homeDir, '.claude/skills/m')), false);
  assert.deepEqual(fs.readdirSync(outside), []);
});
