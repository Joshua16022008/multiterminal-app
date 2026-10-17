'use strict';
/* Inhaltsprüfung für docs/guide: Seiten parsebar, nur unterstütztes Markdown-Subset, Links und Anker
   vorhanden, Tastenkürzel-Tabelle gleich den Standardwerten, keine privaten oder internen Begriffe. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGuideService, splitFrontMatter } = require('../src/main/guide-service');
const GM = require('../src/renderer/guide-markdown');
const HK = require('../src/renderer/hotkeys');

const ROOT = path.join(__dirname, '..');
const GUIDE_DIR = path.join(ROOT, 'docs', 'guide');

const REQUIRED_SLUGS = [
  'erste-schritte', 'oberflaeche', 'terminals-und-agenten', 'worktrees', 'mini-browser', 'diff-und-git', 'ports',
  'projektmanager', 'memory', 'uebergaben-und-anhaenge', 'einstellungen', 'tastenkuerzel', 'befehlspalette',
  'updates', 'fehlerbehebung', 'harnesses-modelle', 'endpunkte',
];
/* Aktionen, die der V1-Release nicht dokumentiert (Funktion kommt nicht in die erste öffentliche Fassung). */
const HOTKEYS_NOT_DOCUMENTED = ['task-link'];
const SUPPORTED_BLOCKS = new Set(['heading', 'paragraph', 'code', 'hr', 'quote', 'list', 'table', 'hook']);
const SUPPORTED_HOOKS = new Set(['hotkeys']);

const mdFiles = () => fs.readdirSync(GUIDE_DIR).filter((n) => n.endsWith('.md')).sort();
const readFile = (name) => fs.readFileSync(path.join(GUIDE_DIR, name), 'utf8');
const service = createGuideService({ dir: GUIDE_DIR });

/* Alle Blöcke rekursiv (Zitate, Listeneinträge, Tabellen-Rückfall der Hooks). */
function* walkBlocks(blocks) {
  for (const b of blocks) {
    yield b;
    if (b.type === 'quote') yield* walkBlocks(b.blocks);
    if (b.type === 'list') for (const item of b.items) yield* walkBlocks(item);
    if (b.type === 'hook' && b.fallback) yield* walkBlocks([b.fallback]);
  }
}

/* Alle Inline-Knoten eines Blocks, ohne in andere Blöcke abzusteigen. */
function* inlineRoots(b) {
  if (b.type === 'heading' || b.type === 'paragraph') yield b.inline;
  if (b.type === 'table') { yield* b.head; for (const row of b.rows) yield* row; }
}
function* walkInline(nodes) {
  for (const n of nodes) {
    yield n;
    if (n.children) yield* walkInline(n.children);
  }
}
const plain = (nodes) => nodes.map((n) => (n.value !== undefined ? n.value : plain(n.children || []))).join('');

function parsed(name) {
  const raw = readFile(name);
  const { body } = splitFrontMatter(raw);
  return { raw, body, ...GM.parse(body) };
}

