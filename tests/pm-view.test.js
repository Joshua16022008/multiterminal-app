'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const View = require('../src/renderer/pm-view');
const Send = require('../src/renderer/pm-send');
const hk = require('../src/renderer/hotkeys');

const NOW = 1_000_000;
const sample = {
  ok: true,
  project: { id: 'p1', name: 'Demo', path: '/tmp/demo' },
  capturedAt: NOW,
  terminals: [
    { id: 't1', title: 'Backend', preset: 'claude', running: true, agent: { provider: 'claude', state: 'needs-input', since: NOW - 125000 }, workspace: { workspaceId: 'w1', branch: 'feat/x' } },
    { id: 't2', title: 'Shell', preset: null, running: true, agent: null, workspace: null },
    { id: 't3', title: 'Alt', preset: null, running: false, agent: { provider: 'codex', state: 'working', since: null }, workspace: null },
    { id: 't4', title: 'Fremd', preset: 'x', running: true, agent: { provider: null, state: 'bogus', since: null }, workspace: null },
  ],
  worktrees: [{ workspaceId: 'w1', branch: 'feat/x', missing: false, changedFiles: 3 }, { workspaceId: 'w2', branch: 'old', missing: true, changedFiles: null }],
  changes: { ok: true, branch: 'main', staged: 1, unstaged: 2, untracked: 0 },
  ports: [{ port: 3000, terminalId: 't1', url: 'http://localhost:3000' }, { port: 8080, terminalId: null, url: null }],
  docs: { nextStep: 'Tests schreiben', activeReservations: 2 },
  manager: { running: true, resumed: false },
};

test('Lagebild: Kachelzustände ehrlich dargestellt', () => {
  const m = View.describe(sample, NOW);
  assert.equal(m.ok, true);
  assert.deepEqual(m.terminals.map(t => [t.kind, t.stateText]), [
    ['needs-input', 'wartet auf dich'], ['none', 'kein Agentenereignis'], ['ended', 'beendet'], ['unknown', 'unbekannt'],
  ]);
  assert.equal(m.terminals[0].since, 'seit 2 min');
  assert.equal(m.terminals[0].branch, 'feat/x');
  assert.equal(m.terminals[2].since, null);
});

test('Lagebild: ohne Agentenstatus ist der Zustand unbekannt, nicht "kein Agent"', () => {
  const m = View.describe({ ...sample, agentStatusEnabled: false }, NOW);
  assert.equal(m.terminals[1].kind, 'unknown');
  assert.match(m.terminals[1].stateText, /Agentenstatus aus/);
});

test('Lagebild: Arbeitskopien, Änderungen, Ports, nächster Schritt', () => {
  const m = View.describe(sample, NOW);
  assert.equal(m.worktrees[0].changed, '3 Dateien');
  assert.equal(m.worktrees[1].missing, true);
  assert.equal(m.worktrees[1].changed, 'unbekannt');
  assert.equal(m.changes.text, '1 vorgemerkt · 2 geändert · 0 neu');
  assert.equal(m.ports.length, 2);
  assert.equal(m.nextStep, 'Tests schreiben');
  assert.equal(m.reservations, 2);
  assert.equal(m.projectName, 'Demo');
});

test('Lagebild: Fehler und fehlende Teile', () => {
  assert.deepEqual(View.describe({ ok: false, error: 'kaputt' }), { ok: false, error: 'kaputt' });
  assert.equal(View.describe(null).ok, false);
  const m = View.describe({ ok: true, project: { name: 'X' }, changes: { ok: false, error: 'kein Git' }, docs: {} }, NOW);
  assert.equal(m.changes.ok, false);
  assert.match(m.changes.text, /kein Git/);
  assert.equal(m.nextStep, null);
  assert.equal(m.reservations, null);
  assert.deepEqual(m.terminals, []);
  const clean = View.describe({ ok: true, changes: { ok: true, staged: 0, unstaged: 0, untracked: 0 } }, NOW);
  assert.equal(clean.changes.text, 'sauber');
});

function fakePane(over = {}) { return { id: 't1', status: 'running', disposed: false, project: { id: 'p1' }, ...over }; }

test('pm:sendRequest öffnet die Promptvorschau mit Präfix', () => {
  const calls = [];
  const handle = Send.createSendHandler({ getPane: id => (id === 't1' ? fakePane() : null), getDraft: () => null, openDraft: o => { calls.push(o); return true; } });
  assert.deepEqual(handle({ requestId: 'r', projectId: 'p1', terminalId: 't1', text: 'Mach X' }), { ok: true });
  assert.deepEqual(calls, [{ terminalId: 't1', text: '[Projektmanager] Mach X' }]);
});

test('pm:sendRequest Fehlerfälle', () => {
  let draft = null;
  const panes = { t1: fakePane(), t2: fakePane({ id: 't2', project: { id: 'other' } }), t3: fakePane({ id: 't3', status: 'exited' }) };
  const handle = Send.createSendHandler({ getPane: id => panes[id] || null, getDraft: () => draft, openDraft: () => true });
  assert.match(handle({ projectId: 'p1', terminalId: 'nope', text: 'a' }).error, /nicht mehr/);
  assert.match(handle({ projectId: 'p1', terminalId: 't2', text: 'a' }).error, /nicht zum Projekt/);
  assert.match(handle({ projectId: 'p1', terminalId: 't3', text: 'a' }).error, /läuft nicht/);
  assert.equal(handle({ projectId: 'p1', terminalId: 't1', text: '' }).ok, false);
  assert.equal(handle(null).ok, false);
  draft = { terminalId: 't1' };
  assert.deepEqual(handle({ projectId: 'p1', terminalId: 't1', text: 'a' }), { ok: false, error: 'Es ist bereits eine Vorschau offen.' });
  draft = null;
  const failing = Send.createSendHandler({ getPane: () => fakePane(), getDraft: () => null, openDraft: () => false });
  assert.equal(failing({ projectId: 'p1', terminalId: 't1', text: 'a' }).ok, false);
  const throwing = Send.createSendHandler({ getPane: () => { throw new Error('boom'); }, getDraft: () => null, openDraft: () => true });
  assert.deepEqual(throwing({ projectId: 'p1', terminalId: 't1', text: 'a' }), { ok: false, error: 'boom' });
});

test('Hotkey project-manager: Standard gültig und kollisionsfrei', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const d = hk.defaults(platform);
    assert.equal(d['project-manager'].length, 1);
    assert.doesNotThrow(() => hk.validate(d, platform));
  }
  assert.deepEqual(hk.defaults()['project-manager'], ['Cmd+Shift+O']);
});
