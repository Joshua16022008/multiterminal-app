'use strict';
// Isolated Electron UI/preload/IPC/menus and raw PTY. No provider calls.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, Menu } = require('electron');
const mainFile = path.resolve(process.argv[2] || path.join(__dirname, '../src/main/main.js'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-hotkeys-qa-'));
const data = path.join(root, 'data'), home = path.join(root, 'home'), project = path.join(root, 'project');
for (const dir of [data, home, project, path.join(data, 'session')]) fs.mkdirSync(dir, { recursive: true });
const recorder = path.join(root, 'record.js'), records = path.join(root, 'input.jsonl'), shellFile = path.join(root, 'shell');
fs.writeFileSync(recorder, `const fs=require('fs');if(process.stdin.isTTY)process.stdin.setRawMode(true);console.log('HOTKEY_QA_READY');process.stdin.on('data',b=>fs.appendFileSync(${JSON.stringify(records)},JSON.stringify(b.toString())+'\\n'));`);
const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
fs.writeFileSync(shellFile, '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(recorder) + '\n', { mode: 0o755 });
process.env.SHELL = shellFile;
os.homedir = () => home;
app.setName('Hotkeys QA ' + process.pid); app.setPath('userData', data);
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'hotkey-project', name: 'Hotkey-Test', path: project }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'hotkey-project', projects: { 'hotkey-project': { terminals: [{ id: 'hotkey-a', title: 'Alpha' }, { id: 'hotkey-b', title: 'Beta' }] } } }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let stage = 'startup';
const timer = setTimeout(() => { console.error(JSON.stringify({ error: 'Hotkey QA timed out', stage, root })); app.exit(1); }, 55000);
function menuItems(menu = Menu.getApplicationMenu()) { return menu.items.flatMap(item => [item, ...(item.submenu ? menuItems(item.submenu) : [])]); }
function item(label) { const result = menuItems().find(value => value.label === label); assert.ok(result, label); return result; }
const input = () => fs.existsSync(records) ? fs.readFileSync(records, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).join('') : '';
app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_event, ...args) => {
    const details = typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] };
    if (details.level === 'error' || details.level === 3) console.error('Renderer:', details.message);
  });
  win.webContents.once('did-finish-load', async () => {
    const run = code => win.webContents.executeJavaScript(code);
    const wait = async (expression, label = expression) => {
      const start = Date.now();
      while (!await run(expression)) { if (Date.now() - start > 8000) throw new Error('Timed out: ' + label); await delay(35); }
    };
    const click = (selector, text) => run(`(() => {const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text === undefined ? 'true' : `e.textContent.trim()===${JSON.stringify(text)}`});if(!el)throw new Error('Missing control: '+${JSON.stringify(selector)});el.click();})()`);
    const bindButton = id => `.hotkey-binding[data-action="${id}"][data-index="0"]`;
    const capture = async (id, keyCode, modifiers) => {
      await click(bindButton(id));
      await wait("document.querySelector('.hotkey-recording')?.textContent==='Kombination drücken …'");
      await run("document.querySelector('.hotkey-recording').focus()");
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await wait("!document.querySelector('.hotkey-recording')");
    };
    const panes = "window.DeckApp.state.panes.get('hotkey-project')";
    const count = `${panes}.length`;
    const save = async () => {
      assert.equal(await run("[...document.querySelectorAll('#settings-panel button')].find(e=>e.textContent==='Hotkeys speichern')?.disabled"), false, 'Save is enabled for modified draft');
      await click('#settings-panel button', 'Hotkeys speichern');
      await wait("document.querySelector('.settings-message')?.textContent.includes('sofort aktiv')");
    };
    const open = async () => { await click('#btn-settings'); await click('.settings-tab', 'Hotkeys'); await wait("document.querySelectorAll('.hotkey-row').length===17"); };
    try {
      await wait(`${panes}?.length===2 && ${panes}.every(p=>p.plainText().includes('HOTKEY_QA_READY'))`);
      assert.equal(item('Neues Terminal').accelerator, 'Cmd+T');
      assert.equal(item('Terminal 10').accelerator, 'Cmd+0');
      assert.ok(!item('Originalgröße').accelerator, 'Zoom reset does not compete with Terminal 10');
      await run(`${panes}[0].term.focus()`);
      await open();
      stage = 'capture and conflict';
      await capture('new-terminal', 'W', ['meta']);
      await wait("document.querySelector('.settings-error')?.textContent.includes('Terminal schließen')");
      assert.equal(await run(count), 2);
      assert.equal(await run("window.DeckApp.settingsPanel.isOpen()"), true);
      assert.equal(item('Neues Terminal').accelerator, 'Cmd+T');
      await capture('new-terminal', 'C', ['meta']);
      await wait("document.querySelector('.settings-error')?.textContent.includes('reserviert')");
      await click(bindButton('new-terminal'));
      await wait("document.querySelector('.hotkey-recording')?.textContent==='Kombination drücken …'");
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await wait("!document.querySelector('.hotkey-recording')");
      assert.equal(await run("window.DeckApp.settingsPanel.isOpen()"), true);
      await capture('new-terminal', 'T', ['meta', 'shift']);
      await capture('focus-terminal:3', 'B', ['control', 'shift']);
      await click('#settings-panel button[aria-label="Terminal 3: Kürzel 2 entfernen"]');
      await capture('settings', 'P', ['meta', 'shift']);
      // Drafts never affect active menus until explicitly saved.
      assert.equal(item('Neues Terminal').accelerator, 'Cmd+T');
      await save();
      assert.equal(item('Neues Terminal').accelerator, 'Cmd+Shift+T');
      assert.equal(item('Terminal 3').accelerator, 'Ctrl+Shift+B');
      assert.equal(item('Einstellungen…').accelerator, 'Cmd+Shift+P');
      assert.equal(menuItems().some(i => i.accelerator === 'Ctrl+3'), false);
      assert.equal(await run("window.DeckHotkeys.isHotkeyEvent({ctrlKey:true,shiftKey:true,key:'B'})"), true);
      assert.equal(await run("window.DeckHotkeys.isHotkeyEvent({ctrlKey:true,key:'3'})"), false);
      const saved = JSON.parse(fs.readFileSync(path.join(data, 'hotkeys.json'), 'utf8'));
      assert.deepEqual(saved['new-terminal'], ['Cmd+Shift+T']);
      assert.deepEqual(saved['focus-terminal:3'], ['Ctrl+Shift+B']);
      stage = 'live actions and PTY';
      await click('#settings-panel button[aria-label="Einstellungen schließen"]');
      assert.equal(await run("document.activeElement.classList.contains('xterm-helper-textarea')"), true, 'Closing settings restores terminal focus');
      item('Neues Terminal').click();
      await wait(`${count}===3 && ${panes}[2].plainText().includes('HOTKEY_QA_READY')`);
      item('Terminal 3').click();
      await wait(`window.DeckApp.state.activeByProject['hotkey-project']===${panes}[2].id`);
      assert.match(await run(`${panes}[2].el.querySelector('.tile-num').title`), /B/);
      await run(`${panes}[2].term.focus()`);
      const before = input();
      // Ctrl+3 produces ESC in xterm; explicit fields avoid OS synthesis differences.
      await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'3',code:'Digit3',keyCode:51,which:51,ctrlKey:true,bubbles:true,cancelable:true})); void 0");
      await delay(150);
      assert.ok(input().length > before.length, 'Old Ctrl+3 reaches shell after unbinding');
      const unbound = input();
      await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'B',code:'KeyB',keyCode:66,which:66,ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true})); void 0");
      await delay(150);
      assert.equal(input(), unbound, 'New hotkey never leaks to shell');
      item('Einstellungen…').click();
      await wait("window.DeckApp.settingsPanel.isOpen()");
      await click('#settings-panel button[aria-label="Terminal schließen: Kürzel 1 entfernen"]');
      await save();
      assert.ok(!item('Terminal schließen').accelerator);
      stage = 'reload and reset';
      // Stop only our own recorder PTYs before reload so restored tiles can restart.
      await run(`Promise.all(${panes}.map(p=>window.deck.terminals.kill(p.id)))`);
      const reloaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
      win.webContents.reload(); await reloaded;
      await wait("!!window.DeckApp.settingsPanel && window.DeckApp.state.projects.length===1");
      await wait(`${panes}?.length>=2 && ${panes}.every(p=>p.status==='running')`);
      await wait("window.DeckHotkeys.isHotkeyEvent({ctrlKey:true,shiftKey:true,key:'B'})");
      await open();
      assert.match(await run(`document.querySelector(${JSON.stringify(bindButton('new-terminal'))}).textContent`), /⇧/);
      assert.equal(await run("document.querySelector('[data-hotkey-action=\"close-terminal\"]').textContent.includes('Deaktiviert')"), true);
      await click('#settings-panel button', 'Alle auf Standard zurücksetzen');
      assert.equal(await run(`document.querySelector(${JSON.stringify(bindButton('new-terminal'))}).textContent`), '⌘ + T');
      await save();
      assert.equal(item('Neues Terminal').accelerator, 'Cmd+T');
      assert.equal(item('Terminal schließen').accelerator, 'Cmd+W');
      assert.equal(item('Einstellungen…').accelerator, 'Cmd+,');
      assert.equal(item('Terminal 3').accelerator, 'Cmd+3');
      assert.ok(menuItems().some(i => i.accelerator === 'Ctrl+3'));
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const screenshot = path.join(root, 'hotkeys.png');
      fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({ result: 'passed', productMain: mainFile, checks: ['17 hotkey actions in real settings tab', 'keyboard capture with menu suppression', 'conflict and reserved key rejection', 'Escape cancels capture', 'draft vs live menu', 'save real IPC and disk', 'live menu descriptors and actions', 'secondary binding removal', 'DOM keys to real PTY: remapped xterm interception and old key release', 'disabled binding', 'renderer reload persistence', 'restore defaults'], limitation: 'Menu actions exercised directly; OS-level physical shortcut dispatch not simulated', screenshot, data }));
      clearTimeout(timer); app.exit(0);
    } catch (error) { clearTimeout(timer); console.error(JSON.stringify({ stage, root })); console.error(error.stack); app.exit(1); }
  });
});
require(mainFile);
