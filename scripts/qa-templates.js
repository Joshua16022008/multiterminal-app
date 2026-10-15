'use strict';
// F08: benannte Aufbauten im echten Electron-Lauf (Renderer, Preload, IPC, PTY) mit temporärem Datenordner
// und Projektordner. Nur Shell-Kacheln mit harmlosen Befehlen; kein Agent, kein Anbieter-Aufruf.
//   node_modules/.bin/electron scripts/qa-templates.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');

const mainFile = path.resolve(process.argv[2] || path.join(__dirname, '../src/main/main.js'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-templates-qa-'));
const data = path.join(root, 'data'), home = path.join(root, 'home'), project = path.join(root, 'project');
for (const d of [data, home, project, path.join(data, 'session')]) fs.mkdirSync(d, { recursive: true });
const sh = path.join(root, 'qa-shell');
fs.writeFileSync(sh, '#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
process.env.SHELL = sh;
os.homedir = () => home;
app.setName('Multiterminal Templates QA ' + process.pid);
app.setPath('userData', data);

const CMDS = ['echo QA_ONE > mark1', 'echo QA_TWO > mark2', 'npm run dev; touch mark3'];
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'qa-tpl', name: 'Aufbau-QA', path: project }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({
  version: 1, activeProjectId: 'qa-tpl',
  projects: { 'qa-tpl': { terminals: CMDS.map((command, i) => ({
    id: 'tpl-src-' + i, title: ['Eins', 'Zwei', 'Dev'][i], command, resumeCommand: 'claude --resume geheim-123', color: i,
    nativeSession: { id: 'geheim-123' }, accounts: { claude: 'konto-1' },
  })) } },
}));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stage = 'start';
const timer = setTimeout(() => { console.error(JSON.stringify({ error: 'Templates QA timed out', stage, root })); app.exit(1); }, 80000);
const mark = (n) => fs.existsSync(path.join(project, 'mark' + n));

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, ...args) => {
    const d = typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] };
    if ((d.level === 'error' || d.level === 3) && !String(d.message).includes('Electron Security Warning')) console.error('Renderer:', d.message);
  });
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code);
    const wait = async (expr, label = expr, ms = 10000) => {
      const t = Date.now();
      while (!(await run(expr))) { if (Date.now() - t > ms) throw new Error('Timed out: ' + label); await sleep(60); }
    };
    const clickText = (sel, text) => run(`(() => { const el=[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}); if(!el) throw new Error('Missing: '+${JSON.stringify(text)}); el.click(); })()`);
    const panes = "window.DeckApp.state.panes.get('qa-tpl')";
    const openMenu = async (item) => { await run("document.getElementById('add-project').click()"); await clickText('#menu .menu-item', item); };
    try {
      stage = 'warten auf drei Kacheln';
      await wait(`${panes}?.length===3 && ${panes}.every(p=>p.status==='running')`);
      await sleep(400);
      assert.ok(!mark(1) && !mark(2) && !mark(3), 'wiederhergestellte Kacheln führen ihre Befehle nicht aus');

      stage = 'Aufbau speichern';
      await openMenu('Aufbau speichern…');
      await wait("!!document.querySelector('.tpl-form input[maxlength]')");
      assert.equal(await run("document.querySelectorAll('.tpl-form .tpl-row').length"), 3);
      await run("(() => { const i=document.querySelector('.tpl-form input[maxlength]'); i.value='Drei Kacheln'; })()");
      await run("document.querySelector('.tpl-form button[type=submit]').click()");
      await wait("document.getElementById('modal').hidden");
      const stored = await run('window.deck.templates.list()');
      assert.equal(stored.length, 1);
      assert.equal(stored[0].name, 'Drei Kacheln');
      assert.deepEqual(stored[0].tiles.map((t) => t.startCommand), CMDS);
      const rawFile = fs.readFileSync(path.join(data, 'workspace-templates.json'), 'utf8');
      for (const bad of ['geheim-123', 'konto-1', 'resumeCommand', 'nativeSession', 'accounts']) assert.ok(!rawFile.includes(bad), 'nicht gespeichert: ' + bad);

      stage = 'Doppelter Name';
      await openMenu('Aufbau speichern…');
      await wait("!!document.querySelector('.tpl-form input[maxlength]')");
      await run("document.querySelector('.tpl-form input[maxlength]').value='drei kacheln'");
      await run("document.querySelector('.tpl-form button[type=submit]').click()");
      await wait("document.querySelector('.tpl-error') && !document.querySelector('.tpl-error').hidden && document.querySelector('.tpl-error').textContent.includes('existiert bereits')");
      await clickText('.tpl-form button', 'Abbrechen');

      stage = 'Neuladen';
      const reloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
      win.webContents.reload(); await reloaded;
      await wait(`!!window.DeckApp.workspaceTemplates && ${panes}?.length===3`);
      assert.equal((await run('window.deck.templates.list()')).length, 1, 'Vorlage nach Neuladen vorhanden');

      stage = 'Vorschau';
      await openMenu('Aufbau starten…');
      await wait("document.querySelectorAll('.tpl-form .tpl-row.pick').length===1");
      await run("document.querySelector('.tpl-form .tpl-row.pick').click()");
      await wait("document.querySelectorAll('.tpl-form .tpl-cmd').length===3");
      assert.deepEqual(await run("[...document.querySelectorAll('.tpl-form .tpl-cmd')].map(e=>e.textContent)"), CMDS);
      assert.deepEqual(await run("[...document.querySelectorAll('.tpl-form .tpl-check input')].map(e=>e.checked)"), [true, true, false], 'Devserver standardmäßig aus');
      assert.equal(await run("document.querySelectorAll('.tpl-badge').length"), 1);
      await sleep(600);
      assert.equal(await run(`${panes}.length`), 3, 'Vorschau erzeugt keine Kachel');
      assert.ok(!mark(1) && !mark(2) && !mark(3), 'Vorschau führt nichts aus');
      fs.writeFileSync(path.join(root, 'templates-preview.png'), (await win.webContents.capturePage()).toPNG());

      stage = 'Abbruch';
      await clickText('.tpl-form button', 'Abbrechen');
      await wait("document.getElementById('modal').hidden");
      await sleep(600);
      assert.equal(await run(`${panes}.length`), 3, 'Abbruch startet nichts');
      assert.ok(!mark(1) && !mark(2) && !mark(3), 'Abbruch führt nichts aus');

      stage = 'Starten';
      await openMenu('Aufbau starten…');
      await wait("document.querySelectorAll('.tpl-form .tpl-row.pick').length===1");
      await run("document.querySelector('.tpl-form .tpl-row.pick').click()");
      await wait("document.querySelectorAll('.tpl-form .tpl-cmd').length===3");
      await clickText('.tpl-form button', 'Starten (3)');
      await wait(`${panes}.length===6 && ${panes}.slice(3).every(p=>p.status==='running')`);
      const t0 = Date.now();
      while (!(mark(1) && mark(2))) { if (Date.now() - t0 > 8000) throw new Error('Befehle liefen nicht'); await sleep(80); }
      await sleep(500);
      assert.ok(!mark(3), 'Devserver wurde nicht gestartet');
      const descs = await run(`${panes}.map(p=>({id:p.desc.id,title:p.desc.title,command:p.desc.command,resumeCommand:p.desc.resumeCommand,accounts:p.desc.accounts,nativeSession:p.desc.nativeSession,workspaceId:p.desc.workspaceId}))`);
      assert.equal(new Set(descs.map((d) => d.id)).size, 6, 'keine doppelte ID');
      const fresh = descs.slice(3);
      assert.deepEqual(fresh.map((d) => d.command), CMDS);
      assert.deepEqual(fresh.map((d) => d.title), ['Eins', 'Zwei', 'Dev']);
      for (const d of fresh) {
        assert.equal(d.nativeSession, undefined);
        assert.equal(d.workspaceId, undefined);
        assert.ok(!d.resumeCommand, 'kein übernommener Gesprächsbezug');
      }
      assert.ok(fresh.every((d) => !JSON.stringify(d.accounts || {}).includes('konto-1')), 'keine übernommenen Konten (aktives Konto wird neu vergeben)');
      await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const screenshot = path.join(root, 'templates-started.png');
      fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({ result: 'passed', root, screenshots: [path.join(root, 'templates-preview.png'), screenshot], checks: [
        'Aufbau aus 3 Kacheln gespeichert, ohne Gespräch/Konto', 'doppelter Name abgelehnt', 'nach Neuladen vorhanden',
        'Vorschau startet keinen Prozess', 'Devserver standardmäßig aus', 'Abbruch ohne Wirkung', 'Start erzeugt 3 neue Kacheln mit erwarteten Befehlen'] }));
      clearTimeout(timer); app.exit(0);
    } catch (error) { clearTimeout(timer); console.error(JSON.stringify({ stage, root })); console.error(error.stack); app.exit(1); }
  });
});
require(mainFile);
