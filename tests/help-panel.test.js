'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Help = require('../src/renderer/help-panel');
const palette = require('../src/renderer/command-palette');

const INDEX = {
  pages: [
    { slug: 'erste-schritte', title: 'Erste Schritte', order: 10, keywords: 'installation, start', headings: [
      { level: 1, text: 'Erste Schritte', anchor: 'erste-schritte' }, { level: 2, text: 'Voraussetzungen', anchor: 'voraussetzungen' }] },
    { slug: 'worktrees', title: 'Arbeitskopien (Worktrees)', order: 50, keywords: 'worktree, branch', headings: [
      { level: 1, text: 'Arbeitskopien', anchor: 'arbeitskopien' }, { level: 2, text: 'Anlegen', anchor: 'anlegen' }, { level: 2, text: 'Entfernen', anchor: 'entfernen' }] },
    { slug: 'ports', title: 'Ports', order: 60, keywords: 'devserver', headings: [{ level: 1, text: 'Ports', anchor: 'ports' }] },
  ],
};
const PAGES = {
  'erste-schritte': '# Erste Schritte\n\nWeiter mit [Worktrees](worktrees.md#anlegen) oder [extern](https://example.org).\n\n## Voraussetzungen\n\nText',
  worktrees: '# Arbeitskopien\n\nIntro [zurück zum Anfang](#arbeitskopien)\n\n## Anlegen\n\nText\n\n## Entfernen\n\nText',
  ports: '# Ports\n\n<!-- mt:hotkeys -->\n\n| a | b |\n|---|---|\n| 1 | 2 |',
};

function makeEnv(overrides = {}) {
  const doc = {
    activeElement: null,
    createTextNode: (value) => ({ nodeType: 3, text: value }),
    createDocumentFragment: () => ({ nodeType: 11, children: [], append(...k) { this.children.push(...k); } }),
  };
  const h = (tag, props = {}, ...kids) => {
    const el = {
      nodeType: 1, tag, props, children: [], scrollTop: 5, focused: 0, scrolled: 0, hidden: false,
      append(...k) { this.children.push(...k); },
      replaceChildren(...k) { this.children = k.flatMap((x) => (x && x.nodeType === 11 ? x.children : [x])); },
      focus() { this.focused++; doc.activeElement = this; },
      scrollIntoView() { this.scrolled++; },
    };
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'text') el.children.push(doc.createTextNode(v));
      else el[k] = v;
    }
    el.hidden = Boolean(props.hidden);
    for (const c of kids.flat()) if (c != null) el.children.push(c);
    return el;
  };
  const calls = { read: [], index: 0, toggles: [], external: [] };
  const api = {
    async index() { calls.index++; return INDEX; },
    async read(slug) { calls.read.push(slug); return PAGES[slug] ? { slug, title: slug, markdown: PAGES[slug] } : null; },
    ...overrides.api,
  };
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const hooks = overrides.hooks;
  const help = Help.create({ document: doc, api, h, palette, storage, hooks, onToggle: (o) => calls.toggles.push(o), onExternal: (u) => calls.external.push(u) });
  return { doc, help, calls, store, storage };
}
const walk = (n) => [n, ...(n.children || []).flatMap(walk)];
const textOf = (n) => (n.nodeType === 3 ? n.text : (n.children || []).map(textOf).join(''));
const find = (root, pred) => walk(root).find(pred);
const byProp = (root, k, v) => find(root, (n) => n.props && n.props[k] === v);

test('parseKey und resolveKey prüfen Seite und Anker gegen den Index', () => {
  assert.deepEqual(Help.parseKey('worktrees#anlegen'), { slug: 'worktrees', anchor: 'anlegen' });
  assert.deepEqual(Help.parseKey('worktrees'), { slug: 'worktrees', anchor: null });
  assert.equal(Help.parseKey('../x'), null);
  assert.equal(Help.parseKey(''), null);
  assert.deepEqual(Help.resolveKey('worktrees#anlegen', INDEX), { slug: 'worktrees', anchor: 'anlegen' });
  assert.deepEqual(Help.resolveKey('worktrees#gibtsnicht', INDEX), { slug: 'worktrees', anchor: null });
  assert.equal(Help.resolveKey('unbekannt#x', INDEX), null);
});

