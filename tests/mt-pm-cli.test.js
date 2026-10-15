'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const cli = require('../src/main/mt-pm-cli.js');
const { createPmBridge } = require('../src/main/pm-bridge.js');

const CLI_PATH = path.join(__dirname, '..', 'src', 'main', 'mt-pm-cli.js');

test('parseArgs bildet jeden Befehl ab', () => {
  for (const c of ['status', 'changes', 'ports', 'docs']) assert.deepStrictEqual(cli.parseArgs([c]), { cmd: c, args: {}, json: false });
  assert.deepStrictEqual(cli.parseArgs(['output', 'Backend']), { cmd: 'output', args: { terminal: 'Backend' }, json: false });
  assert.deepStrictEqual(cli.parseArgs(['output', 'Backend', '--lines', '20']), { cmd: 'output', args: { terminal: 'Backend', lines: 20 }, json: false });
  assert.deepStrictEqual(cli.parseArgs(['output', '--lines=7', 't1']), { cmd: 'output', args: { terminal: 't1', lines: 7 }, json: false });
  assert.deepStrictEqual(cli.parseArgs(['send', 'Tests', 'Bitte', 'die', 'Tests', 'laufen', 'lassen']),
    { cmd: 'send', args: { terminal: 'Tests', text: 'Bitte die Tests laufen lassen' }, json: false });
  assert.deepStrictEqual(cli.parseArgs(['send', 't1', 'Ein Auftrag in einem Argument']).args.text, 'Ein Auftrag in einem Argument');
  assert.strictEqual(cli.parseArgs(['status', '--json']).json, true);
  assert.strictEqual(cli.parseArgs(['--json', 'ports']).json, true);
  for (const h of [[], ['help'], ['--help'], ['-h']]) assert.deepStrictEqual(cli.parseArgs(h), { help: true });
});

test('parseArgs meldet Benutzungsfehler', () => {
  for (const argv of [['status', 'x'], ['output'], ['output', 'a', 'b'], ['output', 'a', '--lines'], ['output', 'a', '--lines', '0'], ['output', 'a', '--lines', '501'],
    ['output', 'a', '--lines', 'x'], ['send'], ['send', 't1'], ['send', 't1', '  '], ['explode']]) {
    assert.ok(cli.parseArgs(argv).error, argv.join(' '));
  }
});

test('buildRequest braucht Socket und Token', () => {
  const parsed = cli.parseArgs(['status']);
  assert.ok(cli.buildRequest({}, parsed).error);
  assert.ok(cli.buildRequest({ MULTITERMINAL_PM_SOCKET: '/s' }, parsed).error);
  const r = cli.buildRequest({ MULTITERMINAL_PM_SOCKET: '/s', MULTITERMINAL_PM_TOKEN: 'tk' }, parsed);
  assert.strictEqual(r.sock, '/s');
  assert.deepStrictEqual(JSON.parse(r.line), { token: 'tk', cmd: 'status', args: {} });
});

const STATUS = {
  ok: true,
  project: { id: 'p1', name: 'Demo', path: '/tmp/demo' },
  capturedAt: 1760000000000,
  terminals: [
    { id: 't1', title: 'Backend', preset: 'claude', running: true, agent: { provider: 'claude', state: 'needs-input', since: 1760000000000 }, workspace: { workspaceId: 'w1', branch: 'feature/a' } },
    { id: 't2', title: 'Tests', preset: null, running: false, agent: null, workspace: null },
    { id: 't3', title: 'Frei', preset: null, running: true, agent: { provider: null, state: 'unknown', since: null }, workspace: null },
  ],
  worktrees: [{ workspaceId: 'w1', branch: 'feature/a', missing: false, changedFiles: 3 }, { workspaceId: 'w2', branch: 'alt', missing: true, changedFiles: null }],
  changes: { ok: true, branch: 'main', staged: 1, unstaged: 2, untracked: 3 },
  ports: [{ port: 3000, terminalId: 't1', url: 'http://localhost:3000' }, { port: 8080, terminalId: null, url: null }],
  docs: { nextStep: null, activeReservations: null },
  manager: { running: true, resumed: false },
};

test('Textausgabe: Agentenstatus aus -> Zustand unbekannt', () => {
  const f = cli.formatResponse({ cmd: 'status', json: false }, { ok: true, result: { ...STATUS, agentStatusEnabled: false } });
  assert.match(f.out, /Tests \[t2\] beendet; Agentenzustand unbekannt \(Agentenstatus aus\)/);
});

test('Textausgabe des Lagebilds ist deutsch und ehrlich bei Unbekanntem', () => {
  const f = cli.formatResponse({ cmd: 'status', json: false }, { ok: true, result: STATUS });
  const t = f.out;
  assert.match(t, /Projekt: Demo/);
  assert.match(t, /Backend \[t1\] läuft; claude: wartet auf dich/);
  assert.match(t, /Tests \[t2\] beendet; kein Agentenereignis/);
  assert.match(t, /Frei \[t3\] läuft; Agent: unbekannt/);
  assert.match(t, /Arbeitskopie feature\/a/);
  assert.match(t, /alt \[w2\]: Ordner fehlt/);
  assert.match(t, /1 vorgemerkt, 2 geändert, 3 neu/);
  assert.match(t, /3000 http:\/\/localhost:3000 \(Kachel t1\)/);
  assert.match(t, /8080 \(Kachel unbekannt\)/);
  assert.match(t, /Nächster Schritt \(PROJECT_STATUS.md\): unbekannt/);
  assert.match(t, /Aktive Reservierungen \(WORK_IN_PROGRESS.md\): unbekannt/);
});

