'use strict';

// PM: Ende-zu-Ende-QA des Projektmanagers mit echtem Renderer, Preload, Main, PTY und mt-pm-Brücke.
// Alles liegt in einem temporären Ordner: Datenordner, Git-Projekt mit Arbeitskopie, Shell-Kacheln
// mit Eingabe-Recorder und ein Fake-`claude` auf dem PATH (kein echter Agent, kein Provider).
// Das Fake-claude startet als Manager, nimmt Zeilen aus dem Manager-Terminal entgegen und führt
// `mt-pm …` aus; Aufrufe und Ergebnisse werden aufgezeichnet.
//   node_modules/.bin/electron scripts/qa-project-manager.js
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const electron = require('electron');
const { app, BrowserWindow, Menu, dialog } = electron;

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mt-pm-e2e-')));
const home = path.join(root, 'home'), data = path.join(root, 'data'), project = path.join(root, 'project');
const other = path.join(root, 'other'), fakeBin = path.join(root, 'fakebin');
for (const d of [home, data, project, other, fakeBin, path.join(data, 'session'), path.join(data, 'pm')]) fs.mkdirSync(d, { recursive: true });

// Git-Projekt: Koordinationsdokumente eingecheckt, dann je eine geänderte, vorgemerkte und neue Datei.
const git = (...a) => execFileSync('git', a, { cwd: project, encoding: 'utf8' });
git('init', '-q', '-b', 'main'); git('config', 'user.email', 'qa@example.com'); git('config', 'user.name', 'QA');
fs.writeFileSync(path.join(project, 'a.txt'), 'eins\n');
fs.writeFileSync(path.join(project, 'PROJECT_STATUS.md'), '# Status\n\n## Nächster Schritt\n\nProjektmanager-QA abschließen.\n\n## Blocker\n\n- keine\n');
fs.writeFileSync(path.join(project, 'WORK_IN_PROGRESS.md'), '# WIP\n\n## Aktive Reservierungen\n\n### T-1\n- Status: in Arbeit\n\n### T-2\n- Status: abgeschlossen\n');
fs.writeFileSync(path.join(project, 'PROGRESS.md'), '# Fortschritt\n\n- QA-Eintrag Projektmanager\n');
git('add', '.'); git('commit', '-q', '-m', 'init');
fs.writeFileSync(path.join(project, 'a.txt'), 'zwei\n');
fs.writeFileSync(path.join(project, 'b.txt'), 'neu vorgemerkt\n'); git('add', 'b.txt');
fs.writeFileSync(path.join(project, 'c.txt'), 'unversioniert\n');

