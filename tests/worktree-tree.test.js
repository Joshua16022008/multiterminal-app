'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createWorktreeTree, parsePorcelain, classifyOrigin, pickTrunk } = require('../src/main/worktree-tree.js');
const { createWorktreeService } = require('../src/main/worktree-service.js');

// ---- pure parsers ---------------------------------------------------------

const PORCELAIN = [
  'worktree /repo/my project',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /home/u/.codex/worktrees/1580/repo',
  'HEAD 2222222222222222222222222222222222222222',
  'detached',
  '',
  'worktree /repo/.agent-worktrees/a',
  'HEAD 3333333333333333333333333333333333333333',
  'branch refs/heads/feature/x',
  'locked in use by agent',
  '',
  'worktree /repo/.qa-hotkeys-tmp/gone',
  'HEAD 4444444444444444444444444444444444444444',
  'branch refs/heads/qa',
  'prunable gitdir file points to non-existent location',
  '',
].join('\n');

test('parsePorcelain reads paths with spaces, detached, locked and prunable', () => {
  const e = parsePorcelain(PORCELAIN);
  assert.strictEqual(e.length, 4);
  assert.strictEqual(e[0].path, '/repo/my project');
  assert.strictEqual(e[0].branch, 'main');
  assert.strictEqual(e[0].head, '1'.repeat(40));
  assert.strictEqual(e[1].detached, true);
  assert.strictEqual(e[1].branch, null);
  assert.strictEqual(e[2].locked, true);
  assert.strictEqual(e[2].lockReason, 'in use by agent');
  assert.strictEqual(e[2].branch, 'feature/x');
  assert.strictEqual(e[3].prunable, true);
  assert.match(e[3].prunableReason, /non-existent/);
  assert.strictEqual(e[0].prunable, false);
});

test('parsePorcelain tolerates bare entries, empty input and no trailing blank line', () => {
  assert.deepStrictEqual(parsePorcelain(''), []);
  assert.deepStrictEqual(parsePorcelain(null), []);
  const e = parsePorcelain('worktree /bare.git\nbare\n\nworktree /w\nHEAD abc\nbranch refs/heads/m');
  assert.strictEqual(e[0].bare, true);
  assert.strictEqual(e[1].branch, 'm');
  assert.strictEqual(parsePorcelain('locked\nHEAD x\n').length, 0);
});

test('classifyOrigin recognises codex, agent-worktrees, app and other', () => {
  const home = '/Users/j';
  assert.strictEqual(classifyOrigin('/Users/j/.codex/worktrees/1580/repo', home), 'codex');
  assert.strictEqual(classifyOrigin('/Users/j/.codex/worktrees-other/x', home), 'other');
  assert.strictEqual(classifyOrigin('/x/repo/.agent-worktrees/a', home), 'agent-worktrees');
  assert.strictEqual(classifyOrigin('/data/worktrees/p1/f-1', home, '/data/worktrees'), 'app');
  assert.strictEqual(classifyOrigin('/data/worktrees-x/p1', home, '/data/worktrees'), 'other');
  assert.strictEqual(classifyOrigin('/tmp/else', home), 'other');
  assert.strictEqual(classifyOrigin(null, null), 'other');
});

test('pickTrunk prefers origin/HEAD, then main, master and the current branch', () => {
  assert.strictEqual(pickTrunk({ originHead: 'origin/develop', branches: ['develop', 'main'] }), 'develop');
  assert.strictEqual(pickTrunk({ originHead: 'origin/develop', branches: ['main'] }), 'origin/develop');
  assert.strictEqual(pickTrunk({ branches: ['master', 'x'] }), 'master');
  assert.strictEqual(pickTrunk({ branches: ['main', 'master'] }), 'main');
  assert.strictEqual(pickTrunk({ branches: ['x'], current: 'x' }), 'x');
  assert.strictEqual(pickTrunk({ branches: [], current: 'HEAD' }), null);
  assert.strictEqual(pickTrunk(undefined), null);
});

// ---- tree with an injected run ---------------------------------------------

const SHA = (c) => c.repeat(40);

