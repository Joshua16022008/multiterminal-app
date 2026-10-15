'use strict';

// Real Electron renderer/preload/IPC/PTY with temporary data and fake CLIs.
// Optional argv[2]: main.js from a packaged app. Never publish or contact providers.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { app, dialog } = require('electron');
const mainFile = path.resolve(process.argv[2] || path.join(__dirname, '../src/main/main.js'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-project-planning-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data');
const bin = path.join(home, '.local/bin'), projectsDir = path.join(home, 'Multiterminal');
const recordsFile = path.join(root, 'agent-records.jsonl'), forbiddenFile = path.join(root, 'forbidden-gh.txt');
for (const dir of [home, data, bin]) fs.mkdirSync(dir, { recursive: true });
const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
const recorder = path.join(root, 'fake-agent.js');
fs.writeFileSync(recorder, `const fs=require('node:fs');
fs.appendFileSync(${JSON.stringify(recordsFile)},JSON.stringify({agent:process.argv[2],args:process.argv.slice(3),cwd:process.cwd(),pid:process.pid})+'\\n');
console.log('LOCAL_FAKE_AGENT_READY '+process.argv[2]);
setTimeout(()=>process.exit(0),60000);
process.stdin.resume();`);
for (const agent of ['claude', 'codex', 'kimi']) {
  fs.writeFileSync(path.join(bin, agent), '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(recorder) + ' ' + quote(agent) + ' "$@"\n', { mode: 0o755 });
}
// toolEnv() puts ~/.local/bin first, so even an accidental gh call is inert.
fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$*" >> ' + quote(forbiddenFile) + '\nexit 97\n', { mode: 0o755 });
const shell = path.join(root, 'qa-shell');
fs.writeFileSync(shell, '#!/bin/sh\nexport PATH=' + quote(bin + ':/usr/bin:/bin:/usr/sbin:/sbin') + '\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
Object.assign(process.env, {
  HOME: home, SHELL: shell, PATH: bin + ':/usr/bin:/bin:/usr/sbin:/sbin',
  XDG_CONFIG_HOME: path.join(home, '.config'), GH_CONFIG_DIR: path.join(home, '.config/gh'),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
  GIT_AUTHOR_NAME: 'Project Planning QA', GIT_AUTHOR_EMAIL: 'qa@example.invalid',
  GIT_COMMITTER_NAME: 'Project Planning QA', GIT_COMMITTER_EMAIL: 'qa@example.invalid',
});
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[commit]\n\tgpgsign = false\n[core]\n\thooksPath = /dev/null\n');
os.homedir = () => home;
app.setName('Project Planning QA ' + process.pid);
app.setPath('userData', data);
fs.writeFileSync(path.join(data, 'projects.json'), '[]');
const confirmations = [];
dialog.showMessageBox = async (_window, options) => { confirmations.push(options); return { response: 2, checkboxChecked: false }; };
dialog.showOpenDialog = async () => { throw new Error('Unexpected native folder picker'); };
const records = () => fs.existsSync(recordsFile) ? fs.readFileSync(recordsFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const git = (folder, ...args) => execFileSync('/usr/bin/git', ['-C', folder, ...args], { encoding: 'utf8', env: process.env }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let stage = 'bootstrap', finished = false;
const timer = setTimeout(() => { console.error(JSON.stringify({ result: 'failed', stage, root, error: 'QA timeout' })); app.exit(1); }, 65000);
app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    const run = code => win.webContents.executeJavaScript(code);
    const wait = async (fn, label) => {
      const until = Date.now() + 10000;
      while (!await fn()) { if (Date.now() > until) throw new Error('Timed out: ' + label); await delay(50); }
    };
    const menu = async text => {
      await run("document.getElementById('add-project').click()");
      await run(`(() => {const item=[...document.querySelectorAll('#menu .menu-item')].find(e=>e.textContent===${JSON.stringify(text)});if(!item)throw new Error('Missing menu item');item.click()})()`);
    };
    const open = async () => {
      await menu('Neues Projekt planen…');
      await wait(() => run("!document.getElementById('modal').hidden && document.querySelector('#modal h2')?.textContent==='Neues Projekt planen'"), 'planning form');
    };
    const fill = (name, agent) => run(`(() => {document.querySelector('#modal input').value=${JSON.stringify(name)};document.querySelector('#modal select').value=${JSON.stringify(agent)}})()`);
    const submit = () => run("document.querySelector('#modal button[type=submit]').click()");
    const cancel = () => run("[...document.querySelectorAll('#modal button')].find(b=>b.textContent==='Abbrechen').click()");
    let failed = false, screenshot;
    try {
      await wait(() => run("window.DeckApp?.state.presets.length>=3"), 'app initialized');
      assert.equal(await run('window.DeckApp.state.projects.length'), 0);
      stage = 'form and cancellation';
      await open();
      assert.deepEqual(await run("[...document.querySelector('#modal select').options].map(o=>o.value)"), ['claude', 'codex', 'kimi']);
      await fill('QA Projektplanung', 'codex');
      win.showInactive(); win.moveTop();
      await run('Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),new Promise(r=>setTimeout(r,1000))])');
      screenshot = path.join(root, 'project-planning-dialog.png');
      fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      await cancel();
      assert.equal(await run("document.getElementById('modal').hidden"), true);
      assert.equal(await run('window.DeckApp.state.projects.length'), 0);
      assert.equal(fs.existsSync(projectsDir), false);
      assert.deepEqual(records(), []);

      stage = 'invalid name';
      await open(); await fill('../outside', 'codex'); await submit();
      await wait(() => run("document.querySelector('#notices')?.textContent.includes('Ungültiger Projektname')"), 'visible validation error');
      assert.equal(await run("document.getElementById('modal').hidden"), false);
      assert.equal(await run('window.DeckApp.state.projects.length'), 0);
      assert.equal(fs.existsSync(projectsDir), false);
      await cancel();

      // Each built-in selection must open precisely that fake agent in its own cwd.
      for (const agent of ['codex', 'claude', 'kimi']) {
        stage = 'create ' + agent;
        const name = 'QA Planung ' + agent, slug = name.replace(/ /g, '-');
        const folder = path.join(projectsDir, slug);
        await open(); await fill(name, agent); await submit();
        await wait(() => fs.existsSync(folder) && records().some(r => r.agent === agent && r.cwd === fs.realpathSync(folder)), 'fake agent running in project ' + agent);
        assert.equal(git(folder, 'branch', '--show-current'), 'main');
        assert.equal(git(folder, 'rev-list', '--count', 'HEAD'), '1');
        assert.deepEqual(git(folder, 'ls-tree', '--name-only', 'HEAD').split('\n').sort(), ['AGENTS.md', 'CLAUDE.md', 'PLAN.md']);
        assert.equal(git(folder, 'status', '--porcelain'), '');
        assert.equal(git(folder, 'remote'), '');
        assert.equal(fs.readFileSync(path.join(folder, 'AGENTS.md'), 'utf8'), fs.readFileSync(path.join(folder, 'CLAUDE.md'), 'utf8'));
        assert.match(fs.readFileSync(path.join(folder, 'AGENTS.md'), 'utf8'), /Planungsphase/);
        assert.match(fs.readFileSync(path.join(folder, 'PLAN.md'), 'utf8'), /Status: Planung/);
        const record = records().find(r => r.agent === agent);
        assert.deepEqual(record.args, ['Starte die Projektplanung wie in CLAUDE.md beschrieben.']);
        const active = await run(`(() => {const s=window.DeckApp.state,p=s.projects.find(p=>p.id===s.activeId),panes=s.panes.get(s.activeId);return {project:p,panes:panes.map(x=>({id:x.id,preset:x.desc.presetId,running:x.status==='running',active:x.el.classList.contains('active'),visible:x.el.getBoundingClientRect().height>0})),activePane:s.activeByProject[s.activeId]}})()`);
        assert.equal(active.project.path, folder);
        assert.equal(active.project.name, slug);
        assert.equal(active.panes.length, 1);
        assert.equal(active.panes[0].preset, agent);
        assert.equal(active.panes[0].running, true);
        assert.equal(active.panes[0].active, true);
        assert.equal(active.panes[0].visible, true);
        assert.equal(active.activePane, active.panes[0].id);
      }
      stage = 'duplicate name';
      const folder = path.join(projectsDir, 'QA-Planung-codex');
      const beforeHead = git(folder, 'rev-parse', 'HEAD');
      const sentinel = path.join(folder, 'user-note.txt');
      fs.writeFileSync(sentinel, 'must survive duplicate creation');
      const beforeFiles = Object.fromEntries(['AGENTS.md', 'CLAUDE.md', 'PLAN.md', 'user-note.txt'].map(f => [f, fs.readFileSync(path.join(folder, f), 'utf8')]));
      await run("document.getElementById('notices').replaceChildren()");
      await open(); await fill('QA Planung codex', 'claude'); await submit();
      await wait(() => run("document.getElementById('notices').textContent.includes('existiert bereits')"), 'duplicate visible error');
      assert.equal(await run('window.DeckApp.state.projects.length'), 3);
      assert.equal(records().length, 3);
      assert.equal(git(folder, 'rev-parse', 'HEAD'), beforeHead);
      for (const [file, content] of Object.entries(beforeFiles)) assert.equal(fs.readFileSync(path.join(folder, file), 'utf8'), content);
      await cancel();

      stage = 'GitHub cancel';
      await menu('Aktives Projekt auf GitHub anlegen…');
      await wait(() => confirmations.length === 1, 'main-process confirmation');
      await delay(150);
      const confirmation = confirmations[0];
      assert.deepEqual(confirmation.buttons, ['Privat anlegen', 'Öffentlich anlegen', 'Abbrechen']);
      assert.equal(confirmation.defaultId, 0);
      assert.equal(confirmation.cancelId, 2);
      assert.match(confirmation.message, /QA-Planung-kimi/);
      assert.match(confirmation.detail, /hochgeladen/);
      assert.equal(fs.existsSync(forbiddenFile), false, 'no gh invocation, including after cancel');
      assert.equal(git(path.join(projectsDir, 'QA-Planung-kimi'), 'remote'), '');
      console.log(JSON.stringify({ result: 'passed', productMain: mainFile, root, screenshot,
        checks: ['menu and agent selector', 'cancel without project or PTY', 'invalid name remains editable', 'three built-in agents through real PTYs with exact opening argument and cwd', 'Git main and one initial commit', 'three committed planning files', 'correct active visible tile', 'duplicate rejects without overwrite', 'GitHub main-process confirmation cancels without gh'],
        limits: 'Synthetic UI clicks; native GitHub dialog stubbed to cancel. Fake agents only; no provider or publish acceptance.' }));
    } catch (error) {
      failed = true;
      console.error(JSON.stringify({ result: 'failed', stage, root, screenshot, error: error.stack || String(error) }));
    }
    try { await run('Promise.all([...window.DeckApp.state.panes.values()].flat().map(p=>window.deck.terminals.kill(p.id)))'); } catch {}
    finished = true; clearTimeout(timer); app.exit(failed ? 1 : 0);
  });
});
app.on('window-all-closed', () => { if (!finished) { clearTimeout(timer); app.exit(1); } });
require(mainFile);
