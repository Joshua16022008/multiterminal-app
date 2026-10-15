'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const wt = require('../src/renderer/workspace-templates');

const PRESETS = [
  { id: 'claude', label: 'Claude Code', command: 'claude', resumeCommand: 'claude --continue', builtin: true },
  { id: 'codex', label: 'Codex', command: 'codex', resumeCommand: null, builtin: true },
  { id: 'eigen', label: 'Eigen', command: 'mein-tool', resumeCommand: null, builtin: false },
];

test('Devserver-Befehle werden erkannt, andere nicht', () => {
  for (const c of ['npm run dev', 'npm start', 'pnpm dev', 'yarn start', 'vite', 'npx vite --port 3000', 'next dev', 'PORT=3000 npm start',
    'cd web && npm run dev', 'python3 -m http.server 8000', 'rails server', 'flask run', 'ng serve']) {
    assert.equal(wt.isDevServerCommand(c), true, c);
  }
  for (const c of ['claude', 'codex', 'echo hi', 'npm test', 'npm install', 'git status', 'ls -la', null, 42]) {
    assert.equal(wt.isDevServerCommand(c), false, String(c));
  }
});

test('tilesFromDescs übernimmt nur erlaubte Felder', () => {
  const tiles = wt.tilesFromDescs([{
    id: 'x1', title: 'Agent', presetId: 'claude', command: 'claude', resumeCommand: 'claude --resume abc',
    nativeSession: { id: 'abc' }, accounts: { claude: 'a1' }, workspaceId: 'ws', color: 2, browserUrl: 'http://localhost:5173', browserOpen: true,
  }, { id: 'x2', title: 'Shell', presetId: null, command: null, browserUrl: 'file:///etc/hosts' }]);
  assert.deepEqual(tiles, [
    { title: 'Agent', presetId: 'claude', startCommand: 'claude', color: 2, browserUrl: 'http://localhost:5173' },
    { title: 'Shell', presetId: null },
  ]);
});

test('Vorschau: Agent an, Devserver aus und gekennzeichnet, Shell ohne Befehl', () => {
  const tpl = { name: 'T', tiles: [
    { title: 'A', presetId: 'claude', startCommand: 'claude' },
    { title: 'D', presetId: null, startCommand: 'npm run dev' },
    { title: 'S', presetId: null },
    { title: 'E', presetId: null, startCommand: 'echo hallo' },
  ] };
  const p = wt.previewModel(tpl, { presets: PRESETS, existingCount: 0, max: 30 });
  assert.deepEqual(p.items.map((i) => [i.kind, i.run, i.command]), [
    ['agent', true, 'claude'], ['devserver', false, 'npm run dev'], ['shell', false, null], ['command', true, 'echo hallo'],
  ]);
  assert.equal(p.overLimit, false);
});

test('Vorschau: fehlendes Preset wird normale Shell mit Hinweis', () => {
  const p = wt.previewModel({ name: 'T', tiles: [{ title: 'Weg', presetId: 'geloescht', startCommand: 'geheim-tool' }] }, { presets: PRESETS });
  assert.equal(p.items[0].missingPreset, true);
  assert.equal(p.items[0].command, null);
  assert.equal(p.items[0].run, false);
  assert.match(p.items[0].note, /normale Shell/);
  const plan = wt.startPlan(p, [true]);
  assert.equal(plan[0].preset, null);
  assert.equal(plan[0].run, false);
});

test('Kachelgrenze: zu viele Kacheln -> nichts wird gestartet', () => {
  const tiles = Array.from({ length: 5 }, (_, i) => ({ title: 'K' + i, presetId: null }));
  const p = wt.previewModel({ name: 'T', tiles }, { presets: PRESETS, existingCount: 27, max: 30 });
  assert.equal(p.free, 3);
  assert.equal(p.overLimit, true);
  assert.match(p.limitMessage, /Platz für 3/);
  assert.deepEqual(wt.startPlan(p, tiles.map(() => true)), []);
  const ok = wt.previewModel({ name: 'T', tiles: tiles.slice(0, 3) }, { presets: PRESETS, existingCount: 27, max: 30 });
  assert.equal(ok.overLimit, false);
  assert.equal(wt.startPlan(ok, [true, true, true]).length, 3);
});

test('Startplan respektiert abgewählte Häkchen und führt ohne Befehl nie etwas aus', () => {
  const p = wt.previewModel({ name: 'T', tiles: [{ title: 'A', presetId: 'claude' }, { title: 'S', presetId: null }] }, { presets: PRESETS });
  const plan = wt.startPlan(p, [false, true]);
  assert.equal(plan[0].run, false);
  assert.equal(plan[0].command, 'claude');
  assert.equal(plan[1].run, false);
});