function fakeRun(overrides = {}) {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  async function run(args, cwd) {
    calls.push({ args, cwd });
    active += 1; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setImmediate(r));
    active -= 1;
    const key = args.join(' ');
    for (const [pattern, reply] of Object.entries(overrides)) {
      if (key.startsWith(pattern)) return typeof reply === 'function' ? reply(args, cwd) : reply;
    }
    const ok = (stdout) => ({ ok: true, stdout, stderr: '' });
    if (key === 'rev-parse --is-inside-work-tree') return ok('true\n');
    if (key === 'worktree list --porcelain') return ok(`worktree ${os.tmpdir()}\nHEAD ${SHA('a')}\nbranch refs/heads/main\n\nworktree ${os.tmpdir()}/nope-1\nHEAD ${SHA('b')}\nbranch refs/heads/feat\n`);
    if (key.startsWith('symbolic-ref')) return { ok: false, stdout: '', stderr: 'no origin' };
    if (key.startsWith('for-each-ref')) return ok('main\nfeat\n');
    if (key === 'rev-parse --abbrev-ref HEAD') return ok('main\n');
    if (key.startsWith('log -1')) return ok(`${SHA('a')}\x00subject\x00100\x00Anna\n`);
    if (key.startsWith('merge-base --is-ancestor')) return { ok: false, code: 1, stdout: '', stderr: '' };
    if (key.startsWith('merge-base')) return ok(`${SHA('0')}\n`);
    if (key.startsWith('rev-list')) return ok('2\t3\n');
    if (key === 'status --porcelain') return ok(' M a\n?? b\n');
    return { ok: false, stdout: '', stderr: 'unexpected' };
  }
  return { run, calls, maxActive: () => maxActive };
}

const noRecords = { list: () => [] };

test('buildTree fills ahead/behind, fork point, last commit and changes', async () => {
  const f = fakeRun();
  const t = createWorktreeTree({ run: f.run, worktrees: noRecords, homeDir: '/nohome' });
  const tree = await t.tree({ id: 'p1', path: os.tmpdir() });
  assert.strictEqual(tree.ok, true);
  assert.strictEqual(tree.isGit, true);
  assert.strictEqual(tree.trunk.name, 'main');
  assert.strictEqual(tree.trunk.subject, 'subject');
  assert.strictEqual(tree.trunk.time, 100000);
  const [proj, feat] = tree.nodes;
  assert.strictEqual(proj.kind, 'project');
  assert.strictEqual(proj.ahead, 0);
  assert.strictEqual(proj.merged, null);
  assert.strictEqual(feat.kind, 'external');
  assert.strictEqual(feat.missing, true);
  assert.strictEqual(feat.behind, 2);
  assert.strictEqual(feat.ahead, 3);
  assert.strictEqual(feat.merged, false);
  assert.strictEqual(feat.forkPoint, SHA('0'));
  assert.strictEqual(feat.last.subject, 'subject');
  assert.strictEqual(feat.last.author, 'Anna');
  assert.strictEqual(feat.changes, null, 'missing folder: not readable');
  assert.strictEqual(proj.changes, 2);
  assert.match(feat.id, /^path:[0-9a-f]{10}$/);
});

test('a failing query only nulls that node field, never the whole tree', async () => {
  const f = fakeRun({
    'rev-list': { ok: false, stdout: '', stderr: 'boom' },
    'merge-base --is-ancestor': { ok: false, code: 128, stdout: '', stderr: 'fatal' },
    'log -1': (args) => (args.includes(SHA('b')) ? { ok: false, stdout: '', stderr: 'bad object' } : { ok: true, stdout: `${SHA('a')}\x00s\x00100\x00A\n`, stderr: '' }),
  });
  const t = createWorktreeTree({ run: f.run, worktrees: noRecords });
  const tree = await t.tree({ id: 'p1', path: os.tmpdir() });
  const feat = tree.nodes[1];
  assert.strictEqual(feat.ahead, null);
  assert.strictEqual(feat.behind, null);
  assert.strictEqual(feat.merged, null);
  assert.strictEqual(feat.last, null);
  assert.strictEqual(feat.forkPoint, SHA('0'));
  assert.strictEqual(tree.nodes.length, 2);
});

test('a thrown run() is treated as a failed query', async () => {
  const f = fakeRun({ 'rev-list': () => { throw new Error('kaputt'); } });
  const t = createWorktreeTree({ run: f.run, worktrees: noRecords });
  const tree = await t.tree({ id: 'p1', path: os.tmpdir() });
  assert.strictEqual(tree.nodes[1].ahead, null);
});

test('no git repository gives isGit:false and no nodes', async () => {
  const t = createWorktreeTree({
    run: async () => ({ ok: false, stdout: '', stderr: 'fatal: not a git repository' }),
    worktrees: noRecords,
  });
  const tree = await t.tree({ id: 'p1', path: os.tmpdir() });
  assert.strictEqual(tree.ok, true);
  assert.strictEqual(tree.isGit, false);
  assert.deepStrictEqual(tree.nodes, []);
  assert.strictEqual(tree.trunk, null);
  assert.strictEqual((await t.tree(null)).isGit, false);
});

