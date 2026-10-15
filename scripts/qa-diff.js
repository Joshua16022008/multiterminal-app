'use strict';

// F04: real Electron renderer/preload/main/PTY. Project = temporary Git repository with
// staged, unstaged, untracked and binary changes; terminals record their raw input.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-diff-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data'), project = path.join(root, 'repo'), plain = path.join(root, 'plain');
for (const folder of [home, data, project, plain, path.join(data, 'session')]) fs.mkdirSync(folder, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: project, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).toString();
git('init', '-q', '-b', 'main'); git('config', 'user.email', 'qa@example.invalid'); git('config', 'user.name', 'QA');
fs.writeFileSync(path.join(project, 'a b.txt'), 'eins\nzwei\ndrei\n');
fs.writeFileSync(path.join(project, 'staged.js'), 'const x = 1;\n');
git('add', '-A'); git('commit', '-qm', 'start');
fs.writeFileSync(path.join(project, 'a b.txt'), 'eins\nZWEI\ndrei\nvier\n');
fs.writeFileSync(path.join(project, 'staged.js'), 'const x = 2;\n'); git('add', 'staged.js');
fs.writeFileSync(path.join(project, 'neu.md'), '# neu\n');
fs.writeFileSync(path.join(project, 'bild.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]));
const statusBefore = git('status', '--porcelain=v1', '-z', '--untracked-files=all');
const fileBytes = () => ['a b.txt', 'staged.js', 'neu.md', 'bild.png'].map((f) => fs.readFileSync(path.join(project, f)).toString('base64')).join('|');
const bytesBefore = fileBytes();

const shellFile = path.join(root, 'test-shell'), recorder = path.join(root, 'record-input.js'), records = path.join(root, 'input.jsonl');
fs.writeFileSync(recorder, `const fs=require('node:fs'); const file=${JSON.stringify(records)}; if(process.stdin.isTTY)process.stdin.setRawMode(true); process.stdout.write('LOCAL_TEST_TERMINAL\\r\\n\\x1b[?2004h'); process.stdin.on('data',b=>fs.appendFileSync(file,JSON.stringify({pid:process.pid,text:b.toString()})+'\\n'));`);
const quote = (value) => "'" + value.replace(/'/g, "'\"'\"'") + "'";
fs.writeFileSync(shellFile, '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(recorder) + '\n', { mode: 0o755 });
process.env.SHELL = shellFile;
os.homedir = () => home;
app.setName('Multiterminal Diff QA ' + process.pid); app.setPath('userData', data);
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'qa-repo', name: 'Diff-Test', path: project }, { id: 'qa-plain', name: 'Ohne Git', path: plain }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'qa-repo', projects: {
  'qa-repo': { terminals: [{ id: 'qa-alpha', title: 'Alpha' }, { id: 'qa-beta', title: 'Beta' }] },
  'qa-plain': { terminals: [{ id: 'qa-plain-1', title: 'Plain' }] },
} }));
let failed = false, stage = 'bootstrap';
const timer = setTimeout(() => { console.error(JSON.stringify({ error: 'Diff QA timed out', stage, root })); app.exit(1); }, 90000);
const inputs = () => (fs.existsSync(records) ? fs.readFileSync(records, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3 && !message.includes('Electron Security Warning')) console.error('Renderer:', message); });
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code);
    const wait = async (predicate, label) => {
      const start = Date.now();
      while (!await predicate()) { if (Date.now() - start > 8000) throw new Error('Timed out: ' + label); await sleep(30); }
    };
    const panes = (pid) => `window.DeckApp.state.panes.get(${JSON.stringify(pid)})`;
    const texts = (sel) => run(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e=>e.textContent)`);
    const clickFileIn = (group, label) => run(`(() => { const h=[...document.querySelectorAll('.diff-group')].find(h=>h.textContent.startsWith(${JSON.stringify(group)})); if(!h) throw new Error('group missing: ${group}'); const li=[...h.nextElementSibling.querySelectorAll('.diff-file')].find(l=>l.querySelector('.diff-path').textContent===${JSON.stringify(label)}); if(!li) throw new Error('file missing: ${label}'); li.click(); })()`);
    const button = (text) => run(`(() => { const b=[...document.querySelectorAll('#diff-panel button')].find(b=>b.textContent===${JSON.stringify(text)}); if(!b) throw new Error('button missing'); return b.disabled; })()`);
    try {
      await wait(() => run(`${panes('qa-repo')}?.length===2 && ${panes('qa-repo')}.every(p=>p.status==='running'&&p.plainText().includes('LOCAL_TEST_TERMINAL'))`), 'real PTYs');

      stage = 'open panel and list';
      assert.equal(await run("document.getElementById('diff-panel').hidden"), true);
      await run("document.getElementById('btn-diff').click()");
      await wait(() => run("document.querySelectorAll('.diff-file').length>=4"), 'file list');
      const groups = await texts('.diff-group');
      assert.deepEqual(groups.map((g) => g.split(' · ')[0]), ['Gestaged (Index gegen HEAD)', 'Nicht gestaged (Arbeitsbaum gegen Index)', 'Neu, nicht verfolgt']);
      assert.deepEqual((await texts('.diff-path')).sort(), ['a b.txt', 'bild.png', 'neu.md', 'staged.js']);
      assert.match(await run("document.querySelector('.diff-scope').textContent"), /Diff-Test · Projektordner · Branch main/);
      assert.equal(await run("document.getElementById('btn-diff').getAttribute('aria-expanded')"), 'true');

      stage = 'binary and untracked';
      await clickFileIn('Neu', 'bild.png');
      await wait(() => run("document.querySelector('.diff-view .diff-note')?.textContent.includes('Binärdatei')"), 'binary note');
      await clickFileIn('Neu', 'neu.md');
      await wait(() => run("document.querySelectorAll('.diff-line').length===1"), 'untracked content');
      assert.match(await run("document.querySelector('.diff-compare').textContent"), /Neue, noch nicht verfolgte Datei/);

      stage = 'select lines and comment';
      await clickFileIn('Nicht gestaged', 'a b.txt');
      await wait(() => run("document.querySelector('.diff-compare')?.textContent==='Arbeitsbaum gegen Index' && document.querySelectorAll('.diff-line').length>0"), 'unstaged diff');
      const rows = await run("[...document.querySelectorAll('.diff-line')].map(r=>r.className.split(' ')[1]+':'+r.querySelector('.diff-text').textContent)");
      assert.deepEqual(rows, ['diff-ctx: eins', 'diff-del:-zwei', 'diff-add:+ZWEI', 'diff-ctx: drei', 'diff-add:+vier']);
      assert.equal(await button('In Promptvorschau'), true, 'disabled without selection');
      await run("document.querySelector('.diff-line[data-index=\"1\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
      await run("document.querySelector('.diff-line[data-index=\"2\"]').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))");
      assert.equal(await run("document.querySelectorAll('.diff-line.picked').length"), 2);
      await run("(() => { const t=document.querySelector('.diff-comment'); t.value='Bitte Großschreibung begründen'; t.dispatchEvent(new Event('input',{bubbles:true})); })()");
      assert.deepEqual(await run("[...document.querySelectorAll('.diff-target option')].map(o=>o.value)"), ['qa-alpha', 'qa-beta']);
      await run("(() => { const s=document.querySelector('.diff-target'); s.value='qa-beta'; s.dispatchEvent(new Event('change',{bubbles:true})); })()");
      assert.deepEqual(inputs(), []);

      stage = 'preview, nothing sent before insert';
      await run("[...document.querySelectorAll('#diff-panel button')].find(b=>b.textContent==='In Promptvorschau').click()");
      await wait(() => run("document.getElementById('prompt-draft-dialog')?.open"), 'prompt preview');
      assert.equal(await run('window.DeckApp.promptDraft.get().terminalId'), 'qa-beta');
      const preview = await run("document.querySelector('.prompt-draft-preview').textContent");
      for (const part of ['Rückmeldung zu a b.txt', 'Zeilen 2 (Arbeitsbaum', 'Arbeitsbaum gegen Index', 'Bitte Großschreibung begründen', '- zwei ⏎ + ZWEI']) assert.ok(preview.includes(part), 'preview misses ' + part + ': ' + preview);
      assert.deepEqual(inputs(), [], 'nothing reaches a terminal before the user inserts');
      await run("document.getElementById('prompt-draft-insert').click()");
      await wait(() => inputs().length > 0, 'raw input');
      const bytes = inputs().map((i) => i.text).join('');
      assert.equal(bytes, '\x1b[200~' + preview + '\x1b[201~');
      assert.doesNotMatch(bytes, /[\r\n]/, 'no Enter');
      assert.equal(new Set(inputs().map((i) => i.pid)).size, 1, 'only one shell received it');

      stage = 'repo untouched, refresh, other project';
      assert.equal(git('status', '--porcelain=v1', '-z', '--untracked-files=all'), statusBefore, 'index/worktree unchanged');
      assert.equal(fileBytes(), bytesBefore, 'files unchanged');
      fs.writeFileSync(path.join(project, 'spaet.txt'), 'neu\n');
      await run("[...document.querySelectorAll('#diff-panel button')].find(b=>b.textContent==='⟳').click()");
      await wait(async () => (await texts('.diff-path')).includes('spaet.txt'), 'refresh shows new file');
      fs.unlinkSync(path.join(project, 'spaet.txt'));
      await run("[...document.querySelectorAll('#projects li.proj, li.proj')].find(e=>e.textContent.includes('Ohne Git'))?.click()");
      await wait(() => run("window.DeckApp.state.activeId==='qa-plain'"), 'other project active');
      await wait(() => run("document.querySelector('#diff-panel .diff-error')?.textContent.includes('kein Git-Repository')"), 'not a repo message');

      stage = 'exclusive panels and screenshot';
      await run("document.getElementById('btn-ports').click()");
      await wait(() => run("document.getElementById('diff-panel').hidden"), 'ports closes diff');
      await run("[...document.querySelectorAll('#projects li.proj, li.proj')].find(e=>e.textContent.includes('Diff-Test'))?.click()");
      await wait(() => run("window.DeckApp.state.activeId==='qa-repo'"), 'back to repo');
      await run("document.getElementById('btn-diff').click()");
      await wait(() => run("document.getElementById('ports-panel').hidden && !document.getElementById('diff-panel').hidden"), 'diff closes ports');
      await wait(() => run("document.querySelectorAll('.diff-file').length>=4"), 'list again');
      await clickFileIn('Gestaged', 'staged.js');
      await wait(() => run("document.querySelectorAll('.diff-line').length===2"), 'staged diff');
      await run("document.querySelector('.diff-line[data-index=\"1\"]').click()");
      await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const screenshot = path.join(root, 'diff.png');
      fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({ result: 'passed', checks: ['real renderer/preload/IPC/PTY + temp Git repo', 'groups staged/unstaged/untracked', 'file name with space', 'binary note', 'untracked content', 'line selection with shift', 'preview with target, range, comparison, comment', 'nothing sent before insert, no Enter, one shell', 'repo bytes and index unchanged', 'refresh', 'non-repo project message', 'exclusive with ports', 'screenshot'], root, screenshot }));
    } catch (error) { failed = true; console.error(JSON.stringify({ stage, root, error: error.stack || String(error) })); }
    clearTimeout(timer); app.exit(failed ? 1 : 0);
  });
});
require('../src/main/main');
