'use strict';
// F02: exact conversation per tile. Real renderer, preload, main, PTYs and bridge with an isolated data
// folder; a fake `claude`/`codex` prints its arguments, hook events come from inside the tiles (mt-event).
//   node_modules/.bin/electron scripts/qa-resume.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-resume-qa-'));
const home = path.join(root, 'home'), data = path.join(root, 'data'), fake = path.join(root, 'fake'), proj = path.join(root, 'proj');
for (const d of [home, data, fake, proj, path.join(data, 'session')]) fs.mkdirSync(d, { recursive: true });
const ID1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ID2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const tile = (id, title, preset, resume) => ({ id, title, presetId: preset, command: preset, resumeCommand: resume, browserUrl: null, browserOpen: false });
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'pa', name: 'Projekt A', path: proj }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({
  version: 1, activeProjectId: 'pa',
  projects: { pa: { terminals: [
    tile('r1', 'R1', 'claude', 'claude --continue'),
    tile('r2', 'R2', 'claude', 'claude --continue'),
    tile('r3', 'R3', 'codex', 'codex resume --last'),
  ] } },
}));
fs.writeFileSync(path.join(data, 'agent-events.json'), JSON.stringify({ statusEnabled: true }));
for (const name of ['claude', 'codex']) {
  fs.writeFileSync(path.join(fake, name), `#!/bin/sh\nprintf "FAKE-${name}:"; for a in "$@"; do printf " [%s]" "$a"; done; echo\n`, { mode: 0o755 });
}
process.env.PATH = fake + path.delimiter + process.env.PATH;
const sh = path.join(root, 'qa-shell');
fs.writeFileSync(sh, '#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
process.env.SHELL = sh;
os.homedir = () => home;
app.setName('Multiterminal Resume QA ' + process.pid);
app.setPath('userData', data);

const timeout = setTimeout(() => { console.error('Resume QA timed out'); app.exit(1); }, 120000);
let failed = false;
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 15000) {
  const f = fn; fn = async () => { try { return await f(); } catch (_) { return false; } };
  const t = Date.now();
  while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timed out: ' + what); await sleep(80); }
}
const ok = (name) => { results.push(name); console.log('PASS', name); };

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3 && !message.includes('Electron Security Warning')) console.error('Renderer:', message);
  });
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code);
    const P = "[...window.DeckApp.state.panes.get('pa')]";
    const ansi = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
    const screen = (id) => run(`(() => { const p = ${P}.find(x => x.id === ${JSON.stringify(id)}); return p ? p.serialize() : ''; })()`).then((t) => t.replace(ansi, ''));
    const type = (id, text) => run(`window.deck.terminals.write(${JSON.stringify(id)}, ${JSON.stringify(text)})`);
    const hook = (id, sid) => type(id, `echo '${JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid })}' | mt-event SessionStart\r`);
    const disk = () => JSON.parse(fs.readFileSync(path.join(data, 'session/session.json'), 'utf8')).projects.pa.terminals;
    const diskNs = (id) => (disk().find((t) => t.id === id) || {}).nativeSession;
    const btn = (id) => run(`(() => { const p = ${P}.find(x => x.id === ${JSON.stringify(id)}); const b = p.el.querySelector('.btn-resume'); return { hidden: b.hidden, text: b.textContent, title: b.title }; })()`);
    try {
      await until(() => run('!!(window.DeckApp.state.activeId && window.DeckApp.attention)'), 'app ready');
      await until(() => run(`${P}.length === 3 && ${P}.every(p => p.status === 'running')`), 'tiles running');

      // 1. two tiles of the same provider report different conversations
      await hook('r1', ID1); await hook('r2', ID2);
      await until(() => run(`${P}.filter(p => p.desc.nativeSession).length === 2`), 'nativeSession on both tiles');
      assert.equal(await run(`${P}.find(p => p.id === 'r1').desc.nativeSession.nativeSessionId`), ID1);
      assert.equal(await run(`${P}.find(p => p.id === 'r2').desc.nativeSession.nativeSessionId`), ID2);
      assert.equal(await run(`${P}.find(p => p.id === 'r3').desc.nativeSession`), undefined);
      await until(() => !!diskNs('r1') && !!diskNs('r2'), 'session file has IDs');
      assert.equal(diskNs('r1').nativeSessionId, ID1);
      assert.equal(diskNs('r2').nativeSessionId, ID2);
      assert.equal(diskNs('r3'), undefined);
      ok('hook events give each tile its own conversation ID; saved in session.json');

      // 2. restart: stop the PTYs, reload the page (tiles come back from the session file)
      await run(`Promise.all(${P}.map(p => window.deck.terminals.kill(p.id)))`);
      const reloaded = new Promise((r) => win.webContents.once('did-finish-load', r));
      win.webContents.reload(); await reloaded;
      await until(() => run(`!!window.DeckApp.attention && ${P}.length === 3`), 'tiles restored');
      await until(async () => (await btn('r1')).hidden === false && (await btn('r2')).hidden === false && (await btn('r3')).hidden === false, 'resume buttons');
      assert.equal((await btn('r1')).text, 'Fortsetzen');
      assert.equal((await btn('r2')).text, 'Fortsetzen');
      assert.match((await btn('r1')).title, new RegExp('--resume ' + ID1));
      assert.match((await btn('r2')).title, new RegExp('--resume ' + ID2));
      assert.equal((await btn('r3')).text, 'Fortsetzen: letztes Gespräch');
      assert.match((await btn('r3')).title, /Keine feste Zuordnung/);
      ok('after restart: exact buttons for r1/r2, visibly loose button for the tile without ID');

      // 3. click all three; each tile types its own command
      for (const id of ['r1', 'r2', 'r3']) await run(`${P}.find(p => p.id === ${JSON.stringify(id)}).el.querySelector('.btn-resume').click()`);
      await until(async () => /FAKE-claude:.*\[--resume\] \[bbbbbbbb/.test(await screen('r2')) && /FAKE-claude:.*\[--resume\] \[aaaaaaaa/.test(await screen('r1')) && /FAKE-codex:/.test(await screen('r3')), 'resumed output');
      const s1 = await screen('r1'), s2 = await screen('r2'), s3 = await screen('r3');
      assert.match(s1, new RegExp('\\[--resume\\] \\[' + ID1 + '\\]'));
      assert.doesNotMatch(s1, new RegExp(ID2));
      assert.match(s2, new RegExp('\\[--resume\\] \\[' + ID2 + '\\]'));
      assert.doesNotMatch(s2, new RegExp(ID1));
      assert.doesNotMatch(s1 + s2, /\[--continue\]/);
      assert.match(s3, /FAKE-codex: \[resume\] \[--last\]/);
      ok('r1 types claude --resume <ID1>, r2 claude --resume <ID2>, r3 keeps codex resume --last');
    } catch (error) {
      failed = true; console.error(error.stack || String(error));
      try { console.error('r1:', (await screen('r1')).slice(-400), '\nr2:', (await screen('r2')).slice(-400)); } catch (_) { /* ignore */ }
    }
    try { await run(`Promise.all(${P}.map(p => window.deck.terminals.kill(p.id)))`); } catch (_) { /* ignore */ }
    clearTimeout(timeout);
    console.log(JSON.stringify({ result: failed ? 'failed' : 'passed', passed: results.length }));
    win.close();
    setTimeout(() => { fs.rmSync(root, { recursive: true, force: true }); app.exit(failed ? 1 : 0); }, 500);
  });
});
require('../src/main/main');