// Kachel-Shell: der Manager bekommt eine echte bash (dort tippt die App den claude-Befehl),
// alle anderen Kacheln einen Eingabe-Recorder. Eine Kachel lauscht zusätzlich auf einem Port.
const records = path.join(root, 'input.jsonl');
const portFlag = path.join(root, 'port-flag'), portFile = path.join(root, 'port.json');
fs.writeFileSync(portFlag, '');
const recorder = path.join(root, 'record-input.js');
fs.writeFileSync(recorder, `const fs=require('node:fs'); const file=${JSON.stringify(records)};
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdout.write('LOCAL_TEST_TERMINAL\\r\\n\\x1b[?2004h');
try { fs.renameSync(${JSON.stringify(portFlag)}, ${JSON.stringify(portFlag)}+'.'+process.pid);
  const s=require('node:net').createServer(()=>{}); s.listen(0,'127.0.0.1',()=>{ fs.writeFileSync(${JSON.stringify(portFile)}, JSON.stringify({pid:process.pid,port:s.address().port})); process.stdout.write('SERVER_TILE '+s.address().port+'\\r\\n'); }); } catch {}
process.stdin.on('data',b=>{ const text=b.toString(); fs.appendFileSync(file,JSON.stringify({pid:process.pid,text})+'\\n'); if(text.includes('QA_QUIT'))process.exit(0); });`);
const quote = (v) => "'" + v.replace(/'/g, "'\"'\"'") + "'";
const shellFile = path.join(root, 'test-shell');
fs.writeFileSync(shellFile, '#!/bin/sh\nif [ -n "$MULTITERMINAL_PM_TOKEN" ]; then exec /bin/bash --noprofile --norc -i; fi\n'
  + 'ELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(recorder) + '\n', { mode: 0o755 });

// Fake-claude: zeichnet Aufruf auf und führt eingegebene mt-pm-Zeilen aus.
const calls = path.join(root, 'claude-calls.jsonl'), results = path.join(root, 'pm-results.jsonl');
const fakeJs = path.join(root, 'fake-claude.js');
fs.writeFileSync(fakeJs, `const fs=require('node:fs'); const cp=require('node:child_process');
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), cwd: process.cwd(),
  token: process.env.MULTITERMINAL_PM_TOKEN || null, socket: process.env.MULTITERMINAL_PM_SOCKET || null, path: process.env.PATH || '' })+'\\n');
process.stdout.write('FAKE_CLAUDE_BEREIT\\r\\n> ');
let buf='';
process.stdin.on('data', (b) => { buf += b.toString(); let i;
  while ((i = buf.indexOf('\\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (line === 'exit') process.exit(0);
    if (line.startsWith('mt-pm')) { const r = cp.spawnSync('/bin/sh', ['-c', line], { encoding: 'utf8', env: process.env });
      fs.appendFileSync(${JSON.stringify(results)}, JSON.stringify({ cmd: line, code: r.status, stdout: r.stdout, stderr: r.stderr })+'\\n');
      process.stdout.write((r.stdout + r.stderr).replace(/\\n/g, '\\r\\n')); }
    process.stdout.write('> '); } });`);
fs.writeFileSync(path.join(fakeBin, 'claude'), '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(fakeJs) + ' "$@"\n', { mode: 0o755 });

process.env.SHELL = shellFile;
process.env.PATH = fakeBin + path.delimiter + (process.env.PATH || '/usr/bin:/bin');
process.env.BASH_SILENCE_DEPRECATION_WARNING = '1';
process.env.PS1 = 'qa$ ';
os.homedir = () => home;
app.setName('Multiterminal PM QA ' + process.pid); app.setPath('userData', data);

const RESUME_ID = '3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f';
fs.writeFileSync(path.join(data, 'pm', 'sessions.json'), JSON.stringify({ 'qa-pm': { nativeSessionId: RESUME_ID, observedAt: Date.now() } }));
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([
  { id: 'qa-pm', name: 'PM-Projekt', path: project }, { id: 'qa-other', name: 'Fremdprojekt', path: other },
]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'qa-pm', projects: {
  'qa-pm': { terminals: [{ id: 'qa-alpha', title: 'Alpha' }, { id: 'qa-beta', title: 'Beta' }, { id: 'qa-dead', title: 'Beendet' }, { id: 'qa-server', title: 'Server' }] },
  'qa-other': { terminals: [{ id: 'qa-foreign', title: 'Fremd' }] },
} }));
const confirmations = [];
dialog.showMessageBox = async (_w, options) => { confirmations.push(options); return { response: 0, checkboxChecked: false }; };

let failed = false, stage = 'bootstrap', started = false;
const timer = setTimeout(() => { console.error(JSON.stringify({ error: 'PM QA timed out', stage, root })); app.exit(1); }, 150000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jsonl = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const inputs = () => jsonl(records);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(fn, label, ms = 12000) {
  const t = Date.now();
  while (!(await fn())) { if (Date.now() - t > ms) throw new Error('Timed out: ' + label); await sleep(50); }
}
const pmWindows = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('pm.html'));
const pmRun = (code) => { const w = pmWindows()[0]; if (!w) throw new Error('kein Manager-Fenster'); return w.webContents.executeJavaScript(code); };
const pmText = () => pmRun("(() => { const b = window.__pmTerm.buffer.active; let s=''; for (let i=0;i<b.length;i++) s += b.getLine(i).translateToString(true) + '\\n'; return s; })()");
const pmLoaded = async () => { const w = pmWindows()[0]; return Boolean(w) && !w.webContents.isLoading() && await w.webContents.executeJavaScript('!!window.__pmTerm').catch(() => false); };

