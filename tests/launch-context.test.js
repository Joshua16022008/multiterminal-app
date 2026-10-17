'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createWorktreeService } = require('../src/main/worktree-service');
const { createLaunchContextService } = require('../src/main/launch-context');

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'original');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'README.md'), 'committed project documentation');
  fs.writeFileSync(path.join(repo, 'WORK_IN_PROGRESS.md'), 'historical ledger');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'initial');
  const project = { id: 'test', name: 'Example', path: repo };
  const dataDir = path.join(root, 'data');
  const worktrees = createWorktreeService({ dataDir });
  const first = await worktrees.create({ project, branch: 'feature/one' });
  const second = await worktrees.create({ project, branch: 'feature/two' });
  assert.ok(first.ok && second.ok);
  const service = createLaunchContextService({ dataDir, worktrees });
  return { root, repo, project, dataDir, worktrees, first: first.worktree, second: second.worktree, service };
}

test('two worktrees use their actual branches and own documents plus separate fresh original ledger', async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.repo, 'README.md'), 'UNCOMMITTED MAIN CONTENT');
  fs.writeFileSync(path.join(f.repo, 'ignored.txt'), 'IGNORED MAIN SECRET');
  fs.writeFileSync(path.join(f.repo, '.env'), 'ENV SECRET');
  fs.writeFileSync(path.join(f.repo, 'WORK_IN_PROGRESS.md'), 'CURRENT CENTRAL RESERVATION');
  for (const rec of [f.first, f.second]) {
    const p = await f.service.preview({ project: f.project, workspaceId: rec.workspaceId, task: 'Implement a feature', scope: 'One file', acceptance: 'Check result' });
    assert.ok(p.ok, p.error);
    assert.equal(p.cwd, rec.cwd);
    assert.equal(p.branch, rec.branch);
    assert.equal(p.head, git(rec.cwd, 'rev-parse', 'HEAD'));
    assert.match(p.text, /committed project documentation/);
    assert.match(p.text, /CURRENT CENTRAL RESERVATION/);
    assert.ok(p.text.includes(`Quelle: ${path.join(fs.realpathSync(f.repo), 'WORK_IN_PROGRESS.md')}`));
    assert.match(p.text, /Gelesen: \d{4}-/);
    assert.doesNotMatch(p.text, /UNCOMMITTED MAIN CONTENT|IGNORED MAIN SECRET|ENV SECRET|historical ledger/);
    assert.match(p.text, /One file/);
    assert.match(p.text, /Keine automatischen Merges/);
    assert.match(p.text, /AGENTS\.md und CLAUDE\.md im gewählten cwd vollständig/);
    assert.match(p.text, /Auszüge können gekürzt sein/);
    assert.equal(p.warnings.some((warning) => /AGENTS\.md|CLAUDE\.md|PLAN\.md/.test(warning)), false);
    assert.match(p.text, /### AGENTS\.md[\s\S]*Nicht eingebunden/);
    assert.ok(p.warnings.some((warning) => warning.includes('nicht in die gewählte Arbeitskopie übernommen')));
    assert.equal(fs.existsSync(path.join(rec.cwd, 'ignored.txt')), false);
  }
  git(f.first.cwd, 'switch', '-c', 'actual-new-branch');
  const actual = await f.service.preview({ project: f.project, workspaceId: f.first.workspaceId, task: 'Work' });
  assert.equal(actual.branch, 'actual-new-branch');
});

test('missing worktrees fail with no project-folder fallback and no context file', async (t) => {
  const f = await fixture(t);
  fs.rmSync(f.first.cwd, { recursive: true });
  const p = await f.service.preview({ project: f.project, workspaceId: f.first.workspaceId, task: 'Work' });
  assert.equal(p.ok, false);
  assert.equal(fs.existsSync(path.join(f.dataDir, 'launch-contexts')), false);
});

