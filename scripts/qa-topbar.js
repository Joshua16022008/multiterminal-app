'use strict';

// Real renderer and IPC, isolated app data and a local terminal fixture; no providers.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-topbar-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data'), project = path.join(root, 'project');
for (const dir of [home, data, project, path.join(data, 'session')]) fs.mkdirSync(dir, { recursive: true });
const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
const terminal = path.join(root, 'terminal.js');
fs.writeFileSync(terminal, "if(process.stdin.isTTY)process.stdin.setRawMode(true); process.stdout.write('LOCAL_QA_TERMINAL\\r\\n\\x1b[?2004h'); process.stdin.on('data',()=>{});");
const shell = path.join(root, 'shell');
fs.writeFileSync(shell, '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(terminal) + '\n', { mode: 0o755 });
process.env.SHELL = shell;
os.homedir = () => home;
app.setName('Multiterminal Topbar QA ' + process.pid);
app.setPath('userData', data);
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'qa', name: 'Menü-Testprojekt', path: project }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'qa', projects: { qa: { terminals: [{ id: 'qa-first', title: 'Terminal' }] } } }));
const timeout = setTimeout(() => { console.error('Topbar QA timeout', root); app.exit(1); }, 60000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  win.webContents.once('did-finish-load', async () => {
    const run = code => win.webContents.executeJavaScript(code);
    const wait = async (predicate, label) => {
      const start = Date.now();
      while (!(await predicate())) {
        if (Date.now() - start > 10000) throw new Error('Timeout: ' + label);
        await sleep(50);
      }
    };
    const click = async id => {
      const pos = await run(`(() => { const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...pos });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...pos });
      await sleep(70);
    };
    const hidden = id => run(`!document.getElementById(${JSON.stringify(id)}).getClientRects().length`);
    const open = async () => {
      if (await hidden('toolbar-options')) await click('btn-toolbar');
      assert.equal(await hidden('toolbar-options'), false);
    };
    try {
      await wait(() => run('window.DeckApp?.state.activeId === "qa" && !!window.DeckApp.state.panes.get("qa")?.length'), 'app ready');
      const actions = ['btn-settings', 'btn-attention', 'btn-diff', 'btn-ports', 'btn-menu', 'btn-live', 'btn-accounts', 'btn-progress', 'btn-handoff'];
      assert.deepEqual(await run('[...document.querySelectorAll("#topbar button")].filter(b=>b.getClientRects().length).map(b=>b.id)'), ['btn-plus', 'btn-toolbar']);
      await open();
      for (const id of actions) assert.equal(await hidden(id), false, id + ' visible');
      assert.equal(await run('document.activeElement.id'), 'btn-settings');
      const layout = await run('(() => { const t=document.getElementById("topbar").getBoundingClientRect(),r=document.getElementById("toolbar-options").getBoundingClientRect(); return {below:r.top>=t.bottom,wide:r.width>r.height*3}; })()');
      assert.deepEqual(layout, { below: true, wide: true });
      fs.writeFileSync(path.join(root, 'menu-open.png'), (await win.webContents.capturePage()).toPNG());
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await wait(() => hidden('toolbar-options'), 'Escape closes');
      assert.equal(await run('document.activeElement.id'), 'btn-toolbar');
      await open(); await click('ws-title'); assert.equal(await hidden('toolbar-options'), true);
      await open(); await click('btn-toolbar'); assert.equal(await hidden('toolbar-options'), true);
      console.log('PASS compact header, all options, horizontal layout, Escape/focus, outside click, toggle');

      for (const [button, panel] of [['btn-settings','settings-panel'], ['btn-attention','attention-panel'], ['btn-diff','diff-panel'], ['btn-ports','ports-panel'], ['btn-accounts','accounts-panel'], ['btn-progress','progress-panel']]) {
        await open(); await click(button);
        await wait(async () => !(await hidden(panel)), panel);
        assert.equal(await hidden('toolbar-options'), true);
        await open(); await click(button);
        await wait(() => hidden(panel), panel + ' closes');
      }
      await open();
      const liveBefore = await run('document.getElementById("btn-live").getAttribute("aria-pressed")');
      await click('btn-live');
      assert.notEqual(await run('document.getElementById("btn-live").getAttribute("aria-pressed")'), liveBefore);
      await open(); await click('btn-handoff');
      assert.equal(await run('!!document.getElementById("handoff-title")'), true);
      await run('document.querySelector("dialog.handoff").close()');
      console.log('PASS settings, attention, diff, ports, accounts, progress, live dictation, handoff');

      await open(); await click('btn-menu');
      assert.equal(await hidden('menu'), false);
      assert.equal(await hidden('toolbar-options'), true);
      assert.ok(await run('document.getElementById("menu").textContent.includes("Eigenen Befehl hinzufügen")'));
      await run('[...document.querySelectorAll("#menu .menu-item")].find(e=>e.textContent.includes("Eigenen Befehl hinzufügen")).click()');
      assert.equal(await hidden('modal'), false);
      await run('document.querySelector("#modal button[type=button]").click()');
      const count = await run('window.DeckApp.state.panes.get("qa").length');
      await click('btn-plus');
      await wait(() => run(`window.DeckApp.state.panes.get("qa").length === ${count + 1}`), 'plus creates terminal');
      console.log('PASS quickstart, custom command form, plus creates terminal');

      win.setSize(800, 700); await sleep(120); await open();
      assert.equal(await run('[...document.querySelectorAll("#toolbar-options button")].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})'), true);
      fs.writeFileSync(path.join(root, 'menu-narrow.png'), (await win.webContents.capturePage()).toPNG());
      await click('ws-title');
      // Keep the project in state but exercise header rendering without an active project.
      await run('window.DeckApp.state.activeId=null');
      // Native hotkey refresh invokes renderHeader without changing user data outside the fixture.
      await run('window.deck.hotkeys.save(window.DeckHotkeys.defaults())');
      await wait(() => hidden('ws-actions'), 'no project header');
      await open();
      assert.equal(await hidden('project-options'), true);
      assert.equal(await hidden('btn-settings'), false);
      assert.equal(await hidden('btn-attention'), false);
      console.log('PASS narrow layout and global options without a project');
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ status: 'passed', root }));
      clearTimeout(timeout); app.quit();
    } catch (error) {
      console.error(error.stack, JSON.stringify({ root, errors }));
      clearTimeout(timeout); app.exit(1);
    }
  });
});
require(process.argv[2] ? path.resolve(process.argv[2]) : '../src/main/main');
