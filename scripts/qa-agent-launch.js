'use strict';

// Real Electron/IPC/PTY, temporary repositories and inert CLI recorders only.
// Optional argv[2]: main.js from a packaged app.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-agent-launch-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data'), repo = path.join(root, 'project');
const bin = path.join(home, '.local/bin'), recordsFile = path.join(root, 'records.jsonl');
const quote = text => "'" + text.replace(/'/g, "'\\''") + "'";
for (const dir of [home, data, repo, bin, path.join(data, 'session')]) fs.mkdirSync(dir, { recursive: true });
const git = (...args) => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' }).trim();
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'Local QA'); git('config', 'user.email', 'qa@example.invalid');
fs.writeFileSync(path.join(repo, 'README.md'), '# QA project\nCONTEXT_FROM_COMMITTED_PROJECT\n');
fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'Only change the assigned task.\n');
fs.writeFileSync(path.join(repo, 'WORK_IN_PROGRESS.md'), '# Coordination\nLEDGER_AT_COMMIT\n');
git('add', '.'); git('commit', '-qm', 'fixture');
fs.writeFileSync(path.join(repo, 'WORK_IN_PROGRESS.md'), '# Coordination\nFRESH_CENTRAL_LEDGER\n');
fs.writeFileSync(path.join(repo, 'unsaved.txt'), 'Must not enter worktree\n');
const project = { id: 'qa-launch', name: 'Kontextstart QA', path: repo };
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([project]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: project.id, projects: { [project.id]: { terminals: [] } } }));
const recorder = path.join(root, 'recorder.js');
fs.writeFileSync(recorder, `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(recordsFile)},JSON.stringify({provider:process.argv[2],args:process.argv.slice(3),cwd:process.cwd()})+'\\n');console.log('LOCAL_FAKE_AGENT_READY');process.stdin.resume();setInterval(()=>{},10000);`);
for (const provider of ['claude', 'codex', 'kimi']) {
  fs.writeFileSync(path.join(bin, provider), '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(recorder) + ' ' + quote(provider) + ' "$@"\n', { mode: 0o755 });
}
const shell = path.join(root, 'qa-shell');
fs.writeFileSync(shell, '#!/bin/sh\nexport PATH=' + quote(bin + ':/usr/bin:/bin:/usr/sbin:/sbin') + '\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
process.env.SHELL = shell;
os.homedir = () => home;
app.setName('Multiterminal Context Start QA ' + process.pid);
app.setPath('userData', data);
const records = () => fs.existsSync(recordsFile) ? fs.readFileSync(recordsFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const worktrees = () => fs.existsSync(path.join(data, 'worktrees.json')) ? JSON.parse(fs.readFileSync(path.join(data, 'worktrees.json'), 'utf8')).worktrees : [];
const contexts = () => fs.existsSync(path.join(data, 'launch-contexts')) ? fs.readdirSync(path.join(data, 'launch-contexts')).filter(f => f.endsWith('.md')) : [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let stage = 'bootstrap';
const timer = setTimeout(() => { console.error(JSON.stringify({ result: 'failed', stage, root, error: 'QA timeout' })); app.exit(1); }, 90000);
app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) console.error('Renderer:', message); });
  win.webContents.once('did-finish-load', async () => {
    const run = code => win.webContents.executeJavaScript(code);
    const wait = async (fn, label) => {
      const until = Date.now() + 12000;
      while (!await fn()) { if (Date.now() > until) throw new Error('Timeout: ' + label); await sleep(60); }
    };
    const menu = async text => {
      await run("if(!document.getElementById('toolbar-options').getClientRects().length)document.getElementById('btn-toolbar').click();document.getElementById('btn-menu').click()");
      await run(`(()=>{const row=[...document.querySelectorAll('#menu .menu-item')].find(e=>(e.querySelector('.grow')?.textContent.trim()||e.textContent.trim())===${JSON.stringify(text)});if(!row)throw Error('Menu missing: '+${JSON.stringify(text)});row.click()})()`);
    };
    const set = (id, value) => run(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error('Missing field '+${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`);
    const click = id => run(`document.getElementById(${JSON.stringify(id)}).click()`);
    const open = async () => { await menu('Agent mit Kontext starten…'); await wait(() => run("document.getElementById('agent-launch-dialog').open"), 'launch dialog'); };
    const preview = async () => { await click('agent-launch-prepare'); await wait(() => run("!!document.getElementById('agent-launch-context')?.getClientRects().length"), 'context preview'); };
    const takeScreenshot = async name => {
      win.showInactive(); win.moveTop();
      await run('Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),new Promise(r=>setTimeout(r,500))])');
      fs.writeFileSync(path.join(root, name + '.png'), (await win.webContents.capturePage()).toPNG());
    };
    let failed = false;
    try {
      await wait(() => run('!!window.DeckApp?.agentLaunch && window.DeckApp.state.activeId === "qa-launch"'), 'app ready');
      // This regression isolates the original context-start flow. Shared Memory
      // delivery and its enabled-by-default behavior have their own qa-memory.
      await run('window.deck.memory ? window.deck.memory.setSettings({ enabled: false }) : null');
      stage = 'ordinary starts';
      const count = await run('window.DeckApp.state.panes.get("qa-launch").length');
      await click('btn-plus');
      await wait(() => run(`window.DeckApp.state.panes.get('qa-launch').length===${count + 1}`), 'plus direct');
      assert.equal(await run("document.getElementById('agent-launch-dialog').open"), false);
      for (const provider of ['claude', 'codex', 'kimi']) {
        await menu({ claude: 'Claude Code', codex: 'Codex', kimi: 'Kimi Code' }[provider]);
        await wait(() => records().some(r => r.provider === provider), 'ordinary ' + provider);
        const rec = records().find(r => r.provider === provider);
        assert.deepEqual(rec.args, provider === 'codex' ? ['--dangerously-bypass-approvals-and-sandbox'] : []); assert.equal(rec.cwd, fs.realpathSync(repo));
      }
      assert.equal(contexts().length, 0); assert.equal(worktrees().length, 0);
      console.log('PASS Plus and all three ordinary agent quick starts stay direct');

      // Personal profile flags must survive appending the initial task prompt.
      await run("(async()=>{const p=await window.deck.settings.readProfile('codex');await window.deck.settings.saveProfile('codex','QA_PERSONAL_CODEX_PROFILE',p.revision);await window.deck.settings.setLoadAtStart('codex',true)})()");

      stage = 'cancel';
      await open(); await takeScreenshot('start-dialog');
      await click('agent-launch-cancel');
      assert.equal(contexts().length, 0); assert.equal(worktrees().length, 0); assert.equal(records().length, 3);
      stage = 'new working copy preview';
      await open();
      await set('agent-launch-provider', 'codex');
      await set('agent-launch-branch', 'feature/context-qa');
      await set('agent-launch-task', 'Implementiere Suche. Literal: $(touch ' + path.join(root, 'must-not-exist') + ')');
      await set('agent-launch-scope', 'Only search module');
      await set('agent-launch-acceptance', 'Search test passes');
      await preview();
      assert.equal(worktrees().length, 1); assert.equal(contexts().length, 0); assert.equal(records().length, 3);
      const ws = worktrees()[0];
      assert.equal(fs.existsSync(path.join(ws.cwd, 'unsaved.txt')), false);
      const text = await run("document.getElementById('agent-launch-context').value");
      assert.match(text, /CONTEXT_FROM_COMMITTED_PROJECT/); assert.match(text, /FRESH_CENTRAL_LEDGER/);
      assert.ok(text.includes(ws.cwd)); assert.match(text, /feature\/context-qa/); assert.match(text, /Search test passes/);
      await set('agent-launch-context', text + '\nEDITED_BEFORE_START\n');
      await takeScreenshot('context-preview');
      await click('agent-launch-start');
      await wait(() => records().some(r => r.provider === 'codex' && r.cwd === fs.realpathSync(ws.cwd)), 'context agent');
      assert.equal(contexts().length, 1);
      const contextPath = path.join(data, 'launch-contexts', contexts()[0]);
      assert.match(fs.readFileSync(contextPath, 'utf8'), /EDITED_BEFORE_START/);
      const launched = records().find(r => r.cwd === fs.realpathSync(ws.cwd));
      assert.ok(launched.args.at(-1).includes(contextPath));
      assert.equal(launched.args[0], '-c');
      assert.match(launched.args[1], /^developer_instructions=/);
      assert.ok(launched.args[1].includes('QA_PERSONAL_CODEX_PROFILE'));
      assert.equal(launched.args.at(-2), '--dangerously-bypass-approvals-and-sandbox');
      assert.equal(fs.existsSync(path.join(root, 'must-not-exist')), false);
      await wait(() => run("[...window.DeckApp.state.panes.values()].flat().some(p=>p.desc.workspaceId && p.desc.presetId==='codex' && p.status==='running')"), 'tile association');
      console.log('PASS real worktree, fresh central coordination, editable context and isolated argv');

      stage = 'existing working copy';
      await open(); await set('agent-launch-provider', 'claude');
      await set('agent-launch-folder', 'existing');
      await set('agent-launch-workspace', ws.workspaceId);
      await set('agent-launch-task', 'Continue in existing working copy');
      await preview(); await click('agent-launch-start');
      await wait(() => records().some(r => r.provider === 'claude' && r.cwd === fs.realpathSync(ws.cwd)), 'existing worktree agent');
      assert.equal(worktrees().length, 1);

      stage = 'project folder context';
      await open(); await set('agent-launch-folder', 'project');
      await set('agent-launch-task', 'Review current project');
      await preview(); await click('agent-launch-start');
      await wait(() => records().length === 6, 'project-folder context agent');
      assert.equal(records().at(-1).cwd, fs.realpathSync(repo)); assert.equal(worktrees().length, 1);
      const saved = await run('window.deck.session.save({version:1,activeProjectId:"qa-launch",projects:{"qa-launch":{terminals:window.DeckApp.state.panes.get("qa-launch").map(p=>({...p.desc}))}}})');
      void saved;
      const stored = JSON.parse(fs.readFileSync(path.join(data, 'session/session.json'), 'utf8')).projects['qa-launch'].terminals;
      assert.equal(stored.filter(t => t.workspaceId === ws.workspaceId).length, 2);
      console.log('PASS existing/project choices, terminal session persistence; no real providers');
      console.log(JSON.stringify({ result: 'passed', root, screenshots: ['start-dialog.png', 'context-preview.png'] }));
    } catch (error) {
      failed = true; console.error(JSON.stringify({ result: 'failed', stage, root, error: error.stack || String(error) }));
      try { await takeScreenshot('failure'); } catch (_) { /* diagnostic only */ }
    }
    await run('Promise.all([...window.DeckApp.state.panes.values()].flat().map(p=>window.deck.terminals.kill(p.id)))').catch(() => {});
    clearTimeout(timer); app.exit(failed ? 1 : 0);
  });
});
require(path.resolve(process.argv[2] || path.join(__dirname, '../src/main/main.js')));
