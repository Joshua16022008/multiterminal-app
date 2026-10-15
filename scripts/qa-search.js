'use strict';
// F03: isolierter Electron-Lauf für Befehlspalette und Terminalsuche. Temporärer Datenordner, kein Anbieteraufruf.
// Start: node_modules/.bin/electron scripts/qa-search.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, Menu } = require('electron');
const mainFile = path.resolve(process.argv[2] || path.join(__dirname, '../src/main/main.js'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-search-qa-'));
const data = path.join(root, 'data'), home = path.join(root, 'home');
const dirs = { alpha: path.join(root, 'alpha'), beta: path.join(root, 'beta') };
for (const dir of [data, home, dirs.alpha, dirs.beta, path.join(data, 'session')]) fs.mkdirSync(dir, { recursive: true });
// Die „Shell“ gibt je Projekt Text aus (echo-Ersatz) und protokolliert jede Eingabe, die das PTY erreicht.
const recorder = path.join(root, 'record.js'), records = path.join(root, 'input.jsonl'), shellFile = path.join(root, 'shell');
fs.writeFileSync(recorder, `const fs=require('fs');if(process.stdin.isTTY)process.stdin.setRawMode(true);
const proj=require('path').basename(process.cwd());
console.log('SEARCH_QA_READY '+proj);
console.log('Needle eins in '+proj+' Größe ÄÖÜ');
console.log('Zeile ohne Treffer');
console.log('NEEDLE zwei');
process.stdin.on('data',b=>fs.appendFileSync(${JSON.stringify(records)},JSON.stringify(b.toString())+'\\n'));`);
const quote = (value) => "'" + value.replace(/'/g, "'\"'\"'") + "'";
fs.writeFileSync(shellFile, '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(recorder) + '\n', { mode: 0o755 });
process.env.SHELL = shellFile;
os.homedir = () => home;
app.setName('Search QA ' + process.pid); app.setPath('userData', data);
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([
  { id: 'proj-a', name: 'Alpha', path: dirs.alpha },
  { id: 'proj-b', name: 'Beta', path: dirs.beta },
]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({
  version: 1, activeProjectId: 'proj-a',
  projects: {
    'proj-a': { terminals: [{ id: 'a-server', title: 'Server' }, { id: 'a-tests', title: 'Tests' }] },
    'proj-b': { terminals: [{ id: 'b-server', title: 'Server' }, { id: 'b-logs', title: 'Logs' }] },
  },
}));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let stage = 'startup';
const timer = setTimeout(() => { console.error(JSON.stringify({ error: 'Search QA timed out', stage, root })); app.exit(1); }, 60000);
function menuItems(menu = Menu.getApplicationMenu()) { return menu.items.flatMap((item) => [item, ...(item.submenu ? menuItems(item.submenu) : [])]); }
function item(label) { const result = menuItems().find((value) => value.label === label); assert.ok(result, label); return result; }
const input = () => fs.existsSync(records) ? fs.readFileSync(records, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).join('') : '';

app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_event, ...args) => {
    const details = typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] };
    if (details.level === 'error' || details.level === 3) console.error('Renderer:', details.message);
  });
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code);
    const wait = async (expression, label = expression) => {
      const start = Date.now();
      while (!await run(expression)) { if (Date.now() - start > 9000) throw new Error('Timed out: ' + label); await delay(35); }
    };
    const key = async (keyCode, modifiers = []) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await delay(60);
    };
    const panesOf = (id) => `window.DeckApp.state.panes.get('${id}')`;
    const activeTitle = "(() => { const S = window.DeckApp.state; const l = S.panes.get(S.activeId); const p = l.find(x => x.id === S.activeByProject[S.activeId]); return S.activeId + '/' + p.desc.id; })()";
    const termFocused = "document.activeElement.classList.contains('xterm-helper-textarea')";
    try {
      await wait(`${panesOf('proj-a')}?.length===2 && ${panesOf('proj-a')}.every(p=>p.plainText().includes('SEARCH_QA_READY alpha'))`);
      assert.equal(item('Befehlspalette…').accelerator, 'Cmd+K');
      assert.equal(item('Im Terminalverlauf suchen…').accelerator, 'Cmd+F');
      // Kollisionsprüfung: kein anderer Menüeintrag nutzt die beiden Kürzel
      for (const accel of ['Cmd+K', 'Cmd+F']) assert.equal(menuItems().filter((i) => i.accelerator === accel).length, 1, accel);

      stage = 'palette open';
      await run(`${panesOf('proj-a')}[0].term.focus()`);
      item('Befehlspalette…').click();
      await wait("!!document.querySelector('.palette-overlay') && !document.querySelector('.palette-overlay').hidden");
      assert.equal(await run("document.activeElement.classList.contains('palette-input')"), true);
      // 4 Kacheln, 2 Projekte, Aktionen: alles im Leerzustand sichtbar (bis 50 Einträge)
      assert.ok(await run("document.querySelectorAll('.palette-item').length") >= 10);
      win.webContents.insertText('server');
      await wait("document.querySelectorAll('.palette-item[data-kind=\"pane\"]').length===2");
      const subs = await run("[...document.querySelectorAll('.palette-item[data-kind=\"pane\"] .palette-sub')].map(e=>e.textContent)");
      assert.ok(subs.some((s) => s.startsWith('Alpha')) && subs.some((s) => s.startsWith('Beta')), JSON.stringify(subs));
      const palettePng = path.join(root, 'palette.png');
      await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      fs.writeFileSync(palettePng, (await win.webContents.capturePage()).toPNG());

      stage = 'palette jump to other project';
      win.webContents.insertText(' beta');
      await wait("document.querySelector('.palette-item.sel .palette-sub')?.textContent.startsWith('Beta')");
      await key('Enter');
      await wait(`${activeTitle}==='proj-b/b-server'`);
      assert.equal(await run("document.querySelector('.palette-overlay').hidden"), true);
      await wait(termFocused);
      assert.equal(await run("document.activeElement.closest('.tile')?.querySelector('.tile-title')?.textContent"), 'Server');
      await wait(`${panesOf('proj-b')}.every(p=>p.plainText().includes('SEARCH_QA_READY beta'))`);

      stage = 'palette: maximized tile is released, Esc restores focus';
      await run(`(() => { const l = ${panesOf('proj-b')}; l[1].setMax(true); window.DeckApp.state.grids.get('proj-b').classList.add('has-max'); })()`);
      await run(`${panesOf('proj-b')}[0].term.focus()`);
      item('Befehlspalette…').click();
      await wait("document.activeElement.classList.contains('palette-input')");
      win.webContents.insertText('logs');
      await key('Enter');
      await wait(`${activeTitle}==='proj-b/b-logs'`);
      assert.equal(await run(`${panesOf('proj-b')}.some(p=>p.maxed && p.id!=='b-logs')`), false, 'andere maximierte Kachel aufgehoben');
      await run(`${panesOf('proj-b')}[0].term.focus()`);
      item('Befehlspalette…').click();
      await wait("document.activeElement.classList.contains('palette-input')");
      await key('Escape');
      await wait("document.querySelector('.palette-overlay').hidden");
      await wait(termFocused);
      assert.equal(await run(`document.activeElement.closest('.tile') === ${panesOf('proj-b')}[1].el`), true, 'Fokus zurück auf die vorher aktive Kachel (Logs)');

      stage = 'terminal search';
      await run(`${panesOf('proj-b')}[1].term.focus()`);
      // deterministischer Umbruch: Treffer beginnt drei Zeichen vor dem Zeilenende
      await run(`(() => { const p = ${panesOf('proj-b')}[1]; p.write('\\r\\n' + 'q'.repeat(p.term.cols - 3) + 'wrapneedle\\r\\n'); })()`);
      await wait(`${panesOf('proj-b')}[1].plainText().includes('wrapneedle') || ${panesOf('proj-b')}[1].term.buffer.active.length>8`);
      item('Im Terminalverlauf suchen…').click();
      const bar = '.tile.active .tsearch';
      await wait(`!!document.querySelector('${bar}') && !document.querySelector('${bar}').hidden && document.activeElement.classList.contains('tsearch-input')`);
      const scope = await run(`document.querySelector('${bar} .tsearch-scope').textContent`);
      assert.match(scope, /geladenen Verlauf dieser Kachel.*max\./);
      win.webContents.insertText('needle');
      await wait(`document.querySelector('${bar} .tsearch-count').textContent==='1/3'`, 'Treffer 1/3');
      assert.equal(await run(`${panesOf('proj-b')}[1].term.getSelection().toLowerCase()`), 'needle');
      await key('Enter');
      assert.equal(await run(`document.querySelector('${bar} .tsearch-count').textContent`), '2/3');
      await key('Enter', ['shift']);
      assert.equal(await run(`document.querySelector('${bar} .tsearch-count').textContent`), '1/3');
      // Umlaute, ohne Beachtung der Schreibweise
      await run(`(() => { const i = document.querySelector('${bar} input'); i.select(); })()`);
      win.webContents.insertText('größe äöü');
      await wait(`document.querySelector('${bar} .tsearch-count').textContent==='1/1'`, 'Umlautetreffer');
      assert.equal(await run(`${panesOf('proj-b')}[1].term.getSelection()`), 'Größe ÄÖÜ');
      // Treffer über den Zeilenumbruch hinweg
      await run(`(() => { const i = document.querySelector('${bar} input'); i.select(); })()`);
      win.webContents.insertText('wrapneedle');
      await wait(`document.querySelector('${bar} .tsearch-count').textContent==='1/1'`, 'Umbruchtreffer');
      assert.equal(await run(`${panesOf('proj-b')}[1].term.getSelection()`), 'wrapneedle');
      await run(`(() => { const i = document.querySelector('${bar} input'); i.select(); })()`);
      win.webContents.insertText('gibtesnicht');
      await wait(`document.querySelector('${bar} .tsearch-count').textContent==='Keine Treffer'`);
      await run(`(() => { const i = document.querySelector('${bar} input'); i.select(); })()`);
      win.webContents.insertText('needle');
      await wait(`document.querySelector('${bar} .tsearch-count').textContent==='1/3'`);
      const searchPng = path.join(root, 'search.png');
      await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      fs.writeFileSync(searchPng, (await win.webContents.capturePage()).toPNG());
      await key('Escape');
      await wait(`document.querySelector('${bar}').hidden && ${termFocused}`);
      assert.equal(await run(`document.activeElement.closest('.tile') === ${panesOf('proj-b')}[1].el`), true, 'Fokus zurück im Terminal');
      assert.equal(await run(`${panesOf('proj-b')}[1].term.hasSelection()`), false);

      stage = 'no leakage into PTY';
      await delay(250);
      assert.equal(input(), '', 'Weder Palette noch Suche haben Zeichen ins PTY geschickt: ' + JSON.stringify(input()));
      // Gegenprobe: normale Tastatureingabe erreicht das PTY weiterhin
      win.webContents.insertText('ok');
      await delay(300);
      assert.ok(input().includes('ok'), 'Normale Eingabe erreicht das PTY nach Schließen der Suche');

      console.log(JSON.stringify({ result: 'passed', productMain: mainFile, checks: ['menu accelerators Cmd+K / Cmd+F unique', 'palette lists projects, tiles, actions', 'same tile name in two projects distinguished', 'jump activates other project + focuses tile', 'maximized tile released on jump', 'Esc restores previous focus', 'terminal search n/m, next/prev, umlauts, wrapped line', 'scope text visible', 'Esc closes search and returns focus', 'no search text reached PTY'], limitation: 'Menu actions exercised directly; OS-level physical shortcut dispatch not simulated', screenshots: [palettePng, searchPng], root }));
      clearTimeout(timer); app.exit(0);
    } catch (error) { clearTimeout(timer); console.error(JSON.stringify({ stage, root })); console.error(error.stack); app.exit(1); }
  });
});
require(mainFile);
