'use strict';

// Real Electron renderer/preload/main/PTY with three local shell tiles. All data,
// the project and the input recorder live in a temporary directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-handoff-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data'), project = path.join(root, 'project');
for (const folder of [home, data, project, path.join(data, 'session')]) fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(project, 'PROGRESS.md'), '# Fortschritt\n\n## Aktueller Stand\n\n- QA-Stand Alpha-Test für die Übergabe\n\n## Verlauf\n- alter Eintrag, darf nicht erscheinen\n');
const shellFile = path.join(root, 'test-shell');
const recorder = path.join(root, 'record-input.js');
const records = path.join(root, 'input.jsonl');
fs.writeFileSync(recorder, `const fs=require('node:fs'); const file=${JSON.stringify(records)}; if(process.stdin.isTTY)process.stdin.setRawMode(true); process.stdout.write('LOCAL_TEST_TERMINAL\\r\\n\\x1b[?2004h'); process.stdin.on('data',b=>fs.appendFileSync(file,JSON.stringify({pid:process.pid,text:b.toString()})+'\\n'));`);
const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
fs.writeFileSync(shellFile, '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(recorder) + '\n', { mode: 0o755 });
process.env.SHELL = shellFile;
os.homedir = () => home;
app.setName('Multiterminal Handoff QA ' + process.pid); app.setPath('userData', data);
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'qa-project', name: 'Übergabetest', path: project }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'qa-project', projects: { 'qa-project': { terminals: [
  { id: 'qa-alpha', title: 'Alpha' }, { id: 'qa-beta', title: 'Beta' }, { id: 'qa-close', title: 'Schließen prüfen' },
] } } }));
let failed = false, stage = 'bootstrap';
const timer = setTimeout(() => { console.error(JSON.stringify({ error: 'Handoff QA timed out', stage, root })); app.exit(1); }, 60000);
const inputs = () => fs.existsSync(records) ? fs.readFileSync(records, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3 && !message.includes('Electron Security Warning')) console.error('Renderer:', message); });
  win.webContents.once('did-finish-load', async () => {
    const run = code => win.webContents.executeJavaScript(code);
    const wait = async (predicate, label) => {
      const start = Date.now();
      while (!await predicate()) { if (Date.now() - start > 7000) throw new Error('Timed out: ' + label); await sleep(30); }
    };
    const panes = "window.DeckApp.state.panes.get('qa-project')";
    const clickIn = (dialogId, value) => run(`(() => { const b=[...document.querySelectorAll('#${dialogId} button')].find(b=>b.textContent===${JSON.stringify(value)}); if(!b)throw new Error('Button missing: ${value}'); b.click(); })()`);
    const activate = id => run(`${panes}.find(p=>p.id===${JSON.stringify(id)}).el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))`);
    const handoffOpen = () => run("document.getElementById('handoff-dialog').open");
    const draftOpen = () => run("document.getElementById('prompt-draft-dialog').open");
    const fill = (id, value) => run(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)}`);
    const openHandoff = async (sourceId) => {
      await activate(sourceId);
      await run('window.DeckApp.handoff.open()');
      await wait(handoffOpen, 'handoff dialog open');
    };
    try {
      await wait(() => run(`${panes}?.length===3 && ${panes}.every(p=>p.status==='running'&&p.plainText().includes('LOCAL_TEST_TERMINAL'))`), 'real PTYs and restored tiles');
      stage = 'button and dialog';
      assert.equal(await run("!!document.getElementById('btn-handoff')"), true);
      await openHandoff('qa-alpha');
      assert.match(await run("document.querySelector('.handoff-source').textContent"), /Alpha/);
      assert.deepEqual(await run("[...document.querySelectorAll('#handoff-target option')].map(o=>o.value)"), ['qa-beta', 'qa-close'], 'source tile must not be a target');
      assert.equal(await run("document.getElementById('handoff-progress').value.includes('QA-Stand Alpha-Test')"), true, 'progress excerpt prefilled');
      assert.equal(await run("document.getElementById('handoff-progress').value.includes('alter Eintrag')"), false, 'only the current status section');
      assert.equal(await run("document.getElementById('handoff-progress').hidden"), true, 'excerpt hidden until ticked');
      assert.deepEqual(inputs(), []);

      stage = 'fill and insert via draft';
      await fill('handoff-goal', 'Login-Fehler eingrenzen');
      await fill('handoff-results', 'Tests 368/368 grün');
      await fill('handoff-next', 'Token-Ablauf prüfen');
      await run("document.getElementById('handoff-target').value='qa-beta'");
      await run("document.getElementById('handoff-progress-on').click()");
      assert.equal(await run("document.getElementById('handoff-progress').hidden"), false);
      await clickIn('handoff-dialog', 'In Promptvorschau');
      await wait(draftOpen, 'prompt preview opened');
      assert.equal(await handoffOpen(), false, 'handoff dialog closes after preview opens');
      assert.equal(await run('window.DeckApp.promptDraft.get().terminalId'), 'qa-beta');
      assert.match(await run("document.querySelector('.prompt-draft-target').textContent"), /Beta/);
      const preview = await run("document.querySelector('.prompt-draft-preview').textContent");
      for (const part of ['Übergabe von Alpha', 'Ziel:', 'Login-Fehler eingrenzen', 'Geprüfte Ergebnisse:', 'Genau ein nächster Schritt:', 'Token-Ablauf prüfen', 'Auszug aus PROGRESS.md:', 'QA-Stand Alpha-Test']) {
        assert.ok(preview.includes(part), 'preview misses ' + part);
      }
      assert.doesNotMatch(preview, /Relevante Dateien/, 'empty field omitted');
      assert.deepEqual(inputs(), [], 'nothing reaches a terminal before the user inserts');
      await clickIn('prompt-draft-dialog', 'Ins Terminal einfügen');
      await wait(() => inputs().length > 0, 'raw PTY input');
      const bytes = inputs().map(i => i.text).join('');
      assert.equal(bytes, '\x1b[200~' + preview + '\x1b[201~');
      assert.doesNotMatch(bytes, /[\r\n]/, 'no Enter is sent');
      assert.equal(new Set(inputs().map(i => i.pid)).size, 1, 'exactly the beta shell received it');

      stage = 'cancel without effect';
      const beforeCancel = inputs().length;
      await openHandoff('qa-alpha');
      await fill('handoff-goal', 'Abbruch darf nichts senden');
      await clickIn('handoff-dialog', 'Abbrechen');
      await sleep(80);
      assert.equal(await handoffOpen(), false);
      assert.equal(await run('window.DeckApp.promptDraft.get()'), null);
      assert.equal(inputs().length, beforeCancel);

      stage = 'closed target refused';
      await openHandoff('qa-alpha');
      await run("document.getElementById('handoff-target').value='qa-close'");
      await run(`${panes}.find(p=>p.id==='qa-close').el.querySelector('.close').click()`);
      await wait(() => run(`(${panes}.find(p=>p.id==='qa-close')?.status ?? 'gone') !== 'running'`), 'target closed');
      await clickIn('handoff-dialog', 'In Promptvorschau');
      await wait(() => run("!document.querySelector('.handoff-error').hidden"), 'error for closed target');
      assert.equal(await handoffOpen(), true, 'dialog stays open on refusal');
      assert.equal(await run('window.DeckApp.promptDraft.get()'), null);
      assert.equal(inputs().length, beforeCancel, 'no input for refused handoff');
      await clickIn('handoff-dialog', 'Abbrechen');

      stage = 'screenshot';
      await openHandoff('qa-alpha');
      await fill('handoff-goal', 'Übergabe an Beta prüfen');
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const screenshot = path.join(root, 'handoff.png');
      fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      await clickIn('handoff-dialog', 'Abbrechen');
      console.log(JSON.stringify({ result: 'passed', checks: ['real renderer/preload/IPC/PTY', 'source tile not a target', 'PROGRESS excerpt limited to current status', 'preview shows exact target and text', 'nothing sent before insert', 'insert without Enter', 'cancel has no effect', 'closed target refused', 'screenshot'], root, screenshot }));
    } catch (error) { failed = true; console.error(JSON.stringify({ stage, root, error: error.stack || String(error) })); }
    clearTimeout(timer); app.exit(failed ? 1 : 0);
  });
});
require('../src/main/main');
