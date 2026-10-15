'use strict';

// F10 QA: echte Electron-Oberfläche + lokaler Fixture-Server (kein echtes Second Brain).
// Der Fixture-Server antwortet mit 403, sobald ein Origin-Header ankommt, und merkt sich alle Anfragen.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-tasklink-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data'), project = path.join(root, 'project');
for (const folder of [home, data, project, path.join(data, 'session')]) fs.mkdirSync(folder, { recursive: true });
const recorder = path.join(root, 'record-input.js');
const records = path.join(root, 'input.jsonl');
fs.writeFileSync(recorder, `const fs=require('node:fs'); const file=${JSON.stringify(records)}; if(process.stdin.isTTY)process.stdin.setRawMode(true); process.stdout.write('LOCAL_TEST_TERMINAL\\r\\n\\x1b[?2004h'); process.stdin.on('data',b=>fs.appendFileSync(file,JSON.stringify({pid:process.pid,text:b.toString()})+'\\n'));`);
const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
const shellFile = path.join(root, 'test-shell');
fs.writeFileSync(shellFile, '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(recorder) + '\n', { mode: 0o755 });
process.env.SHELL = shellFile;
os.homedir = () => home;
app.setName('Multiterminal TaskLink QA ' + process.pid); app.setPath('userData', data);
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'qa-project', name: 'Aufgabentest', path: project }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'qa-project', projects: { 'qa-project': { terminals: [
  { id: 'qa-alpha', title: 'Alpha' }, { id: 'qa-beta', title: 'Beta' },
] } } }));

/* ---------- Fixture-Server ---------- */
let open = [
  { id: 'aaa111', type: 'todo', title: 'Steuererklärung abgeben', space: 'Privat', dueDate: '2026-10-20', priority: 'hoch', done: false, overdue: false, dueToday: false },
  { id: 'bbb222', type: 'goal', title: 'Multiterminal Aufgabenablage', space: 'Arbeit', done: false, steps: [] },
  { id: 'ccc333', type: 'daily', title: 'Routine soll fehlen', space: 'Arbeit', done: false },
  { id: 'ddd444', type: 'idee', title: 'Idee soll fehlen', space: 'Arbeit', done: false },
];
let finished = [];
const seen = [];
let server;
const startFixture = () => new Promise((resolve) => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, origin: req.headers.origin });
    if (req.headers.origin !== undefined) { res.writeHead(403); res.end('{"error":"Origin"}'); return; }
    const body = req.url === '/api/todos' ? open : req.url === '/api/todos/erledigt' ? finished : null;
    if (!body) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const stopFixture = () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });

let failed = false, stage = 'bootstrap';
const timer = setTimeout(() => { console.error(JSON.stringify({ error: 'TaskLink QA timed out', stage, root })); app.exit(1); }, 90000);
const inputs = () => fs.existsSync(records) ? fs.readFileSync(records, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sessionTerm = id => JSON.parse(fs.readFileSync(path.join(data, 'session/session.json'), 'utf8')).projects['qa-project'].terminals.find(t => t.id === id);

app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3 && !message.includes('Electron Security Warning')) console.error('Renderer:', message); });
  win.webContents.once('did-finish-load', async () => {
    const run = code => win.webContents.executeJavaScript(code);
    const wait = async (predicate, label) => {
      const start = Date.now();
      while (true) {
        let ok = false;
        try { ok = await predicate(); } catch (_) { ok = false; }
        if (ok) return;
        if (Date.now() - start > 8000) throw new Error('Timed out: ' + label);
        await sleep(30);
      }
    };
    const panes = "window.DeckApp.state.panes.get('qa-project')";
    const tile = id => `${panes}.find(p=>p.id===${JSON.stringify(id)}).el`;
    const chipText = id => run(`${tile(id)}.querySelector('.task-chip .task-label').textContent`);
    const chipStatus = id => run(`${tile(id)}.querySelector('.task-chip').dataset.status`);
    const clickChip = id => run(`${tile(id)}.querySelector('.task-chip').click()`);
    const popText = () => run("document.querySelector('.task-pop') ? document.querySelector('.task-pop').textContent : ''");
    const popBtn = label => run(`(() => { const b=[...document.querySelectorAll('.task-pop button')].find(b=>b.textContent===${JSON.stringify(label)}); if(!b)throw new Error('Button missing: ${label}'); b.click(); })()`);
    const popOpen = () => run("!!document.querySelector('.task-pop')");
    const ready = () => run(`${panes}?.length===2 && ${panes}.every(p=>p.status==='running'&&p.plainText().includes('LOCAL_TEST_TERMINAL'))`);
    try {
      await wait(ready, 'real PTYs');

      stage = 'chip visible, picker lists only todo/goal';
      assert.equal(await chipText('qa-alpha'), '+ Aufgabe');
      assert.equal(await run(`${tile('qa-alpha')}.querySelector('.task-chip').classList.contains('empty')`), true);
      await clickChip('qa-alpha');
      await wait(() => run("document.querySelectorAll('.task-item').length>0"), 'task list');
      const ids = await run("[...document.querySelectorAll('.task-item')].map(b=>b.dataset.taskId)");
      assert.deepEqual(ids.sort(), ['aaa111', 'bbb222']);
      assert.equal(await run("document.activeElement.classList.contains('task-search')"), true, 'search focused');

      stage = 'keys stay in popover';
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'q' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: 'q' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'q' });
      await wait(() => run("document.querySelector('.task-search').value==='q'"), 'typed into search');
      assert.deepEqual(inputs(), [], 'nothing in PTY');
      await run("(() => { const s=document.querySelector('.task-search'); s.value='steuer'; s.dispatchEvent(new Event('input')); })()");
      await wait(() => run("document.querySelectorAll('.task-item').length===1"), 'text filter');
      await run("document.querySelector('.task-search').value=''; document.querySelector('.task-search').dispatchEvent(new Event('input'))");
      await popBtn('Arbeit');
      assert.deepEqual(await run("[...document.querySelectorAll('.task-item')].map(b=>b.dataset.taskId)"), ['bbb222'], 'space filter');
      await popBtn('Alle');

      stage = 'link';
      await run("document.querySelector('.task-item[data-task-id=\"aaa111\"]').click()");
      await wait(async () => (await chipText('qa-alpha')).includes('Steuererklärung'), 'chip shows title');
      assert.equal(await chipStatus('qa-alpha'), 'open');
      assert.match(await popText(), /Privat/);
      assert.match(await popText(), /20\.10\.2026/);
      const shot1 = path.join(root, 'task-link-linked.png');
      await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      fs.writeFileSync(shot1, (await win.webContents.capturePage()).toPNG());

      stage = 'Esc returns focus to terminal';
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await wait(async () => !(await popOpen()), 'popover closed');
      assert.equal(await run(`${tile('qa-alpha')}.contains(document.activeElement)`), true, 'focus back in tile');
      assert.deepEqual(inputs(), [], 'Esc not sent to PTY');
      await sleep(700); // Sitzung speichern (400 ms Verzögerung)
      assert.equal(sessionTerm('qa-alpha').secondBrainTodoId, 'aaa111');

      stage = 'reload keeps link';
      win.webContents.reload();
      await sleep(500);
      await wait(() => run(`${panes}?.length===2`), 'tiles restored after reload');
      await wait(async () => (await chipText('qa-alpha')).includes('Steuererklärung'), 'chip after reload');
      assert.equal(await chipText('qa-beta'), '+ Aufgabe');

      stage = 'task done in fixture';
      finished = [{ ...open[0], done: true }];
      open = open.slice(1);
      await clickChip('qa-alpha');
      await popBtn('Aktualisieren');
      await wait(async () => (await chipStatus('qa-alpha')) === 'done', 'status done');
      assert.match(await popText(), /erledigt/);
      assert.equal(await run("document.activeElement === document.body || !document.activeElement.closest('.xterm')"), true);

      stage = 'fixture stopped';
      await stopFixture();
      await popBtn('Aktualisieren');
      await wait(async () => (await chipStatus('qa-alpha')) === 'offline', 'status offline');
      const t = await popText();
      assert.match(t, /nicht erreichbar/);
      assert.match(t, /Verknüpfung bleibt gespeichert/);
      assert.match(t, /aaa111/);
      assert.equal(await chipText('qa-alpha').then(x => x.includes('offline')), true);
      assert.ok(await run(`!!${panes}.find(p=>p.id==='qa-alpha')`), 'terminal untouched');
      const shot2 = path.join(root, 'task-link-offline.png');
      await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      fs.writeFileSync(shot2, (await win.webContents.capturePage()).toPNG());

      stage = 'unlink';
      await popBtn('Verknüpfung lösen');
      await wait(async () => (await chipText('qa-alpha')) === '+ Aufgabe', 'unlinked');
      await sleep(700);
      assert.equal('secondBrainTodoId' in sessionTerm('qa-alpha'), false);

      stage = 'fixture saw only GET without Origin; PTY untouched';
      assert.ok(seen.length >= 4);
      for (const q of seen) { assert.equal(q.method, 'GET'); assert.equal(q.origin, undefined); }
      assert.deepEqual(inputs(), [], 'no PTY input at all');
      console.log(JSON.stringify({ result: 'passed', requests: seen.length, checks: ['chip', 'picker only todo/goal', 'search + space filter', 'keys stay in popover', 'link', 'Esc focus', 'reload keeps link', 'done status', 'offline message', 'unlink', 'GET only, no Origin', 'no PTY input'], root, screenshots: [shot1, shot2] }));
    } catch (error) { failed = true; console.error(JSON.stringify({ stage, root, error: error.stack || String(error) })); }
    clearTimeout(timer); app.exit(failed ? 1 : 0);
  });
});

startFixture().then((port) => {
  process.env.MULTITERMINAL_SECOND_BRAIN_URL = 'http://127.0.0.1:' + port;
  require('../src/main/main');
});
