'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../src/renderer/agent-launch.js');

const project = { id: 'p1', name: 'Projekt', path: '/projects/one' };
const ws = { workspaceId: 'w1', branch: 'feature/a', cwd: '/copies/one' };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
function fixture(overrides = {}) {
  const calls = { list: [], create: [], inspect: [], preview: [], prepare: [], launch: [], notify: [] };
  const api = {
    worktrees: {
      async list(...args) { calls.list.push(args); return overrides.list ? overrides.list(...args) : [ws]; },
      async create(...args) { calls.create.push(args); return overrides.create ? overrides.create(...args) : { ok: true, worktree: ws, projectChanges: 2 }; },
      async inspect(...args) { calls.inspect.push(args); return overrides.inspect ? overrides.inspect(...args) : { ok: true, exists: true }; },
    },
    launch: {
      async preview(args) { calls.preview.push(args); return overrides.preview ? overrides.preview(args) : {
        ok: true, text: 'Aufgabe im Projekt', cwd: args.workspaceId ? ws.cwd : project.path,
        branch: args.workspaceId ? ws.branch : 'main', head: 'abc', workspaceId: args.workspaceId, warnings: [],
      }; },
      async prepare(args) { calls.prepare.push(args); return overrides.prepare ? overrides.prepare(args) : { ok: true, ...args, command: 'test-command' }; },
    },
  };
  const controller = createController({ api, launch: async (args) => {
    calls.launch.push(args); return overrides.launch ? overrides.launch(args) : undefined;
  }, notify: (text) => calls.notify.push(text) });
  return { controller, calls };
}
async function ready(f, folder = 'new') {
  await f.controller.open({ project });
  f.controller.update('folder', folder);
  f.controller.update('task', 'Eine Suche bauen');
  f.controller.update('branch', 'feature/a');
  if (folder === 'existing') f.controller.update('workspaceId', ws.workspaceId);
}

test('no project never opens or calls an API; loading and opening do not create or launch', async () => {
  const f = fixture();
  assert.equal(await f.controller.open(), false);
  assert.equal(f.calls.list.length, 0);
  await f.controller.open({ project });
  assert.equal(f.controller.getState().folder, 'new');
  assert.equal(f.calls.create.length + f.calls.prepare.length + f.calls.launch.length, 0);
});

test('blank task, missing branch and unselected workspace fail before side effects', async () => {
  const f = fixture();
  await f.controller.open({ project });
  f.controller.update('task', '   ');
  assert.equal(await f.controller.preview(), false);
  assert.match(f.controller.getState().error, /Aufgabe/);
  f.controller.update('task', 'Auftrag');
  assert.equal(await f.controller.preview(), false);
  assert.match(f.controller.getState().error, /Branch/);
  f.controller.update('folder', 'existing');
  assert.equal(await f.controller.preview(), false);
  assert.match(f.controller.getState().error, /auswählen/);
  assert.equal(f.calls.create.length + f.calls.preview.length, 0);
});

test('creation requires prepare click; repeated clicks and edits cannot duplicate the operation', async () => {
  const pending = deferred();
  const f = fixture({ create: () => pending.promise });
  await ready(f);
  const first = f.controller.preview();
  assert.equal(await f.controller.preview(), false);
  assert.equal(f.controller.update('folder', 'project'), false);
  assert.equal(f.calls.create.length, 1);
  pending.resolve({ ok: true, worktree: ws });
  assert.equal(await first, true);
  assert.equal(f.controller.getState().step, 'preview');
  assert.equal(f.calls.launch.length, 0);
});

test('preview failure retains a newly created workspace so retry does not create another', async () => {
  let attempts = 0;
  const f = fixture({ preview: (args) => ++attempts === 1
    ? { ok: false, error: 'Temporär gesperrt' }
    : { ok: true, text: 'Erneuter Kontext', workspaceId: args.workspaceId, cwd: ws.cwd, head: 'abc' } });
  await ready(f);
  assert.equal(await f.controller.preview(), false);
  assert.equal(f.controller.getState().workspaceId, ws.workspaceId);
  assert.equal(f.controller.getState().folder, 'existing');
  assert.equal(await f.controller.preview(), true);
  assert.equal(f.calls.create.length, 1);
  assert.equal(f.calls.preview[1].workspaceId, ws.workspaceId);
});

test('plain project selection previews without creating or inspecting a worktree', async () => {
  const f = fixture();
  await ready(f, 'project');
  assert.equal(await f.controller.preview(), true);
  assert.equal(f.calls.create.length + f.calls.inspect.length, 0);
  assert.equal(f.calls.preview[0].workspaceId, null);
  assert.equal(f.controller.getState().preview.cwd, project.path);
});

test('missing existing workspace does not preview or fall back to project', async () => {
  const f = fixture({ inspect: () => ({ ok: true, exists: false }) });
  await ready(f, 'existing');
  assert.equal(await f.controller.preview(), false);
  assert.match(f.controller.getState().error, /fehlt/);
  assert.equal(f.calls.preview.length + f.calls.launch.length, 0);
});

test('field edits invalidate prior preview; changing folder previews the new selection', async () => {
  const f = fixture();
  await ready(f, 'project');
  await f.controller.preview();
  f.controller.update('text', 'Eigener Kontext');
  assert.equal(f.controller.getState().step, 'preview');
  f.controller.back();
  f.controller.update('scope', 'nur src/');
  assert.equal(f.controller.getState().preview, null);
  assert.equal(await f.controller.start(), false);
  f.controller.update('folder', 'existing');
  f.controller.update('workspaceId', ws.workspaceId);
  await f.controller.preview();
  assert.equal(f.calls.preview[1].workspaceId, ws.workspaceId);
  assert.equal(f.calls.preview[1].scope, 'nur src/');
});

