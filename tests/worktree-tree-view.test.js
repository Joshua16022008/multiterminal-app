'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/renderer/worktree-tree');

/* ---- fake DOM in the style of the other panel tests ---- */
function h(tag, props = {}, ...children) {
  const el = {
    tag, ...props, hidden: !!props.hidden, children: children.flat().filter(Boolean), style: { setProperty() {} },
    attrs: {},
    // Like the real DOM, native append/replaceChildren would print null as text: refuse it here.
    append(...items) { if (items.some((i) => i == null)) throw new Error('append(null) prints "null"'); this.children.push(...items); },
    replaceChildren(...items) { if (items.some((i) => i == null)) throw new Error('replaceChildren(null) prints "null"'); this.children = items; },
    setAttribute(k, v) { this.attrs[k] = v; },
  };
  return el;
}
const all = (el) => [el, ...(el.children || []).flatMap(all)];
const text = (root) => all(root).map((e) => e.text || '').join('\n');
const buttons = (root, label) => all(root).filter((e) => e.tag === 'button' && e.text === label);
const button = (root, label) => buttons(root, label)[0];
const tick = () => new Promise((r) => setImmediate(r));

function fakeDoc() {
  const root = h('section', { hidden: true });
  const listeners = {};
  return {
    root,
    getElementById: (id) => (id === 'worktree-view' ? root : null),
    createElementNS: (ns, tag) => ({ ns, tag, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); } }),
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || new Set()).add(fn); },
    removeEventListener: (t, fn) => { (listeners[t] || new Set()).delete(fn); },
    key(k) { for (const fn of [...(listeners.keydown || [])]) fn({ key: k, preventDefault() {} }); },
    listenerCount: () => (listeners.keydown || new Set()).size,
  };
}

const node = (o) => ({ id: o.id, path: '/p/' + o.id, branch: o.id, head: 'abcdef1234', detached: false, locked: false, prunable: false, missing: false,
  kind: 'managed', origin: 'app', workspaceId: o.id, forkPoint: 'aaa', ahead: 0, behind: 0, merged: false,
  last: { sha: 'deadbeefcafe', subject: 'Betreff ' + o.id, time: 1700000000, author: 'x' }, changes: 0, ...o });

const TREE = {
  ok: true, isGit: true, projectPath: '/p/proj', generatedAt: Date.now(),
  trunk: { name: 'main', head: '1234567abc', subject: 'Stamm', time: 1700000000 },
  nodes: [
    node({ id: 'proj', branch: 'main', kind: 'project', workspaceId: null, path: '/p/proj' }),
    node({ id: 'feature/a', ahead: 2, behind: 1, changes: 3 }),
    node({ id: 'ext', branch: 'codex/x', kind: 'external', origin: 'codex', workspaceId: null, path: '/home/u/.codex/worktrees/1/x' }),
    node({ id: 'done', merged: true }),
    node({ id: 'dead', prunable: true, missing: true, last: null, changes: null }),
  ],
};

function setup({ tree = TREE, api = {}, hooks = {}, confirmAnswer = true, layout } = {}) {
  const doc = fakeDoc();
  const log = { confirms: [], notices: [], hooks: [], calls: [] };
  const fullApi = { worktrees: {
    tree: async (id) => { log.calls.push(['tree', id]); return typeof tree === 'function' ? tree() : tree; },
    adopt: async (pid, cwd) => { log.calls.push(['adopt', pid, cwd]); return { ok: true, workspace: { workspaceId: 'ws-new', cwd, branch: 'codex/x', managed: false } }; },
    remove: async (id) => { log.calls.push(['remove', id]); return { ok: true, branchKept: id }; },
    ...api.worktrees,
  } };
  const view = T.create({ document: doc, api: fullApi, h, notify: (m, k) => log.notices.push([m, k]), confirm: (m) => { log.confirms.push(m); return confirmAnswer; }, layout });
  const record = (name) => (...a) => { log.hooks.push([name, ...a]); };
  view.setHooks({
    panesFor: (id) => (id === 'feature/a' ? [{ id: 'pane1', title: 'Kachel 1', activity: 'working' }] : []),
    onJump: record('jump'), onOpenTerminal: record('terminal'), onStartAgent: record('agent'), onShowDiff: record('diff'), onAdopt: record('adopt'),
    ...hooks,
  });
  return { view, doc, log };
}
const project = { id: 'p1', name: 'Demo' };
const card = (doc, id) => all(doc.root).find((e) => e['data-node-id'] === id);

