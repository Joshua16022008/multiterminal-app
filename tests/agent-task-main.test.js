'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAgentTaskMain } = require('../src/main/agent-task-main');

function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-task-main-'));
  const metas = new Map([
    ['a', { terminalId: 'a', projectId: 'p', provider: 'claude', cwd: dir }],
    ['b', { terminalId: 'b', projectId: 'p', provider: 'codex', cwd: dir }],
    ['x', { terminalId: 'x', projectId: 'other', provider: 'codex', cwd: dir }],
    ['manager', { terminalId: 'manager', projectId: 'p', manager: true }],
  ]);
  const messages = [], contexts = [];
  const adapter = createAgentTaskMain({ dataDir: dir, getTerminal: id => metas.get(id),
    listTerminals: pid => [...metas.values()].filter(meta => meta.projectId === pid),
    getProject: pid => pid === 'p' ? { id: 'p', name: 'Test', path: dir } : null,
    worktrees: { create: options.createWorktree || (async () => ({ ok: true, worktree: { workspaceId: 'isolated' } })) },
    launchContext: {
      preview: async input => { contexts.push(input); return { ok: true, text: input.task, head: 'head', cwd: dir, branch: 'isolated' }; },
      prepare: async input => ({ ok: true, command: input.provider + " 'Read task file'", workspaceId: input.workspaceId }),
    },
    sendToWindow: (channel, value) => { messages.push({ channel, value }); return options.windowAvailable !== false; },
  });
  t.after(() => { adapter.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  adapter.grant('p', 'a', { enabled: true, allowNew: true, maxNewWorkers: 2 });
  const launches = () => messages.filter(message => message.channel === 'agentTasks:launch');
  let n = 0;
  const send = input => adapter.handleCli('a', 'send', { title: 'Task', text: 'Implement bounded task', requestId: 'req-' + ++n, ...input });
  return { adapter, metas, launches, contexts, send, dir };
}

test('existing peers receive persisted inbox tasks; only explicit acceptance and reply complete them', t => {
  const f = setup(t), task = f.send({ to: 'b' });
  assert.equal(task.status, 'queued');
  assert.equal(f.adapter.handleCli('b', 'list', { box: 'inbox' })[0].id, task.id);
  assert.equal(f.adapter.handleCli('b', 'accept', { id: task.id }).status, 'running');
  f.adapter.handleCli('b', 'reply', { id: task.id, status: 'completed', text: 'Implemented; tests passed.' });
  assert.equal(f.adapter.handleCli('a', 'get', { id: task.id }).result.text, 'Implemented; tests passed.');
  assert.equal(f.launches().length, 0);
  assert.throws(() => f.adapter.handleCli('manager', 'list'), /unbekannt|Arbeitsagent/);
  assert.throws(() => f.adapter.handleCli('x', 'get', { id: task.id }), /nicht gefunden/);
});

test('new worker is isolated and prepared; renderer receipt never marks accepted', async t => {
  const f = setup(t), task = f.send({ provider: 'codex' });
  await f.adapter.drain();
  const request = f.launches()[0].value;
  assert.equal(request.provider, 'codex');
  assert.equal(request.terminalId, task.targetTerminalId);
  assert.equal(request.workspaceId, 'isolated');
  assert.ok(f.contexts[0].task.includes(`mt-agent accept ${task.id}`));
  assert.ok(f.contexts[0].task.includes(`mt-agent reply ${task.id}`));
  f.adapter.launchResult({ taskId: task.id, terminalId: task.targetTerminalId, ok: true });
  assert.equal(f.adapter.snapshot('p').tasks[0].status, 'queued');
  const start = { id: request.terminalId, projectId: 'p', command: request.command, workspaceId: 'isolated' };
  assert.equal(f.adapter.validateStart(start).provider, 'codex');
  for (const patch of [{ projectId: 'other' }, { command: 'anything' }, { workspaceId: 'wrong' }, { launch: { harnessId: 'claude' } }]) assert.throws(() => f.adapter.validateStart({ ...start, ...patch }), /nicht mehr/);
  f.metas.set(request.terminalId, { terminalId: request.terminalId, projectId: 'p', provider: 'codex' });
  f.adapter.started(request.terminalId);
  assert.equal(f.adapter.snapshot('p').tasks[0].delivery.state, 'launched');
  f.adapter.handleCli(request.terminalId, 'accept', { id: task.id });
  f.adapter.terminalEnded(request.terminalId);
  assert.equal(f.adapter.snapshot('p').tasks[0].status, 'interrupted', 'PTY exit is not successful completion');
});

test('revocation while preparing stops worker creation and stale launch cannot start', async t => {
  let release;
  const f = setup(t, { createWorktree: () => new Promise(resolve => { release = resolve; }) });
  const task = f.send({ provider: 'codex' });
  const pending = f.adapter.drain();
  f.adapter.grant('p', 'a', { enabled: false, allowNew: false, maxNewWorkers: 2 });
  release({ ok: true, worktree: { workspaceId: 'isolated' } }); await pending;
  assert.equal(f.launches().length, 0);
  assert.equal(f.adapter.snapshot('p').tasks[0].status, 'interrupted');
  assert.throws(() => f.adapter.validateStart({ id: task.targetTerminalId, projectId: 'p', command: 'codex' }), /nicht mehr freigegeben/);
  assert.throws(() => f.adapter.validateStart({ id: task.targetTerminalId, projectId: 'p', launch: { harnessId: 'claude' } }), /nicht mehr freigegeben/);
  assert.equal(f.adapter.validateStart({ id: task.targetTerminalId, projectId: 'p', command: null }), null, 'restored plain shell does not replay task');
});

test('missing renderer and user cancellation preserve visible failed/cancelled task records', async t => {
  const f = setup(t, { windowAvailable: false });
  const task = f.send({ provider: 'claude' }); await f.adapter.drain();
  assert.equal(f.adapter.snapshot('p').tasks[0].status, 'interrupted');
  const queued = f.send({ to: 'b' });
  assert.equal(f.adapter.cancel('p', queued.id).status, 'cancelled');
  assert.throws(() => f.adapter.cancel('other', task.id), /nicht gefunden/);
});

test('worker generation uses complete maximum-length user task without raw terminal input', async t => {
  const f = setup(t), text = 'x'.repeat(3000);
  f.send({ provider: 'codex', title: 't'.repeat(160), text }); await f.adapter.drain();
  assert.ok(f.contexts[0].task.includes(text));
  assert.ok(f.contexts[0].task.length <= 4000, 'existing context-start limit');
});

test('closing the source revokes its grant even if the same pane ID starts a new agent', t => {
  const f = setup(t);
  f.adapter.terminalEnded('a');
  assert.equal(f.adapter.snapshot('p').grants.a.enabled, false);
  f.metas.set('a', { terminalId: 'a', projectId: 'p', provider: 'codex' });
  assert.throws(() => f.send({ provider: 'codex' }), /freigabe/i);
});

test('runtime store damage preserves ordinary terminals while prepared and stale task starts fail closed', async t => {
  const f = setup(t), task = f.send({ provider: 'codex' });
  await f.adapter.drain();
  const request = f.launches()[0].value;
  const start = { id: request.terminalId, projectId: 'p', command: request.command, workspaceId: request.workspaceId };
  fs.writeFileSync(path.join(f.dir, 'agent-tasks/tasks.json'), 'damaged after startup');
  assert.throws(() => f.adapter.validateStart(start));
  assert.equal(f.adapter.validateStart({ id: 'ordinary', projectId: 'p', command: 'claude' }), null);
  assert.doesNotThrow(() => f.adapter.terminalEnded('a'));
  f.adapter.startFailed(task.targetTerminalId, 'Aborted');
  assert.throws(() => f.adapter.validateStart(start), /nicht mehr freigegeben/);
  assert.throws(() => f.adapter.snapshot('p'));
  assert.equal(fs.readFileSync(path.join(f.dir, 'agent-tasks/tasks.json'), 'utf8'), 'damaged after startup');
});

test('source exit during store damage stays revoked for reused pane and descendants after file restoration', async t => {
  const f = setup(t), parent = f.send({ to: 'b' });
  f.adapter.handleCli('b', 'accept', { id: parent.id });
  f.metas.set('c', { terminalId: 'c', projectId: 'p', provider: 'codex' });
  const waiting = f.adapter.handleCli('b', 'send', { to: 'c', title: 'Child', text: 'Wait for acceptance', parentId: parent.id, requestId: 'child' });
  const worker = f.adapter.handleCli('b', 'send', { provider: 'codex', title: 'Worker', text: 'Prepare only', parentId: parent.id, requestId: 'worker' });
  await f.adapter.drain();
  const request = f.launches()[0].value;
  const file = path.join(f.dir, 'agent-tasks/tasks.json'), valid = fs.readFileSync(file);
  fs.writeFileSync(file, 'temporary corruption');
  assert.doesNotThrow(() => f.adapter.terminalEnded('a'));
  fs.writeFileSync(file, valid);
  f.metas.set('a', { terminalId: 'a', projectId: 'p', provider: 'codex' });
  assert.equal(f.adapter.snapshot('p').grants.a.enabled, false);
  assert.throws(() => f.send({ to: 'b' }), /freigabe/i);
  assert.throws(() => f.adapter.handleCli('b', 'send', { to: 'c', title: 'Blocked', text: 'No old authorization', parentId: parent.id, requestId: 'later' }), /freigabe/i);
  assert.throws(() => f.adapter.handleCli('c', 'accept', { id: waiting.id }), /widerrufen/i);
  assert.equal(f.adapter.service.canLaunch(worker.id), false);
  assert.throws(() => f.adapter.validateStart({ id: request.terminalId, projectId: 'p', command: request.command, workspaceId: request.workspaceId }), /nicht mehr/);
  assert.equal(f.adapter.service.pendingLaunches().length, 0);
  f.adapter.grant('p', 'a', { enabled: true, allowNew: true, maxNewWorkers: 2 });
  assert.equal(f.adapter.handleCli('c', 'accept', { id: waiting.id }).status, 'running', 'only fresh successful user grant clears local revocation');
});
