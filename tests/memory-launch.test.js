'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createMemoryService } = require('../src/main/memory-service');
const { createAgentProfile } = require('../src/main/agent-profile');
const { createMemoryLaunch } = require('../src/main/memory-launch');
const { createLaunchContextService } = require('../src/main/launch-context');
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mt-memory-launch-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "App's data"), profiles = {};
  const readProfile = provider => ({ text: profiles[provider] || '', path: path.join(root, provider + '.md') });
  const agentProfile = createAgentProfile({ dataDir, readProfile });
  const memory = createMemoryService({ dataDir });
  const launch = createMemoryLaunch({ dataDir, memory, agentProfile, readProfile });
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  for (const provider of ['claude', 'codex', 'kimi']) fs.writeFileSync(path.join(bin, provider), '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n', { mode: 0o755 });
  const args = command => JSON.parse(execFileSync('/bin/sh', ['-c', command], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH } }));
  const profile = (provider, text) => { profiles[provider] = text; fs.writeFileSync(readProfile(provider).path, text); agentProfile.setEnabled(provider, true); };
  return { root, dataDir, memory, launch, args, profile };
}
const id = 'a1b2c3d4-0000-4000-8000-123456789abc';
function contextFile(args) { return args.at(-1).match(/Memory-Datei (.+?) vollständig/)[1]; }
test('Claude and Codex built-in starts/resumes receive immutable private current-scope files and profile', t => {
  const f = fixture(t); const text = 'literal ${cwd} `touch BAD` $(touch BAD) \'quote\'';
  f.memory.saveNotes('one', text, 0); f.memory.saveNotes('other', 'MUST NOT APPEAR', 0);
  for (const provider of ['claude', 'codex']) {
    f.profile(provider, 'PERSONAL PROFILE');
    for (const command of [provider, provider === 'claude' ? 'claude --continue' : 'codex resume ' + id, ...(provider === 'claude' ? ['claude --resume ' + id] : [])]) {
      const args = f.args(f.launch.decorateCommand({ command, projectId: 'one' }));
      const file = contextFile(args), content = fs.readFileSync(file, 'utf8');
      assert.ok(content.includes(text)); assert.ok(!content.includes('MUST NOT APPEAR'));
      assert.match(args.at(-1), /aktuelle Benutzeranweisungen/);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.ok(provider === 'claude' ? args.includes('--append-system-prompt') : args.includes('--dangerously-bypass-approvals-and-sandbox'));
      f.memory.saveNotes('one', text + ' newer', f.memory.read('one').revision);
      assert.equal(fs.readFileSync(file, 'utf8'), content);
    }
  }
  assert.equal(fs.existsSync(path.join(f.root, 'BAD')), false);
});
test('Codex last resume uses one merged developer setting and no positional prompt', t => {
  const f = fixture(t); f.profile('codex', 'PROFILE'); f.memory.saveNotes('one', 'RECENT', 0);
  const args = f.args(f.launch.decorateCommand({ command: 'codex resume --last', projectId: 'one' }));
  assert.deepEqual(args.slice(0, 2), ['resume', '--last']); assert.equal(args.filter(x => x === '-c').length, 1);
  const instructions = JSON.parse(args[args.indexOf('-c') + 1].slice('developer_instructions='.length));
  assert.match(instructions, /PROFILE/); assert.match(instructions, /RECENT/); assert.match(instructions, /mt-memory save/);
  assert.equal(args.length, 5); assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));
});
test('Kimi combines base/profile with a read-file hint; memory template variables remain in data file; resume native', t => {
  const f = fixture(t); f.profile('kimi', 'PROFILE'); f.memory.saveNotes('one', 'MEMORY ${cwd} ${base_prompt}', 0);
  const args = f.args(f.launch.decorateCommand({ command: 'kimi', projectId: 'one' }));
  assert.equal(args[0], '--agent-file'); assert.equal(args.length, 2);
  const agent = fs.readFileSync(args[1], 'utf8'); assert.match(agent, /\$\{base_prompt\}/); assert.match(agent, /PROFILE/);
  assert.ok(!agent.includes('MEMORY ${cwd}')); assert.match(fs.readFileSync(contextFile([agent]), 'utf8'), /MEMORY \$\{cwd\}/);
  for (const command of ['kimi --continue', 'kimi --session ' + id]) assert.equal(f.launch.decorateCommand({ command, projectId: 'one' }), command);
});
test('empty enabled memory bootstraps checkpoint writing, disabled/custom commands preserve native behavior', t => {
  const f = fixture(t);
  const args = f.args(f.launch.decorateCommand({ command: 'claude', projectId: 'one' }));
  const content = fs.readFileSync(contextFile(args), 'utf8'); assert.match(content, /mt-memory save --summary/); assert.match(content, /ungeprüft/);
  for (const command of ['custom --arg hi', 'codex --sandbox read-only', 'claude --resume short;touch BAD']) assert.equal(f.launch.decorateCommand({ command, projectId: 'one' }), command);
  f.memory.setSettings({ enabled: false });
  assert.equal(f.launch.decorateCommand({ command: 'claude', projectId: 'one' }), 'claude');
  assert.equal(f.launch.decorateCommand({ command: 'codex', projectId: 'one' }), 'codex --dangerously-bypass-approvals-and-sandbox');
});
test('context-start preview includes memory while prepare retains exactly one initial task-file prompt', async t => {
  const f = fixture(t), project = { id: 'one', name: 'One', path: f.root };
  f.memory.saveNotes('one', 'PREVIEW MEMORY', 0);
  const service = createLaunchContextService({ dataDir: f.dataDir, readMemory: id => f.memory.context(id) });
  const preview = await service.preview({ project, task: 'Do task' }); assert.equal(preview.ok, true); assert.match(preview.text, /PREVIEW MEMORY/);
  const prepared = await service.prepare({ project, provider: 'claude', text: preview.text, expectedCwd: preview.cwd, expectedHead: preview.head, expectedBranch: preview.branch });
  assert.equal(prepared.ok, true); assert.equal(f.args(prepared.command).length, 1);
  assert.equal(f.launch.decorateCommand({ command: prepared.command, projectId: 'one' }), prepared.command);
});

