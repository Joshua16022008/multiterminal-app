'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/renderer/command-palette');

const projects = [{ id: 'p1', name: 'Alpha', path: '/x/alpha' }, { id: 'p2', name: 'Beta Über', path: '/x/beta' }];
const panes = {
  p1: [{ id: 't1', desc: { title: 'Server', presetId: 'claude' } }, { id: 't2', desc: { title: 'Tests' } }],
  p2: [{ id: 't3', desc: { title: 'Server', presetId: 'codex' } }],
};
const build = (over = {}) => P.buildEntries({
  projects, panesOf: (id) => panes[id] || [], activeId: 'p1',
  actions: [{ id: 'new-terminal', label: 'Neues Terminal', hotkey: '⌘ + T' }, { id: 'settings', label: 'Einstellungen öffnen' }],
  presetLabel: (d) => ({ claude: 'Claude', codex: 'Codex' }[d.presetId] || ''), ...over,
});

test('Einträge enthalten Aktionen, Projekte und Kacheln mit Projektkontext', () => {
  const e = build();
  assert.deepEqual(e.map((x) => x.kind), ['action', 'action', 'project', 'project', 'pane', 'pane', 'pane']);
  const servers = e.filter((x) => x.kind === 'pane' && x.title === 'Server');
  assert.equal(servers.length, 2, 'gleiche Kachelnamen in zwei Projekten bleiben getrennt');
  assert.notEqual(servers[0].id, servers[1].id);
  assert.match(servers[0].subtitle, /Alpha · Terminal 1 · Claude/);
  assert.match(servers[1].subtitle, /Beta Über · Terminal 1 · Codex/);
  assert.equal(servers[1].projectId, 'p2');
});

test('gleiche Namen: Suche nach Projekt trennt die Treffer', () => {
  const r = P.rank(build(), 'server beta');
  assert.equal(r[0].paneId, 't3');
  assert.ok(!r.some((x) => x.paneId === 't1'));
});

test('leere Suche liefert alles in Ursprungsreihenfolge, begrenzt', () => {
  const e = build();
  assert.deepEqual(P.rank(e, '').map((x) => x.id), e.map((x) => x.id));
  assert.equal(P.rank(e, '   ').length, e.length);
  assert.equal(P.rank(e, '', 3).length, 3);
});

test('Umlaute und Akzente: ü findet u und umgekehrt, ß wird ss', () => {
  const e = build();
  assert.equal(P.rank(e, 'uber')[0].projectId, 'p2');
  assert.equal(P.rank(e, 'ÜBER')[0].projectId, 'p2');
  assert.equal(P.normalize('Straße'), 'strasse');
});

test('Teilsuche und unscharfe Suche, Titeltreffer vor Nebentreffern', () => {
  const e = build();
  assert.equal(P.rank(e, 'tes')[0].paneId, 't2');
  assert.equal(P.rank(e, 'einst')[0].actionId, 'settings');
  assert.equal(P.rank(e, 'nstrm')[0].actionId, 'new-terminal');
  assert.equal(P.rank(e, 'codex')[0].paneId, 't3');
  assert.deepEqual(P.rank(e, 'zzzz'), []);
});

test('geschlossene Kachel verschwindet aus den Ergebnissen', () => {
  const live = { p1: [panes.p1[0]], p2: panes.p2 };
  const r = P.rank(build({ panesOf: (id) => live[id] || [] }), 'tests');
  assert.ok(!r.some((x) => x.paneId === 't2'));
});

test('aktives Projekt und Terminalzahl stehen im Untertitel', () => {
  const p = build().filter((x) => x.kind === 'project');
  assert.match(p[0].subtitle, /2 Terminals · aktiv/);
  assert.match(p[1].subtitle, /1 Terminal$/);
});
