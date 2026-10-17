'use strict';

// Hotkeys der neuen Funktionen: echter Renderer/Preload/Main/PTY, Menüeinträge wie beim Tastendruck ausgelöst.
// Die Aufgabenquelle der Entwicklerversion zeigt auf einen geschlossenen lokalen Port, damit die echte Web-App nie angesprochen wird.
// Läuft in beiden Editionen (MULTITERMINAL_EDITION_FILE): ohne Aufgaben-Funktion fehlen Menüpunkt und Kürzel ganz.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { app, Menu } = require('electron');
const edition = require('../src/main/edition');
const taskLabel = edition.features.taskLink ? edition.devFeatures.TASK_LINK_LABEL + '…' : null;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-feature-hotkeys-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data'), project = path.join(root, 'p');
for (const d of [home, data, project, path.join(data, 'session')]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(project, 'PROGRESS.md'), '# Fortschritt\n\n## Aktueller Stand\n\n- QA\n');
const term = (id, title) => ({ id, title, presetId: null, command: null, resumeCommand: null, browserUrl: null, browserOpen: false });
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'p', name: 'Hotkeys', path: project }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'p', projects: { p: { terminals: [term('t1', 'Eins'), term('t2', 'Zwei')] } } }));
const sh = path.join(root, 'qa-shell');
fs.writeFileSync(sh, '#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
process.env.SHELL = sh;
os.homedir = () => home;
app.setName('Multiterminal Feature Hotkeys QA ' + process.pid); app.setPath('userData', data);

let failed = false, stage = 'bootstrap';
const timer = setTimeout(() => { console.error(JSON.stringify({ error: 'Feature hotkeys QA timed out', stage, root })); app.exit(1); }, 120000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findItem(menu, label) {
  for (const it of menu.items) { if (it.label === label) return it; if (it.submenu) { const f = findItem(it.submenu, label); if (f) return f; } }
  return null;
}
const press = (label) => { const it = findItem(Menu.getApplicationMenu(), label); assert.ok(it, 'Menüeintrag fehlt: ' + label); it.click(); };

// Freien Port belegen und wieder freigeben: dort lauscht garantiert niemand.
const closedPort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => { if (level >= 3 && !message.includes('Electron Security Warning')) console.error('Renderer:', message); });
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code);
    const until = async (fn, what, ms = 8000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timed out: ' + what); await sleep(50); } };
    const visible = (id) => run(`(() => { const e=document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden; })()`);
    const notices = () => run("[...document.querySelectorAll('#notices .notice')].map(n=>n.textContent)");
    try {
      await until(() => run("window.DeckApp.state.panes.get('p')?.length===2 && window.DeckApp.state.panes.get('p').every(p=>p.status==='running')"), 'two shells');

      stage = 'menu and defaults';
      const fn = findItem(Menu.getApplicationMenu(), 'Funktionen');
      assert.ok(fn, 'Menü „Funktionen“');
      const accel = Object.fromEntries(fn.submenu.items.filter((i) => i.label && i.type !== 'separator' && i.visible !== false).map((i) => [i.label, i.accelerator]));
      const mac = process.platform === 'darwin';
      assert.deepEqual(accel, mac ? {
        'Änderungen': 'Cmd+Shift+D', 'Ports': 'Cmd+Shift+P', 'Rückmeldungen': 'Cmd+Shift+J', 'Fortschritt': 'Cmd+Shift+G',
        'Arbeitskopien-Stammbaum…': 'Cmd+Shift+Y', 'Harnesses & Modelle…': null,
        'Übergabe an anderes Terminal…': 'Cmd+Shift+U', 'Element im Browser kommentieren': 'Cmd+Shift+E', ...(taskLabel ? { [taskLabel]: 'Cmd+Shift+L' } : {}),
        'Aufbau starten…': 'Cmd+Shift+B', 'Aufbau speichern…': 'Cmd+Alt+B', 'Komfort…': 'Cmd+Shift+K', 'Automatisch sortieren an/aus': 'Cmd+Shift+S',
        'Lagebild im Projektmanager ein/aus': 'Cmd+\\',
      } : accel);

      stage = 'panels';
      press('Änderungen'); await until(() => visible('diff-panel'), 'diff panel');
      press('Ports'); await until(async () => (await visible('ports-panel')) && !(await visible('diff-panel')), 'ports replaces diff');
      press('Rückmeldungen'); await until(async () => (await visible('attention-panel')) && !(await visible('ports-panel')), 'attention replaces ports');
      press('Rückmeldungen'); await until(async () => !(await visible('attention-panel')), 'attention toggles off');
      press('Fortschritt'); await until(() => visible('progress-panel'), 'progress panel');
      press('Fortschritt'); await until(async () => !(await visible('progress-panel')), 'progress toggles off');

      stage = 'dialogs';
      press('Übergabe an anderes Terminal…'); await until(() => run("document.getElementById('handoff-dialog')?.open"), 'handoff dialog');
      await run("[...document.querySelectorAll('#handoff-dialog button')].find(b=>b.textContent==='Abbrechen').click()");
      press('Komfort…'); await until(() => visible('qol-panel'), 'comfort menu');
      press('Komfort…'); await until(async () => !(await visible('qol-panel')), 'comfort menu toggles off');
      press('Aufbau starten…'); await until(() => visible('modal'), 'layout start dialog');
      assert.match(await run("document.getElementById('modal').textContent"), /Aufbau starten/);
      await run("document.getElementById('modal').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      await until(async () => !(await visible('modal')), 'layout dialog closed');
      press('Aufbau speichern…'); await until(async () => (await visible('modal')) && /Aufbau speichern/.test(await run("document.getElementById('modal').textContent")), 'layout save dialog');
      await run("document.getElementById('modal').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      await until(async () => !(await visible('modal')), 'save dialog closed');

      stage = 'toggles';
      assert.equal(await run('window.DeckApp.qol.get().autoSort'), true);
      press('Automatisch sortieren an/aus');
      await until(() => run('window.DeckApp.qol.get().autoSort === false'), 'auto sort off');
      assert.ok((await notices()).some((n) => n.includes('Automatische Sortierung aus')));
      press('Automatisch sortieren an/aus');
      await until(() => run('window.DeckApp.qol.get().autoSort === true'), 'auto sort on');

      stage = 'tile actions';
      press('Element im Browser kommentieren');
      await until(async () => (await notices()).some((n) => n.includes('Mini-Browser dieser Kachel ist nicht offen')), 'browser closed message');
      if (taskLabel) {
      press(taskLabel);
      await until(() => run("!!document.querySelector('.task-pop')"), 'task popover');
      await until(() => run("document.querySelector('.task-pop').textContent.includes('nicht erreichbar')"), 'closed port: not reachable', 8000);
      await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      await run("document.querySelector('.task-pop .ib')?.click()");
      await run("window.DeckApp.qol.set('taskChip', false)");
      press(taskLabel);
      await until(async () => (await notices()).some((n) => n.includes('Aufgaben-Chip ist ausgeschaltet')), 'chip off message');
      await run("window.DeckApp.qol.set('taskChip', true)");
      } else assert.equal(await run("document.querySelectorAll('.task-chip').length"), 0, 'no task chip without the feature');

      stage = 'palette and settings list the actions';
      press('Befehlspalette…');
      await until(() => run("document.querySelectorAll('.cp-item, [role=option]').length > 0"), 'palette entries');
      const pal = await run("document.body.innerText");
      for (const label of ['Änderungen anzeigen', 'Übergabe an anderes Terminal', 'Aufbau starten', 'Komfort-Einstellungen']) assert.ok(pal.includes(label), 'palette misses ' + label);
      await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      const bindings = await run('window.deck.hotkeys.get().then(r=>Object.keys(r.bindings))');
      for (const id of ['diff-panel', 'ports-panel', 'attention-panel', 'progress-panel', 'handoff', 'browser-pick', ...(taskLabel ? ['task-link'] : []), 'layout-start', 'layout-save', 'qol-panel', 'auto-sort', 'pm-situation']) assert.ok(bindings.includes(id), 'binding missing: ' + id);
      if (!taskLabel) assert.ok(!bindings.includes('task-link'), 'task-link binding without the feature');

      stage = 'screenshot';
      press('Komfort…'); await until(() => visible('qol-panel'), 'menu for screenshot');
      await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const screenshot = path.join(root, 'feature-hotkeys.png');
      fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({ result: 'passed', checks: ['menu „Funktionen“ with platform defaults', 'diff/ports/attention/progress panels open and toggle', 'handoff, comfort, layout start/save dialogs', 'auto-sort toggle with notice', 'browser pick and task link act on active tile, with clear messages', 'palette and editable bindings include all new actions', 'screenshot'], root, screenshot }));
    } catch (error) { failed = true; console.error(JSON.stringify({ stage, root, error: error.stack || String(error) })); }
    clearTimeout(timer); app.exit(failed ? 1 : 0);
  });
});
closedPort().then((port) => {
  process.env.MULTITERMINAL_TASKS_URL = 'http://127.0.0.1:' + port;
  require('../src/main/main');
});
