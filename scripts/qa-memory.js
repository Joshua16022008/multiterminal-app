'use strict';

// Two real Electron processes sharing only an isolated QA data directory.
// Fake provider executables record argv; no provider/model is contacted.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const quote = text => "'" + String(text).replace(/'/g, "'\\''") + "'";

if (!process.versions.electron) {
  const root = fs.mkdtempSync(path.join('/private/tmp', 'mt-memory-qa-'));
  let ok = true;
  for (const phase of ['write', 'read']) {
    const result = spawnSync(require('electron'), [__filename, phase, root], {
      encoding: 'utf8', timeout: 90000, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    fs.writeFileSync(path.join(root, phase + '.log'), (result.stdout || '') + (result.stderr || ''));
    const file = path.join(root, phase + '.result.json');
    if (result.status !== 0 || !fs.existsSync(file) || JSON.parse(fs.readFileSync(file, 'utf8')).result !== 'passed') {
      console.error(JSON.stringify({ result: 'failed', phase, root, status: result.status, signal: result.signal, error: result.error?.message, log: path.join(root, phase + '.log') }));
      ok = false; break;
    }
  }
  if (ok) console.log(JSON.stringify({ result: 'passed', root, checks: ['two Electron processes', 'durable shared and project notes', 'CLI handoff', 'automatic output checkpoint', 'provider switch argv', 'real settings UI', 'project isolation'] }));
  process.exitCode = ok ? 0 : 1;
} else {
  const { app, clipboard } = require('electron');
  const phase = process.argv[2], root = process.argv[3];
  if (!['write', 'read'].includes(phase) || !root) throw new Error('QA requires write/read and isolated root.');
  const home = path.join(root, 'home'), data = path.join(root, 'data'), repo = path.join(root, 'project');
  const bin = path.join(home, '.local/bin'), recordsFile = path.join(root, 'providers.jsonl');
  for (const dir of [home, data, repo, bin, path.join(data, 'session')]) fs.mkdirSync(dir, { recursive: true });
  const projects = [
    { id: 'qa-memory', name: 'Memory Wechseltest', path: repo },
    { id: 'qa-other', name: 'Anderes Projekt', path: path.join(root, 'other') },
  ];
  fs.mkdirSync(projects[1].path, { recursive: true });
  if (phase === 'write') {
    fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify(projects));
    fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'qa-memory', projects: { 'qa-memory': { terminals: [] } } }));
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'QA fixture only.\n');
  }
  const recorder = path.join(root, 'provider-recorder.js');
  fs.writeFileSync(recorder, `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(recordsFile)},JSON.stringify({provider:process.argv[2],args:process.argv.slice(3),cwd:process.cwd()})+'\\n');console.log('QA_AUTOMATIC_OUTPUT_FROM_'+process.argv[2]);process.stdin.resume();`);
  for (const provider of ['claude', 'codex', 'kimi']) {
    fs.writeFileSync(path.join(bin, provider), '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(recorder) + ' ' + quote(provider) + ' "$@"\n', { mode: 0o755 });
  }
  const shell = path.join(root, 'qa-shell');
  // A private bash without startup scripts; all wrappers remain on PATH.
  fs.writeFileSync(shell, '#!/bin/sh\nexport PATH=' + quote(bin) + ':"$PATH"\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
  process.env.SHELL = shell;
  os.homedir = () => home;
  app.setName('Multiterminal Memory QA ' + phase + ' ' + process.pid);
  app.setPath('userData', data);
  const records = () => fs.existsSync(recordsFile) ? fs.readFileSync(recordsFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let stage = 'bootstrap', handled = false;
  const timer = setTimeout(() => finish(false, 'QA timeout'), 75000);
  function finish(ok, error) {
    clearTimeout(timer);
    const result = { result: ok ? 'passed' : 'failed', phase, stage, root, ...(error ? { error: String(error.stack || error) } : {}) };
    fs.writeFileSync(path.join(root, phase + '.result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result)); app.exit(ok ? 0 : 1);
  }
  app.on('browser-window-created', (_event, win) => {
    if (handled) return; handled = true;
    win.webContents.setBackgroundThrottling(false);
    win.webContents.once('did-finish-load', async () => {
      const run = code => win.webContents.executeJavaScript(code, true);
      const wait = async (predicate, label) => {
        const until = Date.now() + 12000;
        while (!await predicate()) { if (Date.now() > until) throw new Error('Timeout: ' + label); await sleep(50); }
      };
      const api = (method, ...args) => run(`window.deck.memory.${method}(...${JSON.stringify(args)})`);
      const click = text => run(`(()=>{const b=[...document.querySelectorAll('#settings-panel button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button '+${JSON.stringify(text)});b.click()})()`);
      const edit = (id, value) => run(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error('Missing editor '+${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      const terminal = async (id, command, projectId = 'qa-memory') => {
        const result = await run(`window.deck.terminals.create(${JSON.stringify({ id, projectId, cols: 90, rows: 25, command })})`);
        assert.equal(result.ok, true, result.error);
      };
      const kill = id => run(`window.deck.terminals.kill(${JSON.stringify(id)})`);
      const globalMarker = 'QA_SHARED_MEMORY_MARKER', projectMarker = 'QA_PROJECT_MEMORY_MARKER';
      const assertProjectContext = (instruction, provider) => {
        const files = [...instruction.matchAll(/(?:\/[^\s'"\n]+\.md)/g)].map(m => m[0]);
        const snapshots = files.filter(file => fs.existsSync(file)).map(file => fs.readFileSync(file, 'utf8'));
        assert.ok(snapshots.some(text => text.includes(globalMarker) && text.includes(projectMarker)), provider + ' receives readable shared and project context');
        assert.ok(snapshots.every(text => !text.includes('OTHER_PROJECT_PRIVATE_MARKER')), provider + ' context is project-scoped');
      };
      try {
        await wait(() => run('!!window.deck?.memory && window.DeckApp?.state.activeId === "qa-memory"'), 'app ready');
        if (phase === 'write') {
          stage = 'notes and private project isolation';
          for (const [id, text] of [[null, globalMarker], ['qa-memory', projectMarker], ['qa-other', 'OTHER_PROJECT_PRIVATE_MARKER']]) {
            const state = await api('read', id); await api('saveNotes', id, text, state.revision);
          }
          stage = 'generic harness CLI save and read';
          await terminal('qa-cli', '"$MULTITERMINAL_MEMORY_CLI" save --summary "QA_AGENT_CHECKPOINT" --next "QA_NEXT_STEP"; "$MULTITERMINAL_MEMORY_CLI" read');
          await wait(async () => (await api('read', 'qa-memory')).checkpoints.some(c => c.summary === 'QA_AGENT_CHECKPOINT'), 'CLI checkpoint');
          await kill('qa-cli');
          stage = 'automatic output and first harness';
          await terminal('qa-first-claude', 'claude');
          await wait(() => records().some(r => r.provider === 'claude'), 'fake Claude argv');
          assertProjectContext(records().find(r => r.provider === 'claude').args.at(-1), 'Claude');
          await sleep(200); await kill('qa-first-claude');
          assert.ok((await api('read', 'qa-memory')).checkpoints.some(c => c.source === 'terminal' && c.summary.includes('QA_AUTOMATIC_OUTPUT_FROM_claude')));
        } else {
          stage = 'durability after actual process restart';
          assert.equal((await api('read', null)).notes, globalMarker);
          const saved = await api('read', 'qa-memory');
          assert.equal(saved.notes, projectMarker);
          assert.ok(saved.checkpoints.some(c => c.summary === 'QA_AGENT_CHECKPOINT'));
          const context = await api('context', 'qa-memory');
          assert.ok(context.includes(globalMarker) && context.includes(projectMarker) && context.includes('QA_NEXT_STEP'));
          assert.ok(!context.includes('OTHER_PROJECT_PRIVATE_MARKER'));
          stage = 'cross harness actual launch arguments';
          for (const provider of ['codex', 'kimi']) {
            await terminal('qa-switch-' + provider, provider);
            await wait(() => records().some(r => r.provider === provider), 'fake ' + provider);
            const rec = records().find(r => r.provider === provider);
            if (provider === 'codex') {
              assert.ok(rec.args.includes('--dangerously-bypass-approvals-and-sandbox'));
              const instruction = rec.args.at(-1);
              assert.match(instruction, /Memory|memory|Kontext/);
              assertProjectContext(instruction, 'Codex');
            } else {
              const file = rec.args[rec.args.indexOf('--agent-file') + 1];
              assert.ok(file && fs.existsSync(file));
              const agent = fs.readFileSync(file, 'utf8');
              assert.ok(agent.includes('${base_prompt}')); assert.match(agent, /Memory|memory|Kontext/);
              assertProjectContext(agent, 'Kimi');
            }
            await kill('qa-switch-' + provider);
          }
          stage = 'Memory UI notes, conflicts, copy and switches';
          await run("document.getElementById('btn-settings').click()"); await click('Memory');
          await wait(() => run("!!document.getElementById('memory-global-notes') && !!document.getElementById('memory-project-notes')"), 'Memory UI');
          assert.equal(await run("document.querySelectorAll('#settings-panel .settings-provider').length"), 0);
          assert.equal(await run("document.getElementById('memory-project-notes').value"), projectMarker);
          await edit('memory-project-notes', projectMarker + '\nUI_EDIT'); await click('Projekt-Memory speichern');
          await wait(async () => (await api('read', 'qa-memory')).notes.includes('UI_EDIT'), 'UI persisted');
          // An external update must win over a stale unsaved editor.
          const current = await api('read', 'qa-memory'); await api('saveNotes', 'qa-memory', projectMarker + '\nEXTERNAL_EDIT', current.revision);
          await edit('memory-project-notes', 'LOCAL_STALE_EDIT'); await click('Projekt-Memory speichern');
          await wait(() => run("!!document.querySelector('.settings-error')"), 'revision error');
          assert.equal((await api('read', 'qa-memory')).notes, projectMarker + '\nEXTERNAL_EDIT');
          await run('window.confirm=()=>true'); await click('Projekt-Memory neu laden');
          await wait(() => run("document.getElementById('memory-project-notes').value.includes('EXTERNAL_EDIT')"), 'reload');
          await click('Kontext kopieren');
          await wait(() => Promise.resolve(clipboard.readText().includes('EXTERNAL_EDIT')), 'clipboard');
          await run("document.getElementById('memory-enabled').click()");
          await wait(async () => (await api('getSettings')).enabled === false, 'disable memory');
          assert.equal(await api('context', 'qa-memory'), '');
          await run("document.getElementById('memory-enabled').click()");
          await wait(async () => (await api('getSettings')).enabled === true, 'enable memory');
          await run("document.getElementById('memory-auto-capture').click()");
          await wait(async () => (await api('getSettings')).autoCapture === false, 'capture switch');
          win.showInactive(); win.moveTop();
          await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
          fs.writeFileSync(path.join(root, 'memory.png'), (await win.webContents.capturePage()).toPNG());
          await click('Projekt-Memory leeren');
          await wait(async () => { const x = await api('read', 'qa-memory'); return x.notes === '' && x.checkpoints.length === 0; }, 'clear project');
          assert.equal((await api('read', null)).notes, globalMarker);
          assert.equal((await api('read', 'qa-other')).notes, 'OTHER_PROJECT_PRIVATE_MARKER');
        }
        finish(true);
      } catch (error) { finish(false, error); }
    });
  });
  require('../src/main/main');
}
