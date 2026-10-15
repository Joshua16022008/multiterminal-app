'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHandoffText, listTargets, progressExcerpt } = require('../src/renderer/handoff-panel');
const { buildPromptText } = require('../src/renderer/attachments');

test('the handoff text names source and goal and lists every filled field', () => {
  const text = buildHandoffText({
    sourceTitle: 'Alpha',
    goal: 'Login-Fehler beheben',
    results: 'Tests 368/368 grün',
    files: 'src/main/auth.js\ntests/auth.test.js',
    questions: 'Soll die Sitzung verlängert werden?',
    nextStep: 'Token-Ablauf in auth.js prüfen',
    progressExcerpt: '## Aktueller Stand\n- Stand A',
  });
  assert.match(text, /^Übergabe von Alpha/);
  for (const label of ['Ziel:', 'Geprüfte Ergebnisse:', 'Relevante Dateien:', 'Offene Fragen:', 'Genau ein nächster Schritt:', 'Auszug aus PROGRESS.md:']) {
    assert.ok(text.includes(label), 'missing ' + label);
  }
  assert.ok(text.includes('Token-Ablauf in auth.js prüfen'));
  assert.ok(text.indexOf('Ziel:') < text.indexOf('Genau ein nächster Schritt:'));
});

test('empty fields are left out completely', () => {
  const text = buildHandoffText({ sourceTitle: 'Beta', goal: '  ', results: '', nextStep: 'Weiter mit B' });
  assert.equal(text, 'Übergabe von Beta\n\nGenau ein nächster Schritt:\nWeiter mit B');
  assert.doesNotMatch(text, /Ziel:|Geprüfte|Relevante|Offene|PROGRESS/);
});

test('a long PROGRESS.md excerpt is cut to 4000 characters and marked', () => {
  const long = 'x'.repeat(9000);
  const text = buildHandoffText({ sourceTitle: 'Alpha', progressExcerpt: long });
  const excerpt = text.slice(text.indexOf('Auszug aus PROGRESS.md:\n') + 'Auszug aus PROGRESS.md:\n'.length);
  assert.ok(excerpt.endsWith('\n(gekürzt)'));
  assert.equal(excerpt.length, 4000 + '\n(gekürzt)'.length);
});

test('control characters that the prompt preview refuses are removed, so the text can be inserted', () => {
  const text = buildHandoffText({ sourceTitle: 'Alpha', results: 'Spalte\tA\r\nZeile \x1b[31mrot' });
  assert.doesNotThrow(() => buildPromptText(text, []));
  assert.ok(text.includes('Spalte  A\nZeile'));
});

test('targets exclude the source and any tile that is not running', () => {
  const panes = [
    { id: 'a', status: 'running' },
    { id: 'b', status: 'running' },
    { id: 'c', status: 'exited' },
    { id: 'd', status: 'running', disposed: true },
    { id: 'e', status: 'idle' },
  ];
  assert.deepEqual(listTargets(panes, 'a').map(p => p.id), ['b']);
});

test('without a source and without finished tiles the list is only the running ones', () => {
  const panes = [{ id: 'a', status: 'running' }, { id: 'b', status: 'exited' }];
  assert.deepEqual(listTargets(panes).map(p => p.id), ['a']);
});

test('no tiles at all gives an empty target list', () => {
  assert.deepEqual(listTargets([], 'a'), []);
  assert.deepEqual(listTargets(undefined, 'a'), []);
  assert.deepEqual(listTargets(null, 'a'), []);
});

test('the progress excerpt takes only the current-status section and at most 60 lines', () => {
  const body = Array.from({ length: 80 }, (_, i) => '- Zeile ' + i).join('\n');
  const content = '# PROGRESS\n\n## Aktueller Stand\n' + body + '\n\n## Verlauf\n- alt';
  const excerpt = progressExcerpt(content);
  assert.ok(excerpt.startsWith('## Aktueller Stand'));
  assert.ok(!excerpt.includes('Verlauf'));
  assert.equal(excerpt.split('\n').length, 60);
});

test('a PROGRESS.md without the section yields an empty excerpt', () => {
  assert.equal(progressExcerpt('# Nur Titel\n\n## Anderes\ntext'), '');
  assert.equal(progressExcerpt(null), '');
});