/* Fließtext ohne Codezäune und Inline-Code, für Syntax-Prüfungen auf Rohtext. */
function proseOf(body) {
  return body
    .replace(/^\s{0,3}(```+|~~~+)[^\n]*\n[\s\S]*?\n\s{0,3}\1\s*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/`[^`\n]*`/g, '');
}

test('alle Pflichtseiten sind vorhanden und im Index', () => {
  const slugs = service.index().pages.map((p) => p.slug);
  for (const slug of REQUIRED_SLUGS) assert.ok(slugs.includes(slug), 'Seite fehlt: ' + slug);
  assert.ok(fs.existsSync(path.join(GUIDE_DIR, 'README.md')), 'README.md fehlt');
});

test('jede Seite hat Front-Matter mit title, order und keywords; order ist eindeutig', () => {
  const orders = new Map();
  for (const name of mdFiles()) {
    if (name === 'README.md') continue;
    const { meta } = splitFrontMatter(readFile(name));
    assert.ok(meta.title && meta.title.length >= 2, name + ': title fehlt');
    assert.ok(/^\d+$/.test(meta.order || ''), name + ': order fehlt oder keine Zahl');
    assert.ok(meta.keywords && meta.keywords.trim(), name + ': keywords fehlt');
    assert.ok(!orders.has(meta.order), name + ': order ' + meta.order + ' schon bei ' + orders.get(meta.order));
    orders.set(meta.order, name);
  }
});

test('jede Seite ist mit dem Guide-Service lesbar, hat genau eine H1 und einen Titel in der Datei', () => {
  const { pages } = service.index();
  for (const p of pages) {
    const page = service.read(p.slug);
    assert.ok(page && page.markdown.trim().length > 0, p.slug + ': nicht lesbar oder leer');
    assert.equal(p.headings.filter((h) => h.level === 1).length, 1, p.slug + ': genau eine H1 erwartet');
    assert.ok(p.title && p.title !== p.slug, p.slug + ': kein Titel');
  }
});

test('nur unterstütztes Markdown-Subset (keine Bilder, kein Roh-HTML, keine Referenz-Links u. Ä.)', () => {
  for (const name of mdFiles()) {
    const { blocks, body } = parsed(name);
    for (const b of walkBlocks(blocks)) {
      assert.ok(SUPPORTED_BLOCKS.has(b.type), name + ': Blocktyp ' + b.type);
      if (b.type === 'hook') assert.ok(SUPPORTED_HOOKS.has(b.name), name + ': unbekannter Platzhalter mt:' + b.name);
      if (b.type === 'heading') assert.ok(b.level <= 4, name + ': Überschrift tiefer als H4: ' + b.text);
    }
    const prose = proseOf(body);
    assert.ok(!/!\[[^\]]*\]\(/.test(prose), name + ': Bilder werden nicht unterstützt');
    assert.ok(!/<\/?[A-Za-z][^>]*>/.test(prose), name + ': Roh-HTML wird nicht unterstützt');
    assert.ok(!/^\s*\[[^\]]+\]:\s*\S+/m.test(prose), name + ': Referenz-Links werden nicht unterstützt');
    assert.ok(!/\[\^[^\]]+\]/.test(prose), name + ': Fußnoten werden nicht unterstützt');
    assert.ok(!/^\s*[-*+]\s+\[[ xX]\]\s/m.test(prose), name + ': Aufgabenlisten werden nicht unterstützt');
    assert.ok(!/^[^\n]+\n={2,}\s*$/m.test(prose), name + ': Setext-Überschriften werden nicht unterstützt');
    assert.ok(!/~~[^~]+~~/.test(prose), name + ': Durchgestrichen wird nicht unterstützt');
    assert.ok(!/\t/.test(body), name + ': Tabulatoren vermeiden');
    // Inline: übrig gebliebene Markup-Zeichen im reinen Text deuten auf nicht erkannte Syntax
    for (const b of walkBlocks(blocks)) {
      for (const root of inlineRoots(b)) {
        for (const n of walkInline(root)) {
          if (n.type !== 'text') continue;
          assert.ok(!/\*\*|__|\]\(|!\[/.test(n.value), name + ': unerkannte Auszeichnung in „' + n.value.slice(0, 60) + '“');
        }
      }
    }
  }
});

function checkLinks(name, blocks, pages) {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const own = name.replace(/\.md$/, '');
  let count = 0;
  for (const b of walkBlocks(blocks)) {
    for (const root of inlineRoots(b)) {
      for (const n of walkInline(root)) {
        if (n.type !== 'link') continue;
        count++;
        const info = GM.classifyHref(n.href);
        assert.ok(info, name + ': Link nicht zulässig: ' + n.href);
        if (info.external) { assert.match(info.href, /^https:\/\//, name + ': nur https-Links: ' + n.href); continue; }
        if (info.slug) assert.match(n.href, /\.md(#|$)/, name + ': interne Links brauchen die Endung .md: ' + n.href);
        const slug = info.slug || own;
        const target = bySlug.get(slug);
        assert.ok(target, name + ': Linkziel existiert nicht: ' + n.href);
        if (info.anchor) {
          assert.ok(target.headings.some((h) => h.anchor === info.anchor), name + ': Anker existiert nicht: ' + n.href);
        }
      }
    }
  }
  return count;
}

test('alle internen Links und Anker existieren', () => {
  const { pages } = service.index();
  let total = 0;
  for (const name of mdFiles()) {
    const { blocks } = parsed(name);
    total += checkLinks(name, blocks, pages);
  }
  assert.ok(total >= 30, 'auffallend wenige Links: ' + total);
});

test('README verlinkt jede Seite', () => {
  const { blocks } = parsed('README.md');
  const hrefs = new Set();
  for (const b of walkBlocks(blocks)) {
    for (const root of inlineRoots(b)) {
      for (const n of walkInline(root)) if (n.type === 'link') hrefs.add(n.href.replace(/#.*$/, ''));
    }
  }
  for (const slug of REQUIRED_SLUGS) assert.ok(hrefs.has(slug + '.md'), 'README verlinkt ' + slug + ' nicht');
});

test('Tastenkürzel-Tabelle entspricht hotkeys.defaults("darwin")', () => {
  const { blocks } = parsed('tastenkuerzel.md');
  const hook = blocks.find((b) => b.type === 'hook' && b.name === 'hotkeys');
  assert.ok(hook, 'Platzhalter <!-- mt:hotkeys --> fehlt');
  assert.ok(hook.fallback && hook.fallback.type === 'table', 'Standardtabelle muss direkt auf den Platzhalter folgen');
  const table = hook.fallback;
  assert.deepEqual(table.head.map(plain), ['Aktion', 'Tastenkürzel']);
  const actual = table.rows.map((r) => [plain(r[0]), plain(r[1])]);
  const defaults = HK.defaults('darwin');
  const expected = HK.actions
    .filter((a) => !HOTKEYS_NOT_DOCUMENTED.includes(a.id))
    .map((a) => [a.label, defaults[a.id].map(HK.format).join(' / ')]);
  assert.deepEqual(actual, expected);
  for (const id of HOTKEYS_NOT_DOCUMENTED) assert.ok(HK.actions.some((a) => a.id === id) || HK.disabled.includes(id), 'Ausnahme für unbekannte Aktion ' + id);
});

/* Persönliche Begriffe stehen nur in der Entwicklerversion (tests/private-terms.js, nicht exportiert). */
const PRIVATE = (() => { try { return require('./private-terms'); } catch (_) { return []; } })();
const RELEASE = PRIVATE;
const FORBIDDEN = [
  ...RELEASE,
  [/Diktat|Diktier/i, 'Diktat'],
  [/Mikrofon/i, 'Mikrofon'],
  [/Aufgaben-Chip|task-?link/i, 'Aufgaben-Link'],
];

test('Datenschutz- und Release-Wächter: docs/guide enthält keine privaten oder internen Begriffe', () => {
  for (const name of mdFiles()) {
    const raw = readFile(name);
    for (const [re, label] of FORBIDDEN) assert.ok(!re.test(raw), name + ': enthält „' + label + '“');
  }
});

/* Dateien, die nur in der Entwicklerversion liegen, prüft der Wächter nicht (scripts/export-manifest.json). */
function devOnly() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'export-manifest.json'), 'utf8')).devOnly; } catch (_) { return []; }
}

function grepTree(dirs) {
  const skip = devOnly();
  const excluded = (rel) => skip.some((entry) => (entry.endsWith('/') ? rel.startsWith(entry) : rel === entry));
  const hits = [];
  const files = [];
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f); } else if (/\.(js|sh|md|html|css|json)$/.test(e.name)) files.push(f);
    }
  };
  for (const d of dirs) walk(path.join(ROOT, d));
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (excluded(rel)) continue;
    const text = fs.readFileSync(f, 'utf8');
    for (const [re, label] of RELEASE) if (re.test(text)) hits.push(rel + ': ' + label);
  }
  return hits;
}

test('Release-Wächter für src/ und scripts/ (ohne Dateien der Entwicklerversion)', () => {
  assert.deepEqual(grepTree(['src', 'scripts']), []);
});
