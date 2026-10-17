'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs, checkTarget, buildStaging, guardScan, syncTarget, exportEdition } = require('../scripts/export');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const write = (root, rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mt-export-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), target = path.join(root, 'public');
  fs.mkdirSync(source); fs.mkdirSync(path.join(source, 'node_modules'));
  git(source, 'init', '-b', 'main'); git(source, 'config', 'user.name', 'Export Test'); git(source, 'config', 'user.email', 'export@example.invalid');
  const base = { devOnly: ['scripts/export-manifest.json', 'export/', 'private.txt'], internal: ['INTERNAL.md'], stripLines: { 'index.html': 'dev-only' }, publicEdition: { edition: 'public', appName: 'Multiterminal', bundleId: 'io.github.multiterminal' }, overlay: 'export/overlay' };
  write(source, 'scripts/export-manifest.json', JSON.stringify(base));
  write(source, 'export/manifest.json', JSON.stringify({ exclude: [], forbidden: ['private-person'] }));
  write(source, 'export/overlay/README.md', 'Public README\n');
  write(source, 'export/overlay/LICENSE', 'MIT\n');
  write(source, '.gitignore', 'node_modules/\ndist/\n');
  write(source, 'package.json', JSON.stringify({ name: 'private-app', version: '1.0.0', scripts: { test: 'node --test tests/*.js' }, author: 'private-person' }));
  write(source, 'package-lock.json', JSON.stringify({ name: 'private-app', packages: { '': { name: 'private-app', version: '1.0.0' } } }));
  write(source, 'tests/smoke.js', "require('node:assert/strict').equal(require('../edition.json').edition, 'public');\n");
  write(source, 'index.html', '<script src="private.js"></script> <!-- dev-only -->\n<main>Public</main>\n');
  write(source, 'private.txt', 'private-person'); write(source, 'INTERNAL.md', 'private-person');
  write(source, 'keep.txt', 'committed\n');
  const commit = () => { git(source, 'add', '-A'); git(source, 'commit', '-m', 'fixture'); return git(source, 'rev-parse', 'HEAD'); };
  commit();
  return { root, source, target, base, commit };
}

test('CLI supports defaults, exact refs and rejects incomplete or unknown flags', () => {
  assert.equal(parseArgs([]).dryRun, false);
  assert.equal(parseArgs(['--ref', 'HEAD~1', '--dry-run']).ref, 'HEAD~1');
  assert.throws(() => parseArgs(['--target']), /Wert/);
  assert.throws(() => parseArgs(['--ref', '--dry-run']), /Wert/);
  assert.throws(() => parseArgs(['--unknown']), /Unbekannt/);
});

test('staging excludes developer/internal files, overlays docs, strips tags and updates package plus lock', async t => {
  const f = fixture(t), staging = path.join(f.root, 'stage'); fs.mkdirSync(staging);
  // buildStaging operates on archive contents, which have no .git or node_modules.
  const snapshot = path.join(f.root, 'snapshot'); fs.mkdirSync(snapshot);
  for (const rel of git(f.source, 'ls-files').split('\n')) write(snapshot, rel, fs.readFileSync(path.join(f.source, rel)));
  const files = await buildStaging({ source: snapshot, staging, manifest: f.base, onWarn() {} });
  assert.ok(!files.includes('private.txt')); assert.ok(!files.includes('INTERNAL.md'));
  assert.equal(fs.readFileSync(path.join(staging, 'README.md'), 'utf8'), 'Public README\n');
  assert.equal(fs.readFileSync(path.join(staging, 'index.html'), 'utf8'), '<main>Public</main>\n');
  const pkg = JSON.parse(fs.readFileSync(path.join(staging, 'package.json')));
  assert.equal(pkg.name, 'multiterminal'); assert.equal(pkg.author, undefined); assert.equal(pkg.scripts.release, 'node scripts/release.js');
  assert.equal(pkg.license, 'MIT'); assert.equal(pkg.private, true);
  const lock = JSON.parse(fs.readFileSync(path.join(staging, 'package-lock.json')));
  assert.equal(lock.name, pkg.name); assert.equal(lock.packages[''].name, pkg.name); assert.equal(lock.packages[''].license, 'MIT');
});

