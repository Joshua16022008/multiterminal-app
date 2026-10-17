'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createGitService, parseStatus, normalizeRemote, REPO_NAME } = require('../src/main/git-service');

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
}

// A bare "GitHub" repository plus two working copies of it.
function setup() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mt-git-')));
  const remote = path.join(root, 'remote.git');
  const mine = path.join(root, 'mine');
  const other = path.join(root, 'other');
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['clone', '--quiet', remote, mine], { stdio: 'ignore' });
  fs.writeFileSync(path.join(mine, 'a.txt'), 'eins\n');
  git(mine, 'add', '-A');
  git(mine, 'commit', '--quiet', '-m', 'erster');
  git(mine, 'push', '--quiet', '-u', 'origin', 'HEAD:main');
  execFileSync('git', ['clone', '--quiet', remote, other], { stdio: 'ignore' });
  return { root, mine, other, service: createGitService({ cloneDir: root }) };
}

function commitIn(dir, file, text) {
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', `ändert ${file}`);
}

test('parseStatus reads branch, upstream, ahead/behind and changes', () => {
  const out = '# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -3\n1 .M N... 100644 100644 100644 a b x.txt\n? neu.txt\n';
  assert.deepStrictEqual(parseStatus(out), { isRepo: true, branch: 'main', hasUpstream: true, ahead: 2, behind: 3, changes: 2 });
  assert.strictEqual(parseStatus('# branch.head (detached)\n').branch, null);
});

test('normalizeRemote treats https, ssh and .git alike', () => {
  for (const url of ['https://github.com/Foo/Bar.git', 'git@github.com:foo/bar.git', 'https://user@github.com/foo/bar/']) {
    assert.strictEqual(normalizeRemote(url), 'github.com/foo/bar');
  }
});

test('REPO_NAME rejects anything that is not owner/name', () => {
  assert.ok(REPO_NAME.test('Nutzer2008/multiterminal-app'));
  for (const bad of ['foo', '../x/y', 'a/b/c', 'a/b c', '-o/--upload-pack=x y', '']) assert.ok(!REPO_NAME.test(bad), bad);
});

test('status reports a folder that is not a repository', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-plain-'));
  assert.strictEqual((await createGitService({ cloneDir: dir }).status(dir)).isRepo, false);
});

test('status counts local changes', async () => {
  const { mine, service } = setup();
  fs.writeFileSync(path.join(mine, 'neu.txt'), 'x');
  const s = await service.status(mine);
  assert.strictEqual(s.branch, 'main');
  assert.strictEqual(s.changes, 1);
  assert.strictEqual(s.hasUpstream, true);
});

test('pull fast-forwards and keeps uncommitted work', async () => {
  const { mine, other, service } = setup();
  commitIn(other, 'b.txt', 'zwei\n');
  git(other, 'push', '--quiet');
  fs.writeFileSync(path.join(mine, 'offen.txt'), 'nicht committet');
  const r = await service.pull(mine);
  assert.strictEqual(r.pulled, true);
  assert.strictEqual(r.message, null);
  assert.ok(fs.existsSync(path.join(mine, 'b.txt')));
  assert.strictEqual(fs.readFileSync(path.join(mine, 'offen.txt'), 'utf8'), 'nicht committet');
});

test('pull does nothing and explains when histories diverged', async () => {
  const { mine, other, service } = setup();
  commitIn(other, 'b.txt', 'zwei\n');
  git(other, 'push', '--quiet');
  commitIn(mine, 'c.txt', 'drei\n');
  const head = git(mine, 'rev-parse', 'HEAD');
  const r = await service.pull(mine);
  assert.strictEqual(r.pulled, false);
  assert.match(r.message, /unterschiedliche Commits/);
  assert.strictEqual(git(mine, 'rev-parse', 'HEAD'), head);
});

test('sync pushes local commits but never commits open changes', async () => {
  const { mine, other, service } = setup();
  commitIn(mine, 'c.txt', 'drei\n');
  fs.writeFileSync(path.join(mine, 'offen.txt'), 'bleibt lokal');
  const r = await service.sync(mine);
  assert.strictEqual(r.pushed, true);
  assert.strictEqual(r.ahead, 0);
  assert.strictEqual(r.changes, 1);
  git(other, 'pull', '--quiet');
  assert.ok(fs.existsSync(path.join(other, 'c.txt')));
  assert.ok(!fs.existsSync(path.join(other, 'offen.txt')));
});

test('sync does not push when the pull was refused', async () => {
  const { mine, other, service } = setup();
  commitIn(other, 'b.txt', 'zwei\n');
  git(other, 'push', '--quiet');
  commitIn(mine, 'c.txt', 'drei\n');
  const r = await service.sync(mine);
  assert.strictEqual(r.pushed, false);
  assert.ok(r.message);
});

test('cloneRepo rejects invalid names before running anything', async () => {
  const { service } = setup();
  await assert.rejects(service.cloneRepo('../../etc'), /Ungültiger Repo-Name/);
  await assert.rejects(service.cloneRepo('--upload-pack=x/y'), /Ungültiger Repo-Name/);
});
