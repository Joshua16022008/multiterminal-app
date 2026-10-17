'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createWorktreeService } = require('../src/main/worktree-service.js');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

// Only temporary repositories are ever touched.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-wt-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'eins\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  const dataDir = path.join(root, 'data');
  const svc = createWorktreeService({ dataDir });
  const project = { id: 'p1', path: repo };
  return { root, repo, dataDir, svc, project, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('creates two independent working copies with their own file states', async () => {
  const f = fixture();
  try {
    const a = await f.svc.create({ project: f.project, branch: 'feature/a' });
    const b = await f.svc.create({ project: f.project, branch: 'feature/b', baseRef: 'main' });
    assert.ok(a.ok && b.ok, JSON.stringify([a, b]));
    assert.notStrictEqual(a.worktree.cwd, b.worktree.cwd);
    assert.strictEqual(a.worktree.managed, true);
    assert.strictEqual(a.worktree.branch, 'feature/a');
    assert.strictEqual(a.worktree.projectId, 'p1');

    fs.writeFileSync(path.join(a.worktree.cwd, 'a.txt'), 'in A geändert\n');
    assert.strictEqual(fs.readFileSync(path.join(b.worktree.cwd, 'a.txt'), 'utf8'), 'eins\n');
    assert.strictEqual(fs.readFileSync(path.join(f.repo, 'a.txt'), 'utf8'), 'eins\n');
    assert.strictEqual((await f.svc.inspect(a.worktree.workspaceId)).changes, 1);
    assert.strictEqual((await f.svc.inspect(b.worktree.workspaceId)).changes, 0);
  } finally { f.cleanup(); }
});

test('the mapping survives a restart (new service instance, same data folder)', async () => {
  const f = fixture();
  try {
    const a = await f.svc.create({ project: f.project, branch: 'keep-me' });
    const again = createWorktreeService({ dataDir: f.dataDir });
    const rec = again.get(a.worktree.workspaceId);
    assert.deepStrictEqual(rec, a.worktree);
    const r = await again.resolveCwd(a.worktree.workspaceId, 'p1', f.repo);
    assert.ok(r.ok);
    assert.strictEqual(r.cwd, a.worktree.cwd);
    assert.deepStrictEqual(again.list('p1').map((x) => x.workspaceId), [a.worktree.workspaceId]);
    assert.deepStrictEqual(again.list('other'), []);
  } finally { f.cleanup(); }
});

test('rejects invalid branch names, bases and existing branches', async () => {
  const f = fixture();
  try {
    for (const bad of ['', '  ', '-x', 'a b', 'a..b', 'a~1', 'x.lock', 'a//b', undefined, 42]) {
      const r = await f.svc.create({ project: f.project, branch: bad });
      assert.strictEqual(r.ok, false, `branch ${JSON.stringify(bad)}`);
    }
    assert.strictEqual((await f.svc.create({ project: f.project, branch: 'ok', baseRef: '--output=x' })).ok, false);
    assert.strictEqual((await f.svc.create({ project: f.project, branch: 'ok', baseRef: 'gibt-es-nicht' })).ok, false);
    assert.strictEqual((await f.svc.create({ project: f.project, branch: 'main' })).ok, false);
    assert.ok((await f.svc.create({ project: f.project, branch: 'neu' })).ok);
    assert.strictEqual((await f.svc.create({ project: f.project, branch: 'neu' })).ok, false);
    assert.deepStrictEqual(f.svc.list().length, 1);
  } finally { f.cleanup(); }
});

test('a folder that is no git repository is refused', async () => {
  const f = fixture();
  try {
    const plain = path.join(f.root, 'plain');
    fs.mkdirSync(plain);
    const r = await f.svc.create({ project: { id: 'p2', path: plain }, branch: 'x' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(f.svc.list().length, 0);
  } finally { f.cleanup(); }
});

test('uncommitted project changes are neither carried along nor lost, and are reported', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.repo, 'a.txt'), 'lokal geändert\n');
    fs.writeFileSync(path.join(f.repo, 'neu.txt'), 'untracked\n');
    const r = await f.svc.create({ project: f.project, branch: 'sauber' });
    assert.ok(r.ok);
    assert.strictEqual(r.projectChanges, 2);
    assert.strictEqual(fs.readFileSync(path.join(r.worktree.cwd, 'a.txt'), 'utf8'), 'eins\n');
    assert.strictEqual(fs.existsSync(path.join(r.worktree.cwd, 'neu.txt')), false);
    assert.strictEqual(fs.readFileSync(path.join(f.repo, 'a.txt'), 'utf8'), 'lokal geändert\n');
    assert.strictEqual(fs.readFileSync(path.join(f.repo, 'neu.txt'), 'utf8'), 'untracked\n');
  } finally { f.cleanup(); }
});