test('prunable entries get no git queries beyond the listing', async () => {
  const gone = path.join(os.tmpdir(), 'mt-wt-definitely-gone');
  const f = fakeRun({
    'worktree list': { ok: true, stderr: '', stdout: `worktree ${os.tmpdir()}\nHEAD ${SHA('a')}\nbranch refs/heads/main\n\nworktree ${gone}\nHEAD ${SHA('c')}\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n` },
  });
  const t = createWorktreeTree({ run: f.run, worktrees: noRecords });
  const tree = await t.tree({ id: 'p1', path: os.tmpdir() });
  const old = tree.nodes[1];
  assert.strictEqual(old.prunable, true);
  assert.strictEqual(old.missing, true);
  assert.strictEqual(old.ahead, null);
  assert.strictEqual(old.changes, null);
  assert.ok(!f.calls.some((c) => c.args.includes(SHA('c'))), 'no query for the prunable head');
});

test('records decide the kind: managed, linked, external', async () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-wtk-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-wtk-b-'));
  const c = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-wtk-c-'));
  try {
    const f = fakeRun({
      'worktree list': { ok: true, stderr: '', stdout: [a, b, c].map((p, i) => `worktree ${p}\nHEAD ${SHA('d')}\nbranch refs/heads/b${i}\n`).join('\n') },
    });
    const records = [
      { workspaceId: 'wt-aaaa', projectId: 'p1', cwd: a, branch: 'b0', baseRef: 'main', managed: true },
      { workspaceId: 'wt-bbbb', projectId: 'p1', cwd: b, branch: 'b1', baseRef: '', managed: false },
    ];
    const t = createWorktreeTree({ run: f.run, worktrees: { list: () => records }, homeDir: '/nohome' });
    const tree = await t.tree({ id: 'p1', path: path.join(os.tmpdir(), 'elsewhere') });
    const [na, nb, nc] = tree.nodes;
    assert.deepStrictEqual([na.kind, na.origin, na.workspaceId, na.id], ['managed', 'app', 'wt-aaaa', 'wt-aaaa']);
    assert.deepStrictEqual([nb.kind, nb.workspaceId], ['linked', 'wt-bbbb']);
    assert.deepStrictEqual([nc.kind, nc.workspaceId], ['external', null]);
  } finally {
    for (const p of [a, b, c]) fs.rmSync(p, { recursive: true, force: true });
  }
});

test('at most 4 git calls run at the same time', async () => {
  const paths = Array.from({ length: 12 }, (_, i) => `worktree ${os.tmpdir()}/w${i}\nHEAD ${SHA('e')}\nbranch refs/heads/w${i}\n`).join('\n');
  const f = fakeRun({ 'worktree list': { ok: true, stderr: '', stdout: paths } });
  const t = createWorktreeTree({ run: f.run, worktrees: noRecords });
  const tree = await t.tree({ id: 'p1', path: os.tmpdir() });
  assert.strictEqual(tree.nodes.length, 12);
  assert.ok(f.maxActive() <= 4, `max parallel was ${f.maxActive()}`);
  assert.ok(f.maxActive() >= 2, 'work should actually overlap');
});

test('result is cached for 10 s per project, invalidated by new records and by time', async () => {
  const f = fakeRun();
  let clock = 1000;
  let records = [];
  const t = createWorktreeTree({ run: f.run, worktrees: { list: () => records }, now: () => clock });
  const project = { id: 'p1', path: os.tmpdir() };
  const first = await t.tree(project);
  const n = f.calls.length;
  assert.deepStrictEqual(await t.tree(project), first);
  assert.strictEqual(f.calls.length, n);
  clock += 9999;
  assert.deepStrictEqual(await t.tree(project), first);
  clock += 2;
  const second = await t.tree(project);
  assert.notStrictEqual(second, first);
  assert.ok(f.calls.length > n);
  const m = f.calls.length;
  records = [{ workspaceId: 'wt-1111', projectId: 'p1', cwd: '/x', branch: 'q', baseRef: '', managed: false }];
  assert.notStrictEqual(await t.tree(project), second);
  assert.ok(f.calls.length > m);
  await t.tree({ id: 'p2', path: os.tmpdir() });
  const k = f.calls.length;
  t.invalidate('p1');
  await t.tree(project);
  assert.ok(f.calls.length > k);
});