test('prepare failure retains editable text and retry launches exactly once with reviewed provider and location', async () => {
  let attempts = 0;
  const pending = deferred();
  const f = fixture({ prepare: async (args) => ++attempts === 1
    ? { ok: false, error: 'Stand hat sich geändert' } : pending.promise });
  await ready(f, 'existing');
  f.controller.update('provider', 'codex');
  await f.controller.preview();
  f.controller.update('text', 'Von mir bearbeiteter Kontext');
  assert.equal(await f.controller.start(), false);
  assert.equal(f.controller.getState().text, 'Von mir bearbeiteter Kontext');
  assert.equal(f.controller.getState().step, 'preview');
  const retry = f.controller.start();
  assert.equal(await f.controller.start(), false);
  pending.resolve({ ok: true, cwd: ws.cwd, workspaceId: ws.workspaceId, command: 'codex test' });
  assert.equal(await retry, true);
  assert.deepEqual(f.calls.prepare[1], {
    projectId: project.id, workspaceId: ws.workspaceId, provider: 'codex', text: 'Von mir bearbeiteter Kontext', expectedHead: 'abc', expectedCwd: ws.cwd, expectedBranch: ws.branch,
  });
  assert.equal(f.calls.launch.length, 1);
  assert.equal(f.calls.launch[0].provider, 'codex');
  assert.equal(f.controller.getState().opened, false);
});

test('cancel while prepare is pending prevents launch even if preparation finishes later', async () => {
  const pending = deferred();
  const f = fixture({ prepare: () => pending.promise });
  await ready(f, 'project');
  await f.controller.preview();
  const starting = f.controller.start();
  f.controller.close();
  pending.resolve({ ok: true, command: 'unused' });
  assert.equal(await starting, false);
  assert.equal(f.calls.launch.length, 0);
});

test('reopen loads current workspaces and ignores older asynchronous list and preview results', async () => {
  const oldList = deferred(), oldPreview = deferred();
  let lists = 0;
  const f = fixture({ list: () => ++lists === 1 ? oldList.promise : [], preview: () => oldPreview.promise });
  const firstOpen = f.controller.open({ project });
  f.controller.close();
  await f.controller.open({ project: { ...project, name: 'Neu' } });
  oldList.resolve([ws]);
  assert.equal(await firstOpen, false);
  assert.deepEqual(f.controller.getState().workspaces, []);
  f.controller.update('folder', 'project'); f.controller.update('task', 'Aufgabe');
  const preparing = f.controller.preview();
  f.controller.close();
  await f.controller.open({ project });
  oldPreview.resolve({ ok: true, text: 'Veralteter Kontext' });
  assert.equal(await preparing, false);
  assert.equal(f.controller.getState().step, 'edit');
  assert.equal(f.controller.getState().text, '');
  assert.equal(f.calls.list.length, 3);
});

test('cancelling a requested creation ignores its result and explains where the completed worktree is available', async () => {
  const pending = deferred();
  const f = fixture({ create: () => pending.promise });
  await ready(f);
  const preparing = f.controller.preview();
  f.controller.close();
  pending.resolve({ ok: true, worktree: ws });
  assert.equal(await preparing, false);
  assert.equal(f.calls.preview.length, 0);
  assert.equal(f.calls.notify.length, 1);
  assert.equal(f.controller.getState().opened, false);
});

test('blank edited context and unsupported provider cannot trigger an agent start', async () => {
  const f = fixture();
  await ready(f, 'project');
  assert.equal(f.controller.update('provider', 'kimi'), false);
  await f.controller.preview();
  f.controller.update('text', '  ');
  assert.equal(await f.controller.start(), false);
  assert.equal(f.calls.prepare.length + f.calls.launch.length, 0);
});

test('open from the Stammbaum preselects the working copy or the project folder', async () => {
  const f = fixture();
  await f.controller.open({ project, workspaceId: ws.workspaceId });
  assert.equal(f.controller.getState().folder, 'existing');
  assert.equal(f.controller.getState().workspaceId, ws.workspaceId);
  f.controller.update('task', 'Auftrag');
  assert.equal(await f.controller.preview(), true);
  assert.equal(f.calls.preview.at(-1).workspaceId, ws.workspaceId);
  assert.equal(f.calls.create.length, 0, 'no new working copy for a chosen branch');

  await f.controller.open({ project, workspaceId: null });
  assert.equal(f.controller.getState().folder, 'project');
  assert.equal(f.controller.getState().workspaceId, '');
  await f.controller.open({ project });
  assert.equal(f.controller.getState().folder, 'new', 'menu start stays unchanged');
  await f.controller.open({ project, workspaceId: '' });
  assert.equal(f.controller.getState().folder, 'new');
});

test('a stale preselected workspaceId falls back to a new working copy with a notice', async () => {
  const f = fixture();
  await f.controller.open({ project, workspaceId: 'gone' });
  const s = f.controller.getState();
  assert.strictEqual(s.folder, 'new');
  assert.strictEqual(s.workspaceId, '');
  assert.match(s.error, /nicht mehr/);
  await f.controller.open({ project, workspaceId: 'w1' });
  assert.strictEqual(f.controller.getState().folder, 'existing');
});