test('remove refuses dirty or untracked work and never forces', async () => {
  const f = fixture();
  try {
    const a = await f.svc.create({ project: f.project, branch: 'dirty' });
    fs.writeFileSync(path.join(a.worktree.cwd, 'nur-untracked.txt'), 'x\n');
    const refused = await f.svc.remove(a.worktree.workspaceId, f.repo);
    assert.strictEqual(refused.ok, false);
    assert.strictEqual(refused.dirty, true);
    assert.ok(fs.existsSync(path.join(a.worktree.cwd, 'nur-untracked.txt')));
    assert.ok(f.svc.get(a.worktree.workspaceId));

    fs.rmSync(path.join(a.worktree.cwd, 'nur-untracked.txt'));
    const ok = await f.svc.remove(a.worktree.workspaceId, f.repo);
    assert.ok(ok.ok);
    assert.strictEqual(fs.existsSync(a.worktree.cwd), false);
    assert.strictEqual(f.svc.get(a.worktree.workspaceId), null);
    // the branch is kept
    assert.match(git(f.repo, 'branch', '--list', 'dirty'), /dirty/);
  } finally { f.cleanup(); }
});

test('a missing worktree folder is an error, not a fallback to the project folder', async () => {
  const f = fixture();
  try {
    const a = await f.svc.create({ project: f.project, branch: 'weg' });
    fs.rmSync(a.worktree.cwd, { recursive: true, force: true });
    const r = await f.svc.resolveCwd(a.worktree.workspaceId, 'p1', f.repo);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.missing, true);
    const i = await f.svc.inspect(a.worktree.workspaceId);
    assert.strictEqual(i.exists, false);
    // the record is kept so the user sees what is gone
    assert.ok(f.svc.get(a.worktree.workspaceId));
  } finally { f.cleanup(); }
});

test('resolveCwd refuses another project and a folder git no longer lists', async () => {
  const f = fixture();
  try {
    const a = await f.svc.create({ project: f.project, branch: 'fremd' });
    assert.strictEqual((await f.svc.resolveCwd(a.worktree.workspaceId, 'p2', f.repo)).ok, false);
    assert.strictEqual((await f.svc.resolveCwd('wt-unbekannt', 'p1', f.repo)).ok, false);
    git(f.repo, 'worktree', 'remove', '--force', a.worktree.cwd);
    fs.mkdirSync(a.worktree.cwd, { recursive: true }); // same path, but no worktree any more
    const r = await f.svc.resolveCwd(a.worktree.workspaceId, 'p1', f.repo);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.missing, true);
  } finally { f.cleanup(); }
});

test('a corrupt or foreign data file is read as empty', () => {
  const f = fixture();
  try {
    fs.mkdirSync(f.dataDir, { recursive: true });
    fs.writeFileSync(path.join(f.dataDir, 'worktrees.json'), '{ kaputt');
    assert.deepStrictEqual(f.svc.list(), []);
    fs.writeFileSync(path.join(f.dataDir, 'worktrees.json'), JSON.stringify({ worktrees: [{ workspaceId: '../x', projectId: 'p', cwd: '/', branch: 'b', baseRef: 'HEAD' }, 7, null] }));
    assert.deepStrictEqual(f.svc.list(), []);
  } finally { f.cleanup(); }
});