test('every git call is an argv array with a timeout of at most 10 s', async () => {
  const seen = [];
  const f = fakeRun();
  const run = (args, cwd, timeout) => { seen.push({ args, timeout }); return f.run(args, cwd); };
  const t = createWorktreeTree({ run, worktrees: noRecords });
  await t.tree({ id: 'p1', path: os.tmpdir() });
  assert.ok(seen.length > 5);
  for (const s of seen) {
    assert.ok(Array.isArray(s.args));
    assert.ok(s.timeout > 0 && s.timeout <= 10000);
  }
});

test('branchOf returns the branch, or null for detached, errors and bad input', async () => {
  const mk = (reply) => createWorktreeTree({ run: async () => reply, worktrees: noRecords });
  assert.strictEqual(await mk({ ok: true, stdout: 'feature/x\n' }).branchOf('/w'), 'feature/x');
  assert.strictEqual(await mk({ ok: true, stdout: 'HEAD\n' }).branchOf('/w'), null);
  assert.strictEqual(await mk({ ok: false, stdout: '' }).branchOf('/w'), null);
  assert.strictEqual(await mk({ ok: true, stdout: 'x' }).branchOf(''), null);
  const thrower = createWorktreeTree({ run: async () => { throw new Error('x'); }, worktrees: noRecords });
  assert.strictEqual(await thrower.branchOf('/w'), null);
});

// ---- real temporary repository ---------------------------------------------

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

