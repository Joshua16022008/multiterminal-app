'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { slugify, seedFiles } = require('../src/main/project-seed');
const { createGitService } = require('../src/main/git-service');

function tmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mt-seed-')));
}

test('slugify: Leerzeichen werden zu Bindestrichen, Unbrauchbares wird abgelehnt', () => {
  assert.strictEqual(slugify('  Mein Projekt  '), 'Mein-Projekt');
  assert.strictEqual(slugify('app_v2.0'), 'app_v2.0');
  for (const bad of ['', '   ', '.versteckt', '..', 'a/b', 'a\\b', 'Größe', 'x'.repeat(101), null, 42]) {
    assert.strictEqual(slugify(bad), null, `sollte abgelehnt werden: ${String(bad)}`);
  }
});

test('seedFiles: CLAUDE.md und AGENTS.md tragen dieselbe Planungsanweisung, PLAN.md ist die Vorlage', () => {
  const files = seedFiles('Demo');
  assert.deepStrictEqual(Object.keys(files).sort(), ['AGENTS.md', 'CLAUDE.md', 'PLAN.md']);
  assert.strictEqual(files['CLAUDE.md'], files['AGENTS.md']);
  assert.match(files['CLAUDE.md'], /Planungsphase/);
  assert.match(files['CLAUDE.md'], /nichts/);
  assert.match(files['PLAN.md'], /^# Demo – Plan/);
});

test('createLocalProject: legt Ordner, Dateien, Repo und ersten Commit an', async (t) => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { return t.skip('git fehlt'); }
  const base = tmp();
  const service = createGitService({ cloneDir: base });
  const result = await service.createLocalProject('Mein Projekt');
  assert.strictEqual(result.name, 'Mein-Projekt');
  assert.strictEqual(result.path, path.join(base, 'Mein-Projekt'));
  assert.ok(result.isRepo);
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'PLAN.md']) assert.ok(fs.existsSync(path.join(result.path, f)), f);
  assert.ok(fs.existsSync(path.join(result.path, '.git')));
  const status = await service.status(result.path);
  assert.strictEqual(status.isRepo, true);
  assert.strictEqual(status.branch, 'main');
  assert.strictEqual(status.hasUpstream, false);
});

test('createLocalProject: bestehender Ordner und ungültiger Name werden abgelehnt, nichts wird überschrieben', async () => {
  const base = tmp();
  fs.mkdirSync(path.join(base, 'Da'));
  fs.writeFileSync(path.join(base, 'Da', 'wichtig.txt'), 'bleibt');
  const service = createGitService({ cloneDir: base });
  await assert.rejects(() => service.createLocalProject('Da'), /existiert bereits/);
  await assert.rejects(() => service.createLocalProject('../raus'), /Ungültiger Projektname/);
  assert.strictEqual(fs.readFileSync(path.join(base, 'Da', 'wichtig.txt'), 'utf8'), 'bleibt');
  assert.deepStrictEqual(fs.readdirSync(path.join(base, 'Da')), ['wichtig.txt']);
});

test('publishRepo: verweigert Ordner ohne Repo', async () => {
  const base = tmp();
  const plain = path.join(base, 'plain');
  fs.mkdirSync(plain);
  const service = createGitService({ cloneDir: base });
  await assert.rejects(() => service.publishRepo(plain, { isPrivate: true }), /kein Git-Repo/);
});