test('renders one card per branch with kind, ahead/behind, merged, last commit and changes', async () => {
  const s = setup();
  await s.view.open({ project });
  assert.equal(s.doc.root.hidden, false);
  assert.ok(s.view.isOpen());
  assert.deepEqual(s.log.calls[0], ['tree', 'p1']);
  const t = text(s.doc.root);
  assert.match(t, /Arbeitskopien · Demo/);
  assert.match(t, /Stamm: main/);
  const a = text(card(s.doc, 'feature/a'));
  assert.match(a, /verwaltet/); assert.match(a, /↑2/); assert.match(a, /↓1/);
  assert.match(a, /3 Änderungen/); assert.match(a, /deadbee/); assert.match(a, /Betreff feature\/a/);
  assert.match(text(card(s.doc, 'proj')), /Projekt/);
  assert.match(text(card(s.doc, 'ext')), /extern \(Codex\)/);
  assert.match(text(card(s.doc, 'done')), /gemergt/);
  assert.doesNotMatch(text(card(s.doc, 'feature/a')), /gemergt/);
  assert.match(t, /erst bei der nächsten Aktualisierung/); // checkout hint
  assert.equal(all(s.doc.root).filter((e) => e['data-node-id']).length, 5);
});

test('running tiles hang on their branch with a status dot, and a click jumps and closes', async () => {
  const s = setup();
  await s.view.open({ project });
  const c = card(s.doc, 'feature/a');
  const pane = all(c).find((e) => e.class === 'wtv-pane');
  assert.ok(pane);
  assert.equal(all(pane).find((e) => e.class === 'wtv-dot')['data-activity'], 'working');
  assert.match(text(pane), /Kachel 1 · arbeitet/);
  pane.onclick();
  assert.deepEqual(s.log.hooks, [['jump', 'pane1']]);
  assert.equal(s.view.isOpen(), false);
  assert.equal(s.doc.root.hidden, true);
});

test('dirty managed branch without a tile: exact removal reason', async () => {
  const tree = { ...TREE, nodes: [...TREE.nodes, node({ id: 'dirty', changes: 4 })] };
  const s = setup({ tree });
  await s.view.open({ project });
  const b = buttons(card(s.doc, 'dirty'), 'Entfernen')[0];
  assert.equal(b.disabled, true);
  assert.equal(b.title, '4 ungesicherte Änderungen. Erst sichern oder verwerfen.');
});

test('other-origin external folders get the same question; open without any project stays closed', async () => {
  const tree = { ...TREE, nodes: [...TREE.nodes, node({ id: 'o', kind: 'external', origin: 'other', workspaceId: null })] };
  const s = setup({ tree });
  await s.view.open({ project });
  await button(card(s.doc, 'o'), 'Übernehmen…').onclick();
  assert.match(s.log.confirms[0], /anderen Werkzeug\. Ein zweiter Agent.*\n\nTrotzdem verknüpfen und fortfahren\?$/s);
  const e = setup();
  await e.view.open({});
  assert.equal(e.view.isOpen(), false);
  assert.equal(e.doc.listenerCount(), 0);
  assert.equal(e.log.calls.length, 0);
});

test('focus works for ids with quotes and backslashes', async () => {
  const odd = 'fe"at\\x';
  const tree = { ...TREE, nodes: [...TREE.nodes, node({ id: odd })] };
  const doc = fakeDoc();
  const scrolled = [];
  const hh = (tag, p, ...k) => { const e = h(tag, p, ...k); e.scrollIntoView = () => scrolled.push(e['data-node-id']); return e; };
  const view = T.create({ document: doc, h: hh, api: { worktrees: { tree: async () => tree } }, notify() {} });
  await view.open({ project, focusId: odd });
  assert.deepEqual(scrolled, [odd]);
});

