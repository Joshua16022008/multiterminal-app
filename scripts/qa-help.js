'use strict';
// Hilfe-Panel (Etappe 3a): echter Renderer, Preload, Main und User Guide aus docs/guide, isolierte Daten.
// Prüft Menü (Hilfe, Cmd+Shift+H), Topbar-Knopf, Inhaltsverzeichnis, Suche, Kontext-Link mit Anker,
// gegenseitigen Ausschluss mit den rechten Panels und Esc mit Fokus-Rückgabe.
//   node_modules/.bin/electron scripts/qa-help.js [path/to/main.js]
// Gibt QA_ROOT aus; Screenshot help-open.png liegt dort.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, Menu } = require('electron');

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mt-help-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data'), project = path.join(root, 'p');
for (const d of [home, data, project, path.join(data, 'session')]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'p', name: 'Hilfe-QA', path: project }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'p', projects: { p: { terminals: [{ id: 't1', title: 'Eins' }] } } }));
const sh = path.join(root, 'qa-shell');
fs.writeFileSync(sh, '#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
process.env.SHELL = sh;
os.homedir = () => home;
app.setName('Multiterminal Hilfe QA ' + process.pid);
app.setPath('userData', data);

const guideDir = path.join(__dirname, '..', 'docs', 'guide');
const pages = fs.readdirSync(guideDir).filter((f) => f.endsWith('.md') && f !== 'README.md');
const timeout = setTimeout(() => { console.error('Hilfe-QA timed out', root); app.exit(1); }, 90000);
let failed = false;
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 10000) {
  const t = Date.now();
  while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timed out: ' + what); await sleep(60); }
}
function findItem(menu, label) {
  for (const it of menu.items) { if (it.label === label) return it; if (it.submenu) { const f = findItem(it.submenu, label); if (f) return f; } }
  return null;
}

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3 && !message.includes('Electron Security Warning')) { errors.push(message); console.error('Renderer:', message); }
  });
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code);
    const helpOpen = () => run("(() => { const e = document.getElementById('help-panel'); return !!e && !e.hidden; })()");
    const visible = (id) => run(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden; })()`);
    try {
      await until(() => run("window.DeckApp.state.panes.get('p')?.length === 1 && window.DeckApp.state.panes.get('p')[0].status === 'running'"), 'app ready');

      // Menü: eigenes Hilfe-Menü mit Cmd+Shift+H; der Klick öffnet das Panel wie der Tastendruck.
      const item = findItem(Menu.getApplicationMenu(), 'Multiterminal-Hilfe');
      assert.ok(item, 'Menüeintrag „Multiterminal-Hilfe“');
      if (process.platform === 'darwin') assert.equal(item.accelerator, 'Cmd+Shift+H');
      const helpMenu = Menu.getApplicationMenu().items.find((m) => m.role === 'help' || m.role === 'helpmenu' || (m.submenu && m.submenu.items.includes(item)));
      assert.ok(helpMenu, 'Hilfe-Menü vorhanden');
      item.click();
      await until(helpOpen, 'Menü öffnet die Hilfe');
      assert.equal(await run("document.getElementById('btn-help').getAttribute('aria-expanded')"), 'true');
      console.log('PASS Hilfe-Menü mit Cmd+Shift+H öffnet das Panel');

      // Inhaltsverzeichnis: alle Seiten aus docs/guide (ohne README), erste Seite geladen, Suchfeld fokussiert.
      await until(() => run("document.querySelectorAll('#help-panel [data-help-page]').length > 0 && !!document.querySelector('#help-panel .help-content h1')"), 'Inhaltsverzeichnis und Seite');
      const toc = await run("[...document.querySelectorAll('#help-panel [data-help-page]')].map(b => b.dataset.helpPage)");
      assert.deepEqual(toc.slice().sort(), pages.map((f) => f.replace(/\.md$/, '')).sort(), 'TOC = docs/guide');
      assert.equal(await run("document.activeElement === document.querySelector('#help-panel .help-search')"), true, 'Suche hat den Fokus');
      const box = await run("(() => { const r = document.getElementById('help-panel').getBoundingClientRect(); return { w: r.width, right: r.right, vw: innerWidth }; })()");
      assert.ok(box.w > 300 && Math.abs(box.right - box.vw) <= 2, 'rechtes Panel: ' + JSON.stringify(box));
      fs.writeFileSync(path.join(root, 'help-open.png'), (await win.webContents.capturePage()).toPNG());
      console.log('PASS Inhaltsverzeichnis (' + toc.join(', ') + '), Seite geladen, Suche fokussiert');

      // Suche: Treffer über Stichwort/Überschrift, Klick springt zum Abschnitt; Unsinn zeigt „Nichts gefunden.“
      const type = (q) => run(`(() => { const i = document.querySelector('#help-panel .help-search'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await type('Voraussetzungen');
      await until(() => run("document.querySelectorAll('#help-panel [data-help-hit]').length > 0"), 'Suchtreffer');
      await run("document.querySelector('#help-panel [data-help-hit]').click()");
      await until(() => run("[...document.querySelectorAll('#help-panel .help-content h2')].some(h => h.textContent.includes('Voraussetzungen'))"), 'Treffer öffnet die Seite');
      await type('xyzzy-gibt-es-nicht');
      await until(() => run("!!document.querySelector('#help-panel .help-empty')"), 'Nichts gefunden');
      await type('');
      console.log('PASS Suche: Treffer öffnet Abschnitt, leere Treffermenge gemeldet');

      // Kontext-Link: DeckHelp.link() öffnet Seite und Anker; Klick läuft nicht an die Umgebung weiter.
      await run("window.DeckApp.help.close()");
      await until(async () => !(await helpOpen()), 'Hilfe zu');
      await run(`(() => { const b = window.DeckApp.help.link('erste-schritte#voraussetzungen'); b.id = 'qa-help-link'; document.getElementById('topbar').append(b); })()`);
      await run("document.getElementById('qa-help-link').click()");
      await until(helpOpen, 'Kontext-Link öffnet die Hilfe');
      await until(() => run("!!document.querySelector('#help-panel [data-help-page=\"erste-schritte\"].active')"), 'Seite aktiv');
      await run("document.getElementById('qa-help-link').remove()");
      console.log('PASS Kontext-Link öffnet Seite mit Anker');

      // Gegenseitiger Ausschluss: Änderungen-Panel schließt die Hilfe, die Hilfe schließt Änderungen.
      await run("document.getElementById('btn-diff').click()");
      await until(async () => (await visible('diff-panel')) && !(await helpOpen()), 'Änderungen ersetzt Hilfe');
      await run("document.getElementById('btn-help').click()");
      await until(async () => (await helpOpen()) && !(await visible('diff-panel')), 'Hilfe ersetzt Änderungen');
      console.log('PASS rechte Panels schließen sich gegenseitig');

      // Esc schließt und gibt den Fokus an die Kachel zurück; Palette öffnet die Hilfe wieder.
      await run("document.querySelector('#help-panel .help-search').focus()");
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await until(async () => !(await helpOpen()), 'Esc schließt');
      assert.equal(await run("document.getElementById('btn-help').getAttribute('aria-expanded')"), 'false');
      await until(() => run("!!document.activeElement && !!document.activeElement.closest('.tile')"), 'Fokus zurück in der Kachel');
      await run('window.DeckApp.commandPalette.open()');
      const hit = await run("(() => { const i = document.querySelector('.palette-input'); i.value = 'Hilfe öffnen'; i.dispatchEvent(new Event('input')); return document.querySelector('.palette-item .palette-title').textContent; })()");
      assert.equal(hit, 'Hilfe öffnen');
      await run("document.querySelector('.palette-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))");
      await until(helpOpen, 'Palette öffnet die Hilfe');
      console.log('PASS Esc mit Fokus-Rückgabe, Palette-Eintrag');

      assert.deepEqual(errors, [], 'keine Renderer-Fehler');
      console.log(JSON.stringify({ result: 'passed', QA_ROOT: root, screenshots: ['help-open.png'] }));
    } catch (error) {
      failed = true; console.error(error.stack || String(error));
      try { fs.writeFileSync(path.join(root, 'help-failure.png'), (await win.webContents.capturePage()).toPNG()); } catch (_) { /* ignore */ }
    }
    try { await run('Promise.all([...window.DeckApp.state.panes.values()].flat().map(p => window.deck.terminals.kill(p.id)))'); } catch (_) { /* ignore */ }
    clearTimeout(timeout);
    // app.exit direkt: Fenster schließen würde mit Code 0 beenden und einen Fehler verdecken.
    setTimeout(() => app.exit(failed ? 1 : 0), 400);
  });
});
console.log(JSON.stringify({ root }));
require(process.argv[2] || '../src/main/main');
