'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createPmService, parseNextStep, countActiveReservations } = require('../src/main/pm-service.js');
const { createOutputBuffer } = require('../src/main/output-buffer.js');

const PROJECT = { id: 'p1', name: 'Demo', path: '/tmp/demo' };

function make(over = {}) {
  const outputBuffer = createOutputBuffer();
  const deps = {
    getProject: (id) => (id === 'p1' ? PROJECT : null),
    getSessionTerminals: () => [
      { id: 't1', title: 'Backend', presetId: 'claude', workspaceId: 'w1' },
      { id: 't2', title: 'Tests', presetId: null },
    ],
    getAgentStates: () => [{ terminalId: 't1', provider: 'claude', state: 'working', observedAt: 1000 }],
    ptySnapshot: () => [
      { terminalId: 't1', projectId: 'p1', pid: 1 },
      { terminalId: 'pm-p1', projectId: 'p1', pid: 2 },
      { terminalId: 'x9', projectId: 'p2', pid: 3 },
    ],
    worktrees: {
      list: async () => [{ workspaceId: 'w1', branch: 'feature/a' }, { workspaceId: 'w2', branch: 'old' }],
      inspect: async (id) => (id === 'w1' ? { ok: true, exists: true, changes: 3 } : { ok: true, exists: false, changes: 0 }),
    },
    diffs: { listChanges: async () => ({ ok: true, branch: 'main', files: [
      { staged: true, unstaged: false, untracked: false }, { staged: true, unstaged: true, untracked: false }, { staged: false, unstaged: false, untracked: true },
    ] }) },
    ports: { list: async () => ({ ok: true, entries: [
      { port: 3000, terminalId: 't1', projectId: 'p1', url: 'http://localhost:3000' }, { port: 9, terminalId: null, projectId: 'p2', url: null },
      { port: 5173, terminalId: null, projectId: 'p1', url: 'http://localhost:5173' },
    ] }) },
    readDocs: () => ({
      projectStatus: '# Status\n\n## Nächster Schritt\n\nJoshua prüft den Build.\nZweite Zeile.\n\nAnderer Absatz.\n',
      workInProgress: '## Aktive Reservierungen\n\n### A\n- Status: läuft\n\n### B\n- Status: abgeschlossen und geprüft\n\n### C\n- Status: pausiert\n',
      progress: 'P',
    }),
    gitInfo: async () => ({ log: 'abc123 Erster\n', branches: '* main\n' }),
    outputBuffer,
    managerResumed: () => true,
  };
  return { svc: createPmService({ ...deps, ...over }), outputBuffer, deps };
}

test('Lagebild aus Fakes: Kacheln, Arbeitskopien, Änderungen, Ports, Doku', async () => {
  const { svc } = make();
  const s = await svc.state('p1');
  assert.strictEqual(s.ok, true);
  assert.deepStrictEqual(s.project, PROJECT);
  assert.ok(Number.isFinite(s.capturedAt));
  assert.deepStrictEqual(s.terminals.map((t) => t.id), ['t1', 't2']); // Manager nicht dabei
  const t1 = s.terminals[0];
  assert.deepStrictEqual(t1, {
    id: 't1', title: 'Backend', preset: 'claude', running: true,
    agent: { provider: 'claude', state: 'working', since: 1000 },
    workspace: { workspaceId: 'w1', branch: 'feature/a' },
  });
  assert.deepStrictEqual(s.terminals[1], { id: 't2', title: 'Tests', preset: null, running: false, agent: null, workspace: null });
  assert.deepStrictEqual(s.worktrees, [
    { workspaceId: 'w1', branch: 'feature/a', missing: false, changedFiles: 3 },
    { workspaceId: 'w2', branch: 'old', missing: true, changedFiles: null },
  ]);
  assert.deepStrictEqual(s.changes, { ok: true, branch: 'main', staged: 2, unstaged: 1, untracked: 1 });
  assert.deepStrictEqual(s.ports, [
    { port: 3000, terminalId: 't1', url: 'http://localhost:3000' },
    { port: 5173, terminalId: null, url: 'http://localhost:5173' },
  ]);
  assert.deepStrictEqual(s.docs, { nextStep: 'Joshua prüft den Build. Zweite Zeile.', activeReservations: 2 });
  assert.deepStrictEqual(s.manager, { running: true, resumed: true });
});

