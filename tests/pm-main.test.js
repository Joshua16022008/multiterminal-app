'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPmMain } = require('../src/main/pm-main.js');

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-main-'));
  const handlers = new Map();
  const listeners = new Map();
  const ipcMain = {
    handle: (ch, fn) => handlers.set(ch, fn),
    on: (ch, fn) => listeners.set(ch, fn),
  };
  let nextWc = 100;
  const windowsCreated = [];
  class FakeWindow {
    constructor(opts) {
      this.opts = opts;
      this.destroyed = false;
      this.sent = [];
      this.loaded = null;
      this.handlers = {};
      const frame = {};
      this.webContents = {
        id: nextWc++, mainFrame: frame, send: (...a) => this.sent.push(a),
        setWindowOpenHandler: () => {}, on: () => {},
      };
      windowsCreated.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    show() { this.shown = (this.shown || 0) + 1; }
    focus() { this.focused = (this.focused || 0) + 1; }
    restore() {}
    on(ev, fn) { this.handlers[ev] = fn; }
    destroy() { this.destroyed = true; if (this.handlers.closed) this.handlers.closed(); }
    loadFile(file, o) { this.loaded = { file, o }; }
  }
  const mainWin = new FakeWindow({});
  const terminalMeta = new Map();
  const killed = [];
  const ptys = { snapshot: () => [], create: () => ({ ok: true }), write() {}, resize() {}, kill: (id) => killed.push(id) };
  const projects = new Map([['p1', { id: 'p1', name: 'Eins', path: '/tmp/e1' }], ['p2', { id: 'p2', name: 'Zwei', path: '/tmp/e2' }]]);
  const pm = createPmMain({
    electron: { BrowserWindow: FakeWindow, ipcMain, shell: { openExternal() {} } },
    getMainWindow: () => mainWin,
    getDataDir: () => dataDir,
    getProjects: () => projects,
    getSessions: () => ({ load: () => ({ projects: {} }) }),
    getPtys: () => ptys,
    getWorktrees: () => ({ list: async () => [], inspect: async () => ({ ok: true, exists: true, changes: 0 }) }),
    getPorts: () => ({ list: async () => ({ ok: true, entries: [] }) }),
    getAgentStore: () => ({ list: () => [] }),
    getAccounts: () => ({ envFor: () => ({ env: {}, accounts: [] }) }),
    getTerminalMeta: () => terminalMeta,
    getBrowserBridge: () => null,
    getBinDir: () => null,
    getZdotdir: () => null,
    statusEnabled: () => false,
    forgetTerminal: (id) => terminalMeta.delete(String(id)),
    createDiffService: () => ({ listChanges: async () => ({ ok: true, branch: 'main', files: [] }) }),
  });
  pm.registerIpc();
  const eventFrom = (win) => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  return { pm, handlers, listeners, mainWin, windowsCreated, terminalMeta, eventFrom, killed, dataDir };
}

test('Fenster: pro Projekt höchstens eines, Pfade und Sicherheitsoptionen', async () => {
  const c = setup();
  const open = c.handlers.get('pm:openWindow');
  assert.deepStrictEqual(await open(c.eventFrom(c.mainWin), 'p1'), { ok: true });
  const win = c.windowsCreated[1];
  assert.strictEqual(win.opts.title, 'Projektmanager – Eins');
  assert.strictEqual(win.opts.webPreferences.contextIsolation, true);
  assert.strictEqual(win.opts.webPreferences.nodeIntegration, false);
  assert.strictEqual(win.opts.webPreferences.sandbox, true);
  assert.ok(win.opts.webPreferences.preload.endsWith(path.join('src', 'main', 'pm-preload.js')));
  assert.ok(win.loaded.file.endsWith(path.join('src', 'renderer', 'pm.html')));
  assert.deepStrictEqual(win.loaded.o, { query: { project: 'p1' } });
  await open(c.eventFrom(c.mainWin), 'p1');
  assert.strictEqual(c.windowsCreated.length, 2); // nur fokussiert
  assert.strictEqual(win.focused, 1);
  await open(c.eventFrom(c.mainWin), 'p2');
  assert.strictEqual(c.windowsCreated.length, 3);
  assert.deepStrictEqual(await open(c.eventFrom(c.mainWin), '../x'), { ok: false, error: 'Ungültige Projekt-ID für den Projektmanager.' });
  assert.deepStrictEqual(await open(c.eventFrom(c.mainWin), 'nix'), { ok: false, error: 'Projekt nicht gefunden.' });
});

test('pm:openWindow nur aus dem Hauptfenster', async () => {
  const c = setup();
  await c.handlers.get('pm:openWindow')(c.eventFrom(c.mainWin), 'p1');
  const pmWin = c.windowsCreated[1];
  await assert.rejects(async () => c.handlers.get('pm:openWindow')(c.eventFrom(pmWin), 'p2'), /Nicht erlaubt/);
  await assert.rejects(async () => c.handlers.get('pm:openWindow')({ sender: c.mainWin.webContents, senderFrame: {} }, 'p2'), /Nicht erlaubt/);
});

