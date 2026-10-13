'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureProgress, readProgress, writeSnapshot } = require('../src/main/progress-files');

function tmp() {
  // realpath: os.tmpdir() is a symlink on macOS (/var -> /private/var)
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mt-progress-')));
}
const NOW = new Date(2026, 6, 15, 9, 5, 3); // local time

test('ensureProgress creates a German template', () => {
  const dir = tmp();
  const r = ensureProgress(dir, 'Mein Projekt');
  assert.strictEqual(r.created, true);
  assert.strictEqual(r.path, path.join(dir, 'PROGRESS.md'));
  assert.strictEqual(fs.readFileSync(r.path, 'utf8'), r.content);
  assert.match(r.content, /^# Mein Projekt/);
  for (const h of ['## Aktueller Stand', '## Nächster Schritt', '## Erledigt', '## Offene Fragen']) {
    assert.ok(r.content.includes(h), h);
  }
  assert.match(r.content, /nach jedem abgeschlossenen Schritt/);
});

test('ensureProgress never modifies an existing PROGRESS.md', () => {
  const dir = tmp();
  const file = path.join(dir, 'PROGRESS.md');
  fs.writeFileSync(file, 'mein eigener Inhalt');
  const before = fs.statSync(file).mtimeMs;
  const r = ensureProgress(dir, 'X');
  assert.deepStrictEqual({ ...r }, { path: file, content: 'mein eigener Inhalt', created: false });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'mein eigener Inhalt');
  assert.strictEqual(fs.statSync(file).mtimeMs, before);
});

test('readProgress returns null when missing, content when present', () => {
  const dir = tmp();
  assert.strictEqual(readProgress(dir), null);
  fs.writeFileSync(path.join(dir, 'PROGRESS.md'), 'hi');
  assert.deepStrictEqual(readProgress(dir), { path: path.join(dir, 'PROGRESS.md'), content: 'hi' });
});

test('relative, non-existent, non-directory and bad projectPath throw', () => {
  const dir = tmp();
  const file = path.join(dir, 'f.txt');
  fs.writeFileSync(file, 'x');
  const bads = ['relative/path', '.', '', path.join(dir, 'missing'), file, null, undefined, 42, dir + '\0'];
  for (const p of bads) {
    assert.throws(() => ensureProgress(p, 'n'), Error, String(p));
    assert.throws(() => readProgress(p), Error, String(p));
    assert.throws(() => writeSnapshot(p, 't', 'x', NOW), Error, String(p));
  }
});

test('symlinked PROGRESS.md pointing outside the project is refused', () => {
  const dir = tmp();
  const outside = tmp();
  const secret = path.join(outside, 'secret.md');
  fs.writeFileSync(secret, 'SECRET');
  fs.symlinkSync(secret, path.join(dir, 'PROGRESS.md'));
  assert.throws(() => ensureProgress(dir, 'n'), /outside/);
  assert.throws(() => readProgress(dir), /outside/);
  assert.strictEqual(fs.readFileSync(secret, 'utf8'), 'SECRET');
});

test('dangling symlinked PROGRESS.md is refused and target is not created', () => {
  const dir = tmp();
  const outside = tmp();
  const target = path.join(outside, 'new.md');
  fs.symlinkSync(target, path.join(dir, 'PROGRESS.md'));
  assert.throws(() => ensureProgress(dir, 'n'));
  assert.strictEqual(fs.existsSync(target), false);
});

test('symlinked PROGRESS.md inside the project is allowed', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'real.md'), 'inside');
  fs.symlinkSync(path.join(dir, 'real.md'), path.join(dir, 'PROGRESS.md'));
  assert.strictEqual(ensureProgress(dir, 'n').content, 'inside');
});

test('symlinked .multiterminal pointing outside is refused', () => {
  const dir = tmp();
  const outside = tmp();
  fs.symlinkSync(outside, path.join(dir, '.multiterminal'));
  assert.throws(() => writeSnapshot(dir, 't', 'x', NOW), /outside/);
  assert.deepStrictEqual(fs.readdirSync(outside), []);
});