test('real repository: project, managed, external codex, merged and pruned worktrees', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-wtt-'));
  try {
    const root_ = fs.realpathSync(root);
    const repo = path.join(root_, 'repo');
    const home = path.join(root_, 'home');
    fs.mkdirSync(repo);
    fs.mkdirSync(path.join(home, '.codex', 'worktrees', '1580'), { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 't@example.com');
    git(repo, 'config', 'user.name', 'Test');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'eins\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'init');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'zwei\n');
    git(repo, 'commit', '-q', '-am', 'zweiter');
    git(repo, 'branch', 'merged-b', 'HEAD~1'); // already contained in main

    const svc = createWorktreeService({ dataDir: path.join(root_, 'data') });
    const project = { id: 'p1', path: repo };
    const created = await svc.create({ project, branch: 'feature/a' });
    assert.ok(created.ok, JSON.stringify(created));
    const wtA = created.worktree.cwd;
    fs.writeFileSync(path.join(wtA, 'b.txt'), 'neu\n');
    git(wtA, 'add', 'b.txt');
    git(wtA, 'commit', '-q', '-m', 'Feature-Commit');
    fs.writeFileSync(path.join(wtA, 'a.txt'), 'geändert\n');

    const codexDir = path.join(home, '.codex', 'worktrees', '1580', 'repo');
    git(repo, 'worktree', 'add', '-q', '-b', 'codex/job', codexDir);
    const mergedDir = path.join(root_, 'merged-wt');
    git(repo, 'worktree', 'add', '-q', mergedDir, 'merged-b');
    const goneDir = path.join(root_, 'gone-wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'gone', goneDir);
    fs.rmSync(goneDir, { recursive: true, force: true });

    const t = createWorktreeTree({ worktrees: svc, homeDir: home, appDir: path.join(root_, 'data', 'worktrees') });
    const tree = await t.tree(project);
    assert.strictEqual(tree.isGit, true);
    assert.strictEqual(tree.trunk.name, 'main');
    assert.strictEqual(tree.trunk.subject, 'zweiter');
    assert.strictEqual(tree.nodes.length, 5);
    const by = (b) => tree.nodes.find((n) => n.branch === b);

    const main = by('main');
    assert.deepStrictEqual([main.kind, main.ahead, main.behind, main.changes], ['project', 0, 0, 0]);

    const a = by('feature/a');
    assert.deepStrictEqual([a.kind, a.origin, a.workspaceId], ['managed', 'app', created.worktree.workspaceId]);
    assert.strictEqual(a.ahead, 1);
    assert.strictEqual(a.behind, 0);
    assert.strictEqual(a.merged, false);
    assert.strictEqual(a.changes, 1);
    assert.strictEqual(a.last.subject, 'Feature-Commit');
    assert.strictEqual(a.forkPoint, git(repo, 'rev-parse', 'main').trim());
    assert.strictEqual(a.missing, false);

    const cx = by('codex/job');
    assert.deepStrictEqual([cx.kind, cx.origin, cx.workspaceId], ['external', 'codex', null]);
    assert.strictEqual(cx.ahead, 0);
    assert.strictEqual(cx.merged, false, 'fresh branch on the trunk tip is not "merged"');

    const mg = by('merged-b');
    assert.strictEqual(mg.merged, true);
    assert.strictEqual(mg.behind, 1);
    assert.strictEqual(mg.ahead, 0);

    const gone = by('gone');
    assert.strictEqual(gone.prunable, true);
    assert.strictEqual(gone.missing, true);
    assert.strictEqual(gone.changes, null);
    assert.strictEqual(gone.ahead, null);

    // adopt turns the external copy into a linked one on the next (fresh) tree
    const adopted = await svc.adopt({ projectId: 'p1', cwd: codexDir, projectPath: repo });
    assert.ok(adopted.ok, JSON.stringify(adopted));
    const again = await t.tree(project);
    const cx2 = again.nodes.find((n) => n.branch === 'codex/job');
    assert.deepStrictEqual([cx2.kind, cx2.workspaceId], ['linked', adopted.workspace.workspaceId]);

    assert.strictEqual(await t.branchOf(wtA), 'feature/a');
    assert.strictEqual(await t.branchOf(repo), 'main');
    git(wtA, 'checkout', '-q', '--detach');
    assert.strictEqual(await t.branchOf(wtA), null);
    assert.strictEqual(await t.branchOf(path.join(root_, 'nonexistent')), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('real folder that is not a repository: isGit false', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-wtn-'));
  try {
    const t = createWorktreeTree({ worktrees: noRecords });
    const tree = await t.tree({ id: 'p1', path: dir });
    assert.strictEqual(tree.isGit, false);
    assert.deepStrictEqual(tree.nodes, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('forkTime comes from the fork point commit', async () => {
  const f = fakeRun({ 'log -1': (args) => (args.includes(SHA('0'))
    ? { ok: true, stdout: `${SHA('0')}\x00base\x0050\x00A\n`, stderr: '' }
    : { ok: true, stdout: `${SHA('a')}\x00s\x00100\x00A\n`, stderr: '' }) });
  const t = createWorktreeTree({ run: f.run, worktrees: noRecords });
  const tree = await t.tree({ id: 'p1', path: os.tmpdir() });
  assert.strictEqual(tree.nodes[1].forkTime, 50000);
});

test('classifyOrigin sees codex worktrees behind a symlinked home', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mt-home-')));
  try {
    const realHome = path.join(root, 'real-home');
    const wt = path.join(realHome, '.codex', 'worktrees', '1', 'repo');
    fs.mkdirSync(wt, { recursive: true });
    const linkHome = path.join(root, 'link-home');
    fs.symlinkSync(realHome, linkHome);
    const f = fakeRun({
      'worktree list': { ok: true, stdout: `worktree ${os.tmpdir()}\nHEAD ${SHA('a')}\nbranch refs/heads/main\n\nworktree ${wt}\nHEAD ${SHA('b')}\nbranch refs/heads/cx\n`, stderr: '' },
    });
    const t = createWorktreeTree({ run: f.run, worktrees: noRecords, homeDir: linkHome });
    const tree = await t.tree({ id: 'p1', path: os.tmpdir() });
    assert.strictEqual(tree.nodes[1].origin, 'codex');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('concurrent identical requests share one run and get independent copies', async () => {
  const f = fakeRun();
  const t = createWorktreeTree({ run: f.run, worktrees: noRecords });
  const proj = { id: 'p1', path: os.tmpdir() };
  const [a, b] = await Promise.all([t.tree(proj), t.tree(proj)]);
  const gitCalls = f.calls.filter((c) => c.args[0] === 'rev-parse' && c.args[1] === '--is-inside-work-tree').length;
  assert.strictEqual(gitCalls, 1);
  assert.deepStrictEqual(a, b);
  assert.notStrictEqual(a, b);
  a.nodes[0].branch = 'mutated';
  const c = await t.tree(proj);
  assert.notStrictEqual(c.nodes[0].branch, 'mutated');
  assert.ok(f.maxActive() <= 4);
});

test('force bypasses the cache so freshly changed counts show up', async () => {
  const f = fakeRun();
  const t = createWorktreeTree({ run: f.run, worktrees: noRecords, homeDir: '/nohome' });
  await t.tree({ id: 'p1', path: os.tmpdir() });
  const before = f.calls.length;
  await t.tree({ id: 'p1', path: os.tmpdir() });
  assert.strictEqual(f.calls.length, before, 'second call is served from cache');
  await t.tree({ id: 'p1', path: os.tmpdir() }, { force: true });
  assert.ok(f.calls.length > before, 'force reads git again');
});
