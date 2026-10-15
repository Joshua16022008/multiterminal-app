'use strict';

// Aktivitätsmarkierung und automatische Sortierung: echter Renderer/Preload/Main/PTY,
// Agentenereignisse über das echte mt-event aus einer Bash-Kachel. Alle Daten temporär.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-activity-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data'), project = path.join(root, 'p');
for (const d of [home, data, project, path.join(data, 'session')]) fs.mkdirSync(d, { recursive: true });
const term = (id, title) => ({ id, title, presetId: null, command: null, resumeCommand: null, browserUrl: null, browserOpen: false });
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'p', name: 'Aktivität', path: project }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'p', projects: { p: { terminals: [
  term('t1', 'Eins'), term('t2', 'Zwei'), term('t3', 'Drei'), term('t4', 'Vier'),
] } } }));
fs.writeFileSync(path.join(data, 'agent-events.json'), JSON.stringify({ statusEnabled: true }));
const sh = path.join(root, 'qa-shell');
fs.writeFileSync(sh, '#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
process.env.SHELL = sh;
os.homedir = () => home;
app.setName('Multiterminal Activity QA ' + process.pid); app.setPath('userData', data);

let failed = false, stage = 'bootstrap';
const timer = setTimeout(() => { console.error(JSON.stringify({ error: 'Activity QA timed out', stage, root })); app.exit(1); }, 90000);
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
    const tiles = () => run(`window.DeckApp.state.panes.get('p').map(p => ({ id: p.id, order: Number(p.el.style.order), activity: p.head.dataset.activity || null,
      num: p.el.querySelector('.tile-num')?.textContent || '', anim: getComputedStyle(p.head, '::after').animationName }))`);
    const visualOrder = async () => (await tiles()).sort((a, b) => a.order - b.order).map((t) => t.id);
    try {
      await until(() => run("window.DeckApp.state.panes.get('p')?.length===4 && window.DeckApp.state.panes.get('p').every(p=>p.status==='running')"), 'four shells');
      await sleep(400);
      stage = 'no agent: nothing marked, manual order';
      assert.deepEqual(await visualOrder(), ['t1', 't2', 't3', 't4']);
      assert.ok((await tiles()).every((t) => t.activity === null));

      stage = 'events -> activity marks';
      await hook('t1', 'SessionStart'); await until(async () => !!(await entry('t1')), 't1 start');
      await hook('t2', 'SessionStart'); await until(async () => !!(await entry('t2')), 't2 start');
      await hook('t2', 'UserPromptSubmit'); await waitState('t2', 'working');
      await hook('t3', 'SessionStart'); await until(async () => !!(await entry('t3')), 't3 start');
      await hook('t3', 'Notification', { notification_type: 'permission_prompt' }); await waitState('t3', 'needs-input');
      await until(async () => { const t = await tiles(); return t.find((x) => x.id === 't3').activity === 'waiting' && t.find((x) => x.id === 't2').activity === 'working'; }, 'marks');
      const marks = Object.fromEntries((await tiles()).map((t) => [t.id, [t.activity, t.anim]]));
      assert.deepEqual(marks, { t1: ['idle', 'act-breathe'], t2: ['working', 'act-run'], t3: ['waiting', 'act-glow'], t4: [null, 'none'] });

      stage = 'auto sort: waiting, working, idle/plain';
      await until(async () => (await visualOrder())[0] === 't3', 'resort', 4000);
      assert.deepEqual(await visualOrder(), ['t3', 't2', 't1', 't4']);
      const nums = Object.fromEntries((await tiles()).map((t) => [t.id, t.num]));
      assert.equal(nums.t3, '1', 'number 1 follows the visual first tile');
      stage = 'comfort settings';
      const qol = (key) => run(`(() => { const b=document.getElementById('qol-${key}'); b.click(); return b.checked; })()`);
      await run("document.getElementById('btn-qol').click()");
      assert.equal(await run("!document.getElementById('qol-panel').hidden"), true);
      assert.deepEqual(await run("[...document.querySelectorAll('#qol-panel input')].map(i=>i.id+':'+i.checked)"),
        ['qol-status:true', 'qol-markWaiting:true', 'qol-markWorking:true', 'qol-markIdle:true', 'qol-animate:true', 'qol-autoSort:true', 'qol-taskChip:true']);
      assert.equal(await qol('autoSort'), false);
      await until(async () => (await visualOrder()).join() === 't1,t2,t3,t4', 'manual order when off', 3000);
      assert.equal(await qol('autoSort'), true);
      await until(async () => (await visualOrder())[0] === 't3', 'sorted again', 3000);
      assert.equal(await qol('animate'), false);
      assert.equal((await tiles()).find((t) => t.id === 't2').anim, 'none', 'no animation when off');
      assert.equal(await run("getComputedStyle(document.querySelector('[data-activity=working]'), '::after').display"), 'block', 'mark stays visible');
      assert.equal(await qol('markWorking'), false);
      assert.equal(await run("getComputedStyle(document.querySelector('[data-activity=working]'), '::after').display"), 'none');
      assert.equal(await qol('taskChip'), false);
      assert.equal(await run("[...document.querySelectorAll('.task-chip')].every(c=>getComputedStyle(c).display==='none')"), true);
      assert.equal(await run("JSON.parse(localStorage.getItem('mt.qol')).markWorking"), false, 'stored');
      await run("[...document.querySelectorAll('#qol-panel button')].find(b=>b.textContent==='Standard wiederherstellen').click()");
      assert.equal(await run("[...document.querySelectorAll('#qol-panel input')].every(i=>i.checked)"), true);
      assert.equal(await run("document.body.className.includes('qol-')"), false);
      await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      fs.writeFileSync(path.join(root, 'qol.png'), (await win.webContents.capturePage()).toPNG());
      await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
      assert.equal(await run("document.getElementById('qol-panel').hidden"), true);

      stage = 'state change moves tiles';
      await hook('t3', 'UserPromptSubmit'); await waitState('t3', 'working');
      await hook('t2', 'Notification', { notification_type: 'permission_prompt' }); await waitState('t2', 'needs-input');
      await until(async () => (await visualOrder()).join() === 't2,t3,t1,t4', 'resorted after change', 4000);

      stage = 'screenshot';
      await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const screenshot = path.join(root, 'activity.png');
      fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({ result: 'passed', checks: ['no agent: unmarked, manual order', 'idle/working/waiting marks with own animation', 'sorted waiting>working>idle/plain', 'numbers follow display', 'comfort menu: sort/animation/marks/task chip switch and persist, reset', 'resort on state change', 'screenshot'], root, screenshot }));
    } catch (error) { failed = true; console.error(JSON.stringify({ stage, root, error: error.stack || String(error), tiles: await tiles().catch(() => null) })); }
    clearTimeout(timer); app.exit(failed ? 1 : 0);
  });
});
require('../src/main/main');