test('privacy scans paths and all content including large binary files', t => {
  const f = fixture(t), root = path.join(f.root, 'scan'); fs.mkdirSync(root);
  write(root, 'private-person.txt', 'fine');
  write(root, 'large.bin', Buffer.concat([Buffer.alloc(9 * 1024 * 1024), Buffer.from('\nPRIVATE-PERSON')]));
  const hits = guardScan(root, ['private-person.txt', 'large.bin'], ['private-person']);
  assert.equal(hits.length, 2); assert.match(hits[1], /large.bin:2/);
});

test('sync preserves .git, removes stale files and never follows target symlinks even in dry run', t => {
  const f = fixture(t), staging = path.join(f.root, 'stage'), outside = path.join(f.root, 'outside');
  fs.mkdirSync(staging); fs.mkdirSync(outside); fs.mkdirSync(f.target);
  write(outside, 'keep.txt', 'untouched'); write(f.target, '.git/sentinel', 'history'); write(f.target, 'stale.txt', 'remove');
  fs.symlinkSync(outside, path.join(f.target, 'nested'));
  write(staging, 'nested/keep.txt', 'replacement');
  const opts = { staging, files: ['nested/keep.txt'], target: f.target, keep: ['.git'], apply: false };
  syncTarget(opts); assert.equal(fs.lstatSync(path.join(f.target, 'nested')).isSymbolicLink(), true);
  syncTarget({ ...opts, apply: true });
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'untouched');
  assert.equal(fs.readFileSync(path.join(f.target, '.git/sentinel'), 'utf8'), 'history');
  assert.equal(fs.existsSync(path.join(f.target, 'stale.txt')), false);
  assert.equal(fs.readFileSync(path.join(f.target, 'nested/keep.txt'), 'utf8'), 'replacement');
  fs.linkSync(path.join(outside, 'keep.txt'), path.join(f.target, 'hardlink.txt'));
  write(staging, 'hardlink.txt', 'new content');
  syncTarget({ ...opts, files: ['nested/keep.txt', 'hardlink.txt'], apply: true });
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'untouched');
  assert.equal(fs.readFileSync(path.join(f.target, 'hardlink.txt'), 'utf8'), 'new content');
  assert.throws(() => syncTarget({ ...opts, files: ['../escape'] }), /Unsicher/);
});

test('target checks reject source ancestors, descendants, unrelated repositories and symlink aliases', t => {
  const f = fixture(t);
  for (const target of [f.source, f.root, path.join(f.source, 'nested'), path.join(f.source, '..nested')]) assert.throws(() => checkTarget(target, f.source));
  fs.mkdirSync(f.target); write(f.target, '.git/marker', 'unrelated');
  assert.throws(() => checkTarget(f.target, f.source), /kein öffentliches/);
  const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.target, alias);
  assert.throws(() => checkTarget(alias, f.source), /Symlink/);
});

test('probe tests committed public snapshot and leaves target absent; explicit ref ignores dirty worktree', async t => {
  const f = fixture(t), sha = git(f.source, 'rev-parse', 'HEAD');
  const opts = { source: f.source, target: f.target, dryRun: true };
  const result = await exportEdition(opts); t.after(() => fs.rmSync(result.staging, { recursive: true, force: true }));
  assert.equal(fs.existsSync(f.target), false); assert.equal(result.sha, sha);
  assert.equal(fs.existsSync(path.join(result.staging, 'node_modules')), false);
  write(f.source, 'keep.txt', 'dirty private-person');
  await assert.rejects(exportEdition(opts), /Nicht committierte/);
  const exact = await exportEdition({ ...opts, ref: sha }); t.after(() => fs.rmSync(exact.staging, { recursive: true, force: true }));
  assert.equal(fs.readFileSync(path.join(exact.staging, 'keep.txt'), 'utf8'), 'committed\n');
});

