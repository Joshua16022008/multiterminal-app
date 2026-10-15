'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/renderer/terminal-search');

/* Minimaler xterm-Puffer: Zeilen als { text, wrapped }, ein Zeichen je Zelle;
   breite Zeichen belegen zwei Zellen, die zweite ist leer mit Breite 0. */
const WIDE = /[宽字]/;
function fakeBuffer(rows, cols) {
  const lines = rows.map((r) => {
    const cells = [];
    for (const ch of r.text) {
      cells.push({ ch, w: WIDE.test(ch) ? 2 : 1 });
      if (WIDE.test(ch)) cells.push({ ch: '', w: 0 });
    }
    while (cells.length < cols) cells.push({ ch: '', w: 1 });
    return { isWrapped: !!r.wrapped, length: cols, getCell: (x) => ({ getChars: () => cells[x].ch, getWidth: () => cells[x].w }) };
  });
  return { length: lines.length, getLine: (i) => lines[i] };
}
const find = (rows, query, cols = 10) => S.findMatches(S.logicalLines(fakeBuffer(rows, cols), cols), query, cols).matches;

test('leere Suche findet nichts', () => {
  assert.deepEqual(find([{ text: 'hallo' }], ''), []);
  assert.deepEqual(find([{ text: 'hallo' }], null), []);
});

test('Groß-/Kleinschreibung wird ignoriert, Position in Zeile und Spalte', () => {
  const m = find([{ text: 'Hallo Welt' }, { text: 'welt hallo' }], 'WELT');
  assert.deepEqual(m, [{ row: 0, col: 6, length: 4 }, { row: 1, col: 0, length: 4 }]);
});

test('Umlaute und Unicode (auch Emoji, breite Zeichen)', () => {
  assert.equal(find([{ text: 'Größe ÄÖÜ' }], 'ÄÖÜ').length, 1);
  assert.equal(find([{ text: 'Größe ÄÖÜ' }], 'äöü')[0].col, 6);
  assert.equal(find([{ text: 'a 🎉 b' }], '🎉').length, 1);
  assert.deepEqual(find([{ text: 'x宽y' }], '宽'), [{ row: 0, col: 1, length: 2 }]);
  assert.deepEqual(find([{ text: 'x宽y' }], 'y'), [{ row: 0, col: 3, length: 1 }]);
});

test('Kleinschreibung, die Zeichen verlängert (İ), verschiebt Treffer nicht', () => {
  assert.deepEqual(find([{ text: 'İx ab' }], 'ab'), [{ row: 0, col: 3, length: 2 }]);
});

test('umgebrochene Zeile: Treffer über den Umbruch hinweg, Start in der ersten Zeile', () => {
  const rows = [{ text: 'abcdefghij' }, { text: 'klmno', wrapped: true }, { text: 'neu' }];
  assert.deepEqual(find(rows, 'hijklm'), [{ row: 0, col: 7, length: 6 }]);
  assert.deepEqual(find(rows, 'onew'), []);
  assert.deepEqual(find(rows, 'neu'), [{ row: 2, col: 0, length: 3 }]);
});

test('Treffer in der Fortsetzungszeile liegt in der richtigen Zeile', () => {
  const rows = [{ text: 'abcdefghij' }, { text: 'klmno', wrapped: true }];
  assert.deepEqual(find(rows, 'mno'), [{ row: 1, col: 2, length: 3 }]);
});

test('mehrere Treffer je Zeile ohne Überlappung; Zellfüllung am Zeilenende zählt nicht', () => {
  assert.equal(find([{ text: 'aaaa' }], 'aa').length, 2);
  assert.equal(find([{ text: 'ab' }], ' ').length, 0);
});

test('Trefferdeckel meldet Abschneiden', () => {
  const lines = S.logicalLines(fakeBuffer(Array.from({ length: 20 }, () => ({ text: 'x' })), 4), 4);
  const r = S.findMatches(lines, 'x', 4, 5);
  assert.equal(r.matches.length, 5);
  assert.equal(r.truncated, true);
});

test('Navigation springt zyklisch, Anzeige n/m', () => {
  assert.equal(S.nextIndex(-1, 3, 1), 0);
  assert.equal(S.nextIndex(-1, 3, -1), 2);
  assert.equal(S.nextIndex(2, 3, 1), 0);
  assert.equal(S.nextIndex(0, 3, -1), 2);
  assert.equal(S.nextIndex(0, 0, 1), -1);
  assert.equal(S.summary(0, -1, false), 'Keine Treffer');
  assert.equal(S.summary(7, 2, false), '3/7');
  assert.equal(S.summary(5000, 0, true), '1/5000+');
});

test('Suchumfang wird sichtbar benannt', () => {
  assert.match(S.scopeText(120, 5024), /geladenen Verlauf dieser Kachel.*120 Zeilen.*max\. 5024/);
});

/* Oberfläche gegen ein kleines DOM-Double. */
function fakeDom() {
  const mk = (tag) => {
    const el = { tag, children: [], listeners: {}, hidden: false, attrs: {}, classList: { toggle() {}, add() {} }, style: {}, value: '', focused: false };
    el.append = (...k) => { el.children.push(...k); };
    el.setAttribute = (k, v) => { el.attrs[k] = v; };
    el.addEventListener = (t, f) => { el.listeners[t] = f; };
    el.focus = () => { el.focused = true; };
    el.select = () => {};
    return el;
  };
  return { createElement: mk };
}

test('Suchleiste: Treffer n/m, Enter/Umschalt+Enter, Esc gibt Fokus zurück, nichts gelangt ins PTY', () => {
  const document = fakeDom();
  const cols = 10;
  const buf = Object.assign(fakeBuffer([{ text: 'foo bar' }, { text: 'Bar foo' }], cols), { viewportY: 0 });
  const writes = [];
  let selection = null, focusedPane = 0;
  const pane = {
    id: 'a', el: document.createElement('div'),
    term: {
      cols, rows: 5, options: { scrollback: 100 }, buffer: { active: buf },
      select: (c, r, l) => { selection = { c, r, l }; }, clearSelection: () => { selection = null; }, scrollToLine() {},
      input: (d) => writes.push(d), write: (d) => writes.push(d),
    },
    focus: () => { focusedPane++; },
  };
  const search = S.create({ document, getPane: () => pane });
  assert.equal(search.open(pane), true);
  const bar = pane.el.children[0];
  const input = bar.children[0].children[0];
  const count = bar.children[0].children[1];
  assert.equal(input.focused, true);
  input.value = 'BAR';
  input.listeners.input();
  assert.deepEqual(selection, { c: 4, r: 0, l: 3 });
  assert.equal(count.textContent, '1/2');
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {} });
  assert.deepEqual(selection, { c: 0, r: 1, l: 3 });
  assert.equal(count.textContent, '2/2');
  input.listeners.keydown({ key: 'Enter', shiftKey: true, preventDefault() {} });
  assert.deepEqual(selection, { c: 4, r: 0, l: 3 });
  assert.match(bar.children[1].textContent, /geladenen Verlauf/);
  let stopped = false;
  input.listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(bar.hidden, true);
  assert.equal(selection, null);
  assert.equal(focusedPane, 1);
  assert.deepEqual(writes, []);
  assert.equal(search.isOpen('a'), false);
});
