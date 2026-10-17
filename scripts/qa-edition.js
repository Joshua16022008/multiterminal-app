'use strict';
// Edition (dev/public): echter Renderer, Preload und Main mit isolierten Daten.
//   node_modules/.bin/electron scripts/qa-edition.js          -> öffentliche Version (temporäre edition.json)
//   node_modules/.bin/electron scripts/qa-edition.js dev      -> Entwicklerversion (ohne edition.json)
// Prüft Kachelkopf (Mikrofon, Aufgaben-Chip), Menü, Live-Diktat-Schalter, Komfort, Palette, Hotkeys und Hilfe-Tabelle.
// Gibt QA_ROOT aus; Screenshot edition-<edition>.png liegt dort.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, Menu } = require('electron');

const want = process.argv.includes('dev') ? 'dev' : 'public';
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mt-edition-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data'), project = path.join(root, 'p');
for (const d of [home, data, project, path.join(data, 'session')]) fs.mkdirSync(d, { recursive: true });
if (want === 'public') {
  fs.writeFileSync(path.join(root, 'edition.json'), JSON.stringify({ edition: 'public' }));
  process.env.MULTITERMINAL_EDITION_FILE = path.join(root, 'edition.json');
} else delete process.env.MULTITERMINAL_EDITION_FILE;
// Aufgabenquelle (falls vorhanden) zeigt ins Leere, die echte Web-App wird nie angesprochen.
process.env.MULTITERMINAL_TASKS_URL = 'http://127.0.0.1:9';
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'p', name: 'Edition-QA', path: project }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'p', projects: { p: { terminals: [{ id: 't1', title: 'Eins' }] } } }));
const sh = path.join(root, 'qa-shell');
fs.writeFileSync(sh, '#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
process.env.SHELL = sh;
os.homedir = () => home;
app.setName('Multiterminal Edition QA ' + process.pid);
app.setPath('userData', data);

const edition = require('../src/main/edition');
const timeout = setTimeout(() => { console.error('Edition-QA timed out', root); app.exit(1); }, 90000);
let failed = false;
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 10000) {
  const t = Date.now();
  while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timed out: ' + what); await sleep(60); }
}
const labels = (menu) => menu.items.flatMap((it) => [it.label, ...(it.submenu ? labels(it.submenu) : [])]);

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3 && !message.includes('Electron Security Warning')) { errors.push(message); console.error('Renderer:', message); }
  });
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code);
    try {
      assert.equal(edition.edition, want, 'Edition des Hauptprozesses');
      await until(() => run("window.DeckApp.state.panes.get('p')?.length === 1 && window.DeckApp.state.panes.get('p')[0].status === 'running'"), 'app ready');
      const dev = want === 'dev';
      assert.equal(await run('window.deck.edition.edition'), want, 'Edition im Renderer');
      assert.equal(await run("'dictation' in window.deck"), dev, 'Diktat-API');
      assert.equal(await run("'secondBrain' in window.deck"), dev, 'Aufgaben-API');
      assert.equal(await run("document.querySelectorAll('.tile-head .mic').length"), dev ? 1 : 0, 'Mikrofon im Kachelkopf');
      assert.equal(await run("document.querySelectorAll('.tile-head .task-chip').length"), dev ? 1 : 0, '„+ Aufgabe“ im Kachelkopf');
      assert.equal(await run("!!document.getElementById('btn-live')"), dev, 'Schalter Live-Diktat');
      console.log('PASS Kachelkopf und Menüknöpfe');

      const menu = labels(Menu.getApplicationMenu()).filter(Boolean);
      assert.equal(menu.some((l) => /Aufgabe/.test(l)), dev, 'Menüpunkt Aufgabe');
      const bindings = await run('window.deck.hotkeys.get().then(r => Object.keys(r.bindings))');
      assert.equal(bindings.includes('task-link'), dev, 'Hotkey task-link');
      assert.equal(await run("window.DeckHotkeys.actions.some(a => a.id === 'task-link')"), dev, 'Aktion task-link');
      console.log('PASS Menü und Hotkeys');

      await run("document.getElementById('btn-qol').click()");
      await until(() => run("!document.getElementById('qol-panel').hidden"), 'Komfort offen');
      assert.equal(await run("!!document.getElementById('qol-taskChip')"), dev, 'Komfort-Schalter Aufgaben-Chip');
      await run("document.getElementById('btn-qol').click()");
      await run('window.DeckApp.commandPalette.open()');
      const palette = await run("(() => { const i = document.querySelector('.palette-input'); i.value = 'Aufgabe der Kachel'; i.dispatchEvent(new Event('input')); return [...document.querySelectorAll('.palette-item .palette-title')].map(e => e.textContent); })()");
      assert.equal(palette.some((t) => /Aufgabe der Kachel/.test(t)), dev, 'Palette: ' + JSON.stringify(palette));
      await run("document.querySelector('.palette-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
      console.log('PASS Komfort und Befehlspalette');

      const text = await run('document.body.innerText');
      if (!dev) for (const word of ['Second', 'Live-Diktat', '+ Aufgabe']) assert.ok(!text.includes(word), 'sichtbarer Text enthält ' + word);
      await run('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      const shot = path.join(root, 'edition-' + want + '.png');
      fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
      assert.deepEqual(errors, [], 'keine Renderer-Fehler');
      console.log(JSON.stringify({ result: 'passed', edition: want, QA_ROOT: root, screenshot: shot }));
    } catch (error) {
      failed = true; console.error(error.stack || String(error));
      try { fs.writeFileSync(path.join(root, 'edition-failure.png'), (await win.webContents.capturePage()).toPNG()); } catch (_) { /* ignore */ }
    }
    try { await run('Promise.all([...window.DeckApp.state.panes.values()].flat().map(p => window.deck.terminals.kill(p.id)))'); } catch (_) { /* ignore */ }
    clearTimeout(timeout);
    setTimeout(() => app.exit(failed ? 1 : 0), 400);
  });
});
console.log(JSON.stringify({ root }));
require('../src/main/main');
