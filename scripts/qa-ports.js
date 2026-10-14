'use strict';
// Isolated real Electron UI, IPC, PTY and local HTTP servers. No provider calls.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-ports-qa-'));
const data = path.join(root, 'data'), home = path.join(root, 'home');
const first = path.join(root, 'first'), second = path.join(root, 'second');
for (const dir of [data, home, first, second, path.join(data, 'session')]) fs.mkdirSync(dir, { recursive: true });
// Only the temporary second project is a git repo, for the F07/F11 integration check.
execFileSync('git', ['init', '-q', second]);
execFileSync('git', ['-C', second, '-c', 'user.name=Ports QA', '-c', 'user.email=ports-qa@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'temporary fixture']);
const projects = [{ id: 'ports-a', name: 'Ports Projekt A', path: first }, { id: 'ports-b', name: 'Ports Projekt B', path: second }];
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify(projects));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'ports-a',
  projects: Object.fromEntries(projects.map((p, i) => [p.id, { terminals: [{ id: 'ports-' + i, title: 'Server ' + (i + 1) }] }])) }));
const serverFile = path.join(root, 'server.js');
fs.writeFileSync(serverFile, `const fs=require('fs'),http=require('http');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>'+process.argv[3]+'</title><h1>'+process.argv[3]+'</h1>');});
server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,port:server.address().port}));console.log('SERVER_READY');});
setTimeout(()=>server.close(()=>process.exit()),55000);
process.on('SIGTERM',()=>server.close(()=>process.exit()));`);
const shellFile = path.join(root, 'qa-shell');
fs.writeFileSync(shellFile, '#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
process.env.SHELL = shellFile;
os.homedir = () => home;
app.setName('Ports QA ' + process.pid); app.setPath('userData', data);
const serviceModule = require('../src/main/port-service');
const originalCreate = serviceModule.createPortService;
let listCalls = 0;
serviceModule.createPortService = options => {
  const service = originalCreate(options), list = service.list;
  service.list = (...args) => { listCalls++; return list(...args); };
  return service;
};
const foreign = http.createServer((_req, res) => res.end('foreign fixture'));
const owned = new Set();
let failed = false, finished = false;
let stage = 'bootstrap';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function cleanup() {
  for (const pid of owned) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  foreign.close();
}
const timeout = setTimeout(() => { cleanup(); console.error('Ports QA timed out at ' + stage); app.exit(1); }, 60000);
process.on('exit', cleanup);
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
app.on('browser-window-created', (_event, win) => {
  // Concurrent isolated QA windows can occlude this one; keep its test frames running.
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_event, ...args) => {
    const details = typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] };
    if (details.level === 'error' || details.level === 3) console.error('Renderer:', details.message);
  });
  win.webContents.once('did-finish-load', async () => {
    const run = async code => {
      try { return await win.webContents.executeJavaScript(code); }
      catch (error) { console.error('Renderer code failed:', code); throw error; }
    };
    const wait = async (fn, label, timeoutMs = 12000) => {
      const end = Date.now() + timeoutMs;
      while (!await fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await delay(80); }
    };
    const rows = () => run("[...document.querySelectorAll('.ports-entry')].map(e=>({id:e.dataset.portId,text:e.textContent,disabled:[...e.querySelectorAll('button')].map(b=>b.disabled)}))");
    const action = (id, label) => run(`(() => { const row=[...document.querySelectorAll('.ports-entry')].find(e=>e.dataset.portId===${JSON.stringify(id)});const b=row&&[...row.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b||b.disabled)throw new Error('Missing action');b.click(); })()`);
    try {
      stage = 'projects';
      await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
      await wait(() => run("window.DeckApp?.state.activeId === 'ports-a' && window.DeckApp.state.panes.get('ports-a')[0].status === 'running'"), 'restored PTY');
      const fixtures = [];
      for (let i = 0; i < 2; i++) {
        if (i) {
          await run("[...document.querySelectorAll('.proj')].find(e=>e.querySelector('.proj-name').textContent==='Ports Projekt B').click()");
          await wait(() => run("window.DeckApp.state.panes.get('ports-b')[0].status === 'running'"), 'second PTY');
        }
        const file = path.join(root, 'server-' + i + '.json');
        const command = 'ELECTRON_RUN_AS_NODE=1 ' + quote(process.execPath) + ' ' + quote(serverFile) + ' ' + quote(file) + ' ' + quote('PORTS_QA_' + i) + '\r';
        await run(`window.deck.terminals.write(${JSON.stringify('ports-' + i)}, ${JSON.stringify(command)})`);
        await wait(() => fs.existsSync(file), 'server start');
        const record = JSON.parse(fs.readFileSync(file)); owned.add(record.pid); fixtures.push(record);
      }
      await run("document.getElementById('btn-ports').click()");
      await wait(async () => (await rows()).filter(r => fixtures.some(f => r.text.includes('PID ' + f.pid))).length === 2, 'two assigned listeners');
      const list = await rows();
      stage = 'port-actions';
      const a = list.find(r => r.text.includes('PID ' + fixtures[0].pid));
      const b = list.find(r => r.text.includes('PID ' + fixtures[1].pid));
      assert.match(a.text, /Ports Projekt A.*Server 1/); assert.match(b.text, /Ports Projekt B.*Server 2/);
      assert.deepEqual(a.disabled, [false, false]); assert.deepEqual(b.disabled, [false, false]);
      const other = list.find(r => r.text.includes('PID ' + process.pid) && r.text.includes(':' + foreign.address().port));
      assert.ok(other); assert.match(other.text, /Nicht zugeordnet/); assert.deepEqual(other.disabled, [true, true]);
      await action(a.id, 'Zum Terminal');
      await wait(() => run("window.DeckApp.state.activeId === 'ports-a' && window.DeckApp.state.activeByProject['ports-a'] === 'ports-0' && window.DeckApp.state.panes.get('ports-a')[0].term.textarea === document.activeElement"), 'jump to correct project and terminal');
      await action(b.id, 'HTTP im Browser');
      await wait(() => run("window.DeckApp.state.activeId === 'ports-b' && window.DeckApp.state.panes.get('ports-b')[0].desc.browserOpen"), 'correct browser target');
      await wait(() => run("window.DeckApp.state.panes.get('ports-b')[0].el.querySelector('webview')?.getTitle() === 'PORTS_QA_1'"), 'HTTP page loaded');
      stage = 'worktree';
      const worktree = await run("window.deck.worktrees.create('ports-b', {branch:'ports-qa-worktree'})");
      assert.ok(worktree.ok, worktree.error);
      const ws = worktree.worktree;
      const worktreeFile = path.join(root, 'worktree-server.json');
      const worktreeCommand = 'ELECTRON_RUN_AS_NODE=1 ' + quote(process.execPath) + ' ' + quote(serverFile) + ' ' + quote(worktreeFile) + ' ' + quote('PORTS_QA_WORKTREE');
      await run("document.getElementById('btn-menu').click();[...document.querySelectorAll('#menu .menu-item')].find(e=>e.textContent.includes('Terminal in Arbeitskopie')).click()");
      await wait(() => run("[...document.querySelectorAll('.wt-title')].some(e=>e.textContent==='ports-qa-worktree')"), 'worktree picker');
      await run("[...document.querySelectorAll('.wt-title')].find(e=>e.textContent==='ports-qa-worktree').closest('.wt-row').click()");
      await wait(() => run(`window.DeckApp.state.panes.get('ports-b').some(p=>p.desc.workspaceId===${JSON.stringify(ws.workspaceId)}&&p.status==='running')`), 'real worktree tile');
      const worktreeTerminalId = await run(`window.DeckApp.state.panes.get('ports-b').find(p=>p.desc.workspaceId===${JSON.stringify(ws.workspaceId)}).id`);
      await run(`window.deck.terminals.write(${JSON.stringify(worktreeTerminalId)},${JSON.stringify(worktreeCommand + '\r')})`);
      await wait(() => fs.existsSync(worktreeFile), 'worktree server');
      const worktreeRecord = JSON.parse(fs.readFileSync(worktreeFile)); owned.add(worktreeRecord.pid);
      const worktreePorts = await run('window.deck.ports.list()');
      const workspaceListener = worktreePorts.entries.find(e => e.pid === worktreeRecord.pid);
      assert.ok(workspaceListener);
      assert.equal(workspaceListener.terminalId, worktreeTerminalId);
      assert.equal(workspaceListener.workspaceId, ws.workspaceId);
      assert.equal(fs.realpathSync(workspaceListener.cwd), fs.realpathSync(ws.cwd));
      await run('window.DeckApp.portsPanel.refresh()');
      await action(workspaceListener.id, 'HTTP im Browser');
      await wait(() => run(`window.DeckApp.state.panes.get('ports-b').find(p=>p.id===${JSON.stringify(worktreeTerminalId)}).el.querySelector('webview')?.getTitle()==='PORTS_QA_WORKTREE'`), 'browser in worktree tile');
      stage = 'polling';
      const result = await run('window.deck.ports.resolve("not-a-current-port")');
      assert.equal(result.ok, false);
      process.kill(fixtures[0].pid, 'SIGTERM'); owned.delete(fixtures[0].pid);
      await wait(async () => !(await rows()).some(r => r.id === a.id), 'ended server disappears via polling');
      assert.ok((await rows()).some(r => r.id === b.id));
      await run("document.getElementById('btn-settings').click()");
      assert.equal(await run("window.DeckApp.portsPanel.isOpen()"), false);
      await delay(150); const closedAt = listCalls; await delay(3300);
      assert.equal(listCalls, closedAt, 'closed panel must stop scanning');
      assert.ok(foreign.listening, 'foreign process/server remains untouched');
      stage = 'screenshot';
      await run("window.DeckApp.settingsPanel.toggle(false); document.getElementById('btn-ports').click()");
      await wait(async () => (await rows()).some(r => r.id === b.id), 'panel reopened');
      assert.equal(await run("document.getElementById('ports-panel').hidden"), false);
      assert.equal(await run("document.getElementById('settings-panel').hidden"), true);
      win.showInactive(); win.moveTop();
      await run('Promise.race([new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),new Promise(resolve=>setTimeout(resolve,1500))])');
      const screenshot = path.join(root, 'ports.png');
      fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({ result: 'passed', checks: ['real UI/IPC/PTY listener ownership', 'two projects', 'foreign listener unassigned and untouched', 'correct terminal focus', 'HTTP in correct mini-browser', 'real worktree tile retains cwd/workspaceId and opens correct browser', 'stale port rejected', 'server end removed by polling', 'settings closes panel and stops polling', 'panel reopens'], screenshot, data }));
    } catch (e) { failed = true; console.error(e.stack); }
    cleanup(); clearTimeout(timeout); finished = true;
    try { await run("Promise.all([...window.DeckApp.state.panes.values()].flat().map(p=>window.deck.terminals.kill(p.id)))"); } catch {}
    app.exit(failed ? 1 : 0);
  });
});
app.on('window-all-closed', () => { if (!finished) { cleanup(); clearTimeout(timeout); app.exit(1); } });
require('../src/main/main');