test('Fehlende Daten bleiben ehrlich null/unknown', async () => {
  const { svc } = make({
    getSessionTerminals: () => [{ id: 't1', title: '' }],
    getAgentStates: () => [{ terminalId: 't1', provider: 5, state: 'komisch' }],
    ptySnapshot: () => [],
    worktrees: { list: async () => [{ workspaceId: 'w1', branch: 'b' }], inspect: async () => { throw new Error('weg'); } },
    diffs: { listChanges: async () => ({ ok: false, error: 'kein Repo' }) },
    ports: { list: async () => ({ ok: false, error: 'lsof' }) },
    readDocs: () => ({}),
    managerResumed: undefined,
  });
  const s = await svc.state('p1');
  assert.strictEqual(s.ok, true);
  assert.deepStrictEqual(s.terminals[0].agent, { provider: null, state: 'unknown', since: null });
  assert.strictEqual(s.terminals[0].title, 't1');
  assert.deepStrictEqual(s.worktrees, [{ workspaceId: 'w1', branch: 'b', missing: false, changedFiles: null }]);
  assert.deepStrictEqual(s.changes, { ok: false, error: 'kein Repo' });
  assert.deepStrictEqual(s.ports, []);
  assert.deepStrictEqual(s.docs, { nextStep: null, activeReservations: null });
  assert.deepStrictEqual(s.manager, { running: false, resumed: false });
});

test('Fehler werden als { ok:false, error } geliefert, nie geworfen', async () => {
  const { svc } = make();
  assert.deepStrictEqual(await svc.state('nix'), { ok: false, error: 'Projekt nicht gefunden.' });
  assert.strictEqual((await svc.output('nix', 't1', 5)).ok, false);
  assert.strictEqual((await svc.changes('nix')).ok, false);
  assert.strictEqual((await svc.ports('nix')).ok, false);
  assert.strictEqual((await svc.docs('nix')).ok, false);
  const broken = make({ getSessionTerminals: () => { throw new Error('kaputt'); } }).svc;
  assert.deepStrictEqual(await broken.state('p1'), { ok: false, error: 'kaputt' });
});

test('output liefert bereinigte Zeilen nur für Kacheln des Projekts', async () => {
  const { svc, outputBuffer } = make();
  outputBuffer.append('t1', '\x1b[32mhallo\x1b[0m\nwelt\n');
  outputBuffer.append('x9', 'fremd\n');
  const r = await svc.output('p1', 't1', 1);
  assert.deepStrictEqual(r, { ok: true, terminalId: 't1', lines: ['welt'] });
  assert.strictEqual((await svc.output('p1', 'x9', 5)).ok, false);
  assert.strictEqual((await svc.output('p1', 'pm-p1', 5)).ok, false);
});

test('changes, ports und docs einzeln', async () => {
  const { svc } = make();
  const c = await svc.changes('p1');
  assert.strictEqual(c.changes.staged, 2);
  assert.strictEqual(c.worktrees.length, 2);
  assert.strictEqual((await svc.ports('p1')).ports.length, 2);
  const d = await svc.docs('p1');
  assert.strictEqual(d.progress, 'P');
  assert.strictEqual(d.gitLog, 'abc123 Erster\n');
  assert.strictEqual(d.gitBranches, '* main\n');
  assert.strictEqual(d.projectStatus.includes('Nächster Schritt'), true);
});

test('resolveTerminal: ID, eindeutiger Titel, mehrdeutiger Titel, unbekannt', () => {
  const { svc } = make({ getSessionTerminals: () => [{ id: 'a', title: 'Gleich' }, { id: 'b', title: 'Gleich' }, { id: 'c', title: 'Eins' }] });
  assert.strictEqual(svc.resolveTerminal('p1', 'a').terminal.id, 'a');
  assert.strictEqual(svc.resolveTerminal('p1', 'Eins').terminal.id, 'c');
  const m = svc.resolveTerminal('p1', 'Gleich');
  assert.strictEqual(m.ok, false);
  assert.match(m.error, /mehrdeutig.*a, b/);
  assert.strictEqual(svc.resolveTerminal('p1', 'pm-p1').ok, false);
  assert.strictEqual(svc.resolveTerminal('p1', 'zzz').ok, false);
});

test('parseNextStep und countActiveReservations', () => {
  assert.strictEqual(parseNextStep('## Nächster Schritt\n\nA\n\nB'), 'A');
  assert.strictEqual(parseNextStep('## Nächster Schritt\nA\nB\n## Weiter\nC'), 'A B');
  assert.strictEqual(parseNextStep('## Nächster Schritt\n\n## Weiter\nC'), null);
  assert.strictEqual(parseNextStep('nichts'), null);
  assert.strictEqual(parseNextStep(null), null);
  assert.strictEqual(countActiveReservations('## Aktive Reservierungen\n\n'), 0);
  assert.strictEqual(countActiveReservations('# x'), null);
  assert.strictEqual(countActiveReservations('## Aktive Reservierungen\n### A\n- Status: Erledigt\n### B\nohne Status\n## Andere\n### C\n'), 1);
});
