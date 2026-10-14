'use strict';
// F07: real renderer, preload, main and PTY with an isolated data folder and a temporary Git repository.
// Two launches share one QA_ROOT: phase 1 creates the working copies, phase 2 is the restart.
//   QA_PHASE=1 node_modules/.bin/electron scripts/qa-worktree.js            (prints QA_ROOT)
//   QA_PHASE=2 QA_ROOT=<root> node_modules/.bin/electron scripts/qa-worktree.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { app } = require('electron');
const phase = process.env.QA_PHASE === '2' ? 2 : 1;
const root = process.env.QA_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'mt-wt-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data'), repo = path.join(root, 'repo');
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
if (phase === 1) {
  for (const d of [home, data, repo, path.join(data, 'session')]) fs.mkdirSync(d, { recursive: true });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'qa@example.com'); git('config', 'user.name', 'QA');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'eins\n'); git('add', '.'); git('commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'qa-wt', name: 'Arbeitskopie-QA', path: repo }]));
  fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'qa-wt', projects: { 'qa-wt': { terminals: [] } } }));
}
const sh = path.join(root, 'qa-shell');
fs.writeFileSync(sh, '#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
process.env.SHELL = sh;
os.homedir = () => home;
app.setName('Multiterminal Worktree QA ' + process.pid);
app.setPath('userData', data);
const timeout = setTimeout(() => { console.error('Worktree QA timed out'); app.exit(1); }, 90000);
let failed = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 10000) {
  const t = Date.now();
  while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timed out: ' + what); await sleep(60); }
}
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3 && !message.includes('Electron Security Warning')) console.error('Renderer:', message);
  });
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code);
    const panes = () => run('[...window.DeckApp.state.panes.values()].flat().map(p => ({ id: p.id, ws: p.desc.workspaceId || null, status: p.status }))');
    const chips = () => run("[...document.querySelectorAll('.wt-chip')].filter(e => !e.hidden).map(e => e.textContent)");
    const write = (id, text) => run(`window.deck.terminals.write(${JSON.stringify(id)}, ${JSON.stringify(text)})`);
    const pickerNew = async (branch) => {
      await run("document.getElementById('btn-menu').click()");
      await run("[...document.querySelectorAll('#menu .menu-item')].find(e => e.textContent.trim() === 'Terminal in Arbeitskopie…').click()");
      await until(() => run("!!document.querySelector('#modal .wt-list')"), 'picker open');
      await run(`(() => { const i = document.querySelector('#modal input'); i.value = ${JSON.stringify(branch)}; })()`);
      await run("document.querySelector('#modal form').requestSubmit()");
      await until(() => run('document.getElementById("modal").hidden'), 'picker closed');
    };
    try {
      await until(() => run('!!(window.DeckApp.worktreePicker && window.DeckApp.state.activeId)'), 'app ready');
      if (phase === 1) {
        await pickerNew('feature/a');
        await pickerNew('feature/b');
        // an empty project already opened one plain tile on selection; that one is the project-folder tile
        await until(async () => (await panes()).length === 3, 'three tiles');
        const list = await panes();
        const [plain, a, b] = list;
        assert.ok(a.ws && b.ws && a.ws !== b.ws && plain.ws === null, JSON.stringify(list));
        await until(async () => { const x = (await chips()).join('|'); return x.includes('feature/a') && x.includes('feature/b'); }, 'two chips');
        const c = await chips();
        assert.ok(c.some((t) => t.includes('feature/a')) && c.some((t) => t.includes('feature/b')), c.join('|'));
        const wts = JSON.parse(fs.readFileSync(path.join(data, 'worktrees.json'), 'utf8')).worktrees;
        assert.equal(wts.length, 2);
        const dirOf = (ws) => wts.find((w) => w.workspaceId === ws).cwd;
        await write(a.id, 'echo A > marker.txt\r');
        await write(b.id, 'echo B > marker.txt\r');
        await write(plain.id, 'echo P > marker.txt\r');
        await until(() => [dirOf(a.ws), dirOf(b.ws), repo].every((d) => fs.existsSync(path.join(d, 'marker.txt'))), 'markers');
        assert.equal(fs.readFileSync(path.join(dirOf(a.ws), 'marker.txt'), 'utf8').trim(), 'A');
        assert.equal(fs.readFileSync(path.join(dirOf(b.ws), 'marker.txt'), 'utf8').trim(), 'B');
        assert.equal(fs.readFileSync(path.join(repo, 'marker.txt'), 'utf8').trim(), 'P');
        // persist, then the restart check removes b's folder from outside to see the "missing" case
        await run('window.deck.session.save({ version: 1, activeProjectId: "qa-wt", projects: { "qa-wt": { terminals: [...window.DeckApp.state.panes.values()].flat().map(p => ({ ...p.desc })) } } })');
        const saved = JSON.parse(fs.readFileSync(path.join(data, 'session/session.json'), 'utf8')).projects['qa-wt'].terminals;
        assert.equal(saved.filter((t) => t.workspaceId).length, 2);
        assert.equal(saved.length, 3);
        fs.writeFileSync(path.join(root, 'phase1.json'), JSON.stringify({ a: a.ws, b: b.ws, aDir: dirOf(a.ws), bDir: dirOf(b.ws) }));
        await sleep(300);
        fs.writeFileSync(path.join(root, 'phase1.done'), 'ok');
        console.log(JSON.stringify({ result: 'phase1 passed', QA_ROOT: root }));
      } else {
        const p1 = JSON.parse(fs.readFileSync(path.join(root, 'phase1.json'), 'utf8'));
        await until(async () => (await panes()).length === 3, 'restored tiles');
        const list = await panes();
        assert.deepEqual(list.map((t) => t.ws).filter(Boolean).sort(), [p1.a, p1.b].sort());
        await until(async () => { const x = (await chips()).join('|'); return x.includes('feature/a') && x.includes('feature/b'); }, 'chips after restart');
        const c = await chips();
        assert.ok(c.some((t) => t.includes('feature/a') && !t.includes('fehlt')), c.join('|'));
        assert.ok(c.some((t) => t.includes('feature/b') && t.includes('fehlt')), c.join('|'));
        const ta = list.find((t) => t.ws === p1.a), tb = list.find((t) => t.ws === p1.b);
        await until(async () => (await panes()).find((t) => t.id === ta.id).status === 'running', 'a running');
        await write(ta.id, 'echo AFTER > after.txt\r');
        await until(() => fs.existsSync(path.join(p1.aDir, 'after.txt')), 'a after restart');
        assert.notEqual((await panes()).find((t) => t.id === tb.id).status, 'running', 'missing worktree must not start in the project folder');
        assert.equal(fs.existsSync(path.join(repo, 'after.txt')), false);
        console.log(JSON.stringify({ result: 'phase2 passed' }));
      }
    } catch (error) {
      failed = true; console.error(error.stack || String(error));
      try { console.error('state:', JSON.stringify(await panes()), await run("document.querySelector('#modal')?.innerText || ''")); } catch (_) { /* ignore */ }
    }
    try { await run('Promise.all([...window.DeckApp.state.panes.values()].flat().map(p => window.deck.terminals.kill(p.id)))'); } catch (_) { /* ignore */ }
    clearTimeout(timeout);
    win.close();
    setTimeout(() => app.exit(failed ? 1 : 0), 400);
  });
});
console.log(JSON.stringify({ phase, root }));
require('../src/main/main');
