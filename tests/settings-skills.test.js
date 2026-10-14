'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSettingsService } = require('../src/main/settings-service');

function fixture(t, extra = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'settings-skills-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home'), dataDir = path.join(root, 'app');
  fs.mkdirSync(homeDir);
  const write = (rel, text = '# s') => { const f = path.join(homeDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  return { root, homeDir, dataDir, write, service: createSettingsService({ homeDir, dataDir, ...extra }) };
}
const skill = (model, id, name) => model.providers.find(p => p.id === id).categories.skills.find(s => s.name === name);

test('usage evidence is attached per provider; Kimi has no source', async t => {
  const calls = [];
  const usage = { scan: async ({ provider, configDirs }) => { calls.push([provider, configDirs]); return provider === 'kimi' ? { provider, evidence: 'none', skills: {}, scannedFiles: 0, skippedFiles: 0, truncated: false, scannedAt: 1, note: 'keine Quelle' } : { provider, evidence: provider === 'claude' ? 'executed' : 'read', skills: { used: { count: 3, lastUsedAt: 1000, sessions: 2 } }, scannedFiles: 4, skippedFiles: 1, truncated: true, scannedAt: 5, note: 'Nur 4 jüngste.' }; } };
  const f = fixture(t, { skillUsage: usage });
  f.write('.claude/skills/used/SKILL.md'); f.write('.claude/skills/idle/SKILL.md'); f.write('.agents/skills/used/SKILL.md'); f.write('.kimi-code/skills/k/SKILL.md');
  const model = await f.service.overview({ accounts: [{ provider: 'claude', accounts: [{ id: 'a2', folder: '/acc/two' }] }] });
  assert.deepEqual(skill(model, 'claude', 'used').usage, { evidence: 'executed', count: 3, lastUsedAt: 1000, sessions: 2 });
  assert.equal(skill(model, 'claude', 'idle').usage.count, 0);
  assert.equal(skill(model, 'claude', 'idle').usage.evidence, 'executed');
  assert.equal(skill(model, 'codex', 'used').usage.evidence, 'read');
  assert.deepEqual(skill(model, 'kimi', 'k').usage, { evidence: 'none', count: 0, lastUsedAt: 0, sessions: 0 });
  const claude = model.providers[0];
  assert.deepEqual([claude.usage.scannedFiles, claude.usage.skippedFiles, claude.usage.truncated, claude.usage.note], [4, 1, true, 'Nur 4 jüngste.']);
  assert.deepEqual(calls.find(c => c[0] === 'claude')[1], [path.join(f.homeDir, '.claude'), '/acc/two']);
});

test('a failing or slow scan never blocks or breaks the overview', async t => {
  const f = fixture(t, { skillUsage: { scan: async () => { throw new Error('kaputt'); } } });
  f.write('.claude/skills/a/SKILL.md');
  const model = await f.service.overview();
  assert.equal(model.providers[0].usage.status, 'failed'); assert.equal(skill(model, 'claude', 'a').usage.evidence, 'failed');
  let release; const gate = new Promise(r => { release = r; });
  const slow = fixture(t, { usageWaitMs: 20, skillUsage: { scan: async ({ provider }) => { await gate; return { provider, evidence: 'executed', skills: {}, scannedFiles: 1, skippedFiles: 0, truncated: false, scannedAt: 1, note: '' }; } } });
  slow.write('.claude/skills/a/SKILL.md');
  const started = Date.now(); const m = await slow.service.overview();
  assert.ok(Date.now() - started < 1000); assert.equal(m.providers[0].usage.status, 'pending'); release();
});

test('the real usage service reads Claude logs and caches under settings/', async t => {
  const f = fixture(t);
  f.write('.claude/skills/demo/SKILL.md');
  f.write('.claude/projects/p/s1.jsonl', JSON.stringify({ type: 'assistant', timestamp: '2026-10-01T10:00:00Z', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'demo' } }] } }) + '\n');
  const model = await f.service.overview();
  assert.equal(skill(model, 'claude', 'demo').usage.evidence, 'executed');
  assert.equal(skill(model, 'claude', 'demo').usage.count, 1);
  assert.equal(fs.existsSync(path.join(f.dataDir, 'settings', 'skill-usage-cache.json')), true);
});

test('activation: native, none for the app library, candidates from other agents', async t => {
  const f = fixture(t, { skillUsage: { scan: async ({ provider }) => ({ provider, evidence: 'none', skills: {}, scannedFiles: 0, skippedFiles: 0, truncated: false, scannedAt: 1, note: '' }) } });
  f.write('.claude/skills/own/SKILL.md'); f.write('.agents/skills/shared/SKILL.md'); f.write('.agents/skills/own/SKILL.md');
  f.service.ensureFolders('claude'); f.write('../app/settings/claude/library/libskill/SKILL.md');
  fs.mkdirSync(path.join(f.dataDir, 'settings/claude/skills/appskill'), { recursive: true }); fs.writeFileSync(path.join(f.dataDir, 'settings/claude/skills/appskill/SKILL.md'), '# a');
  const model = await f.service.overview();
  const claude = model.providers[0];
  assert.equal(skill(model, 'claude', 'own').activation, 'native');
  assert.equal(skill(model, 'claude', 'appskill').activation, 'none');
  assert.equal(skill(model, 'claude', 'appskill').assignTarget, path.join(f.homeDir, '.claude/skills/appskill'));
  assert.deepEqual(claude.candidates.map(c => c.name), ['shared']);
  assert.equal(claude.candidates[0].from, 'Codex');
  assert.equal(claude.skillTarget.path, path.join(f.homeDir, '.claude/skills'));
  assert.equal(skill(model, 'kimi', 'shared').activation, 'native');
  assert.equal(model.providers[2].candidates.some(c => c.name === 'shared'), false);
});

test('assignSkill and unassignSkill use resource ids, create and remove only the link', async t => {
  const f = fixture(t, { skillUsage: { scan: async ({ provider }) => ({ provider, evidence: 'none', skills: {}, scannedFiles: 0, skippedFiles: 0, truncated: false, scannedAt: 1, note: '' }) } });
  f.write('.agents/skills/shared/SKILL.md', '# shared');
  let model = await f.service.overview();
  const cand = model.providers[0].candidates.find(c => c.name === 'shared');
  const r = f.service.assignSkill('claude', cand.id);
  const link = path.join(f.homeDir, '.claude/skills/shared');
  assert.equal(r.target, link); assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  model = await f.service.overview();
  assert.equal(skill(model, 'claude', 'shared').activation, 'app');
  assert.equal(model.providers[0].candidates.length, 0);
  assert.throws(() => f.service.assignSkill('claude', cand.id), /bereits zugeordnet|schon/);
  assert.throws(() => f.service.assignSkill('claude', 'nope'), /Unbekannte Ressource/);
  f.service.unassignSkill('claude', 'shared');
  assert.equal(fs.existsSync(link), false);
  assert.equal(fs.readFileSync(path.join(f.homeDir, '.agents/skills/shared/SKILL.md'), 'utf8'), '# shared');
  model = await f.service.overview();
  assert.equal(model.providers[0].candidates.length, 1);
});
