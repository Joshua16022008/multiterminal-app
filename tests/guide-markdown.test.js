'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MD = require('../src/renderer/guide-markdown');

// Minimal fake DOM: elements and text nodes are plain objects.
function makeDom() {
  const doc = {
    createTextNode: (value) => ({ nodeType: 3, text: value }),
    createDocumentFragment: () => ({ nodeType: 11, children: [], append(...k) { this.children.push(...k); } }),
  };
  const h = (tag, props = {}, ...kids) => {
    const el = { nodeType: 1, tag, props, children: [], append(...k) { this.children.push(...k); } };
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'text') el.children.push(doc.createTextNode(v));
      else if (k.startsWith('on')) el[k] = v;
      else el[k] = v;
    }
    for (const c of kids.flat()) if (c != null) el.children.push(c);
    return el;
  };
  return { doc, h };
}
const textOf = (n) => (n.nodeType === 3 ? n.text : (n.children || []).map(textOf).join(''));
const walk = (n) => [n, ...(n.children || []).flatMap(walk)];
function renderMd(markdown, extra = {}) {
  const { doc, h } = makeDom();
  const links = [];
  const frag = MD.render(markdown, { h, document: doc, onLink: (l) => links.push(l), ...extra });
  return { frag, links, all: walk(frag), tags: (t) => walk(frag).filter((n) => n.tag === t) };
}

