'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createDiffService, parseStatus, parseDiff, MAX_LINES } = require('../src/main/diff-service');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-diff-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'qa@example.invalid');
  g('config', 'user.name', 'QA');
  return { dir, g, write: (f, c) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); } };
}
const snapshot = (dir) => execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: dir }).toString();

test('parseStatus: rename carries the old path, ignored entries are skipped', () => {
  const files = parseStatus('R  neu.txt\0alt.txt\0 M a b.txt\0?? x.png\0!! build\0');
  assert.deepEqual(files.map((f) => [f.path, f.oldPath, f.staged, f.unstaged, f.untracked]), [
    ['neu.txt', 'alt.txt', true, false, false],
    ['a b.txt', null, false, true, false],
    ['x.png', null, false, false, true],
  ]);
});

test('parseDiff numbers old and new lines and recognises binary diffs', () => {
  const d = parseDiff('diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -2,2 +2,3 @@ ctx\n a\n-b\n+c\n+d\n\\ No newline at end of file\n');
  assert.equal(d.hunks.length, 1);
  assert.deepEqual(d.hunks[0].lines.map((l) => [l.type, l.oldNo, l.newNo, l.text]), [
    [' ', 2, 2, 'a'], ['-', 3, null, 'b'], ['+', null, 3, 'c'], ['+', null, 4, 'd'], ['\\', null, null, '\\ No newline at end of file'],
  ]);
  assert.equal(parseDiff('Binary files a/x.png and b/x.png differ\n').binary, true);
});

test('lists staged, unstaged, untracked, renamed and deleted files without changing the repo', async () => {
  const r = repo();
  r.write('a b.txt', 'eins\nzwei\n'); r.write('alt.txt', 'x\n'); r.write('weg.txt', 'y\n'); r.write('ü/größe.txt', 'ä\n');
  r.g('add', '-A'); r.g('commit', '-qm', 'start');
  r.write('a b.txt', 'eins\nZWEI\n');                       // unstaged
  r.write('ü/größe.txt', 'ä\nö\n'); r.g('add', 'ü/größe.txt'); // staged
  r.g('mv', 'alt.txt', 'neu.txt');                           // renamed (staged)
  fs.unlinkSync(path.join(r.dir, 'weg.txt'));                // deleted (unstaged)
  r.write('neu/datei.md', 'hallo\n');                        // untracked
  const before = snapshot(r.dir);
  const svc = createDiffService();
  const list = await svc.listChanges(r.dir);
  assert.equal(list.ok, true);
  assert.equal(list.branch, 'main');
  const by = Object.fromEntries(list.files.map((f) => [f.path, f]));
  assert.equal(by['a b.txt'].unstaged, true);
  assert.equal(by['ü/größe.txt'].staged, true);
  assert.equal(by['neu.txt'].oldPath, 'alt.txt');
  assert.equal(by['weg.txt'].worktree, 'D');
  assert.equal(by['neu/datei.md'].untracked, true);

  const un = await svc.fileDiff(r.dir, 'a b.txt', 'unstaged');
  assert.equal(un.compare, 'Arbeitsbaum gegen Index');
  assert.deepEqual(un.hunks[0].lines.filter((l) => l.type !== ' ').map((l) => l.type + l.text), ['-zwei', '+ZWEI']);
  const st = await svc.fileDiff(r.dir, 'ü/größe.txt', 'staged');
  assert.equal(st.compare, 'Index gegen HEAD');
  assert.ok(st.hunks[0].lines.some((l) => l.type === '+' && l.text === 'ö'));
  const ren = await svc.fileDiff(r.dir, 'neu.txt', 'staged');
  assert.equal(ren.ok, true); assert.equal(ren.oldPath, 'alt.txt'); assert.equal(ren.empty, true);
  const del = await svc.fileDiff(r.dir, 'weg.txt', 'unstaged');
  assert.deepEqual(del.hunks[0].lines.map((l) => l.type + l.text), ['-y']);
  const nw = await svc.fileDiff(r.dir, 'neu/datei.md', 'untracked');
  assert.equal(nw.ok, true); assert.deepEqual(nw.hunks[0].lines.map((l) => [l.type, l.newNo]), [['+', 1]]);
  assert.equal(snapshot(r.dir), before, 'reading diffs must not touch index or worktree');
});

test('binary files, empty repos, wrong modes and unknown paths', async () => {
  const r = repo();
  const svc = createDiffService();
  assert.deepEqual((await svc.listChanges(r.dir)).files, []);                 // empty repo, no HEAD
  r.write('bild.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3]));
  r.g('add', 'bild.png');
  const bin = await svc.fileDiff(r.dir, 'bild.png', 'staged');
  assert.equal(bin.binary, true); assert.equal(bin.compare, 'Index (noch kein Commit)');
  assert.equal((await svc.fileDiff(r.dir, 'bild.png', 'unstaged')).gone, true);
  assert.equal((await svc.fileDiff(r.dir, '../../etc/passwd', 'unstaged')).ok, false);
  assert.equal((await svc.fileDiff(r.dir, 'bild.png', 'rm -rf')).ok, false);
});

test('a folder outside Git gives a clear message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-nogit-'));
  const res = await createDiffService().listChanges(dir);
  assert.equal(res.ok, false); assert.equal(res.notRepo, true);
});

test('large diffs are cut at whole lines and flagged', async () => {
  const r = repo();
  r.write('gross.txt', '');
  r.g('add', '-A'); r.g('commit', '-qm', 'start');
  r.write('gross.txt', Array.from({ length: MAX_LINES + 50 }, (_, i) => 'zeile ' + i).join('\n') + '\n');
  const d = await createDiffService().fileDiff(r.dir, 'gross.txt', 'unstaged');
  assert.equal(d.truncated, true);
  const lines = d.hunks.flatMap((h) => h.lines);
  assert.ok(lines.length < MAX_LINES);
  assert.ok(lines.every((l) => /^zeile \d+$/.test(l.text)));
});