test('pm:*-Kanäle: das Projekt kommt aus der Fensterzuordnung, fremde Absender werden abgelehnt', async () => {
  const c = setup();
  await c.handlers.get('pm:openWindow')(c.eventFrom(c.mainWin), 'p1');
  const pmWin = c.windowsCreated[1];
  // Das Hauptfenster darf die Manager-Kanäle nicht benutzen
  for (const ch of ['pm:start', 'pm:write', 'pm:resize', 'pm:restart', 'pm:state']) {
    await assert.rejects(async () => c.handlers.get(ch)(c.eventFrom(c.mainWin), 'p1', 80, 24), /Nicht erlaubt/, ch);
  }
  // Das Manager-Fenster von p1 fragt nach p2: bekommt trotzdem p1
  const st = await c.handlers.get('pm:state')(c.eventFrom(pmWin), 'p2');
  assert.strictEqual(st.ok, true);
  assert.strictEqual(st.project.id, 'p1');
  // Ein unbekanntes Fenster mit passender Frame-Zuordnung hat kein Projekt
  const stranger = { webContents: { id: 999, mainFrame: {} } };
  await assert.rejects(async () => c.handlers.get('pm:state')(c.eventFrom(stranger), 'p1'), /Nicht erlaubt/);
  // Start ohne bereite Werkzeuge liefert einen Fehler statt zu werfen
  const started = await c.handlers.get('pm:start')(c.eventFrom(pmWin), 'p1', 80, 24);
  assert.strictEqual(started.ok, false);
  assert.match(started.error, /nicht verfügbar/);
});

test('pm:sendResult nur aus dem Hauptfenster; ohne offene Anfrage folgenlos', async () => {
  const c = setup();
  const sendResult = c.handlers.get('pm:sendResult');
  const stranger = { webContents: { id: 5, mainFrame: {} } };
  await assert.rejects(async () => sendResult(c.eventFrom(stranger), 'r', { ok: true }), /Nicht erlaubt/);
  assert.strictEqual(await sendResult(c.eventFrom(c.mainWin), 'unbekannt', { ok: true }), true);
});

test('Ausgabe des Managers geht ans Manager-Fenster, andere Terminals bleiben im Hauptfenster', async () => {
  const c = setup();
  await c.handlers.get('pm:openWindow')(c.eventFrom(c.mainWin), 'p1');
  const pmWin = c.windowsCreated[1];
  c.terminalMeta.set('pm-p1', { projectId: 'p1', manager: true });
  c.terminalMeta.set('t1', { projectId: 'p1' });
  assert.strictEqual(c.pm.onPtyData('pm-p1', 'hallo'), true);
  assert.strictEqual(c.pm.onPtyData('t1', 'dort'), false);
  assert.deepStrictEqual(pmWin.sent, [['pm:data', 'hallo']]);
  assert.strictEqual(c.pm.isManager('pm-p1'), true);
  assert.strictEqual(c.pm.isManager('t1'), false);
  // Beenden des Managers: pm:exit ans Fenster, Metadaten weg
  assert.strictEqual(c.pm.onPtyExit('pm-p1', 3), true);
  assert.deepStrictEqual(pmWin.sent.at(-1), ['pm:exit', 3]);
  assert.strictEqual(c.terminalMeta.has('pm-p1'), false);
  assert.strictEqual(c.pm.onPtyExit('t1', 0), false);
});

test('Agentenereignisse des Managers nur als Gesprächs-ID, aus der Liste gefiltert', () => {
  const c = setup();
  c.terminalMeta.set('pm-p1', { projectId: 'p1', manager: true });
  c.terminalMeta.set('t1', { projectId: 'p1' });
  assert.strictEqual(c.pm.handleAgentEvent('t1', { nativeSessionId: 'abcd1234' }), false);
  assert.strictEqual(c.pm.handleAgentEvent('pm-p1', { nativeSessionId: 'abcd1234-ef56', observedAt: 5 }), true);
  const stored = JSON.parse(fs.readFileSync(path.join(c.dataDir, 'pm', 'sessions.json'), 'utf8'));
  assert.strictEqual(stored.p1.nativeSessionId, 'abcd1234-ef56');
  assert.strictEqual(c.pm.handleAgentEvent('pm-p1', { nativeSessionId: 'böse; rm -rf' }), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(c.dataDir, 'pm', 'sessions.json'), 'utf8')).p1.nativeSessionId, 'abcd1234-ef56');
  const list = [{ terminalId: 'pm-p1' }, { terminalId: 't1' }];
  assert.deepStrictEqual(c.pm.withoutManagers(list), [{ terminalId: 't1' }]);
});

test('Projekt entfernen schließt das Fenster und beendet den Manager', async () => {
  const c = setup();
  await c.handlers.get('pm:openWindow')(c.eventFrom(c.mainWin), 'p1');
  const pmWin = c.windowsCreated[1];
  c.pm.removeProject('p1');
  assert.strictEqual(pmWin.destroyed, true);
  assert.deepStrictEqual(c.killed, ['pm-p1']);
  await c.handlers.get('pm:openWindow')(c.eventFrom(c.mainWin), 'p1');
  assert.strictEqual(c.windowsCreated.length, 3); // neues Fenster möglich
  await c.pm.shutdown();
  assert.strictEqual(c.windowsCreated[2].destroyed, true);
});