test('Entfernen exists only for managed branches and is disabled when dirty or in use', async () => {
  const s = setup();
  await s.view.open({ project });
  assert.equal(buttons(card(s.doc, 'proj'), 'Entfernen').length, 0);
  assert.equal(buttons(card(s.doc, 'ext'), 'Entfernen').length, 0);
  assert.equal(buttons(card(s.doc, 'done'), 'Entfernen')[0].disabled, false);
  const dirty = buttons(card(s.doc, 'feature/a'), 'Entfernen')[0];
  assert.equal(dirty.disabled, true);
  assert.match(dirty.title, /3 ungesicherte Änderungen|Eine Kachel nutzt/);
  // clean but with a tile: still blocked
  assert.match(T.removalBlock(node({ id: 'q' }), [{ id: 'x' }]), /Kachel/);
  assert.match(T.removalBlock(node({ id: 'q', changes: null }), []), /nicht lesbar/);
  assert.equal(T.removalBlock(node({ id: 'q' }), []), null);
});

test('removing a clean managed branch asks, calls the API, reloads and keeps the branch', async () => {
  const s = setup();
  await s.view.open({ project });
  await button(card(s.doc, 'done'), 'Entfernen').onclick();
  assert.match(s.log.confirms[0], /Branch bleibt bestehen/);
  assert.deepEqual(s.log.calls.filter((c) => c[0] === 'remove'), [['remove', 'done']]);
  assert.equal(s.log.calls.filter((c) => c[0] === 'tree').length, 2);
  assert.match(s.log.notices[0][0], /bleibt bestehen/);
  // declining does nothing
  const s2 = setup({ confirmAnswer: false });
  await s2.view.open({ project });
  await button(card(s2.doc, 'done'), 'Entfernen').onclick();
  assert.equal(s2.log.calls.filter((c) => c[0] === 'remove').length, 0);
});

test('a refused removal is reported, never swallowed', async () => {
  const s = setup({ api: { worktrees: { remove: async () => ({ ok: false, error: '2 nicht gesicherte Änderungen; nichts entfernt.' }) } } });
  await s.view.open({ project });
  await button(card(s.doc, 'done'), 'Entfernen').onclick();
  assert.match(s.log.notices[0][0], /nichts entfernt/);
});

test('external branch: warning with the exact text, adopt only after consent, then the terminal opens', async () => {
  const declined = setup({ confirmAnswer: false });
  await declined.view.open({ project });
  await button(card(declined.doc, 'ext'), 'Übernehmen…').onclick();
  assert.equal(declined.log.confirms[0], 'Dieser Ordner gehört einem anderen Werkzeug (Codex). Ein zweiter Agent im selben Ordner kann dessen Arbeit stören.\n\nTrotzdem verknüpfen und fortfahren?');
  assert.equal(declined.log.calls.filter((c) => c[0] === 'adopt').length, 0);
  assert.equal(declined.log.hooks.length, 0);
  assert.ok(declined.view.isOpen());

  const s = setup();
  await s.view.open({ project });
  await button(card(s.doc, 'ext'), 'Übernehmen…').onclick();
  assert.deepEqual(s.log.calls.filter((c) => c[0] === 'adopt'), [['adopt', 'p1', '/home/u/.codex/worktrees/1/x']]);
  assert.deepEqual(s.log.hooks.map((x) => x[0]), ['adopt', 'terminal']);
  assert.equal(s.log.hooks[0][2].workspaceId, 'ws-new');
  assert.equal(s.log.hooks[1][2].workspaceId, 'ws-new');
  assert.equal(s.view.isOpen(), false);
});