test('prepare revalidates HEAD and cwd; failure creates no context', async (t) => {
  const f = await fixture(t);
  const p = await f.service.preview({ project: f.project, workspaceId: f.first.workspaceId, task: 'Work' });
  const args = { project: f.project, workspaceId: f.first.workspaceId, provider: 'codex', text: p.text, expectedCwd: p.cwd, expectedHead: p.head, expectedBranch: p.branch };
  assert.equal((await f.service.prepare({ ...args, expectedCwd: f.second.cwd })).ok, false);
  git(f.first.cwd, 'commit', '--allow-empty', '-qm', 'new head');
  assert.equal((await f.service.prepare(args)).ok, false);
  assert.equal(fs.existsSync(path.join(f.dataDir, 'launch-contexts')), false);
  const fresh = await f.service.preview({ project: f.project, workspaceId: f.first.workspaceId, task: 'Work' });
  const result = await f.service.prepare({ ...args, expectedHead: fresh.head });
  assert.ok(result.ok, result.error);
  assert.equal(fs.statSync(result.contextPath).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(result.contextPath, 'utf8'), p.text);
  assert.equal(path.dirname(result.contextPath), path.join(f.dataDir, 'launch-contexts'));
});

test('rejects invalid providers, control characters, lengths and absent expected identity before writing', async (t) => {
  const f = await fixture(t);
  const p = await f.service.preview({ project: f.project, task: 'Work' });
  const args = { project: f.project, provider: 'claude', text: p.text, expectedCwd: p.cwd, expectedHead: p.head, expectedBranch: p.branch };
  for (const provider of ['kimi', 'bash', 'claude; touch /tmp/no', null]) assert.equal((await f.service.prepare({ ...args, provider })).ok, false);
  for (const text of ['', 'x'.repeat(60001), 'hello\x1bworld']) assert.equal((await f.service.prepare({ ...args, text })).ok, false);
  assert.equal((await f.service.prepare({ ...args, expectedHead: undefined })).ok, false);
  assert.equal((await f.service.prepare({ ...args, expectedBranch: undefined })).ok, false);
  for (const task of ['', ' ', 'x'.repeat(4001), 'a\x00b']) assert.equal((await f.service.preview({ project: f.project, task })).ok, false);
  assert.equal(fs.existsSync(path.join(f.dataDir, 'launch-contexts')), false);
});

test('bounded document reads skip symlinks and special files and mark truncation and dirty work', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  fs.writeFileSync(outside, 'ESCAPED SECRET');
  fs.symlinkSync(outside, path.join(f.first.cwd, 'AGENTS.md'));
  fs.writeFileSync(path.join(f.first.cwd, 'README.md'), 'x'.repeat(100000));
  execFileSync('mkfifo', [path.join(f.first.cwd, 'PLAN.md')]);
  const p = await f.service.preview({ project: f.project, workspaceId: f.first.workspaceId, task: 'Work' });
  assert.ok(p.ok, p.error);
  assert.doesNotMatch(p.text, /ESCAPED SECRET/);
  assert.match(p.text, /GEKÜRZT/);
  assert.ok(p.text.length < 60000);
  assert.ok(p.warnings.some((w) => w.includes('AGENTS.md')));
  assert.ok(p.warnings.some((w) => w.includes('PLAN.md')));
  assert.ok(p.warnings.some((w) => w.includes('ungesicherte')));
});

test('adversarial paths and task text remain literal and decoration applies to bare provider', async (t) => {
  const f = await fixture(t);
  const dataDir = path.join(f.root, "space ' $(touch PWNED) `touch PWNED2`");
  const calls = [];
  const service = createLaunchContextService({ dataDir, worktrees: f.worktrees, decorateCommand: ({ command }) => { calls.push(command); return `${command} --profile custom`; } });
  const p = await service.preview({ project: f.project, task: '$(touch TASK_PWNED); `touch TASK2`' });
  const r = await service.prepare({ project: f.project, provider: 'claude', text: p.text, expectedCwd: p.cwd, expectedHead: p.head, expectedBranch: p.branch });
  assert.ok(r.ok, r.error);
  assert.deepEqual(calls, ['claude']);
  assert.ok(r.command.length <= 2000);
  assert.doesNotMatch(r.command, /TASK_PWNED|[\r\n]/);
  // Execute only a harmless shell function to inspect parsed arguments.
  const parsed = execFileSync('/bin/sh', ['-c', `claude() { printf '%s\\n' "$@"; }; ${r.command}`], { cwd: f.root, encoding: 'utf8' });
  assert.ok(parsed.includes(r.contextPath));
  for (const name of ['PWNED', 'PWNED2', 'TASK_PWNED', 'TASK2']) assert.equal(fs.existsSync(path.join(f.root, name)), false);
  const second = await service.prepare({ project: f.project, provider: 'codex', text: p.text, expectedCwd: p.cwd, expectedHead: p.head, expectedBranch: p.branch });
  assert.ok(second.ok);
  assert.notEqual(second.contextPath, r.contextPath);
});