test('Kimi empty bootstrap keeps base prompt, Codex last works without a profile, and unsafe context destinations fail visibly', t => {
  const f = fixture(t);
  const args = f.args(f.launch.decorateCommand({ command: 'kimi', projectId: 'one' }));
  const agent = fs.readFileSync(args[1], 'utf8');
  assert.match(agent, /\$\{base_prompt\}/);
  assert.match(fs.readFileSync(contextFile([agent]), 'utf8'), /mt-memory save/);
  const last = f.args(f.launch.decorateCommand({ command: 'codex resume --last', projectId: 'one' }));
  assert.equal(last.filter(arg => arg === '-c').length, 1);
  assert.match(last[last.indexOf('-c') + 1], /mt-memory save/);
  fs.rmSync(path.join(f.dataDir, 'memory-contexts'), { recursive: true });
  fs.symlinkSync(f.root, path.join(f.dataDir, 'memory-contexts'));
  assert.throws(() => f.launch.decorateCommand({ command: 'claude', projectId: 'one' }), /Unsicher/);
});
test('Memory read failures propagate and enabled launch contexts including bootstrap obey the context bound', t => {
  const f = fixture(t);
  const context = f.memory.context;
  f.memory.context = () => 'x'.repeat(60000);
  const text = f.launch.context('one'); assert.equal(text.length, 60000); assert.match(text, /gekürzt/);
  f.memory.context = () => { throw new Error('Kaputte Memory-Datei'); };
  assert.throws(() => f.launch.decorateCommand({ command: 'claude', projectId: 'one' }), /Kaputte Memory/);
  f.memory.context = context;
});

test('near-limit Memory and project documents compose a bounded useful editable preview', async t => {
  const f = fixture(t), project = { id: 'one', name: 'One', path: f.root };
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'README.md', 'PROJECT_STATUS.md', 'PLAN.md', 'PROGRESS.md']) fs.writeFileSync(path.join(f.root, name), 'PROJECT_DOCUMENT '.repeat(500));
  fs.writeFileSync(path.join(f.root, 'WORK_IN_PROGRESS.md'), 'FRESH_COORDINATION_MARKER\n' + 'COORDINATION '.repeat(500));
  const memoryText = 'EXPLICIT_HANDOFF_PRIORITY_MARKER\n' + 'MEMORY '.repeat(8400);
  const service = createLaunchContextService({ dataDir: f.dataDir, readMemory: () => memoryText });
  const preview = await service.preview({ project, task: 'CURRENT_TASK_MUST_SURVIVE', scope: 'CURRENT_SCOPE_MUST_SURVIVE', acceptance: 'ACCEPTANCE_MUST_SURVIVE' });
  assert.equal(preview.ok, true, preview.error); assert.ok(preview.text.length <= 60000);
  for (const marker of ['CURRENT_TASK_MUST_SURVIVE', 'CURRENT_SCOPE_MUST_SURVIVE', 'ACCEPTANCE_MUST_SURVIVE', 'FRESH_COORDINATION_MARKER', 'EXPLICIT_HANDOFF_PRIORITY_MARKER', 'PROJECT_DOCUMENT']) assert.ok(preview.text.includes(marker), marker);
  assert.ok(preview.warnings.some(w => /Memory.*gekürzt/.test(w)));
  assert.match(preview.text, /GEKÜRZT/);
  const prepared = await service.prepare({ project, provider: 'claude', text: preview.text, expectedCwd: preview.cwd, expectedHead: preview.head, expectedBranch: preview.branch });
  assert.equal(prepared.ok, true, prepared.error);
});