test('diff and agent start on an external branch warn first; a failed adopt stays open with a notice', async () => {
  const no = setup({ confirmAnswer: false });
  await no.view.open({ project });
  await button(card(no.doc, 'ext'), 'Änderungen ansehen').onclick();
  assert.equal(no.log.confirms.length, 1);
  assert.equal(no.log.calls.filter((c) => c[0] === 'adopt').length, 0); // no consent, no adopt
  assert.equal(no.log.hooks.length, 0);
  assert.ok(no.view.isOpen());

  const s = setup();
  await s.view.open({ project });
  await button(card(s.doc, 'ext'), 'Änderungen ansehen').onclick();
  assert.equal(s.log.confirms.length, 1);
  assert.deepEqual(s.log.hooks.map((x) => x[0]), ['adopt', 'diff']);
  assert.equal(s.log.hooks[1][2], 'ws-new');

  const a = setup();
  await a.view.open({ project });
  await button(card(a.doc, 'ext'), 'Agent hier starten').onclick();
  assert.equal(a.log.confirms.length, 1);
  assert.deepEqual(a.log.hooks[1].slice(0, 1).concat(a.log.hooks[1][2]), ['agent', 'ws-new']);

  const f = setup({ api: { worktrees: { adopt: async () => ({ ok: false, error: 'Kein bekannter Worktree.' }) } } });
  await f.view.open({ project });
  await button(card(f.doc, 'ext'), 'Übernehmen…').onclick();
  assert.match(f.log.notices[0][0], /Kein bekannter Worktree/);
  assert.equal(f.log.hooks.length, 0);
  assert.ok(f.view.isOpen());
});

test('own and project branches act without any warning', async () => {
  const s = setup();
  await s.view.open({ project });
  await button(card(s.doc, 'feature/a'), 'Terminal hier öffnen').onclick();
  assert.equal(s.log.confirms.length, 0);
  assert.deepEqual(s.log.hooks[0].slice(0, 1).concat(s.log.hooks[0][2].workspaceId), ['terminal', 'feature/a']);
  const p = setup();
  await p.view.open({ project });
  await button(card(p.doc, 'proj'), 'Agent hier starten').onclick();
  assert.deepEqual(p.log.hooks[0], ['agent', project, null]);
  const d = setup();
  await d.view.open({ project });
  await button(card(d.doc, 'proj'), 'Änderungen ansehen').onclick();
  assert.deepEqual(d.log.hooks[0], ['diff', project, null]);
});

test('orphaned entries only get a hint, no actions', async () => {
  const s = setup();
  await s.view.open({ project });
  const dead = card(s.doc, 'dead');
  assert.match(text(dead), /verwaist/);
  assert.match(text(dead), /git worktree prune/);
  assert.equal(all(dead).filter((e) => e.tag === 'button').length, 0);
});

test('focusId highlights its branch', async () => {
  const s = setup();
  await s.view.open({ project, focusId: 'feature/a' });
  assert.match(card(s.doc, 'feature/a').class, /focus/);
  assert.doesNotMatch(card(s.doc, 'done').class, /focus/);
});

test('Esc and the back button close; the key listener is released', async () => {
  const s = setup();
  await s.view.open({ project });
  assert.equal(s.doc.listenerCount(), 1);
  s.doc.key('Enter');
  assert.ok(s.view.isOpen());
  s.doc.key('Escape');
  assert.equal(s.view.isOpen(), false);
  assert.equal(s.doc.listenerCount(), 0);
  await s.view.open({ project });
  button(s.doc.root, '← Zurück zu den Terminals').onclick();
  assert.equal(s.view.isOpen(), false);
});