test('resolveLink: intern bleibt auf der aktuellen Seite, extern wird weitergereicht', () => {
  assert.deepEqual(Help.resolveLink({ external: false, slug: null, anchor: 'a' }, 'ports'), { external: false, slug: 'ports', anchor: 'a' });
  assert.deepEqual(Help.resolveLink({ external: false, slug: 'worktrees', anchor: null }, 'ports'), { external: false, slug: 'worktrees', anchor: null });
  assert.deepEqual(Help.resolveLink({ external: true, href: 'https://x.y' }, 'ports'), { external: true, href: 'https://x.y' });
});

test('Suche: „arbeitskopie“ findet die Seite worktrees, Überschriften sind eigene Treffer', () => {
  const entries = Help.buildSearchEntries(INDEX);
  assert.equal(entries.filter((e) => e.kind === 'page').length, 3);
  assert.ok(!entries.some((e) => e.kind === 'heading' && e.title === 'Ports')); // Ebene 1 ist kein Treffer
  const hits = palette.rank(entries, 'arbeitskopie');
  assert.equal(hits[0].slug, 'worktrees');
  const heading = palette.rank(entries, 'anlegen')[0];
  assert.deepEqual([heading.kind, heading.slug, heading.anchor], ['heading', 'worktrees', 'anlegen']);
  assert.equal(palette.rank(entries, 'devserver')[0].slug, 'ports'); // über Stichwörter
});

test('open() ohne Ziel zeigt die erste Seite, meldet onToggle und rendert Inhalt', async () => {
  const { help, calls, store } = makeEnv();
  await help.open();
  assert.equal(help.isOpen(), true);
  assert.equal(help.el.hidden, false);
  assert.deepEqual(calls.toggles, [true]);
  assert.deepEqual(calls.read, ['erste-schritte']);
  assert.match(textOf(help.el), /Weiter mit Worktrees/);
  assert.equal(store.get('mt.help.last'), 'erste-schritte');
});

test('open(slug, anchor) springt zum Anker; unbekannter Slug fällt auf die zuletzt gelesene Seite zurück', async () => {
  const env = makeEnv();
  await env.help.open('worktrees', 'entfernen');
  const target = byProp(env.help.el, 'data-anchor', 'entfernen');
  assert.equal(target.scrolled, 1);
  env.help.close();
  await env.help.open('gibt-es-nicht');
  assert.equal(env.store.get('mt.help.last'), 'worktrees');
  assert.match(textOf(byProp(env.help.el, 'data-anchor', 'arbeitskopien')), /Arbeitskopien/);
});