test('plain nonGit project supports explicit null HEAD', async (t) => {
  const f = await fixture(t);
  const plain = path.join(f.root, 'plain');
  fs.mkdirSync(plain);
  const project = { id: 'plain', name: 'Plain', path: plain };
  const p = await f.service.preview({ project, task: 'Work' });
  assert.ok(p.ok, p.error);
  assert.equal(p.head, null);
  assert.equal(p.branch, null);
  assert.equal(p.isGit, false);
  const r = await f.service.prepare({ project, provider: 'codex', text: p.text, expectedCwd: p.cwd, expectedHead: null, expectedBranch: null });
  assert.ok(r.ok, r.error);
});

test('invalid decorated commands and a symlinked context directory cannot write a context', async (t) => {
  const f = await fixture(t);
  const p = await f.service.preview({ project: f.project, task: 'Work' });
  const args = { project: f.project, provider: 'claude', text: p.text, expectedCwd: p.cwd, expectedHead: p.head, expectedBranch: p.branch };
  for (const command of ['claude\nextra', 'c'.repeat(2001), null]) {
    const service = createLaunchContextService({ dataDir: f.dataDir, worktrees: f.worktrees, decorateCommand: () => command });
    assert.equal((await service.prepare(args)).ok, false);
    assert.equal(fs.existsSync(path.join(f.dataDir, 'launch-contexts')), false);
  }
  const outside = path.join(f.root, 'external-contexts');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.dataDir, 'launch-contexts'));
  assert.equal((await f.service.prepare(args)).ok, false);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('switching branches at the same HEAD requires a fresh preview', async (t) => {
  const f = await fixture(t);
  const p = await f.service.preview({ project: f.project, workspaceId: f.first.workspaceId, task: 'Work' });
  git(f.first.cwd, 'switch', '-c', 'same-head-new-branch');
  assert.equal(git(f.first.cwd, 'rev-parse', 'HEAD'), p.head);
  const args = { project: f.project, workspaceId: f.first.workspaceId, provider: 'codex', text: p.text, expectedCwd: p.cwd, expectedHead: p.head, expectedBranch: p.branch };
  const stale = await f.service.prepare(args);
  assert.equal(stale.ok, false);
  assert.match(stale.error, /Branch/);
  assert.equal(fs.existsSync(path.join(f.dataDir, 'launch-contexts')), false);
  const fresh = await f.service.preview({ project: f.project, workspaceId: f.first.workspaceId, task: 'Work' });
  assert.equal(fresh.branch, 'same-head-new-branch');
  assert.ok((await f.service.prepare({ ...args, text: fresh.text, expectedBranch: fresh.branch })).ok);
});

test('initialized Git project without a commit previews its symbolic branch and guards first commit', async (t) => {
  const f = await fixture(t);
  const repo = path.join(f.root, 'unborn');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'first-branch');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'WORK_IN_PROGRESS.md'), 'current ledger');
  const project = { id: 'unborn', name: 'Fresh project', path: repo };
  const p = await f.service.preview({ project, task: 'Start project' });
  assert.ok(p.ok, p.error);
  assert.equal(p.isGit, true);
  assert.equal(p.branch, 'first-branch');
  assert.equal(p.head, null);
  assert.match(p.text, /HEAD: \(noch kein Commit\)/);
  assert.equal(p.warnings.some((warning) => warning.includes('Projekt ohne Git')), false);
  assert.equal(p.warnings.some((warning) => /AGENTS\.md|CLAUDE\.md|README\.md|PLAN\.md|PROGRESS\.md/.test(warning)), false);
  const args = { project, provider: 'codex', text: p.text, expectedCwd: p.cwd, expectedHead: null, expectedBranch: p.branch };
  assert.ok((await f.service.prepare(args)).ok);
  git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/renamed-before-commit');
  assert.equal((await f.service.prepare(args)).ok, false);
  git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/first-branch');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'first');
  assert.equal((await f.service.prepare(args)).ok, false);
});