test('empty, no-repository and error states', async () => {
  let s = setup({ tree: { ok: true, isGit: false, nodes: [], trunk: null } });
  await s.view.open({ project });
  assert.match(text(s.doc.root), /kein Git-Repository/);
  s = setup({ tree: { ok: true, isGit: true, nodes: [], trunk: null } });
  await s.view.open({ project });
  assert.match(text(s.doc.root), /noch keine Arbeitskopien/);

  let fail = true;
  s = setup({ tree: () => { if (fail) throw new Error("Error invoking remote method 'worktrees:tree': Error: Projekt unbekannt."); return TREE; } });
  await s.view.open({ project });
  assert.match(text(s.doc.root), /Projekt unbekannt/);
  assert.doesNotMatch(text(s.doc.root), /Error invoking/);
  fail = false;
  await button(s.doc.root, 'Erneut versuchen').onclick();
  assert.match(text(s.doc.root), /Stamm: main/);
});

test('refresh re-reads while open, and a late answer after close is dropped', async () => {
  const s = setup();
  await s.view.open({ project });
  await s.view.refresh();
  assert.equal(s.log.calls.filter((c) => c[0] === 'tree').length, 2);
  let release;
  const slow = setup({ tree: () => new Promise((r) => { release = r; }) });
  const opening = slow.view.open({ project });
  slow.view.close();
  release(TREE);
  await opening; await tick();
  assert.equal(slow.doc.root.hidden, true);
  assert.equal(slow.view.isOpen(), false);
  assert.equal(await slow.view.refresh(), undefined); // closed: no read
});

test('uses the DeckTreeLayout contract for positions, edges and colours', async () => {
  const seen = [];
  const layout = {
    layout: (t) => { seen.push(t); return { width: 400, height: 900, nodes: t.nodes.map((n, i) => ({ id: n.id, x: 30, y: 40 + i * 180 })), edges: [{ from: 'proj', to: 'feature/a', d: 'M30,40 C30,100 60,100 60,220' }] }; },
    colorFor: (b) => (b === 'feature/a' ? '#123456' : '#654321'),
  };
  const colors = [];
  const doc = fakeDoc();
  const view = T.create({ document: doc, h: (tag, p, ...k) => { const e = h(tag, p, ...k); e.style.setProperty = (n, v) => colors.push([p && p['data-node-id'], n, v]); return e; },
    api: { worktrees: { tree: async () => TREE } }, notify() {}, layout });
  await view.open({ project });
  assert.equal(seen[0], TREE);
  const a = all(doc.root).find((e) => e['data-node-id'] === 'feature/a');
  assert.equal(a.style.left, '50px');
  assert.equal(a.style.top, '206px'); // y of node 1 (220) minus 14
  assert.ok(colors.some(([id, n, v]) => id === 'feature/a' && n === '--wt-color' && v === '#123456'));
  const svg = all(doc.root).find((e) => e.attrs && e.attrs.class === 'wtv-svg') || all(doc.root).find((e) => e.tag === 'div' && e.class === 'wtv-stage').children[0];
  const paths = svg.children.filter((c) => c.tag === 'path');
  assert.equal(paths.length, 1);
  assert.equal(paths[0].attrs.d, 'M30,40 C30,100 60,100 60,220');
  assert.equal(paths[0].attrs.stroke, '#123456');
});

test('without a layout module the view still works with a plain vertical fallback', async () => {
  const s = setup();
  await s.view.open({ project });
  const tops = ['proj', 'feature/a', 'ext'].map((id) => parseInt(card(s.doc, id).style.top, 10));
  assert.ok(tops[0] < tops[1] && tops[1] < tops[2]);
});

test('helpers: relative time (seconds and ms), short path and labels', () => {
  const now = 1700000000 * 1000 + 3 * 3600 * 1000;
  assert.equal(T.relTime(1700000000, now), 'vor 3 Std.');
  assert.equal(T.relTime(1700000000 * 1000, now), 'vor 3 Std.');
  assert.equal(T.relTime(null, now), '');
  assert.equal(T.shortPath('/a/b/c/d/e'), '…/c/d/e');
  assert.equal(T.shortPath('/a/b'), '/a/b');
  assert.equal(T.kindLabel(node({ id: 'x', kind: 'linked' })), 'übernommen');
  assert.equal(T.kindLabel(node({ id: 'x', kind: 'external', origin: 'other' })), 'extern');
});