test('interne Links wechseln die Seite, Zurück kehrt um; externe gehen an onExternal', async () => {
  const env = makeEnv();
  await env.help.open('erste-schritte');
  const links = walk(env.help.el).filter((n) => n.tag === 'a');
  links[1].onclick({ preventDefault() {} });
  assert.deepEqual(env.calls.external, ['https://example.org']);
  const back = find(env.help.el, (n) => n.props && n.props.title === 'Zurück');
  assert.equal(back.disabled, true);
  links[0].onclick({ preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(env.calls.read, ['erste-schritte', 'worktrees']);
  assert.equal(byProp(env.help.el, 'data-anchor', 'anlegen').scrolled, 1);
  assert.equal(back.disabled, false);
  // Link mit nur #anker bleibt auf der Seite (kein erneutes Laden)
  walk(env.help.el).find((n) => n.tag === 'a').onclick({ preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(env.calls.read, ['erste-schritte', 'worktrees']);
  await back.onclick();
  await back.onclick();
  assert.deepEqual(env.calls.read.slice(-1), ['erste-schritte']);
  assert.equal(back.disabled, true);
});

test('Suchfeld: Treffer ersetzen das Inhaltsverzeichnis, Enter öffnet den ersten Treffer', async () => {
  const env = makeEnv();
  await env.help.open('erste-schritte');
  const search = find(env.help.el, (n) => n.tag === 'input');
  search.oninput({ target: { value: 'arbeitskopie' } });
  const hits = walk(env.help.el).filter((n) => n.props && n.props['data-help-hit']);
  assert.equal(hits[0].props['data-help-hit'], 'page:worktrees');
  let prevented = false;
  search.onkeydown({ key: 'Enter', preventDefault() { prevented = true; } });
  await new Promise((r) => setImmediate(r));
  assert.equal(prevented, true);
  assert.equal(env.calls.read.at(-1), 'worktrees');
  search.oninput({ target: { value: 'zzzzqq' } });
  assert.match(textOf(env.help.el), /Nichts gefunden/);
  search.oninput({ target: { value: '' } });
  assert.ok(walk(env.help.el).some((n) => n.props && n.props['data-help-page'] === 'ports'));
});

test('Esc schließt, gibt den Fokus zurück und meldet onToggle(false)', async () => {
  const env = makeEnv();
  const tile = { focused: 0, focus() { this.focused++; } };
  env.doc.activeElement = tile;
  await env.help.open();
  let stopped = false;
  env.help.el.onkeydown({ key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(env.help.isOpen(), false);
  assert.equal(env.help.el.hidden, true);
  assert.equal(tile.focused, 1);
  assert.deepEqual(env.calls.toggles, [true, false]);
  env.help.el.onkeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); // schon zu: kein zweites Ereignis
  assert.deepEqual(env.calls.toggles, [true, false]);
});

test('link(key) liefert ein kleines ?-Element, das Seite und Abschnitt öffnet', async () => {
  const env = makeEnv();
  const btn = env.help.link('worktrees#anlegen');
  assert.equal(btn.tag, 'button');
  assert.equal(textOf(btn), '?');
  assert.equal(btn.props['data-help'], 'worktrees#anlegen');
  let stopped = false;
  btn.onclick({ preventDefault() {}, stopPropagation() { stopped = true; } });
  await new Promise((r) => setImmediate(r));
  assert.equal(stopped, true);
  assert.equal(env.help.isOpen(), true);
  assert.equal(env.calls.read[0], 'worktrees');
  assert.equal(byProp(env.help.el, 'data-anchor', 'anlegen').scrolled, 1);
});

test('Hooks aus dem Markdown erreichen den Integrator', async () => {
  const seen = [];
  const env = makeEnv({ hooks: { hotkeys: (node) => seen.push(node) } });
  await env.help.open('ports');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].props['data-mt-hook'], 'hotkeys');
});

test('Fehler und leerer Guide werden angezeigt statt zu werfen', async () => {
  const broken = makeEnv({ api: { async index() { throw new Error("Error invoking remote method 'guide:index': Error: kaputt"); } } });
  await broken.help.open();
  assert.match(textOf(broken.help.el), /Hilfe konnte nicht geladen werden: kaputt/);
  const empty = makeEnv({ api: { async index() { return { pages: [] }; } } });
  await empty.help.open();
  assert.match(textOf(empty.help.el), /Keine Hilfeseiten gefunden/);
  const gone = makeEnv({ api: { async read() { return null; } } });
  await gone.help.open();
  assert.match(textOf(gone.help.el), /gibt es nicht/);
});

test('Roh-HTML in einer Seite wird als Text angezeigt', async () => {
  const env = makeEnv({ api: { async read() { return { slug: 'x', title: 'x', markdown: 'Hallo <img src=x onerror=alert(1)>' }; } } });
  await env.help.open();
  assert.equal(walk(env.help.el).filter((n) => n.tag === 'img').length, 0);
  assert.match(textOf(env.help.el), /<img src=x onerror=alert\(1\)>/);
});

test('fehlgeschlagene Seite: Klick auf die zuvor aktive Seite rendert sie wieder', async () => {
  // 'ports' is listed in the index but cannot be read (like a broken link target)
  const bad = makeEnv({ api: { async read(slug) { return slug === 'ports' ? null : { slug, title: slug, markdown: '# ' + slug + '\n\nInhalt ' + slug }; } } });
  await bad.help.open('erste-schritte');
  const pageBtn = (e, slug) => byProp(e.help.el, 'data-help-page', slug);
  await pageBtn(bad, 'ports').props.onclick();
  assert.match(textOf(bad.help.el), /gibt es nicht/);
  assert.equal(pageBtn(bad, 'erste-schritte').props['aria-current'], null);
  await pageBtn(bad, 'erste-schritte').props.onclick();
  assert.match(textOf(bad.help.el), /Inhalt erste-schritte/);
  assert.doesNotMatch(textOf(bad.help.el), /gibt es nicht/);
});

test('Hooks: geerbte Objekt-Eigenschaften werden nicht aufgerufen', async () => {
  const env = makeEnv({
    hooks: { hotkeys: () => {} },
    api: { async read(slug) { return { slug, title: slug, markdown: '# x\n\n<!-- mt:constructor -->\n\n<!-- mt:hotkeys -->' }; } },
  });
  await env.help.open('ports'); // must not throw
  assert.ok(env.help.el);
});

test('Index wird bei jedem Öffnen neu geladen', async () => {
  const env = makeEnv();
  await env.help.open('ports');
  env.help.close();
  await env.help.open('ports');
  assert.equal(env.calls.index, 2);
});

test('Index-Fehler beim erneuten Öffnen behält den alten Index', async () => {
  let fail = false;
  const env = makeEnv({ api: { async index() { if (fail) throw new Error('weg'); return INDEX; } } });
  await env.help.open('ports');
  env.help.close();
  fail = true;
  await env.help.open('ports');
  assert.doesNotMatch(textOf(env.help.el), /konnte nicht geladen/);
  assert.match(textOf(env.help.el), /Ports/);
});

test('echte h-Semantik (k in el / setAttribute, null/false übersprungen)', async () => {
  const mk = () => {
    const attrs = {};
    const el = {
      nodeType: 1, children: [], attrs, className: '', hidden: false, disabled: false, href: '', scrollTop: 0, textContent: '',
      append(...k) { this.children.push(...k); },
      replaceChildren(...k) { this.children = k.flatMap((x) => (x && x.nodeType === 11 ? x.children : [x])); },
      setAttribute(k, v) { attrs[k] = String(v); },
      addEventListener(t, f) { (this.listeners = this.listeners || {})[t] = f; },
      focus() {}, scrollIntoView() {},
    };
    return el;
  };
  const doc = {
    activeElement: null,
    createElement: () => mk(),
    createTextNode: (value) => ({ nodeType: 3, text: value }),
    createDocumentFragment: () => ({ nodeType: 11, children: [], append(...k) { this.children.push(...k); } }),
  };
  // same logic as DeckApp.h in terminal-pane.js
  const h = (tag, props, ...kids) => {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null) el.append(c);
    return el;
  };
  const store = new Map();
  const api = {
    async index() { return INDEX; },
    async read(slug) { return { slug, title: slug, markdown: PAGES[slug] }; },
  };
  const help = Help.create({ document: doc, api, h, palette, storage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) } });
  assert.equal(help.el.hidden, true);
  await help.open('worktrees');
  assert.equal(help.el.hidden, false);
  const all = (n) => [n, ...(n.children || []).flatMap(all)];
  const active = all(help.el).filter((n) => n.attrs && n.attrs['aria-current'] === 'page');
  assert.equal(active.length, 1);
  assert.equal(active[0].attrs['data-help-page'], 'worktrees');
  const inactive = all(help.el).filter((n) => n.attrs && n.attrs['data-help-page'] && n.attrs['aria-current'] === undefined);
  assert.equal(inactive.length, 2);
});