test('session store keeps a valid workspaceId and drops a malformed one', () => {
  const { createSessionStore } = require('../src/main/session-store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-wt-sess-'));
  try {
    const store = createSessionStore(dir);
    store.save({ version: 1, activeProjectId: 'p1', projects: { p1: { terminals: [
      { id: 't1', title: 'a', workspaceId: 'wt-1a2b3c4d' },
      { id: 't2', title: 'b', workspaceId: '../../etc' },
      { id: 't3', title: 'c' },
    ] } } });
    const t = store.load().projects.p1.terminals;
    assert.strictEqual(t[0].workspaceId, 'wt-1a2b3c4d');
    assert.strictEqual('workspaceId' in t[1], false);
    assert.strictEqual('workspaceId' in t[2], false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- adopt / linked records -------------------------------------------------

async function externalWorktree(f, name) {
  const dir = path.join(f.root, `ext-${name}`);
  git(f.repo, 'worktree', 'add', '-q', '-b', name, dir);
  return fs.realpathSync(dir);
}

test('adopt links a foreign worktree as managed:false and is idempotent', async () => {
  const f = fixture();
  try {
    const dir = await externalWorktree(f, 'codex-job');
    const r = await f.svc.adopt({ projectId: 'p1', cwd: dir, projectPath: f.repo });
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(r.workspace.managed, false);
    assert.strictEqual(r.workspace.cwd, dir);
    assert.strictEqual(r.workspace.branch, 'codex-job');
    assert.strictEqual(r.workspace.projectId, 'p1');
    assert.match(r.workspace.workspaceId, /^wt-[0-9a-f]{8}$/);
    assert.strictEqual(typeof r.workspace.createdAt, 'number');

    // same folder via a symlink spelling: still one record
    const link = path.join(f.root, 'link-to-ext');
    fs.symlinkSync(dir, link);
    const again = await f.svc.adopt({ projectId: 'p1', cwd: link, projectPath: f.repo });
    assert.ok(again.ok);
    assert.strictEqual(again.workspace.workspaceId, r.workspace.workspaceId);
    assert.strictEqual(f.svc.list('p1').length, 1);

    // survives a restart and resolves like any other record
    const restarted = createWorktreeService({ dataDir: f.dataDir });
    assert.strictEqual(restarted.get(r.workspace.workspaceId).managed, false);
    assert.ok((await restarted.resolveCwd(r.workspace.workspaceId, 'p1', f.repo)).ok);
  } finally { f.cleanup(); }
});

test('adopt uses getProjectPath when no projectPath is passed', async () => {
  const f = fixture();
  try {
    const dir = await externalWorktree(f, 'viaresolver');
    const svc = createWorktreeService({ dataDir: f.dataDir, getProjectPath: (id) => (id === 'p1' ? f.repo : null) });
    assert.ok((await svc.adopt({ projectId: 'p1', cwd: dir })).ok);
    assert.strictEqual((await svc.adopt({ projectId: 'p2', cwd: dir })).ok, false);
    assert.strictEqual((await f.svc.adopt({ projectId: 'p1', cwd: dir })).ok, false, 'no resolver, no path');
  } finally { f.cleanup(); }
});

test('adopt refuses unknown folders, the project folder, prunable entries and bad input', async () => {
  const f = fixture();
  try {
    const stranger = path.join(f.root, 'stranger');
    fs.mkdirSync(stranger);
    assert.strictEqual((await f.svc.adopt({ projectId: 'p1', cwd: stranger, projectPath: f.repo })).ok, false);
    assert.strictEqual((await f.svc.adopt({ projectId: 'p1', cwd: f.repo, projectPath: f.repo })).ok, false);
    assert.strictEqual((await f.svc.adopt({ projectId: 'p1', cwd: path.join(f.root, 'nope'), projectPath: f.repo })).ok, false);
    assert.strictEqual((await f.svc.adopt({ projectId: '../x', cwd: stranger, projectPath: f.repo })).ok, false);
    assert.strictEqual((await f.svc.adopt({ projectId: 'p1', projectPath: f.repo })).ok, false);
    assert.strictEqual((await f.svc.adopt()).ok, false);

    // git still lists it, but the folder is gone: cannot be adopted
    const gone = path.join(f.root, 'gone-wt');
    git(f.repo, 'worktree', 'add', '-q', '-b', 'gone', gone);
    fs.rmSync(gone, { recursive: true, force: true });
    assert.strictEqual((await f.svc.adopt({ projectId: 'p1', cwd: gone, projectPath: f.repo })).ok, false);
    assert.strictEqual(f.svc.list('p1').length, 0);
  } finally { f.cleanup(); }
});

test('remove of a linked record only forgets it and never runs git worktree remove', async () => {
  const f = fixture();
  try {
    const dir = await externalWorktree(f, 'keepme');
    fs.writeFileSync(path.join(dir, 'dirty.txt'), 'ungesichert\n');
    const calls = [];
    const spy = async (args, cwd) => {
      calls.push(args.join(' '));
      return new Promise((resolve) => {
        require('node:child_process').execFile('git', args, { cwd }, (error, stdout, stderr) => {
          resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr) });
        });
      });
    };
    const svc = createWorktreeService({ dataDir: f.dataDir, run: spy });
    const adopted = await svc.adopt({ projectId: 'p1', cwd: dir, projectPath: f.repo });
    assert.ok(adopted.ok);
    calls.length = 0;

    const r = await svc.remove(adopted.workspace.workspaceId, f.repo);
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(r.forgotten, true);
    assert.deepStrictEqual(calls, [], 'no git call at all for a linked record');
    assert.strictEqual(svc.get(adopted.workspace.workspaceId), null);
    assert.ok(fs.existsSync(path.join(dir, 'dirty.txt')), 'folder and its work are untouched');
    assert.ok(git(f.repo, 'worktree', 'list', '--porcelain').includes('keepme'), 'git still lists it');
    assert.ok(git(f.repo, 'branch', '--list', 'keepme').includes('keepme'));
  } finally { f.cleanup(); }
});

test('remove of a managed record still runs git worktree remove (regression)', async () => {
  const f = fixture();
  try {
    const a = await f.svc.create({ project: f.project, branch: 'mine' });
    const r = await f.svc.remove(a.worktree.workspaceId, f.repo);
    assert.ok(r.ok);
    assert.strictEqual(r.branchKept, 'mine');
    assert.ok(!fs.existsSync(a.worktree.cwd));
  } finally { f.cleanup(); }
});
