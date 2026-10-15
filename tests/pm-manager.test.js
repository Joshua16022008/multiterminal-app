'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPmManager } = require('../src/main/pm-manager.js');
const { createOutputBuffer } = require('../src/main/output-buffer.js');
const { createPmSessions } = require('../src/main/pm-sessions.js');

function setup(over = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-mgr-'));
  const role = path.join(dataDir, 'src-role.md');
  fs.writeFileSync(role, 'Rolle');
  const created = [];
  const live = new Set();
  const killed = [];
  const ptys = {
    create: (o) => { if (live.has(o.id)) return { ok: false, error: 'läuft bereits' }; created.push(o); live.add(o.id); return { ok: true }; },
    write: (id, d) => created.push({ write: [id, d] }),
    resize: (id, c, r) => created.push({ resize: [id, c, r] }),
    kill: (id) => { killed.push(id); live.delete(id); },
    snapshot: () => [...live].map((terminalId) => ({ terminalId, projectId: 'p1' })),
  };
  const sessions = createPmSessions({ filePath: path.join(dataDir, 'pm', 'sessions.json') });
  const registered = [];
  const pmBridge = {
    register: (p) => { registered.push(['reg', p]); return 'tok'; },
    unregister: (p) => registered.push(['unreg', p]),
    envFor: () => ({ MULTITERMINAL_PM_SOCKET: '/s', MULTITERMINAL_PM_TOKEN: 'tok' }),
  };
  const outputBuffer = createOutputBuffer();
  const mgr = createPmManager({
    dataDir, roleSource: role, ptys, sessions, outputBuffer, pmBridge,
    getProject: (id) => (id === 'p1' ? { id: 'p1', name: 'P', path: '/tmp/projekt' } : null),
    makeEnv: async (id, projectId, pmEnv) => ({ ...pmEnv, X: id }),
    ...over,
  });
  return { mgr, created, live, killed, sessions, registered, outputBuffer, dataDir };
}

test('Start im Projektordner mit Rollen-Prompt, ohne --resume und niemals --continue', async () => {
  const c = setup();
  const r = await c.mgr.start('p1', 100, 30);
  assert.deepStrictEqual(r, { ok: true, terminalId: 'pm-p1', resumed: false, replay: '' });
  const o = c.created[0];
  assert.strictEqual(o.id, 'pm-p1');
  assert.strictEqual(o.cwd, '/tmp/projekt');
  assert.strictEqual(o.projectId, 'p1');
  assert.strictEqual(o.cols, 100);
  assert.strictEqual(o.workspaceId, undefined);
  const rolePath = path.join(c.dataDir, 'pm', 'pm-role.md');
  assert.strictEqual(o.command, `claude --append-system-prompt "$(cat '${rolePath}')"`);
  assert.strictEqual(fs.readFileSync(rolePath, 'utf8'), 'Rolle');
  assert.ok(!o.command.includes('--continue'));
  assert.deepStrictEqual(o.extraEnv, { MULTITERMINAL_PM_SOCKET: '/s', MULTITERMINAL_PM_TOKEN: 'tok', X: 'pm-p1' });
  assert.strictEqual(c.mgr.wasResumed('p1'), false);
});

test('Neues Gespräch: restart mit fresh verwirft die gespeicherte ID', async () => {
  const c = setup();
  c.sessions.observe('p1', 'abcd1234-ef56');
  await c.mgr.start('p1');
  const r = await c.mgr.restart('p1', { fresh: true });
  assert.deepStrictEqual(r, { ok: true, resumed: false });
  assert.ok(!c.created.at(-1).command.includes('--resume'));
  assert.strictEqual(c.sessions.get('p1'), null);
});

test('Mit belegter Gesprächs-ID: --resume <id>, resumed:true', async () => {
  const c = setup();
  c.sessions.observe('p1', 'abcd1234-ef56');
  const r = await c.mgr.start('p1');
  assert.strictEqual(r.resumed, true);
  assert.match(c.created[0].command, / --resume='abcd1234-ef56'$|--resume=abcd1234-ef56$/);
  assert.ok(!c.created[0].command.includes('--continue'));
  assert.strictEqual(c.mgr.wasResumed('p1'), true);
});

test('Start ist idempotent: kein zweiter Prozess, replay = Rohpuffer', async () => {
  const c = setup();
  await c.mgr.start('p1');
  c.outputBuffer.append('pm-p1', 'Ausgabe\n');
  const again = await c.mgr.start('p1');
  assert.strictEqual(again.ok, true);
  assert.strictEqual(again.replay, 'Ausgabe\n');
  assert.strictEqual(c.created.filter((x) => x.id).length, 1);
});

test('Ungültige oder unbekannte Projekte, fehlgeschlagener Start', async () => {
  const c = setup();
  assert.strictEqual((await c.mgr.start('../x')).ok, false);
  assert.strictEqual((await c.mgr.start('a'.repeat(62))).ok, false); // 'pm-' + 62 > 64
  assert.strictEqual((await c.mgr.start('nix')).ok, false);
  const failing = setup({ makeEnv: async () => { throw new Error('nicht bereit'); } });
  assert.deepStrictEqual(await failing.mgr.start('p1'), { ok: false, error: 'nicht bereit' });
  assert.deepStrictEqual(failing.registered.at(-1), ['unreg', 'p1']);
});

test('write und resize wirken nur auf einen laufenden Manager', async () => {
  const c = setup();
  c.mgr.write('p1', 'x');
  assert.strictEqual(c.created.length, 0);
  await c.mgr.start('p1', 80, 24);
  c.mgr.write('p1', 'hallo');
  c.mgr.write('p1', 5);
  c.mgr.resize('p1', 120, 40);
  assert.deepStrictEqual(c.created.slice(1), [{ write: ['pm-p1', 'hallo'] }, { resize: ['pm-p1', 120, 40] }]);
});

test('Neustart beendet den alten Prozess, startet neu und unterdrückt dessen Exit', async () => {
  const c = setup();
  await c.mgr.start('p1');
  c.sessions.observe('p1', 'neue-id-0001');
  const r = await c.mgr.restart('p1');
  assert.deepStrictEqual(r, { ok: true, resumed: true });
  assert.deepStrictEqual(c.killed, ['pm-p1']);
  assert.strictEqual(c.created.filter((x) => x.id).length, 2);
  assert.strictEqual(c.mgr.exited('p1'), false); // Ende des alten Prozesses
  assert.strictEqual(c.mgr.exited('p1'), true); // echtes Ende des neuen
  assert.deepStrictEqual(c.registered.at(-1), ['unreg', 'p1']);
});

test('Projekt entfernen: Prozess beenden, Token widerrufen, Gespräch vergessen', async () => {
  const c = setup();
  await c.mgr.start('p1');
  c.sessions.observe('p1', 'abcd1234');
  c.mgr.remove('p1');
  assert.deepStrictEqual(c.killed, ['pm-p1']);
  assert.deepStrictEqual(c.registered.at(-1), ['unreg', 'p1']);
  assert.strictEqual(c.sessions.get('p1'), null);
  assert.strictEqual(c.mgr.isRunning('p1'), false);
});
