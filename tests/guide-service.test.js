'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGuideService, splitFrontMatter } = require('../src/main/guide-service');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'mt-guide-')); }
const page = (title, order, body) => '---\ntitle: ' + title + '\norder: ' + order + '\n---\n\n' + body;

test('Front-Matter wird gelesen, Rest bleibt Inhalt', () => {
  const { meta, body } = splitFrontMatter('---\r\ntitle: "Ärger & Co"\r\norder: 5\r\nkeywords: a, b\r\n---\r\n# X\r\n');
  assert.equal(meta.title, 'Ärger & Co');
  assert.equal(meta.order, '5');
  assert.equal(meta.keywords, 'a, b');
  assert.equal(body, '# X\n');
  assert.deepEqual(splitFrontMatter('# ohne').meta, {});
});

test('Index: Sortierung nach order, Titel-Fallback, README und fremde Dateien zählen nicht', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'b.md'), page('Zweite', 20, '# Zweite\n'));
  fs.writeFileSync(path.join(dir, 'a.md'), page('Erste', 10, '# Erste\n'));
  fs.writeFileSync(path.join(dir, 'c.md'), '# Nur Überschrift\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Verzeichnis\n');
  fs.writeFileSync(path.join(dir, 'Gross.md'), '# x\n');
  fs.writeFileSync(path.join(dir, 'notiz.txt'), 'x');
  const { pages } = createGuideService({ dir }).index();
  assert.deepEqual(pages.map((p) => p.slug), ['a', 'b', 'c']);
  assert.equal(pages[2].title, 'Nur Überschrift');
  assert.equal(pages[2].order, 1000);
});

test('Index: Überschriften mit GitHub-Ankern inklusive Umlauten und Duplikaten', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'x.md'), page('X', 1,
    '# Übersicht\n\n## Größe & Änderung\n\n## Anlegen\n\n```\n## im Code\n```\n\n## Anlegen\n\n### Ärger (Fall 2)\n'));
  const { pages } = createGuideService({ dir }).index();
  assert.deepEqual(pages[0].headings, [
    { level: 1, text: 'Übersicht', anchor: 'übersicht' },
    { level: 2, text: 'Größe & Änderung', anchor: 'größe--änderung' },
    { level: 2, text: 'Anlegen', anchor: 'anlegen' },
    { level: 2, text: 'Anlegen', anchor: 'anlegen-1' },
    { level: 3, text: 'Ärger (Fall 2)', anchor: 'ärger-fall-2' },
  ]);
});

test('read: liefert Markdown ohne Front-Matter; unbekannte und gefährliche Slugs ergeben null', () => {
  const dir = tmp();
  const outside = path.join(path.dirname(dir), 'geheim-' + path.basename(dir) + '.md');
  fs.writeFileSync(outside, '# geheim');
  fs.writeFileSync(path.join(dir, 'a.md'), page('Erste', 10, '# Erste\n\nText'));
  const svc = createGuideService({ dir });
  const got = svc.read('a');
  assert.equal(got.slug, 'a');
  assert.equal(got.title, 'Erste');
  assert.match(got.markdown, /^\s*# Erste/);
  assert.doesNotMatch(got.markdown, /title:/);
  for (const bad of ['nope', '../' + path.basename(outside, '.md'), '..', 'a/../a', 'a.md', 'A', '', null, undefined, 5, {}, 'README']) {
    assert.equal(svc.read(bad), null, String(bad));
  }
  fs.rmSync(outside);
});

test('fehlender Ordner ergibt leeren Index statt Absturz', () => {
  const svc = createGuideService({ dir: path.join(tmp(), 'gibt-es-nicht') });
  assert.deepEqual(svc.index(), { pages: [] });
  assert.equal(svc.read('a'), null);
});

test('Cache wird über mtime invalidiert, gelöschte Seiten verschwinden', () => {
  const dir = tmp();
  const file = path.join(dir, 'a.md');
  fs.writeFileSync(file, page('Alt', 1, '# Alt\n'));
  const svc = createGuideService({ dir });
  assert.equal(svc.index().pages[0].title, 'Alt');
  assert.equal(svc.index().pages[0].title, 'Alt'); // aus dem Cache
  fs.writeFileSync(file, page('Neu', 1, '# Neu\n\n## Mehr\n'));
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(file, future, future);
  const again = svc.index().pages[0];
  assert.equal(again.title, 'Neu');
  assert.equal(again.headings.length, 2);
  assert.match(svc.read('a').markdown, /Mehr/);
  fs.rmSync(file);
  assert.deepEqual(svc.index().pages, []);
});

test('Index-Ergebnis ist eine Kopie: Mutation beschädigt den Cache nicht', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.md'), page('A', 1, '# A\n'));
  const svc = createGuideService({ dir });
  svc.index().pages[0].headings.length = 0;
  assert.equal(svc.index().pages[0].headings.length, 1);
});

test('das mitgelieferte Gerüst docs/guide ist lesbar', () => {
  const svc = createGuideService({ dir: path.join(__dirname, '..', 'docs', 'guide') });
  const slugs = svc.index().pages.map((p) => p.slug);
  assert.ok(slugs.includes('erste-schritte'));
  assert.ok(svc.read('erste-schritte').markdown.includes('Erste Schritte'));
});

test('Symlinks im Guide-Ordner werden übersprungen', () => {
  const dir = tmp();
  const other = tmp();
  fs.writeFileSync(path.join(other, 'geheim.md'), '# Geheim\n');
  fs.writeFileSync(path.join(dir, 'echt.md'), '# Echt\n');
  fs.symlinkSync(path.join(other, 'geheim.md'), path.join(dir, 'link.md'));
  const svc = createGuideService({ dir });
  assert.deepEqual(svc.index().pages.map((p) => p.slug), ['echt']);
  assert.equal(svc.read('link'), null);
});
