'use strict';
// Stammbaum (Etappe 3a): real renderer, preload, main and PTY with isolated data, a temporary
// repository and every kind of working copy: project folder, three app worktrees (one with an
// extra commit plus a change, one dirty, one clean), an external Codex worktree, a merged
// branch in a foreign folder and a prunable entry.
//   node_modules/.bin/electron scripts/qa-worktree-tree.js [path/to/main.js]
// Prints QA_ROOT; screenshots land there (tree-overview.png, tree-focus.png).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { app } = require('electron');

// Real path: the memory service refuses data folders behind a symlink (/var -> /private/var).
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mt-tree-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data'), repo = path.join(root, 'repo');
for (const d of [home, data, repo, path.join(data, 'session')]) fs.mkdirSync(d, { recursive: true });
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.email', 'qa@example.com'); git(repo, 'config', 'user.name', 'QA');
fs.writeFileSync(path.join(repo, 'a.txt'), 'eins\n'); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'erster Commit');
const first = git(repo, 'rev-parse', 'HEAD');
fs.writeFileSync(path.join(repo, 'b.txt'), 'zwei\n'); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'zweiter Commit');
// External worktree of Codex, a merged branch in a foreign folder, a prunable entry.
const codexDir = path.join(home, '.codex', 'worktrees', '1580', 'repo');
fs.mkdirSync(path.dirname(codexDir), { recursive: true });
git(repo, 'worktree', 'add', '-q', '-b', 'codex/extern', codexDir);
const mergedDir = path.join(root, 'other', 'merged');
git(repo, 'worktree', 'add', '-q', '-b', 'feature/merged', mergedDir, first);
const goneDir = path.join(root, 'gone');
git(repo, 'worktree', 'add', '-q', '-b', 'feature/gone', goneDir);
fs.rmSync(goneDir, { recursive: true, force: true });

fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'qa-tree', name: 'Stammbaum-QA', path: repo }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'qa-tree', projects: { 'qa-tree': { terminals: [] } } }));
const sh = path.join(root, 'qa-shell');
fs.writeFileSync(sh, '#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
process.env.SHELL = sh;
os.homedir = () => home;
app.setName('Multiterminal Stammbaum QA ' + process.pid);
app.setPath('userData', data);
const timeout = setTimeout(() => { console.error('Stammbaum QA timed out', root); app.exit(1); }, 120000);
let failed = false;
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 15000) {
  const t = Date.now();
  while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timed out: ' + what); await sleep(80); }
}
const records = () => JSON.parse(fs.readFileSync(path.join(data, 'worktrees.json'), 'utf8')).worktrees;

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3 && !message.includes('Electron Security Warning')) { errors.push(message); console.error('Renderer:', message); }
  });
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code);
    const panes = () => run('[...window.DeckApp.state.panes.values()].flat().map(p => ({ id: p.id, ws: p.desc.workspaceId || null, status: p.status }))');
    const write = (id, text) => run(`window.deck.terminals.write(${JSON.stringify(id)}, ${JSON.stringify(text)})`);
    const viewOpen = () => run("!document.getElementById('worktree-view').hidden");
    const cards = () => run(`[...document.querySelectorAll('#worktree-view .wtv-card')].map(c => ({
      id: c.dataset.nodeId, cls: c.className, branch: c.querySelector('.wtv-branch').textContent,
      text: c.innerText, buttons: [...c.querySelectorAll('.wtv-actions button')].map(b => ({ text: b.textContent, disabled: b.disabled, title: b.title })),
      panes: [...c.querySelectorAll('.wtv-pane')].map(b => b.textContent) }))`);
    const card = async (branch) => (await cards()).find((c) => c.branch === '⑂ ' + branch);
    const clickCardButton = (branch, label) => run(`(() => {
      const c = [...document.querySelectorAll('#worktree-view .wtv-card')].find(x => x.querySelector('.wtv-branch').textContent === ${JSON.stringify('⑂ ' + branch)});
      [...c.querySelectorAll('.wtv-actions button')].find(b => b.textContent === ${JSON.stringify(label)}).click(); })()`);
    const shot = async (name) => fs.writeFileSync(path.join(root, name), (await win.webContents.capturePage()).toPNG());
    try {
      await until(() => run('!!(window.DeckApp.worktreeTree && window.DeckApp.state.activeId === "qa-tree")'), 'app ready');
      await until(async () => (await panes()).length === 1 && (await panes())[0].status === 'running', 'plain tile');
      const plain = (await panes())[0];

      // Three app worktrees through the real IPC; then +1 commit and a change in feature/a, a change in feature/dirty.
      const created = {};
      for (const branch of ['feature/a', 'feature/dirty', 'feature/clean']) {
        const r = await run(`window.deck.worktrees.create('qa-tree', { branch: ${JSON.stringify(branch)} })`);
        assert.equal(r.ok, true, r.error);
        created[branch] = r.worktree;
      }
      const aDir = created['feature/a'].cwd;
      fs.writeFileSync(path.join(aDir, 'c.txt'), 'drei\n'); git(aDir, 'add', '.'); git(aDir, '-c', 'user.email=qa@example.com', '-c', 'user.name=QA', 'commit', '-q', '-m', 'Feature A');
      fs.appendFileSync(path.join(aDir, 'a.txt'), 'geändert\n');
      fs.appendFileSync(path.join(created['feature/dirty'].cwd, 'a.txt'), 'schmutzig\n');

      // Topbar button: only for git projects, counts all working copies incl. the project folder.
      await run('window.DeckApp.refreshTreeButton()');
      await until(() => run("!document.getElementById('btn-tree').hidden && document.getElementById('btn-tree').textContent === '⑂ 7'"), 'topbar ⑂ 7');
      const order = await run("(() => { const t = document.getElementById('ws-title').getBoundingClientRect(), c = document.getElementById('counter').getBoundingClientRect(), b = document.getElementById('btn-tree').getBoundingClientRect(); return t.right <= c.left + 1 && c.right <= b.left + 1; })()");
      assert.equal(order, true, 'button right of title and counter');
      // Branch chip of the project-folder tile.
      await until(() => run(`(() => { const c = [...document.querySelectorAll('.wt-chip')].find(e => !e.hidden); return !!c && c.textContent.includes('main') && c.classList.contains('trunk'); })()`), 'trunk chip ⑂ main');
      console.log('PASS topbar ⑂ 7 next to the title, ⑂ main chip on the project-folder tile');

      // Overview: 7 branches with their kinds and figures.
      await run("document.getElementById('btn-tree').click()");
      await until(viewOpen, 'view open');
      await until(async () => (await cards()).length === 7, 'seven cards');
      const all = await cards();
      const kinds = Object.fromEntries(all.map((c) => [c.branch, c.cls]));
      assert.match(kinds['⑂ main'], /kind-project/);
      for (const b of ['feature/a', 'feature/dirty', 'feature/clean']) assert.match(kinds['⑂ ' + b], /kind-managed/, b);
      const ext = await card('codex/extern');
      assert.match(ext.cls, /kind-external/); assert.ok(ext.text.includes('extern (Codex)'), ext.text);
      assert.equal(ext.buttons[0].text, 'Übernehmen…');
      const merged = await card('feature/merged');
      assert.ok(merged.text.includes('gemergt'), merged.text);
      assert.ok(!(await card('feature/a')).text.includes('gemergt'), 'fresh branch is not merged');
      const gone = await card('feature/gone');
      assert.match(gone.cls, /orphan/); assert.ok(gone.text.includes('verwaist')); assert.equal(gone.buttons.length, 0, 'no action on a prunable entry');
      const a = await card('feature/a');
      assert.ok(a.text.includes('↑1') && a.text.includes('1 Änderung'), a.text);
      assert.deepEqual((await card('main')).panes.length, 1, 'plain tile hangs at the project node');
      assert.equal(await run("document.getElementById('btn-tree').getAttribute('aria-expanded')"), 'true');
      assert.equal(await run("document.getElementById('grids').inert"), true);
      await shot('tree-overview.png');
      console.log('PASS view: project, 3 managed, external Codex, merged, orphan; ↑1 / 1 Änderung on feature/a');

      // Jump to a tile from its branch.
      await run(`[...document.querySelectorAll('#worktree-view .wtv-card')].find(x => x.querySelector('.wtv-branch').textContent === '⑂ main').querySelector('.wtv-pane').click()`);
      await until(async () => !(await viewOpen()), 'view closes on jump');
      assert.equal(await run('window.DeckApp.state.activeByProject["qa-tree"]'), plain.id);
      assert.equal(await run("document.getElementById('grids').inert"), false);
      console.log('PASS tile row jumps to the tile and closes the view');

      // "Terminal hier öffnen" on feature/a: a tile in that working copy, chip in the branch colour.
      await run("document.getElementById('btn-tree').click()");
      await until(async () => (await cards()).length === 7, 'reopen');
      await clickCardButton('feature/a', 'Terminal hier öffnen');
      await until(async () => (await panes()).some((p) => p.ws === created['feature/a'].workspaceId && p.status === 'running'), 'tile in feature/a');
      const aPane = (await panes()).find((p) => p.ws === created['feature/a'].workspaceId);
      await write(aPane.id, 'echo A > marker.txt\r');
      await until(() => fs.existsSync(path.join(aDir, 'marker.txt')), 'marker in feature/a');
      await until(() => run(`(() => { const el = [...window.DeckApp.state.panes.get('qa-tree')].find(p => p.id === ${JSON.stringify(aPane.id)}).el.querySelector('.wt-chip'); return !el.hidden && el.textContent.includes('feature/a') && !el.querySelector('.wt-dot').hidden; })()`), 'feature/a chip with dot');
      // Chip click opens the view focused on that branch.
      await run(`[...window.DeckApp.state.panes.get('qa-tree')].find(p => p.id === ${JSON.stringify(aPane.id)}).el.querySelector('.wt-chip').click()`);
      await until(viewOpen, 'chip opens view');
      await until(async () => /\bfocus\b/.test(((await card('feature/a')) || {}).cls || ''), 'feature/a focused');
      assert.ok((await card('feature/a')).panes.length === 1, 'new tile listed at its branch');
      await shot('tree-focus.png');
      console.log('PASS terminal in feature/a (marker), coloured chip with change dot, chip click focuses the branch');

      // Adopting the Codex worktree asks first; "no" changes nothing, "yes" links it and opens a tile there.
      await run('window.__asked = []; window.confirm = (m) => { window.__asked.push(m); return false; }; 0');
      const before = records().length;
      await clickCardButton('codex/extern', 'Übernehmen…');
      await until(() => run('window.__asked.length === 1'), 'warning shown');
      assert.match(await run('window.__asked[0]'), /anderen Werkzeug \(Codex\).*stören[\s\S]*Trotzdem verknüpfen/);
      await sleep(300);
      assert.equal(records().length, before, 'declined: no record');
      assert.equal(await viewOpen(), true, 'declined: view stays');
      await run('window.confirm = (m) => { window.__asked.push(m); return true; }; 0');
      await clickCardButton('codex/extern', 'Übernehmen…');
      await until(() => records().some((r) => r.managed === false && fs.realpathSync(r.cwd) === fs.realpathSync(codexDir)), 'linked record');
      const linked = records().find((r) => r.managed === false);
      await until(async () => (await panes()).some((p) => p.ws === linked.workspaceId && p.status === 'running'), 'tile in codex worktree');
      const cPane = (await panes()).find((p) => p.ws === linked.workspaceId);
      await write(cPane.id, 'echo C > marker.txt\r');
      await until(() => fs.existsSync(path.join(codexDir, 'marker.txt')), 'marker in codex worktree');
      console.log('PASS adopt: warning, decline keeps nothing, accept links managed:false and starts there');

      // Removal: dirty refused (button and IPC), clean removed, its branch stays.
      await run("document.getElementById('btn-tree').click()");
      await until(async () => (await cards()).length === 7 && /kind-linked/.test((await card('codex/extern')).cls), 'reopen for removal (fresh data)');
      assert.match((await card('codex/extern')).cls, /kind-linked/);
      const dirtyBtn = (await card('feature/dirty')).buttons.find((b) => b.text === 'Entfernen');
      assert.equal(dirtyBtn.disabled, true); assert.match(dirtyBtn.title, /ungesicherte/);
      const refused = await run(`window.deck.worktrees.remove(${JSON.stringify(created['feature/dirty'].workspaceId)})`);
      assert.equal(refused.ok, false); assert.equal(refused.dirty, true);
      assert.ok(fs.existsSync(created['feature/dirty'].cwd));
      assert.equal((await card('feature/a')).buttons.find((b) => b.text === 'Entfernen').disabled, true, 'a tile uses feature/a');
      assert.ok(!(await card('codex/extern')).buttons.some((b) => b.text === 'Entfernen'), 'no removal for linked folders');
      assert.equal((await card('feature/clean')).buttons.find((b) => b.text === 'Entfernen').disabled, false);
      await clickCardButton('feature/clean', 'Entfernen');
      await until(() => !records().some((r) => r.workspaceId === created['feature/clean'].workspaceId), 'clean record gone');
      await until(() => !fs.existsSync(created['feature/clean'].cwd), 'clean folder gone');
      assert.equal(git(repo, 'branch', '--list', 'feature/clean'), 'feature/clean', 'branch kept');
      await until(async () => (await cards()).length === 6, 'view reloaded');
      await until(() => run("document.getElementById('btn-tree').textContent === '⑂ 6'") , 'count follows', 5000).catch(() => {});
      console.log('PASS removal: dirty refused (UI and IPC), clean removed, branch kept, no removal for linked');

      // Esc closes; the hotkey action toggles.
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await until(async () => !(await viewOpen()), 'Escape closes');
      await run("window.DeckApp.commandPalette.open()");
      const hit = await run("(() => { const i = document.querySelector('.palette-input'); i.value = 'Stammbaum'; i.dispatchEvent(new Event('input')); return document.querySelector('.palette-item .palette-title').textContent; })()");
      assert.equal(hit, 'Stammbaum / Arbeitskopien');
      await run("document.querySelector('.palette-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))");
      await until(viewOpen, 'palette opens the view');
      await run("document.querySelector('#worktree-view .wtv-head button').click()");
      await until(async () => !(await viewOpen()), 'back button closes');
      console.log('PASS Escape, palette entry and back button');
      assert.deepEqual(errors, [], 'no renderer errors');
      console.log(JSON.stringify({ result: 'passed', QA_ROOT: root, screenshots: ['tree-overview.png', 'tree-focus.png'] }));
    } catch (error) {
      failed = true; console.error(error.stack || String(error));
      try { console.error('cards:', JSON.stringify(await cards())); await shot('tree-failure.png'); } catch (_) { /* ignore */ }
    }
    try { await run('Promise.all([...window.DeckApp.state.panes.values()].flat().map(p => window.deck.terminals.kill(p.id)))'); } catch (_) { /* ignore */ }
    clearTimeout(timeout);
    // app.exit directly: closing the window would quit with code 0 and hide a failure.
    setTimeout(() => app.exit(failed ? 1 : 0), 400);
  });
});
console.log(JSON.stringify({ root }));
require(process.argv[2] || '../src/main/main');