test('Textausgabe weiterer Befehle und --json', () => {
  assert.strictEqual(cli.formatResponse({ cmd: 'output' }, { ok: true, result: { lines: ['a', 'b'] } }).out, 'a\nb');
  assert.match(cli.formatResponse({ cmd: 'ports' }, { ok: true, result: { ports: [] } }).out, /Keine lauschenden Ports/);
  const ch = cli.formatResponse({ cmd: 'changes' }, { ok: true, result: { changes: { ok: false, error: 'kein Repo' }, worktrees: [] } }).out;
  assert.match(ch, /nicht lesbar \(kein Repo\)/);
  const d = cli.formatResponse({ cmd: 'docs' }, { ok: true, result: { projectStatus: 'S', workInProgress: null, progress: 'P', gitLog: 'l', gitBranches: null } }).out;
  assert.match(d, /=== PROJECT_STATUS.md ===\nS/);
  assert.match(d, /=== WORK_IN_PROGRESS.md ===\n\(nicht vorhanden\)/);
  assert.strictEqual(cli.formatResponse({ cmd: 'send' }, { ok: true, result: 'In Promptvorschau von X gelegt – wartet auf Bestätigung durch Joshua.' }).out.startsWith('In Promptvorschau'), true);
  assert.deepStrictEqual(JSON.parse(cli.formatResponse({ cmd: 'status', json: true }, { ok: true, result: STATUS }).out), STATUS);
  assert.deepStrictEqual(cli.formatResponse({ cmd: 'x' }, { ok: false, error: 'kaputt' }), { error: 'kaputt' });
  assert.ok(cli.formatResponse({ cmd: 'x' }, null).error);
});

test('wrapperScript quotet Pfade mit Leerzeichen und Anführungszeichen', () => {
  const dir = fs.mkdtempSync('/tmp/mtpmw-');
  try {
    const script = cli.wrapperScript({ execPath: '/bin/echo', scriptPath: "/pfad mit 'x'/s.js" });
    const sh = path.join(dir, 'mt-pm');
    fs.writeFileSync(sh, script, { mode: 0o755 });
    const r = spawnSync(sh, ['a b', "c'd"], { encoding: 'utf8' });
    assert.strictEqual(r.stdout, "/pfad mit 'x'/s.js a b c'd\n");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function runCli(args, env) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI_PATH, ...args], { env: { PATH: process.env.PATH, ...env } });
    let out = ''; let err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, out, err }));
  });
}

test('Prozess: Hilfe 0, Aufruffehler 2, außerhalb des Manager-Fensters 2', async () => {
  const help = await runCli(['help'], {});
  assert.strictEqual(help.code, 0);
  assert.match(help.out, /mt-pm send/);
  assert.strictEqual((await runCli(['bogus'], {})).code, 2);
  const outside = await runCli(['status'], {});
  assert.strictEqual(outside.code, 2);
  assert.match(outside.err, /Projektmanager-Fenster/);
});

test('Prozess gegen die Brücke: Text, --json, Fehler mit Exit 1', async () => {
  const dir = fs.mkdtempSync('/tmp/mtpmc-');
  const service = {
    resolveTerminal: (p, ref) => (ref === 'Backend' ? { ok: true, terminal: { id: 't1', title: 'Backend', running: true } } : { ok: false, error: 'Keine Kachel „' + ref + '“ in diesem Projekt.' }),
    state: async () => STATUS,
    output: async () => ({ ok: true, terminalId: 't1', lines: ['x', 'y'] }),
    changes: async () => ({ ok: true, changes: STATUS.changes, worktrees: [] }),
    ports: async () => ({ ok: true, ports: [] }),
    docs: async () => ({ ok: true }),
  };
  const sends = [];
  const bridge = createPmBridge({ socketPath: path.join(dir, 's', 'pm.sock'), service, requestSend: async (r) => { sends.push(r); return { ok: true }; } });
  await bridge.start();
  bridge.register('p1');
  const env = bridge.envFor('p1');
  try {
    const st = await runCli(['status'], env);
    assert.strictEqual(st.code, 0);
    assert.match(st.out, /Projekt: Demo/);
    const js = await runCli(['status', '--json'], env);
    assert.deepStrictEqual(JSON.parse(js.out), STATUS);
    const o = await runCli(['output', 'Backend', '--lines', '2'], env);
    assert.strictEqual(o.out, 'x\ny\n');
    const s = await runCli(['send', 'Backend', 'Bitte', 'prüfen'], env);
    assert.strictEqual(s.code, 0);
    assert.strictEqual(s.out, 'In Promptvorschau von Backend gelegt – wartet auf Bestätigung durch Joshua.\n');
    assert.deepStrictEqual(sends, [{ projectId: 'p1', terminalId: 't1', text: 'Bitte prüfen' }]);
    const bad = await runCli(['output', 'Nix'], env);
    assert.strictEqual(bad.code, 1);
    assert.match(bad.err, /Keine Kachel/);
    const wrong = await runCli(['status'], { ...env, MULTITERMINAL_PM_TOKEN: 'falsch' });
    assert.strictEqual(wrong.code, 1);
    assert.match(wrong.err, /Nicht berechtigt/);
  } finally {
    await bridge.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
