'use strict';

// Real Electron renderer/preload/main/PTY. All projects, images and shell input
// live in a temporary directory. The clipboard reader is a local fixture.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, clipboard, dialog, nativeImage } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-attachments-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data'), project = path.join(root, 'project');
for (const folder of [home, data, project, path.join(data, 'session')]) fs.mkdirSync(folder, { recursive: true });
const png = nativeImage.createFromBitmap(Buffer.from([68, 102, 136, 255]), { width: 1, height: 1 }).toPNG();
const imagePath = path.join(root, 'Koralle ü 1.png'); fs.writeFileSync(imagePath, png);
const oddPath = path.join(root, "Datei ' $(nicht-ausführen).txt"); fs.writeFileSync(oddPath, 'local fixture');
const multilinePath = path.join(root, 'zwei\nzeilen.txt'); fs.writeFileSync(multilinePath, 'not sent');
const shellFile = path.join(root, 'test-shell');
const recorder = path.join(root, 'record-input.js');
const records = path.join(root, 'input.jsonl');
fs.writeFileSync(recorder, `const fs=require('node:fs'); const file=${JSON.stringify(records)}; if(process.stdin.isTTY)process.stdin.setRawMode(true); process.stdout.write('LOCAL_TEST_TERMINAL\\r\\n\\x1b[?2004h'); process.stdin.on('data',b=>fs.appendFileSync(file,JSON.stringify({pid:process.pid,text:b.toString()})+'\\n'));`);
const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
fs.writeFileSync(shellFile, '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(recorder) + '\n', { mode: 0o755 });
process.env.SHELL = shellFile;
os.homedir = () => home;
app.setName('Multiterminal Attachments QA ' + process.pid); app.setPath('userData', data);
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'qa-project', name: 'Anhangstest', path: project }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'qa-project', projects: { 'qa-project': { terminals: [
  { id: 'qa-alpha', title: 'Alpha' }, { id: 'qa-beta', title: 'Beta' }, { id: 'qa-close', title: 'Schließen prüfen' },
] } } }));
let selectedFiles = [oddPath, imagePath];
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selectedFiles });
let finishClipboard;
let delayedClipboard = false;
clipboard.read = async () => {
  if (delayedClipboard) await new Promise(resolve => { finishClipboard = resolve; });
  return [{ types: ['image/png'], getType: async () => new Blob([png], { type: 'image/png' }) }];
};
let failed = false, stage = 'bootstrap';
const timer = setTimeout(() => { console.error(JSON.stringify({ error: 'Attachment QA timed out', stage, root })); app.exit(1); }, 60000);
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
    const clickText = value => run(`(() => { const b=[...document.querySelectorAll('#prompt-draft-dialog button')].find(b=>b.textContent===${JSON.stringify(value)}); if(!b)throw new Error('Button missing'); b.click(); })()`);
    const open = (terminalId, text = '') => run(`window.DeckApp.promptDraft.open(${JSON.stringify({ terminalId, text })})`);
    try {
      await wait(() => run(`${panes}?.length===3 && ${panes}.every(p=>p.status==='running'&&p.plainText().includes('LOCAL_TEST_TERMINAL'))`), 'real PTYs and restored tiles');
      stage = 'ui';
      assert.equal(await run("document.querySelectorAll('.attachment-button').length"), 3);
      assert.equal(await open('qa-beta', 'Prüfe\ndie Dateien'), true);
      await clickText('Dateien hinzufügen…');
      await wait(() => run("document.querySelectorAll('.prompt-draft-files li').length===2"), 'native picker fixture through IPC');
      assert.match(await run("document.querySelector('.prompt-draft-target').textContent"), /Beta/);
      assert.match(await run("document.querySelector('.prompt-draft-preview').textContent"), /Prüfe die Dateien/);
      assert.deepEqual(inputs(), []);
      await clickText('Abbrechen'); await sleep(80);
      assert.deepEqual(inputs(), []);

      stage = 'drop';
      // CDP loads a disk-backed File, exercising webUtils.getPathForFile across
      // the isolated preload. Only the drop event itself is synthetic.
      await run("(() => {const f=document.createElement('input');f.type='file';f.multiple=true;f.id='qa-files';document.body.append(f)})()");
      win.webContents.debugger.attach('1.3');
      const doc = await win.webContents.debugger.sendCommand('DOM.getDocument');
      const node = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#qa-files' });
      await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [oddPath, imagePath] });
      await run(`(() => {const d=new DataTransfer();for(const f of document.getElementById('qa-files').files)d.items.add(f);${panes}.find(p=>p.id==='qa-beta').el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}));})()`);
      await wait(() => run("document.querySelectorAll('.prompt-draft-files li').length===2 && document.getElementById('prompt-draft-dialog').open"), 'disk file drop');
      assert.equal(await run('window.DeckApp.promptDraft.get().terminalId'), 'qa-beta');
      assert.equal(await run('window.DeckApp.promptDraft.get().files[0].path'), oddPath);
      await run("(() => {const e=document.getElementById('prompt-draft-text');e.value='Dateien prüfen';e.dispatchEvent(new Event('input',{bubbles:true}));})()");
      const expected = await run("document.querySelector('.prompt-draft-preview').textContent");
      await clickText('Ins Terminal einfügen');
      await wait(() => inputs().length > 0, 'raw PTY input');
      let bytes = inputs().map(i => i.text).join('');
      assert.equal(bytes, '\x1b[200~' + expected + '\x1b[201~');
      assert.doesNotMatch(bytes, /[\r\n]/);
      assert.equal(await run(`${panes}.find(p=>p.id==='qa-beta').el.classList.contains('active')`), true);
      assert.equal(new Set(inputs().map(i => i.pid)).size, 1);

      stage = 'clipboard';
      const beforeImageInput = inputs().length;
      await open('qa-alpha', 'Bild ansehen'); await clickText('Bild aus Zwischenablage');
      await wait(() => run("window.DeckApp.promptDraft.get()?.files.length===1"), 'clipboard image to local PNG');
      const savedImage = await run('window.DeckApp.promptDraft.get().files[0]');
      assert.equal(savedImage.kind, 'image'); assert.ok(savedImage.path.startsWith(path.join(data, 'attachments') + path.sep));
      assert.ok(fs.statSync(savedImage.path).size > 8);
      await clickText('Ins Terminal einfügen');
      await wait(() => inputs().length > beforeImageInput, 'image reference in Alpha');
      assert.equal(new Set(inputs().map(i => i.pid)).size, 2);

      stage = 'pasted image in tile';
      const beforePasteInput = inputs().length;
      const pasteImage = target => run(`(() => {const bytes=new Uint8Array(${JSON.stringify(Array.from(png))});const f=new File([bytes],'clipboard.png',{type:'image/png'});const d=new DataTransfer();d.items.add(f);${target}.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));})()`);
      await pasteImage(`${panes}.find(p=>p.id==='qa-alpha').el`);
      await wait(() => run("window.DeckApp.promptDraft.get()?.files.length===1"), 'image paste from tile through isolated preload');
      assert.equal(await run('window.DeckApp.promptDraft.get().terminalId'), 'qa-alpha');
      assert.equal(inputs().length, beforePasteInput);
      await clickText('Abbrechen');

      stage = 'invalid file';
      await open('qa-beta'); selectedFiles = [multilinePath];
      await clickText('Dateien hinzufügen…');
      await wait(() => run("!document.querySelector('.prompt-draft-error').hidden"), 'newline filename rejected');
      assert.match(await run("document.querySelector('.prompt-draft-error').textContent"), /Steuer|Zeilen/);
      await clickText('Abbrechen');

      stage = 'closed target';
      const beforeCloseInput = inputs().length;
      await open('qa-close', 'Darf nicht an eine andere Kachel gehen');
      await run(`${panes}.find(p=>p.id==='qa-close').el.querySelector('.close').click()`);
      await clickText('Ins Terminal einfügen');
      assert.match(await run("document.querySelector('.prompt-draft-error').textContent"), /Terminal/);
      assert.equal(inputs().length, beforeCloseInput);
      await clickText('Abbrechen');

      stage = 'tile reorder';
      const beforeOrder = await run(`${panes}.map(p=>p.id)`);
      await run(`(() => {const list=${panes},s=list[0],t=list[1],d=new DataTransfer();s.head.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:d}));t.el.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:d}));t.el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}));})()`);
      assert.deepEqual(await run(`${panes}.map(p=>p.id)`), [...beforeOrder].reverse());

      stage = 'cancel pending image';
      delayedClipboard = true;
      await open('qa-alpha', 'Alter Entwurf'); await clickText('Bild aus Zwischenablage');
      await wait(() => Boolean(finishClipboard), 'delayed clipboard');
      await clickText('Abbrechen');
      assert.equal(await open('qa-beta', 'Neuer Entwurf'), true);
      finishClipboard(); delayedClipboard = false;
      await sleep(150);
      assert.equal(await run("window.DeckApp.promptDraft.get()?.text"), 'Neuer Entwurf');
      assert.equal(await run("window.DeckApp.promptDraft.get()?.files.length"), 0, 'cancelled image must not enter the new draft');
      assert.equal(await run("document.getElementById('prompt-draft-dialog').open"), true);

      stage = 'pasted image in editor';
      await pasteImage("document.getElementById('prompt-draft-text')");
      await wait(() => run("window.DeckApp.promptDraft.get()?.files.length===1"), 'image paste within draft');
      const editorImage = await run('window.DeckApp.promptDraft.get().files[0]');
      assert.equal(editorImage.kind, 'image'); assert.ok(fs.existsSync(editorImage.path));
      assert.equal(await run('window.DeckApp.promptDraft.get().terminalId'), 'qa-beta');

      stage = 'screenshot';
      await run("window.DeckApp.promptDraft.close()");
      await run(`${panes}.find(p=>p.id==='qa-alpha').el.querySelector('button[title="Maximieren / Wiederherstellen"]').click()`);
      await open('qa-beta', 'Ziel muss sichtbar sein');
      await clickText('Ins Terminal einfügen');
      await wait(() => run("!document.getElementById('prompt-draft-dialog').open"), 'insert into other maximized tile');
      assert.equal(await run(`${panes}.find(p=>p.id==='qa-alpha').maxed`), false, 'other maximized tile must be restored');
      assert.equal(await run(`${panes}.find(p=>p.id==='qa-beta').el.getBoundingClientRect().height > 0`), true, 'insert target must be visible');
      await open('qa-beta', 'Dateien und Bilder gezielt einfügen');
      selectedFiles = [imagePath, oddPath];
      await clickText('Dateien hinzufügen…');
      await wait(() => run("window.DeckApp.promptDraft.get()?.files.length===2"), 'screenshot references');
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const screenshot = path.join(root, 'attachments.png'); fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      win.webContents.debugger.detach();
      console.log(JSON.stringify({ result: 'passed', checks: ['real renderer/preload/IPC/PTY', 'picker and disk-backed file drop', 'Unicode and shell-character paths', 'edit/cancel and exact target', 'no Enter in raw PTY input', 'clipboard PNG fixture persisted', 'image paste in tile and editor', 'newline filename refused', 'closed target refused', 'tile swap preserved', 'cancelled async image isolated', 'maximized other tile restored'], root, screenshot, clipboard: 'fixture; system clipboard unchanged', gestures: 'synthetic events, disk files through CDP' }));
    } catch (error) { failed = true; console.error(JSON.stringify({ stage, root, error: error.stack || String(error) })); }
    clearTimeout(timer); app.exit(failed ? 1 : 0);
  });
});
require('../src/main/main');