app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3 && !message.includes('Electron Security Warning')) console.error('Renderer:', message); });
  if (started) return; // weitere Fenster sind Manager-Fenster
  started = true;
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code);
    const panes = "window.DeckApp.state.panes.get('qa-pm')";
    const draft = () => run('window.DeckApp.promptDraft.get()');
    const mtpm = async (cmd) => {
      const before = jsonl(results).length;
      await pmRun(`window.pm.write(${JSON.stringify(cmd + '\r')})`);
      await until(() => jsonl(results).length > before, 'mt-pm result: ' + cmd, 20000);
      return jsonl(results)[before];
    };
    const shots = [];
    const shot = async (w, name) => {
      await w.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const file = path.join(root, name);
      fs.writeFileSync(file, (await w.webContents.capturePage()).toPNG());
      shots.push(file);
    };
    try {
      await until(() => run(`${panes}?.length===4 && ${panes}.every(p=>p.status==='running'&&p.plainText().includes('LOCAL_TEST_TERMINAL'))`), 'four recorder tiles', 20000);
      stage = 'worktree';
      const wt = await run("window.deck.worktrees.create('qa-pm', { branch: 'feature/pm-qa' })");
      assert.equal(wt && wt.ok, true, 'worktree created: ' + JSON.stringify(wt));

      stage = 'open via sidebar symbol';
      assert.equal(pmWindows().length, 0);
      const activeBefore = await run('window.DeckApp.state.activeId');
      await run("[...document.querySelectorAll('.proj-pm')].find(b => b.parentElement.textContent.includes('PM-Projekt')).click()");
      await until(pmLoaded, 'manager window loaded');
      assert.equal(pmWindows().length, 1);
      assert.equal(await run('window.DeckApp.state.activeId'), activeBefore, 'symbol click does not switch the project');
      const pmWin = pmWindows()[0];
      assert.equal(pmWin.getTitle(), 'Projektmanager – PM-Projekt');
      assert.match(pmWin.webContents.getURL(), /pm\.html\?project=qa-pm$/);

      stage = 'manager pty';
      await until(() => jsonl(calls).length === 1 && pmText().then((t) => t.includes('FAKE_CLAUDE_BEREIT')), 'fake claude started', 20000);
      const call = jsonl(calls)[0];
      assert.equal(fs.realpathSync(call.cwd), project, 'manager runs in the project folder');
      assert.equal(call.argv[0], '--append-system-prompt');
      assert.match(call.argv[1], /Du bist der Projektmanager dieses Projekts/);
      assert.match(call.argv[1], /mt-pm send/);
      assert.deepEqual(call.argv.slice(2), ['--resume=' + RESUME_ID], 'stored conversation is resumed');
      assert.equal(call.argv.includes('--continue'), false);
      assert.ok(call.token && call.socket && call.socket.endsWith('.pm.sock'), 'manager gets pm socket and token');
      assert.ok(call.path.split(':').some((d) => fs.existsSync(path.join(d, 'mt-pm'))), 'mt-pm on PATH');
      assert.equal(fs.existsSync(path.join(data, 'pm', 'pm-role.md')), true, 'role file copied to userData');

      stage = 'second open focuses';
      await run("document.getElementById('btn-pm').click()");
      await sleep(400);
      win.webContents.send('menu:action', 'project-manager');
      await sleep(400);
      assert.equal(pmWindows().length, 1, 'still exactly one manager window');
      assert.equal(pmWindows()[0], pmWin);
      assert.equal(jsonl(calls).length, 1, 'no second manager process');
      const st0 = await pmRun('window.pm.state()');
      assert.equal(st0.manager.running, true);

      stage = 'lagebild';
      const port = await (async () => { await until(() => fs.existsSync(portFile), 'server tile port'); return JSON.parse(fs.readFileSync(portFile, 'utf8')); })();
      let st;
      await until(async () => { st = await pmRun('window.pm.state()'); return st.ok && st.ports.some((p) => p.port === port.port) && st.worktrees.length === 1; }, 'state with port and worktree', 20000);
      assert.deepEqual(Object.keys(st).sort(), ['agentStatusEnabled', 'capturedAt', 'changes', 'docs', 'manager', 'ok', 'ports', 'project', 'terminals', 'worktrees']);
      assert.deepEqual(st.project, { id: 'qa-pm', name: 'PM-Projekt', path: project });
      assert.deepEqual(st.terminals.map((t) => t.id).sort(), ['qa-alpha', 'qa-beta', 'qa-dead', 'qa-server']);
      assert.equal(st.terminals.some((t) => t.id.startsWith('pm-')), false, 'manager not listed as a tile');
      for (const t of st.terminals) {
        assert.equal(t.running, true); assert.equal(t.agent, null, 'no agent status is reported honestly'); assert.equal(t.preset, null);
        assert.deepEqual(Object.keys(t).sort(), ['agent', 'id', 'preset', 'running', 'title', 'workspace']);
      }
      assert.equal(st.worktrees[0].branch, 'feature/pm-qa'); assert.equal(st.worktrees[0].missing, false); assert.equal(st.worktrees[0].changedFiles, 0);
      assert.deepEqual(st.changes, { ok: true, branch: 'main', staged: 1, unstaged: 1, untracked: 1 });
      const portEntry = st.ports.find((p) => p.port === port.port);
      assert.ok(['qa-alpha', 'qa-beta', 'qa-dead', 'qa-server'].includes(portEntry.terminalId), 'port mapped to a tile');
      assert.deepEqual(st.docs, { nextStep: 'Projektmanager-QA abschließen.', activeReservations: 1 });
      assert.deepEqual(st.manager, { running: true, resumed: true });
      await pmRun("document.getElementById('pm-refresh').click()");
      await until(() => pmRun("document.getElementById('pm-situation').textContent.includes(':" + port.port + "')"), 'port rendered');
      const side = await pmRun("document.getElementById('pm-situation').textContent");
      for (const part of ['Alpha', 'Beta', 'Server', 'feature/pm-qa', 'Projektmanager-QA abschließen.', 'Aktive Reservierungen: 1', 'Manager läuft']) assert.ok(side.includes(part), 'Lagebild misses ' + part);
      assert.match(side, /kein Agentenereignis|Agentenstatus aus/);
      assert.ok(side.includes('Kachel ' + st.terminals.find((t) => t.id === portEntry.terminalId).title), 'port shows the tile title');
      assert.equal(await pmRun("document.getElementById('pm-title').textContent"), 'Projektmanager · PM-Projekt');
      assert.match(await pmRun("document.getElementById('pm-hint').textContent"), /nichts wird ohne deine Bestätigung eingefügt/);

      stage = 'lagebild toggle';
      const findItem = (menu, label) => { for (const it of menu.items) { if (it.label === label) return it; if (it.submenu) { const f = findItem(it.submenu, label); if (f) return f; } } return null; };
      const sitItem = findItem(Menu.getApplicationMenu(), 'Lagebild im Projektmanager ein/aus');
      assert.ok(sitItem, 'menu item for the Lagebild'); assert.equal(sitItem.accelerator, process.platform === 'darwin' ? 'Cmd+\\' : 'Ctrl+Alt+\\');
      const colsBefore = await pmRun('window.__pmTerm.cols');
      await pmRun("document.getElementById('pm-toggle-situation').click()");
      assert.equal(await pmRun("document.getElementById('pm-situation').hidden"), true);
      assert.equal(await pmRun("document.getElementById('pm-refresh').hidden"), true, 'refresh button hidden with the Lagebild');
      assert.equal(await pmRun("document.getElementById('pm-toggle-situation').getAttribute('aria-expanded')"), 'false');
      await until(async () => (await pmRun('window.__pmTerm.cols')) > colsBefore, 'manager terminal uses the freed width');
      assert.equal(await pmRun("localStorage.getItem('mt.pm.situation')"), 'off', 'remembered');
      pmWin.webContents.send('pm:menu', 'pm-situation'); // derselbe Weg wie der Menü-Hotkey bei fokussiertem Manager-Fenster
      await until(() => pmRun("!document.getElementById('pm-situation').hidden"), 'hotkey shows the Lagebild again');
      await until(async () => (await pmRun('window.__pmTerm.cols')) === colsBefore, 'terminal back to its width');
      assert.equal(await pmRun("localStorage.getItem('mt.pm.situation')"), 'on');

      stage = 'mt-pm read commands';
      let r = await mtpm('mt-pm status');
      assert.equal(r.code, 0, r.stderr); for (const part of ['Alpha', 'Beta', 'feature/pm-qa']) assert.ok(r.stdout.includes(part), 'status misses ' + part);
      r = await mtpm('mt-pm status --json');
      assert.equal(r.code, 0, r.stderr);
      const sj = JSON.parse(r.stdout);
      assert.deepEqual((sj.terminals || sj.result?.terminals).map((t) => t.id).sort(), ['qa-alpha', 'qa-beta', 'qa-dead', 'qa-server']);
      r = await mtpm('mt-pm output Alpha --lines 20');
      assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /LOCAL_TEST_TERMINAL/); assert.doesNotMatch(r.stdout, /\x1b/, 'ANSI removed');
      r = await mtpm('mt-pm changes --json');
      assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /"staged":\s*1/); assert.match(r.stdout, /feature\/pm-qa/);
      r = await mtpm('mt-pm ports');
      assert.equal(r.code, 0, r.stderr); assert.ok(r.stdout.includes(String(port.port)), 'ports lists the server port');
      r = await mtpm('mt-pm docs');
      assert.equal(r.code, 0, r.stderr); for (const part of ['Projektmanager-QA abschließen.', 'QA-Eintrag Projektmanager', 'init']) assert.ok(r.stdout.includes(part), 'docs misses ' + part);
      r = await mtpm('mt-pm output qa-foreign');
      assert.equal(r.code, 1, 'foreign tile output refused');
      r = await mtpm('mt-pm frobnicate');
      assert.equal(r.code, 2, 'usage error');

      stage = 'mt-pm send -> prompt preview';
      assert.deepEqual(inputs(), []);
      r = await mtpm("mt-pm send Beta 'Bitte die Tests ausführen und berichten'");
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /In Promptvorschau von Beta gelegt – wartet auf Bestätigung durch den Nutzer\./);
      const d = await draft();
      assert.equal(d.terminalId, 'qa-beta');
      assert.equal(d.text, '[Projektmanager] Bitte die Tests ausführen und berichten');
      assert.equal(await run("document.getElementById('prompt-draft-dialog').open"), true);
      await sleep(300);
      assert.deepEqual(inputs(), [], 'nothing reaches any PTY before the user inserts');
      r = await mtpm("mt-pm send Alpha 'zweiter Auftrag'");
      assert.equal(r.code, 1); assert.match(r.stderr, /Es ist bereits eine Vorschau offen\./);
      assert.equal((await draft()).terminalId, 'qa-beta', 'open preview not overwritten');
      await shot(win, 'pm-main-preview.png');
      await run("[...document.querySelectorAll('#prompt-draft-dialog button')].find(b=>b.textContent==='Ins Terminal einfügen').click()");
      await until(() => inputs().length > 0, 'beta receives input after insert');
      const betaPid = inputs()[0].pid;
      assert.equal(inputs().map((i) => i.text).join(''), '\x1b[200~[Projektmanager] Bitte die Tests ausführen und berichten\x1b[201~');
      assert.equal(new Set(inputs().map((i) => i.pid)).size, 1);

      stage = 'send refusals';
      await run("window.deck.terminals.write('qa-dead', 'QA_QUIT')");
      await until(() => run(`${panes}.find(p=>p.id==='qa-dead').status !== 'running'`), 'dead tile exited');
      const quitCount = inputs().length;
      for (const [target, label] of [['qa-foreign', 'foreign project'], ['pm-qa-pm', 'manager itself'], ['qa-dead', 'exited tile'], ['Beendet', 'exited tile by title']]) {
        r = await mtpm(`mt-pm send ${target} 'darf nicht ankommen'`);
        assert.equal(r.code, 1, label + ' must be refused'); assert.ok(r.stderr.trim(), label + ' has an error text');
        assert.equal(await draft(), null, label + ': no preview');
      }
      await sleep(200);
      assert.equal(inputs().length, quitCount, 'refused sends write nothing');
      assert.ok(inputs().every((i) => i.pid === betaPid || i.text.includes('QA_QUIT')));
      await shot(pmWin, 'pm-window.png');

      stage = 'close and reopen -> replay';
      const managerPid = jsonl(calls)[0].pid;
      pmWin.close();
      await until(() => pmWindows().length === 0, 'manager window closed');
      await sleep(300);
      assert.equal(alive(managerPid), true, 'closing the window keeps the manager running');
      await run("document.getElementById('btn-pm').click()");
      await until(pmLoaded, 'manager window reopened');
      await until(() => pmText().then((t) => t.includes('FAKE_CLAUDE_BEREIT') && t.includes('In Promptvorschau von Beta')), 'replay of earlier output');
      assert.equal(jsonl(calls).length, 1, 'reopen does not start a second manager');
      r = await mtpm('mt-pm ports');
      assert.equal(r.code, 0, 'manager still usable after reopen');

      stage = 'restart';
      await pmRun("document.getElementById('pm-restart').click()");
      await until(() => jsonl(calls).length === 2, 'restarted manager', 20000);
      await until(() => !alive(managerPid), 'old manager ended');
      assert.deepEqual(jsonl(calls)[1].argv.slice(2), ['--resume=' + RESUME_ID]);
      await until(() => pmText().then((t) => t.includes('FAKE_CLAUDE_BEREIT')), 'new manager output');
      assert.equal(await pmRun("document.getElementById('pm-exit').hidden"), true, 'restart shows no exit notice');
      r = await mtpm('mt-pm status');
      assert.equal(r.code, 0, 'new token works after restart: ' + r.stderr);

      stage = 'exit and restart';
      await pmRun("window.pm.write('exit\\r')");
      await sleep(400);
      await pmRun("window.pm.write('exit\\r')");
      await until(() => pmRun("!document.getElementById('pm-exit').hidden"), 'exit notice shown');
      const exitedToken = jsonl(calls)[1];
      await pmRun("document.getElementById('pm-exit-restart').click()");
      await until(() => jsonl(calls).length === 3, 'manager started again', 20000);
      await until(() => pmRun("document.getElementById('pm-exit').hidden"), 'exit notice hidden');
      const bridgeCall = (token) => new Promise((resolve) => {
        const c = net.connect(exitedToken.socket); let buf = '';
        c.on('connect', () => c.write(JSON.stringify({ token, cmd: 'status', args: {} }) + '\n'));
        c.on('data', (x) => { buf += x; }); c.on('close', () => resolve(JSON.parse(buf.split('\n')[0] || '{}'))); c.on('error', () => resolve({ ok: false, error: 'socket' }));
      });
      assert.equal((await bridgeCall(exitedToken.token)).ok, false, 'token of the exited manager is revoked');
      assert.equal((await bridgeCall('falsch')).ok, false, 'unknown token refused');

      stage = 'remove project ends manager';
      const last = jsonl(calls)[2];
      assert.equal((await bridgeCall(last.token)).ok, true, 'current token works');
      const removed = await run("window.deck.projects.remove('qa-pm')");
      assert.notEqual(removed, false);
      assert.equal(confirmations.length, 1);
      await until(() => pmWindows().length === 0, 'manager window closed with the project');
      await until(() => !alive(last.pid), 'manager process ended');
      assert.equal((await bridgeCall(last.token)).ok, false, 'token revoked with the project');
      const sessionsFile = JSON.parse(fs.readFileSync(path.join(data, 'pm', 'sessions.json'), 'utf8'));
      assert.equal(Object.prototype.hasOwnProperty.call(sessionsFile, 'qa-pm'), false, 'stored conversation forgotten');

      console.log(JSON.stringify({ result: 'passed', checks: [
        'sidebar symbol, top button and menu action open exactly one manager window per project',
        'manager PTY in project folder with role prompt and --resume, never --continue',
        'Lagebild schema and rendering: tiles, honest no-agent, worktree, changes, port, next step',
        'Lagebild toggle: button and hotkey path, terminal widens, state remembered, menu accelerator',
        'mt-pm status/output/changes/ports/docs with real socket and token',
        'mt-pm send opens prompt preview for the right tile, nothing written before insert',
        'second send while preview open refused, preview kept',
        'send to foreign project, manager itself and exited tile refused',
        'close/reopen keeps manager and replays output',
        'restart and exit/restart with token rotation',
        'removing the project ends manager, closes window, revokes token, forgets conversation',
      ], root, screenshots: shots }));
    } catch (error) { failed = true; console.error(JSON.stringify({ stage, root, error: error.stack || String(error) })); }
    clearTimeout(timer); app.exit(failed ? 1 : 0);
  });
});
require('../src/main/main');