test('anchor: GitHub-kompatibel inklusive Umlauten und Satzzeichen', () => {
  assert.equal(MD.anchor('Arbeitskopien (Worktrees)'), 'arbeitskopien-worktrees');
  assert.equal(MD.anchor('Übergabe & Überblick'), 'übergabe--überblick');
  assert.equal(MD.anchor('Größe ändern'), 'größe-ändern');
  assert.equal(MD.anchor('Schritt 1: Start!'), 'schritt-1-start');
  assert.equal(MD.anchor('snake_case-und-Bindestrich'), 'snake_case-und-bindestrich');
  assert.equal(MD.anchor('Mit `Code` und **Fett**'.replace(/[`*]/g, '')), 'mit-code-und-fett');
});

test('parse: Überschriften-Anker sind bei Duplikaten eindeutig, Code wird übersprungen', () => {
  const { headings } = MD.parse('# Titel\n\n## Anlegen\n\n```\n## kein Heading\n```\n\n## Anlegen\n\n### Anlegen\n\n## **Fett** `code`');
  assert.deepEqual(headings.map((x) => x.anchor), ['titel', 'anlegen', 'anlegen-1', 'anlegen-2', 'fett-code']);
  assert.equal(headings[4].text, 'Fett code');
  assert.deepEqual(headings.map((x) => x.level), [1, 2, 2, 3, 2]);
});

test('Überschriften, Absätze und Inline-Formate', () => {
  const r = renderMd('# Titel\n\nEin **fetter** und *kursiver* Text mit `code` und _auch kursiv_.\nZweite Zeile.');
  assert.equal(r.tags('h1')[0].props['data-anchor'], 'titel');
  assert.equal(textOf(r.tags('strong')[0]), 'fetter');
  assert.equal(textOf(r.tags('em')[0]), 'kursiver');
  assert.equal(r.tags('em').length, 2);
  assert.equal(textOf(r.tags('code')[0]), 'code');
  assert.match(textOf(r.tags('p')[0]), /auch kursiv\.\s*Zweite Zeile\./);
});

test('snake_case bleibt unverändert und Escapes funktionieren', () => {
  const r = renderMd('mt_pm_cli und \\*kein Stern\\*');
  assert.equal(r.tags('em').length, 0);
  assert.equal(textOf(r.tags('p')[0]), 'mt_pm_cli und *kein Stern*');
});

test('Codeblöcke werden nicht formatiert', () => {
  const r = renderMd('```bash\nnpm **start**\n# kein Heading\n```');
  assert.equal(r.tags('strong').length, 0);
  assert.equal(r.tags('h1').length, 0);
  assert.equal(textOf(r.tags('pre')[0]), 'npm **start**\n# kein Heading');
  assert.equal(r.tags('code')[0]['data-lang'], 'bash');
});

test('Listen: ungeordnet, geordnet, verschachtelt', () => {
  const r = renderMd('- eins\n- zwei\n  - zwei a\n  - zwei b\n- drei\n\n3. x\n4. y');
  const lists = r.tags('ul');
  assert.equal(lists.length, 2); // äußere + verschachtelte
  const outer = lists[0];
  assert.equal(outer.children.length, 3);
  assert.equal(textOf(outer.children[1].children[0]), 'zwei');
  assert.equal(outer.children[1].children[1].tag, 'ul');
  assert.equal(outer.children[1].children[1].children.length, 2);
  const ol = r.tags('ol')[0];
  assert.equal(ol.children.length, 2);
  assert.equal(ol.start, 3);
});

test('Tabellen mit Ausrichtung und Inline-Inhalt', () => {
  const r = renderMd('| Aktion | Kürzel |\n|:--|--:|\n| **Palette** | `⌘K` |\n| a \\| b | x |');
  assert.equal(r.tags('th').length, 2);
  assert.equal(r.tags('td').length, 4);
  assert.equal(r.tags('th')[1].props.class, 'align-right');
  assert.equal(r.tags('th')[0].props.class, null);
  assert.equal(textOf(r.tags('td')[3]), 'x');
  assert.equal(textOf(r.tags('td')[2]), 'a | b');
  assert.equal(r.tags('strong').length, 1);
});

test('Blockzitat und Trennlinie', () => {
  const r = renderMd('> Hinweis mit **Fett**\n> zweite Zeile\n\n---\n\nEnde');
  assert.equal(r.tags('blockquote').length, 1);
  assert.equal(r.tags('hr').length, 1);
  assert.match(textOf(r.tags('blockquote')[0]), /Hinweis mit Fett zweite Zeile/);
});

test('Roh-HTML erscheint als Text, es entstehen keine Elemente', () => {
  const r = renderMd('Hallo <script>alert(1)</script> <img src=x onerror=alert(1)>\n\n<div onclick="x">Box</div>');
  assert.equal(r.tags('script').length, 0);
  assert.equal(r.tags('img').length, 0);
  assert.equal(r.tags('div').length, 0);
  assert.match(textOf(r.frag), /<script>alert\(1\)<\/script>/);
  assert.match(textOf(r.frag), /<div onclick="x">Box<\/div>/);
});

test('javascript:-, data:- und andere Schemata werden verworfen', () => {
  for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html;base64,AAAA', 'vbscript:x', 'file:///etc/passwd', '//evil.example/x', '../geheim.md', 'ordner/seite.md']) {
    const r = renderMd('[Klick](' + bad + ') danach');
    assert.equal(r.tags('a').length, 0, bad);
    assert.match(textOf(r.frag), /Klick danach/, bad);
  }
});

test('Whitespace im Ziel macht daraus keinen Link', () => {
  assert.equal(renderMd('[Klick](java\tscript:alert(1)) danach').tags('a').length, 0);
});

test('interne Links gehen über onLink mit Slug und Anker', () => {
  const r = renderMd('[A](worktrees.md#anlegen) [B](#unten) [C](./ports.md) [D](tastenkuerzel#ärger)');
  const [a, b, c, d] = r.tags('a');
  a.onclick({ preventDefault() {} }); b.onclick({ preventDefault() {} }); c.onclick({ preventDefault() {} }); d.onclick({ preventDefault() {} });
  assert.deepEqual(r.links.map((l) => [l.external, l.slug, l.anchor]), [
    [false, 'worktrees', 'anlegen'], [false, null, 'unten'], [false, 'ports', null], [false, 'tastenkuerzel', 'ärger'],
  ]);
  assert.equal(a.href, '#anlegen');
});

test('externe Links: onLink mit external:true, Standardaktion unterdrückt', () => {
  const r = renderMd('[Doku](https://example.org/x?a=1#y) und [Mail](mailto:a@b.de)');
  let prevented = 0;
  for (const a of r.tags('a')) a.onclick({ preventDefault() { prevented++; } });
  assert.equal(prevented, 2);
  assert.deepEqual(r.links.map((l) => [l.external, l.href]), [[true, 'https://example.org/x?a=1#y'], [true, 'mailto:a@b.de']]);
  assert.equal(r.tags('a')[0].rel, 'noopener noreferrer');
});

test('Platzhalter <!-- mt:hotkeys --> wird zum Hook-Knoten und umschließt die Ersatztabelle', () => {
  const seen = [];
  const r = renderMd('Text\n\n<!-- mt:hotkeys -->\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nDanach', { onHook: (name, node) => seen.push([name, node]) });
  const hook = r.all.find((n) => n.props && n.props['data-mt-hook'] === 'hotkeys');
  assert.ok(hook);
  assert.equal(seen[0][0], 'hotkeys');
  assert.equal(seen[0][1], hook);
  assert.equal(walk(hook).filter((n) => n.tag === 'table').length, 1);
  assert.match(textOf(r.frag), /Danach/);
  // andere Kommentare sind unsichtbar
  assert.equal(textOf(renderMd('a\n\n<!-- Notiz\nmehrzeilig -->\n\nb').frag), 'ab');
});

test('onHeading meldet Anker und Elemente', () => {
  const seen = [];
  renderMd('# A\n\n## B\n\n## B', { onHeading: (a) => seen.push(a) });
  assert.deepEqual(seen, ['a', 'b', 'b-1']);
});

test('kein innerHTML: Renderer benutzt nur h und Textknoten', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/renderer/guide-markdown.js'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /innerHTML|insertAdjacentHTML|outerHTML/);
});

test('Datum am Zeilenanfang unterbricht keinen Absatz, "1." und Aufzählungen schon', () => {
  const r = renderMd('Am Freitag war es\n17. Oktober und kalt.');
  assert.equal(r.tags('ol').length, 0);
  assert.match(textOf(r.tags('p')[0]), /war es 17\. Oktober und kalt\./);
  const r2 = renderMd('Text\n1. eins\n2. zwei');
  assert.equal(r2.tags('ol').length, 1);
  assert.equal(renderMd('Text\n- punkt').tags('ul').length, 1);
});

test('Unabgeschlossener HTML-Kommentar verschluckt den Rest nicht', () => {
  const md = 'Text\n\n<!-- offen\n\n# Kapitel\n\nmehr';
  const r = renderMd(md);
  assert.equal(r.tags('h1').length, 1);
  assert.match(textOf(r.frag), /mehr/);
  assert.deepEqual(MD.parse(md).headings.map((x) => x.anchor), ['kapitel']);
  assert.equal(renderMd('a\n\n<!-- zu -->\n\nb').tags('p').length, 2);
});
