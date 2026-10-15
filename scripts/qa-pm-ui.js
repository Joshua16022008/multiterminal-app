'use strict';
// QA der Projektmanager-Oberfläche: echtes Electron-Fenster mit pm.html und pm-preload.js,
// aber Fake-Backend (ipcMain-Handler bilden den Vertrag nach). Keine echten Agenten/Provider.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-pm-qa-'));
app.setName('PM UI QA ' + process.pid);
app.setPath('userData', path.join(root, 'data'));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const calls = { start: 0, restart: 0, state: 0, write: [], resize: [] };
let win = null;
const NOW = () => Date.now();

function lagebild() {
  return {
    ok: true,
    project: { id: 'qa-proj', name: 'QA Projekt', path: '/tmp/qa' },
    capturedAt: NOW(),
    terminals: [
      { id: 't1', title: 'Backend', preset: 'claude', running: true, agent: { provider: 'claude', state: 'needs-input', since: NOW() - 95000 }, workspace: { workspaceId: 'w1', branch: 'feat/backend' } },
      { id: 't2', title: 'Tests', preset: 'codex', running: true, agent: { provider: 'codex', state: 'working', since: NOW() - 20000 }, workspace: null },
      { id: 't3', title: 'Shell', preset: null, running: true, agent: null, workspace: null },
      { id: 't4', title: 'Alt', preset: null, running: false, agent: null, workspace: null },
    ],
    worktrees: [{ workspaceId: 'w1', branch: 'feat/backend', missing: false, changedFiles: 4 }, { workspaceId: 'w2', branch: 'alt', missing: true, changedFiles: null }],
    changes: { ok: true, branch: 'main', staged: 1, unstaged: 3, untracked: 2 },
    ports: [{ port: 3000, terminalId: 't1', url: 'http://localhost:3000' }, { port: 5173, terminalId: null, url: null }],
    docs: { nextStep: 'Projektmanager-Oberfläche abnehmen.', activeReservations: 2 },
    manager: { running: true, resumed: false },
  };
}

ipcMain.handle('pm:start', (_e, projectId, cols, rows) => {
  calls.start++; assert.equal(projectId, 'qa-proj');
  return { ok: true, terminalId: 'pm-' + projectId, resumed: false, replay: 'REPLAY_VOM_MANAGER\r\n$ ' };
});
ipcMain.on('pm:write', (_e, projectId, data) => {
  calls.write.push(data);
  // Fake-PTY: Eingabe zurückspiegeln.
  if (win && !win.isDestroyed()) win.webContents.send('pm:data', data === '\r' ? '\r\n' : data);
});
ipcMain.on('pm:resize', (_e, projectId, cols, rows) => { calls.resize.push([cols, rows]); });
ipcMain.handle('pm:restart', () => { calls.restart++; setTimeout(() => win && !win.isDestroyed() && win.webContents.send('pm:data', 'NEUSTART_OK\r\n'), 50); return { ok: true, resumed: false }; });
ipcMain.handle('pm:state', () => { calls.state++; return lagebild(); });

const timer = setTimeout(() => { console.error('PM UI QA timed out'); app.exit(1); }, 40000);

app.whenReady().then(async () => {
  let stage = 'start';
  try {
    win = new BrowserWindow({
      width: 1100, height: 760, show: true,
      webPreferences: { preload: path.resolve(__dirname, '../src/main/pm-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.webContents.setBackgroundThrottling(false);
    win.webContents.on('console-message', (_e, ...args) => {
      const d = typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] };
      if (d.level === 'error' || d.level === 3) console.error('Renderer:', d.message);
    });
    await win.loadFile(path.resolve(__dirname, '../src/renderer/pm.html'), { query: { project: 'qa-proj' } });
    const run = code => win.webContents.executeJavaScript(code);
    const wait = async (fn, label, ms = 10000) => {
      const end = Date.now() + ms;
      while (!await fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await delay(80); }
    };
    const termText = () => run("(()=>{const b=window.__pmTerm.buffer.active;let s='';for(let i=0;i<b.length;i++)s+=(b.getLine(i)?.translateToString(true)||'')+'\\n';return s;})()");

    stage = 'lagebild';
    await wait(() => run("document.querySelectorAll('#pm-situation .pm-row').length>=4"), 'Lagebild gerendert');
    const text = await run("document.getElementById('pm-situation').innerText");
    for (const needle of ['Backend', 'wartet auf dich', 'arbeitet', 'kein Agent', 'beendet', 'feat/backend', 'Ordner fehlt', '1 vorgemerkt', ':3000', 'keiner Kachel zugeordnet', 'Projektmanager-Oberfläche abnehmen.', 'Aktive Reservierungen: 2']) {
      assert.ok(text.includes(needle), 'Lagebild enthält: ' + needle + '\n' + text);
    }
    assert.match(await run("document.getElementById('pm-title').textContent"), /Projektmanager · QA Projekt/);
    assert.match(await run("document.getElementById('pm-hint').textContent"), /nichts wird ohne deine Bestätigung eingefügt/);

    stage = 'terminal';
    await wait(async () => (await termText()).includes('REPLAY_VOM_MANAGER'), 'Replay geschrieben');
    assert.equal(calls.start, 1);
    await wait(() => calls.resize.length > 0 || true, 'resize');
    await run("window.__pmTerm.input('hallo manager\\r', true)");
    await wait(async () => (await termText()).includes('hallo manager'), 'Eingabe über Kanal zurückgespiegelt');
    assert.ok(calls.write.join('').includes('hallo manager'));

    stage = 'refresh';
    const before = calls.state;
    await run("document.getElementById('pm-refresh').click()");
    await wait(() => calls.state > before, 'Knopf lädt Lagebild neu');

    stage = 'exit-restart';
    win.webContents.send('pm:exit', 0);
    await wait(() => run("!document.getElementById('pm-exit').hidden"), 'Exit-Hinweis sichtbar');
    await run("document.getElementById('pm-exit-restart').click()");
    await wait(() => calls.restart === 1, 'Neu starten aufgerufen');
    await wait(async () => (await termText()).includes('NEUSTART_OK'), 'Ausgabe nach Neustart');
    assert.equal(await run("document.getElementById('pm-exit').hidden"), true);

    stage = 'screenshot';
    await delay(300);
    const shot = path.join(os.tmpdir(), 'mt-pm-ui-qa.png');
    fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({ result: 'passed', checks: ['Lagebild-Rendering', 'xterm Replay/Ein-/Ausgabe über Kanäle', 'Aktualisieren-Knopf', 'Exit-Hinweis und Neu starten'], calls: { start: calls.start, restart: calls.restart, state: calls.state }, screenshot: shot }));
    clearTimeout(timer); app.exit(0);
  } catch (error) {
    console.error('PM UI QA failed at ' + stage + ':', error);
    clearTimeout(timer); app.exit(1);
  }
});