test('guard and failing public tests abort before target creation', async t => {
  const f = fixture(t);
  write(f.source, 'leak.txt', 'private-person'); f.commit();
  await assert.rejects(exportEdition({ source: f.source, target: f.target, dryRun: true }), /Wächter/);
  assert.equal(fs.existsSync(f.target), false);
  fs.unlinkSync(path.join(f.source, 'leak.txt'));
  write(f.source, 'tests/smoke.js', "require('node:assert/strict').fail('fixture failure');"); f.commit();
  await assert.rejects(exportEdition({ source: f.source, target: f.target }), /Exporttests fehlgeschlagen/);
  assert.equal(fs.existsSync(f.target), false);
});

test('Git archive rejects symlinks before extraction', async t => {
  const f = fixture(t); fs.symlinkSync('/etc/passwd', path.join(f.source, 'unsafe')); f.commit();
  await assert.rejects(exportEdition({ source: f.source, target: f.target, dryRun: true }), /Nicht unterstützter Git-Eintrag/);
  assert.equal(fs.existsSync(f.target), false);
});

test('real temporary exports create fresh history, preserve .git, remove old files and refuse dirty targets', async t => {
  const f = fixture(t), opts = { source: f.source, target: f.target };
  const first = await exportEdition(opts);
  const firstCommit = git(f.target, 'rev-parse', 'HEAD');
  assert.equal(git(f.target, 'rev-list', '--count', 'HEAD'), '1');
  assert.match(git(f.target, 'log', '-1', '--format=%s'), new RegExp(first.sha.slice(0, 12)));
  assert.equal(git(f.target, 'status', '--porcelain'), '');
  const config = fs.readFileSync(path.join(f.target, '.git/config'));
  await exportEdition(opts); assert.equal(git(f.target, 'rev-parse', 'HEAD'), firstCommit);
  write(f.target, 'keep.txt', 'local work');
  await assert.rejects(exportEdition(opts), /ungesicherte Änderungen/);
  assert.equal(fs.readFileSync(path.join(f.target, 'keep.txt'), 'utf8'), 'local work');
  git(f.target, 'restore', 'keep.txt');
  fs.unlinkSync(path.join(f.source, 'keep.txt')); f.commit();
  await exportEdition(opts);
  assert.equal(fs.existsSync(path.join(f.target, 'keep.txt')), false);
  assert.equal(fs.readFileSync(path.join(f.target, '.git/config')).equals(config), true);
  assert.equal(git(f.target, 'rev-list', '--count', 'HEAD'), '2');
});

test('fresh export commits with source-local identity when global and system Git config are absent', async t => {
  const keys = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.GIT_CONFIG_GLOBAL = '/dev/null'; process.env.GIT_CONFIG_NOSYSTEM = '1';
    const f = fixture(t);
    await exportEdition({ source: f.source, target: f.target });
    assert.equal(git(f.target, 'log', '-1', '--format=%an <%ae>'), 'Export Test <export@example.invalid>');
    assert.equal(git(f.target, 'status', '--porcelain'), '');
    write(f.source, 'keep.txt', 'second export'); f.commit();
    await exportEdition({ source: f.source, target: f.target });
    assert.equal(git(f.target, 'rev-list', '--count', 'HEAD'), '2');
    assert.equal(fs.readFileSync(path.join(f.target, 'keep.txt'), 'utf8'), 'second export');
    git(f.target, 'config', 'user.name', 'Target Author'); git(f.target, 'config', 'user.email', 'target@example.invalid');
    write(f.source, 'keep.txt', 'third export'); f.commit();
    await exportEdition({ source: f.source, target: f.target });
    assert.equal(git(f.target, 'log', '-1', '--format=%an <%ae>'), 'Target Author <target@example.invalid>');
  } finally {
    for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
  }
});