test('symlinked .multiterminal/snapshots pointing outside is refused', () => {
  const dir = tmp();
  const outside = tmp();
  fs.mkdirSync(path.join(dir, '.multiterminal'));
  fs.symlinkSync(outside, path.join(dir, '.multiterminal', 'snapshots'));
  assert.throws(() => writeSnapshot(dir, 't', 'x', NOW), /outside/);
  assert.deepStrictEqual(fs.readdirSync(outside), []);
});

test('writeSnapshot file name, location and content', () => {
  const dir = tmp();
  const r = writeSnapshot(dir, 'Claude Code: Fix #1!', 'line1\nline2', NOW);
  assert.strictEqual(path.dirname(r.path), path.join(dir, '.multiterminal', 'snapshots'));
  assert.strictEqual(path.basename(r.path), '2026-07-15_09-05-03-claude-code-fix-1.md');
  const c = fs.readFileSync(r.path, 'utf8');
  assert.match(c, /^# Claude Code: Fix #1!\n/);
  assert.ok(c.includes('2026-07-15 09:05:03'));
  assert.ok(c.includes('```\nline1\nline2\n```'));
});

test('slug: max 40 chars, fallback to terminal', () => {
  const dir = tmp();
  const a = writeSnapshot(dir, 'x'.repeat(100), 't', NOW);
  assert.strictEqual(path.basename(a.path), `2026-07-15_09-05-03-${'x'.repeat(40)}.md`);
  for (const title of ['', '!!!', '日本語', null, undefined]) {
    const r = writeSnapshot(dir, title, 't', new Date(2026, 0, 1, 0, 0, 0));
    assert.match(path.basename(r.path), /^2026-01-01_00-00-00-terminal(-\d+)?\.md$/, String(title));
  }
});

test('slug never contains path separators or dots from a hostile title', () => {
  const dir = tmp();
  const r = writeSnapshot(dir, '../../../etc/passwd', 'x', NOW);
  assert.strictEqual(path.dirname(r.path), path.join(dir, '.multiterminal', 'snapshots'));
  assert.strictEqual(path.basename(r.path), '2026-07-15_09-05-03-etc-passwd.md');
});

test('file name collisions get a numeric suffix, nothing overwritten', () => {
  const dir = tmp();
  const a = writeSnapshot(dir, 'same', 'first', NOW);
  const b = writeSnapshot(dir, 'same', 'second', NOW);
  const c = writeSnapshot(dir, 'same', 'third', NOW);
  assert.strictEqual(new Set([a.path, b.path, c.path]).size, 3);
  assert.ok(fs.readFileSync(a.path, 'utf8').includes('first'));
  assert.ok(fs.readFileSync(b.path, 'utf8').includes('second'));
  assert.ok(fs.readFileSync(c.path, 'utf8').includes('third'));
  assert.match(path.basename(b.path), /-2\.md$/);
  assert.match(path.basename(c.path), /-3\.md$/);
});

test('text containing backticks cannot close the fence', () => {
  const dir = tmp();
  const text = 'a\n```js\ncode\n```\n`````\nb';
  const r = writeSnapshot(dir, 't', text, NOW);
  const lines = fs.readFileSync(r.path, 'utf8').split('\n');
  const open = lines.find((l) => /^`{3,}$/.test(l));
  assert.ok(open.length >= 6, 'fence longer than longest run in text (5)');
  const idxs = lines.map((l, i) => (l === open ? i : -1)).filter((i) => i >= 0);
  assert.strictEqual(idxs.length, 2);
  assert.strictEqual(lines.slice(idxs[0] + 1, idxs[1]).join('\n'), text);
});

test('text over 2,000,000 chars keeps the end', () => {
  const dir = tmp();
  const r = writeSnapshot(dir, 't', 'A'.repeat(1000) + 'B'.repeat(2000000), NOW);
  const c = fs.readFileSync(r.path, 'utf8');
  assert.ok(!c.includes('A'.repeat(10)) || !/A{10}/.test(c.split('\n').slice(4).join('\n')));
  assert.ok(c.includes('B'.repeat(2000000)));
});

test('snapshots never delete or touch existing files', () => {
  const dir = tmp();
  writeSnapshot(dir, 'one', 'x', NOW);
  const keep = path.join(dir, '.multiterminal', 'snapshots', 'old.md');
  fs.writeFileSync(keep, 'old');
  writeSnapshot(dir, 'two', 'y', NOW);
  assert.strictEqual(fs.readFileSync(keep, 'utf8'), 'old');
});
