'use strict';

// Aktivität je Projekt in der Seitenleiste: echter Renderer/Preload/Main/PTY, Ereignisse über das echte mt-event.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-proj-activity-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data');
const dirs = { pa: path.join(root, 'pa'), pb: path.join(root, 'pb'), pc: path.join(root, 'pc') };
for (const d of [home, data, path.join(data, 'session'), ...Object.values(dirs)]) fs.mkdirSync(d, { recursive: true });
const term = (id, title) => ({ id, title, presetId: null, command: null, resumeCommand: null, browserUrl: null, browserOpen: false });
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([
  { id: 'pa', name: 'Alpha', path: dirs.pa }, { id: 'pb', name: 'Beta', path: dirs.pb }, { id: 'pc', name: 'Gamma', path: dirs.pc }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'pa', projects: {
  pa: { terminals: [term('a1', 'A1'), term('a2', 'A2')] }, pb: { terminals: [term('b1', 'B1')] }, pc: { terminals: [term('c1', 'C1')] } } }));
fs.writeFileSync(path.join(data, 'agent-events.json'), JSON.stringify({ statusEnabled: true }));
const sh = path.join(root, 'qa-shell');
fs.writeFileSync(sh, '#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
process.env.SHELL = sh;
os.homedir = () => home;
app.setName('Multiterminal Project Activity QA ' + process.pid); app.setPath('userData', data);

let failed = false, stage = 'bootstrap';
const timer = setTimeout(() => { console.error(JSON.stringify({ error: 'Project activity QA timed out', stage, root })); app.exit(1); }, 120000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => { if (level >= 3 && !message.includes('Electron Security Warning')) console.error('Renderer:', message); });
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code);
    const until = async (fn, what, ms = 12000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timed out: ' + what); await sleep(60); } };
    const type = (id, text) => run(`window.deck.terminals.write(${JSON.stringify(id)}, ${JSON.stringify(text)})`);
    const hook = (id, name, json = {}) => type(id, `echo '${JSON.stringify({ hook_event_name: name, session_id: 'sess-' + id, ...json })}' | mt-event ${name}\r`);
    const entry = async (id) => (await run('window.deck.agents.list()')).find((e) => e.terminalId === id) || null;
    const waitState = (id, state) => until(async () => { const e = await entry(id); return e && e.state === state; }, id + ' -> ' + state);
    const rows = () => run(`[...document.querySelectorAll('#project-list li.proj')].map(li => ({ name: li.querySelector('.proj-name').textContent, activity: li.dataset.activity || null, title: li.title || '',
      anim: getComputedStyle(li, '::after').animationName, active: li.classList.contains('active') }))`);
    const row = async (name) => (await rows()).find((r) => r.name === name);
    const selectProject = (name) => run(`[...document.querySelectorAll('#project-list li.proj')].find(li => li.querySelector('.proj-name').textContent === ${JSON.stringify(name)}).click()`);
    try {
      await until(() => run("window.DeckApp.state.panes.get('pa')?.length===2"), 'projects loaded');
      // Alle Projekte einmal öffnen, damit ihre Terminals laufen (Hintergrundprojekte).
      for (const name of ['Gamma', 'Beta', 'Alpha']) { await selectProject(name); await sleep(300); }
      await until(() => run("[...window.DeckApp.state.panes.values()].flat().every(p => p.status==='running')"), 'all shells running', 20000);

      stage = 'no agent: rows unmarked';
      assert.ok((await rows()).every((r) => r.activity === null && r.title === ''));

      stage = 'background project shows its activity';
      await hook('b1', 'SessionStart'); await until(async () => !!(await entry('b1')), 'b1 start');
      await hook('b1', 'UserPromptSubmit'); await waitState('b1', 'working');
      await until(async () => (await row('Beta')).activity === 'working', 'Beta working');
      let beta = await row('Beta');
      assert.equal(beta.active, false, 'Beta is not the open project');
      assert.equal(beta.anim, 'act-run');
      assert.equal(beta.title, '1 arbeitet');
      assert.equal((await row('Alpha')).activity, null);

      stage = 'waiting beats working, counts per project';
      await hook('a1', 'SessionStart'); await until(async () => !!(await entry('a1')), 'a1 start');
      await hook('a1', 'UserPromptSubmit'); await waitState('a1', 'working');
      await hook('a2', 'SessionStart'); await until(async () => !!(await entry('a2')), 'a2 start');
      await hook('a2', 'Notification', { notification_type: 'permission_prompt' }); await waitState('a2', 'needs-input');
      await until(async () => (await row('Alpha')).activity === 'waiting', 'Alpha waiting');
      const alpha = await row('Alpha');
      assert.equal(alpha.title, '1 wartet auf dich · 1 arbeitet');
      assert.equal(alpha.anim, 'act-glow');

      stage = 'back to idle, other projects unaffected';
      await hook('b1', 'Stop'); await waitState('b1', 'turn-complete');
      await until(async () => (await row('Beta')).activity === 'waiting', 'unseen answer = waiting');
      await selectProject('Beta'); await sleep(500); // Antwort gesehen
      await until(async () => (await row('Beta')).activity === 'idle', 'Beta idle after seen', 6000);
      assert.equal((await row('Beta')).anim, 'act-breathe');
      assert.equal((await row('Gamma')).activity, null);

      stage = 'ended terminal drops its mark';
      await selectProject('Alpha');
      await type('a1', 'exit\r'); await type('a2', 'exit\r');
      await until(async () => (await row('Alpha')).activity === null, 'Alpha unmarked after exit', 8000);

      stage = 'comfort switches apply';
      await run("window.DeckApp.qol.set('animate', false)");
      assert.equal(await run("getComputedStyle(document.querySelector('li.proj[data-activity]'), '::after').animationName"), 'none');
      await run("window.DeckApp.qol.set('animate', true)");
      await run("window.DeckApp.qol.set('markIdle', false)");
      assert.equal(await run("getComputedStyle(document.querySelector('li.proj[data-activity=idle]'), '::after').display"), 'none');
      await run("window.DeckApp.qol.set('markIdle', true)");

      stage = 'screenshot';
      await hook('b1', 'UserPromptSubmit'); await waitState('b1', 'working');
      await hook('c1', 'SessionStart'); await until(async () => !!(await entry('c1')), 'c1 start');
      await hook('c1', 'Notification', { notification_type: 'permission_prompt' }); await waitState('c1', 'needs-input');
      await until(async () => (await row('Gamma')).activity === 'waiting' && (await row('Beta')).activity === 'working', 'screenshot state');
      await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const screenshot = path.join(root, 'project-activity.png');
      fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({ result: 'passed', checks: ['no agent: unmarked', 'background project marked with own animation', 'waiting beats working, tooltip counts', 'unseen answer waits, seen answer idles', 'exited terminals drop the mark', 'comfort switches (animation, idle mark) apply to project rows', 'screenshot'], root, screenshot }));
    } catch (error) { failed = true; console.error(JSON.stringify({ stage, root, error: error.stack || String(error), rows: await rows().catch(() => null) })); }
    clearTimeout(timer); app.exit(failed ? 1 : 0);
  });
});
require('../src/main/main');
