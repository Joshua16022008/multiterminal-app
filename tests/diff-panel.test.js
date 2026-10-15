'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { groupFiles, flatLines, nextSelection, lineRange, buildPromptText, MAX_EXCERPT_LINES } = require('../src/renderer/diff-panel');
const attachments = require('../src/renderer/attachments');

const L = (type, oldNo, newNo, text) => ({ type, oldNo, newNo, text });

test('a file with staged and unstaged changes appears in both groups', () => {
  const g = groupFiles([
    { path: 'a.js', index: 'M', worktree: 'M', staged: true, unstaged: true, untracked: false },
    { path: 'n.md', index: '?', worktree: '?', staged: false, unstaged: false, untracked: true },
    { path: 'neu.js', oldPath: 'alt.js', index: 'R', worktree: ' ', staged: true, unstaged: false, untracked: false },
  ]);
  assert.deepEqual(g.staged.map((i) => [i.file.path, i.status]), [['a.js', 'geändert'], ['neu.js', 'umbenannt']]);
  assert.deepEqual(g.unstaged.map((i) => i.file.path), ['a.js']);
  assert.deepEqual(g.untracked.map((i) => [i.file.path, i.mode]), [['n.md', 'untracked']]);
});

test('selection: click picks one line, shift-click extends from the anchor in both directions', () => {
  let s = nextSelection(null, 5, false);
  assert.deepEqual(s, { anchor: 5, from: 5, to: 5 });
  s = nextSelection(s, 2, true);
  assert.deepEqual(s, { anchor: 5, from: 2, to: 5 });
  s = nextSelection(s, 9, true);
  assert.deepEqual(s, { anchor: 5, from: 5, to: 9 });
  assert.deepEqual(nextSelection(s, 1, false), { anchor: 1, from: 1, to: 1 });
});

test('flatLines skips "no newline" markers so indices match the rendered rows', () => {
  const lines = flatLines({ hunks: [{ lines: [L(' ', 1, 1, 'a'), L('\\', null, null, '\\ No newline')] }, { lines: [L('+', null, 9, 'x')] }] });
  assert.deepEqual(lines.map((l) => l.text), ['a', 'x']);
});

test('line ranges name new and old numbers', () => {
  assert.equal(lineRange([L('+', null, 4, 'a'), L('+', null, 5, 'b')]), 'Zeilen 4–5');
  assert.equal(lineRange([L('-', 7, null, 'a')]), 'vorher Zeilen 7 (entfernt)');
  assert.equal(lineRange([L(' ', 3, 3, 'a'), L('-', 4, null, 'b'), L('+', null, 4, 'c')]), 'Zeilen 3–4');
  assert.equal(lineRange([L(' ', 10, 12, 'a'), L('+', null, 13, 'b')]), 'Zeilen 12–13 (vorher 10)');
});

test('prompt text carries file, range, comparison, comment and a one-line excerpt', () => {
  const text = buildPromptText({
    path: 'src/a b.js', compare: 'Arbeitsbaum gegen Index', scopeLabel: 'Arbeitskopie ⑂ feature/x',
    lines: [L('-', 3, null, 'const x = 1;'), L('+', null, 3, '\tconst x = 2;')], comment: '  Warum 2?  ',
  });
  assert.equal(text, 'Rückmeldung zu src/a b.js, Zeilen 3 (Arbeitskopie ⑂ feature/x, Arbeitsbaum gegen Index): Warum 2? — Ausschnitt: - const x = 1; ⏎ +   const x = 2;');
  assert.ok(!/[\n\t\r]/.test(text));
});

test('long selections are cut and say so; control characters never reach the preview', () => {
  const many = Array.from({ length: MAX_EXCERPT_LINES + 5 }, (_, i) => L('+', null, i + 1, 'z' + i + '\u001b[31m'));
  const text = buildPromptText({ path: 'f', compare: '', lines: many, comment: '' });
  assert.ok(text.endsWith('… (gekürzt)'));
  assert.ok(!/[\u0000-\u001f\u007f]/.test(text));
  assert.ok(!text.includes('z' + (MAX_EXCERPT_LINES + 1)));
  assert.doesNotThrow(() => attachments.buildPromptText(text, [])); // the F06 preview accepts it
});
