'use strict';
// F01: real renderer, preload, main, PTYs and bridge with an isolated data folder and temporary projects.
//   QA_MODE=main node_modules/.bin/electron scripts/qa-attention.js   (fake `claude`, events from inside the tiles)
//   QA_MODE=live QA_TRUSTED_DIR=<dir> ...  (ONE real prompt to `claude --model haiku`; only with explicit permission)
//   QA_MODE=zsh node_modules/.bin/electron scripts/qa-attention.js   (the app's real `zsh -l -i` with the user's startup files: ZDOTDIR shim)
//   QA_MODE=real node_modules/.bin/electron scripts/qa-attention.js   (real `claude` without a prompt, project = QA_TRUSTED_DIR)
// QA_SHOTS=<dir> writes screenshots there. The window focus is stubbed (QA cannot take the real focus).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { app, Menu, BrowserWindow } = require('electron');

const mode = ['real', 'live', 'zsh'].includes(process.env.QA_MODE) ? process.env.QA_MODE : 'main';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-att-qa-'));
const realHome = os.homedir();
const home = path.join(root, 'home'), data = path.join(root, 'data'), fake = path.join(root, 'fake');
const dirs = { pa: path.join(root, 'pa'), pb: path.join(root, 'pb') };
for (const d of [home, data, fake, path.join(data, 'session'), ...Object.values(dirs)]) fs.mkdirSync(d, { recursive: true });
const sha = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch (_) { return 'absent'; } };
const claudeSettings = path.join(realHome, '.claude', 'settings.json');
const before = { claude: sha(claudeSettings), codex: fs.existsSync(path.join(realHome, '.codex')) };

const term = (id, title) => ({ id, title, presetId: null, command: null, resumeCommand: null, browserUrl: null, browserOpen: false });
let projects, session;
if (mode === 'main' || mode === 'zsh') {
  projects = [{ id: 'pa', name: 'Projekt A', path: dirs.pa }, { id: 'pb', name: 'Projekt B', path: dirs.pb }];
  session = { version: 1, activeProjectId: 'pa', projects: { pa: { terminals: [term('a1', 'A1'), term('a2', 'A2')] }, pb: { terminals: [term('b1', 'B1'), term('b2', 'B2')] } } };
  if (mode === 'zsh') fs.writeFileSync(path.join(data, 'agent-events.json'), JSON.stringify({ statusEnabled: true }));
  fs.writeFileSync(path.join(fake, 'claude'), '#!/bin/sh\nprintf "FAKE:"; for a in "$@"; do printf " [%s]" "$a"; done; echo\n', { mode: 0o755 });
  process.env.PATH = fake + path.delimiter + process.env.PATH;
} else {
  const trusted = process.env.QA_TRUSTED_DIR;
  if (!trusted) throw new Error('QA_TRUSTED_DIR fehlt');
  projects = [{ id: 'pr', name: 'Vertraut', path: trusted }];
  session = { version: 1, activeProjectId: 'pr', projects: { pr: { terminals: mode === 'live' ? [term('r1', 'R1'), term('r2', 'R2')] : [term('r1', 'R1')] } } };
}
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify(projects));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify(session));
const sh = path.join(root, 'qa-shell');
fs.writeFileSync(sh, '#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
process.env.SHELL = mode === 'zsh' ? '/bin/zsh' : sh;
process.env.MULTITERMINAL_ATTENTION_LOG = '1';
os.homedir = () => home; // the app's own paths; the child processes keep the real HOME
app.setName('Multiterminal Attention QA ' + process.pid);
app.setPath('userData', data);

let focused = true;
BrowserWindow.prototype.isFocused = function () { return focused; };
const notifyLog = [];
const origLog = console.log;
console.log = (...a) => { const t = a.join(' '); if (t.startsWith('[attention] notify')) notifyLog.push(t); origLog(...a); };

const timeout = setTimeout(() => { console.error('Attention QA timed out'); app.exit(1); }, 170000);
let failed = false;
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 12000) {
  const t = Date.now();
  while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timed out: ' + what); await sleep(80); }
}
const ok = (name) => { results.push(name); origLog('PASS', name); };
function findItem(menu, label) {
  for (const it of menu.items) {
    if (it.label === label) return it;
    if (it.submenu) { const f = findItem(it.submenu, label); if (f) return f; }
  }
  return null;
}
function fireMenu(label) { const it = findItem(Menu.getApplicationMenu(), label); assert.ok(it, 'Menüeintrag fehlt: ' + label); it.click(); }

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3 && !message.includes('Electron Security Warning')) console.error('Renderer:', message);
  });
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code);
    const shot = async (name) => {
      if (!process.env.QA_SHOTS) return;
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(process.env.QA_SHOTS, `f01-${name}.png`), img.toPNG());
    };
    const ansi = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
    const screen = (id) => run(`(() => { const p = [...window.DeckApp.state.panes.values()].flat().find(x => x.id === ${JSON.stringify(id)}); return p ? p.serialize() : ''; })()`).then((t) => t.replace(ansi, ''));
    const type = (id, text) => run(`window.deck.terminals.write(${JSON.stringify(id)}, ${JSON.stringify(text)})`);
    const hook = (id, name, json) => type(id, `echo '${JSON.stringify({ hook_event_name: name, session_id: 'sess-' + id, ...json })}' | mt-event ${name}\r`);
    const entries = () => run('window.deck.agents.list()');
    const entry = async (id) => (await entries()).find((e) => e.terminalId === id) || null;
    const dot = (id) => run(`(() => { const p = [...window.DeckApp.state.panes.values()].flat().find(x => x.id === ${JSON.stringify(id)}); const d = p.el.querySelector('.attn-dot'); return d ? { hidden: d.hidden, state: d.getAttribute('data-state'), color: d.style.getPropertyValue('--attn-color'), title: d.getAttribute('title') } : null; })()`);
    const badge = () => run("(() => { const b = document.getElementById('attention-count'); return b.hidden ? 0 : Number(b.textContent); })()");
    const active = () => run('(() => { const S = window.DeckApp.state; const p = [...S.panes.get(S.activeId)].find(x => x.id === S.activeByProject[S.activeId]); return { project: S.activeId, pane: p && p.id, focusIn: !!(p && p.el.contains(document.activeElement)) }; })()');
    const waitState = (id, state, ms) => until(async () => { const e = await entry(id); return e && e.state === state; }, `${id} -> ${state}`, ms);
    const clickProject = (name) => run(`[...document.querySelectorAll('#project-list .proj')].find(e => e.textContent.includes(${JSON.stringify(name)})).click()`);
    const reportFocus = (v) => { focused = v; };
    try {
      await until(() => run('!!(window.DeckApp.state.activeId && window.DeckApp.attention)'), 'app ready');
      if (mode === 'zsh') {
        const { execFileSync } = require('node:child_process');
        const bin = path.join(data, 'bin');
        const rcNames = (fs.existsSync(path.join(realHome, '.zshrc')) ? fs.readFileSync(path.join(realHome, '.zshrc'), 'utf8') : '').split('\n')
          .map((l) => /^(?:alias|export)\s+([A-Za-z_][A-Za-z0-9_]*)=/.exec(l)).filter((m) => m && m[1] !== 'PATH').map((m) => m[1]);
        const rcName = rcNames[0];
        assert.ok(rcName, 'no alias/variable name found in ~/.zshrc');
        // control: a normal terminal zsh as the app starts it, without the shim
        const ctl = execFileSync('/bin/zsh', ['-l', '-i', '-c', 'print -r -- "$PATH"; print -r -- "${ZDOTDIR-unset}"; print -r -- "$HISTFILE"'], { env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').slice(-3);
        const w = (n) => path.join(root, n);
        const probe = (id, tag) => {
          const body = [`print -r -- "$PATH" > ${w(tag + '_path')}`, `print -r -- "[\${ZDOTDIR-unset}]" > ${w(tag + '_zdotdir')}`, `print -r -- "$HISTFILE" > ${w(tag + '_hist')}`,
            `(( $+aliases[${rcName}] || $+parameters[${rcName}] || $+functions[${rcName}] )) && print yes > ${w(tag + '_rc')} || print no > ${w(tag + '_rc')}`,
            `whence -p claude > ${w(tag + '_claude')}`, `whence -p mt-browser mt-event > ${w(tag + '_tools')}`, ...(tag === 'on' ? [`[[ "$(whence -p claude)" == ${bin}/claude ]] && path=(${bin} ${fake} $path)`, `claude --version > ${w(tag + '_ver')}`, 'claude --model hand'] : []), `touch ${w(tag + '_done')}`].join('\n') + '\n';
          fs.writeFileSync(w(tag + '.zsh'), body);
          return type(id, `source ${w(tag + '.zsh')}\r`);
        };
        const rd = (n) => fs.readFileSync(w(n), 'utf8').trim();
        await until(async () => (await run("window.DeckApp.state.panes.get('pa').every(p => p.status === 'running')")), 'A running');
        await probe('a1', 'on'); await until(() => fs.existsSync(w('on_done')), 'probe on', 30000).catch(async (e) => { origLog('SCREEN>>>', (await screen('a1')).replace(/\s+/g, ' ').slice(-900)); throw e; });
        const onPath = rd('on_path').split(':');
        assert.equal(onPath[0], bin); assert.equal(rd('on_claude'), path.join(bin, 'claude'));
        assert.deepEqual(onPath, [bin, ...ctl[0].split(':').filter((x) => x !== bin)]);
        assert.equal(rd('on_zdotdir'), '[unset]'); assert.equal(ctl[1], 'unset');
        assert.equal(rd('on_hist'), ctl[2]); assert.equal(rd('on_rc'), 'yes');
        assert.match(rd('on_ver'), /^FAKE: \[--version\]$/); // wrapper -> fake claude (fake put ahead of ~/.local/bin for this probe only)
        assert.match(await screen('a1'), new RegExp('FAKE: \\[--settings\\] \\[' + path.join(data, 'claude-hooks.json').replace(/[/.]/g, '\\$&') + '\\] \\[--model\\] \\[hand\\]')); // tty: --settings added
        assert.deepEqual(rd('on_tools').split('\n').sort(), [path.join(bin, 'mt-browser'), path.join(bin, 'mt-event')].sort());
        ok(`status on, real zsh: first PATH entry and claude = <data>/bin; ZDOTDIR unset after start; HISTFILE same as control; PATH equal to control except our entry first; .zshrc item "${rcName}" present`);
        // quick start (preset typed by the app) goes through the wrapper too
        await run(`window.deck.presets.add({ label: 'FakeStart', command: ${JSON.stringify('whence -p claude > ' + w('quick_claude'))} }).then(p => { window.DeckApp.state.presets.push(p); return 0; })`);
        await run("document.getElementById('btn-menu').click()");
        await run("[...document.querySelectorAll('#menu .menu-item')].find(e => e.textContent.startsWith('FakeStart')).click()");
        await until(async () => { const L = await run("window.DeckApp.state.panes.get('pa').length"); return L === 3; }, 'quick start tile');
        await until(() => fs.existsSync(w('quick_claude')) && rd('quick_claude') !== '', 'quick start output', 30000);
        assert.equal(rd('quick_claude'), path.join(bin, 'claude'));
        ok('quick start command typed by the app resolves `claude` to the wrapper');
        // the event tools still work from this zsh
        await type('a1', `echo '{"hook_event_name":"SessionStart","session_id":"zsh-a1"}' | mt-event SessionStart\r`);
        await until(async () => !!(await entry('a1')), 'mt-event from zsh');
        const srv = http.createServer((q, r) => r.end('<h1>qa</h1>')).listen(0, '127.0.0.1');
        await new Promise((r) => srv.on('listening', r));
        await type('a1', `mt-browser open http://127.0.0.1:${srv.address().port}\r`);
        await until(() => run("[...window.DeckApp.state.panes.get('pa')].find(p => p.id === 'a1').desc.browserOpen === true"), 'mt-browser open');
        ok('mt-event and mt-browser work from the shimmed zsh');
        // status off: new terminal gets no shim
        await run("window.deck.agents.setSettings({ statusEnabled: false })");
        assert.equal(fs.existsSync(path.join(data, 'claude-hooks.json')), false);
        await clickProject('Projekt B'); await until(async () => (await run("window.DeckApp.state.panes.get('pb').every(p => p.status === 'running')")), 'B running');
        await probe('b1', 'off'); await until(() => fs.existsSync(w('off_done')), 'probe off', 30000);
        assert.equal(rd('off_zdotdir'), '[unset]');
        assert.notEqual(rd('off_claude'), path.join(bin, 'claude'));
        assert.equal(rd('off_path').split(':')[0] === bin, false);
        assert.equal(rd('off_path'), ctl[0]);

        srv.close();
        ok('status off: no ZDOTDIR shim, PATH as in a normal terminal zsh, claude not wrapped');
      } else if (mode === 'main') {
        // ---- start: switch is off, nothing is written
        const hooksFile = path.join(data, 'claude-hooks.json');
        assert.equal(fs.existsSync(hooksFile), false);
        assert.equal(fs.existsSync(path.join(data, 'bin', 'mt-event')), true);
        assert.equal(fs.existsSync(path.join(data, 'bin', 'claude')), true);
        await clickProject('Projekt B'); await until(async () => (await run("[...window.DeckApp.state.panes.get('pb')].every(p => p.status === 'running')")), 'B running');
        await clickProject('Projekt A'); await until(async () => (await run("[...window.DeckApp.state.panes.get('pa')].every(p => p.status === 'running')")), 'A running');
        await run("document.getElementById('btn-attention').click()");
        assert.equal(await run("!document.getElementById('attention-panel').hidden"), true);
        assert.match(await run("document.getElementById('attention-panel').innerText"), /Agentenstatus ist ausgeschaltet/);
        ok('panel opens, status off by default');

        // ---- wrapper while off: plain pass-through
        await type('a1', 'claude --model x\r'); await until(async () => /FAKE: \[--model\] \[x\]/.test(await screen('a1')), 'fake claude (off)');
        assert.doesNotMatch(await screen('a1'), /FAKE: \[--settings\]/);
        ok('status off: claude wrapper passes arguments through without --settings');

        // ---- switch on from the UI
        await run("document.querySelector('#attention-panel input[type=checkbox]').click()");
        await until(() => fs.existsSync(hooksFile), 'hooks file');
        const hooks = JSON.parse(fs.readFileSync(hooksFile, 'utf8')).hooks;
        assert.ok(hooks.Stop && hooks.SessionStart && hooks.Notification);
        assert.match(hooks.Stop[0].hooks[0].command, new RegExp(path.join(data, 'bin', 'mt-event').replace(/[/.]/g, '\\$&') + "' Stop$"));
        assert.equal(await run('window.deck.agents.getSettings().then(s => s.statusEnabled)'), true);
        assert.equal(sha(claudeSettings), before.claude);
        ok('switching on writes the hooks file in the data folder; ~/.claude/settings.json unchanged');
        await type('a1', 'clear; claude --model x\r'); await until(async () => /FAKE: \[--settings\] \[[^\]]*claude-hooks\.json\] \[--model\] \[x\]/.test(await screen('a1')), 'fake claude (on)');
        await type('a1', 'clear; claude --version; claude mcp --help\r'); await until(async () => (await screen('a1')).includes('[mcp] [--help]'), 'passthrough cmds');
        const s1 = await screen('a1');
        assert.match(s1, /FAKE: \[--version\]/); assert.doesNotMatch(s1.split('clear; claude --version')[1] || '', /--settings/);
        ok('status on: interactive start gets --settings; --version and mcp --help do not');

        // ---- event chains from inside tiles
        let pushes = 0;
        await run('window.__pushes = 0; window.deck.agents.onChange(() => { window.__pushes++; }); 0');
        await hook('a1', 'SessionStart', {}); await until(async () => !!(await entry('a1')), 'a1 start');
        assert.equal((await entry('a1')).nativeSessionId, 'sess-a1'); assert.equal((await entry('a1')).state, 'unknown');
        assert.equal((await dot('a1')).state, 'unknown');
        await hook('a1', 'UserPromptSubmit', {}); await waitState('a1', 'working');
        const dw = await dot('a1'); assert.equal(dw.state, 'working'); assert.equal(dw.color, 'var(--accent)');
        ok('SessionStart -> unknown with session id; prompt -> working (accent dot)');

        // visible + focused tile: Stop gives no unread entry
        reportFocus(true);
        await sleep(300);
        await hook('a1', 'Stop', {}); await waitState('a1', 'turn-complete');
        let e1 = await entry('a1'); assert.equal(e1.unread, false); assert.equal((await dot('a1')).color, 'var(--ok)');
        assert.equal(await badge(), 0);
        ok('Stop for the visible focused tile: dot green, no unread');

        // other tile in same project: unread
        await hook('a2', 'Notification', { notification_type: 'permission_prompt' }); await waitState('a2', 'needs-input');
        assert.equal((await entry('a2')).unread, true); assert.equal((await dot('a2')).color, 'var(--warn)');
        // idle_prompt ignored
        const obs = (await entry('a2')).observedAt;
        await hook('a2', 'Notification', { notification_type: 'idle_prompt' }); await sleep(900);
        assert.equal((await entry('a2')).observedAt, obs);
        // event in other project
        await clickProject('Projekt A');
        await hook('b2', 'StopFailure', { error: 'rate_limit' }); await waitState('b2', 'error');
        assert.equal((await dot('b2')).color, 'var(--err)');
        await until(async () => (await badge()) === 2, 'badge 2');
        const panelText = await run("document.getElementById('attention-panel').innerText");
        assert.match(panelText, /Projekt B · Kachel 2 · B2/); assert.match(panelText, /Fehler: Kontingent erreicht/);
        assert.match(panelText, /Projekt A · Kachel 2 · A2/); assert.match(panelText, /wartet auf dich/);
        assert.doesNotMatch(panelText, /erledigt/i);
        await shot('liste');
        ok('unread counter 2; list shows project/tile/name/state; idle_prompt ignored');

        // click the entry of the other project
        await run("[...document.querySelectorAll('#attention-panel .attn-entry')].find(e => e.dataset.terminalId === 'b2').click()");
        await until(async () => (await active()).project === 'pb', 'jump project');
        const jb = await active(); assert.equal(jb.pane, 'b2'); assert.equal(jb.focusIn, true);
        await until(async () => (await entry('b2')).unread === false, 'b2 read after focus');
        assert.equal(await badge(), 1);
        ok('click on entry of another project: project switched, right tile active and focused, marked read');

        // menu item Cmd+J
        const item = findItem(Menu.getApplicationMenu(), 'Zur nächsten Rückmeldung springen');
        assert.equal(item.accelerator, process.platform === 'darwin' ? 'Cmd+J' : 'Ctrl+J'); // seit den umbindbaren Hotkeys plattformgenau
        fireMenu('Zur nächsten Rückmeldung springen');
        await until(async () => (await active()).project === 'pa', 'cmd+j project');
        assert.equal((await active()).pane, 'a2'); assert.equal((await active()).focusIn, true);
        await until(async () => (await badge()) === 0, 'badge 0');
        ok('menu "Zur nächsten Rückmeldung springen" (Cmd+J) jumps to the newest unread tile');

        // typing answers a waiting agent
        assert.equal((await entry('a2')).state, 'needs-input');
        win.webContents.focus();
        await run("(() => { const p = [...window.DeckApp.state.panes.get('pa')].find(x => x.id === 'a2'); p.focus(); })()");
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'x' });
        win.webContents.sendInputEvent({ type: 'char', keyCode: 'x' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'x' });
        await waitState('a2', 'working', 5000);
        ok('typing in a "wartet auf dich" tile switches it to "arbeitet"');

        // duplicate / stale
        await sleep(1800);
        const p0 = await run('window.__pushes');
        await hook('a1', 'Stop', {}); await until(async () => (await run('window.__pushes')) > p0, 'first Stop pushed');
        const before1 = await run('window.__pushes');
        await hook('a1', 'Stop', {}); await sleep(1000);
        assert.equal(await run('window.__pushes'), before1, 'duplicate must not push');
        const stale = `node -e "const n=require('net').connect(process.env.MULTITERMINAL_BROWSER_SOCK,()=>n.end(JSON.stringify({token:process.env.MULTITERMINAL_BROWSER_TOKEN,cmd:'event',args:{hook_event_name:'UserPromptSubmit',at:Date.now()-30000}})+'\\\\n'))"\r`;
        await type('a1', stale); await sleep(1500);
        assert.equal((await entry('a1')).state, 'turn-complete'); assert.equal(await run('window.__pushes'), before1);
        ok('duplicate and stale events change nothing (no push, state kept)');

        // foreign token
        await type('a1', `echo '{"hook_event_name":"UserPromptSubmit"}' | MULTITERMINAL_BROWSER_TOKEN=wrong mt-event UserPromptSubmit\r`); await sleep(1500);
        assert.equal((await entry('a1')).state, 'turn-complete');
        ok('foreign token has no effect');

        // unfocused window + desktop notification
        await run("document.querySelectorAll('#attention-panel input[type=checkbox]')[1].click()");
        await until(async () => (await run('window.deck.agents.getSettings()')).desktopNotification === true, 'desktop on');
        reportFocus(false);
        await hook('a1', 'UserPromptSubmit', {}); await waitState('a1', 'working');
        await sleep(1200);
        await hook('a1', 'Stop', {}); await waitState('a1', 'turn-complete');
        await until(async () => notifyLog.length >= 1, 'notification call');
        assert.match(notifyLog[notifyLog.length - 1], /"desktop":true/);
        assert.equal((await entry('a1')).unread, true);
        const nBefore = notifyLog.length;
        reportFocus(true); await run("window.deck.agents.reportVisible('a1')"); await sleep(300);
        await sleep(1200);
        await hook('a1', 'UserPromptSubmit', {}); await waitState('a1', 'working'); await sleep(1200);
        await hook('a1', 'Stop', {}); await waitState('a1', 'turn-complete'); await sleep(600);
        assert.equal(notifyLog.length, nBefore, 'no notification for the seen tile');
        ok('desktop notification call logged for an unfocused window; none for the visible focused tile');

        // browser, hotkey, swap still work
        const srv = http.createServer((q, r) => r.end('<h1>qa</h1>')).listen(0, '127.0.0.1');
        await new Promise((r) => srv.on('listening', r));
        await type('a1', `mt-browser open http://127.0.0.1:${srv.address().port}\r`);
        await until(() => run("[...window.DeckApp.state.panes.get('pa')].find(p => p.id === 'a1').desc.browserOpen === true"), 'mt-browser open');
        srv.close();
        fireMenu('Terminal 2');
        await until(async () => (await active()).pane === 'a2', 'hotkey Terminal 2');
        const swapped = await run(`(() => { const L = window.DeckApp.state.panes.get('pa'); const [p, q] = L; const dt = new DataTransfer(); const mk = (t, el) => el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
          const d = p.el.querySelector('.attn-dot'); const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }); d.hidden = false; d.dispatchEvent(ev); const dotBlocked = ev.defaultPrevented;
          mk('dragstart', q.head); mk('dragover', p.el); mk('drop', p.el); mk('dragend', q.head);
          return { dotBlocked, order: window.DeckApp.state.panes.get('pa').map(x => x.id).join(',') }; })()`);
        assert.equal(swapped.dotBlocked, true); assert.equal(swapped.order, 'a2,a1');
        ok('mt-browser open, menu "Terminal 2" and tile swap still work; the dot starts no drag');

        // closing a tile removes it
        await run("(() => { const p = [...window.DeckApp.state.panes.get('pa')].find(x => x.id === 'a2'); p.el.querySelector('.ib.close').click(); })()");
        await until(async () => !(await entry('a2')), 'a2 removed from list');
        assert.equal(await run("[...document.querySelectorAll('#attention-panel .attn-entry')].some(e => e.dataset.terminalId === 'a2')"), false);
        ok('closed terminal disappears from the list');
        await shot('nach-schliessen');

        // switch off
        await run("document.querySelector('#attention-panel input[type=checkbox]').click()");
        await until(() => !fs.existsSync(hooksFile), 'hooks file removed');
        await type('a1', 'clear; claude --model y\r'); await until(async () => /FAKE: \[--model\] \[y\]/.test(await screen('a1')), 'fake claude (off again)');
        assert.doesNotMatch((await screen('a1')).split('claude --model y')[1] || '', /--settings/);
        ok('switching off removes the hooks file; wrapper passes through again');
      } else if (mode === 'live') {
        await run("window.deck.agents.setSettings({ statusEnabled: true })");
        await until(() => fs.existsSync(path.join(data, 'claude-hooks.json')), 'hooks file');
        await until(async () => (await run("window.DeckApp.state.panes.get('pr').every(p => p.status === 'running')")), 'tiles running');
        await run("document.getElementById('btn-attention').click()");
        await type('r1', 'claude --model haiku\r');
        await until(async () => { const e = await entry('r1'); return e && e.nativeSessionId; }, 'SessionStart', 60000);
        origLog('LIVE SessionStart arrived, state', (await entry('r1')).state);
        await sleep(7000);
        // exactly one prompt; Enter separately so the TUI takes it as a submit
        await type('r1', 'Antworte nur mit dem Wort ok. Benutze keine Werkzeuge.'); await sleep(500);
        await type('r1', '\r');
        await waitState('r1', 'working', 30000);
        origLog('LIVE working seen, dot', JSON.stringify(await dot('r1')));
        // look at the other tile, so r1 is not the visible one
        await run("(() => { const L = window.DeckApp.state.panes.get('pr'); L[1].el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); })()");
        await until(async () => (await active()).pane === 'r2', 'focus r2');
        await until(async () => { const e = await entry('r1'); return e && (e.state === 'turn-complete' || e.state === 'needs-input' || e.state === 'error'); }, 'answer or request', 120000);
        const done = await entry('r1');
        origLog('LIVE result state', done.state, 'unread', done.unread, 'badge', await badge(), 'dot', JSON.stringify(await dot('r1')));
        await shot('live');
        if (done.state === 'needs-input') { await type('r1', '\x1b'); throw new Error('Claude wollte ein Werkzeug/eine Freigabe: abgelehnt (Esc)'); }
        assert.equal(done.state, 'turn-complete'); assert.equal(done.unread, true); assert.ok(await badge() >= 1);
        origLog('LIVE terminal text', (await screen('r1')).replace(/\s+/g, ' ').slice(-300));
        ok('live: UserPromptSubmit -> working, Stop -> Antwort fertig, unread entry for the unfocused tile');
        await type('r1', '/exit'); await sleep(600); await type('r1', '\r');
        await until(async () => !(await entry('r1')), 'SessionEnd removes the entry', 30000);
        assert.equal((await dot('r1')).hidden, true);
        ok('live: /exit -> SessionEnd, display gone');
      } else {
        await run("window.deck.agents.setSettings({ statusEnabled: true })");
        const hooksFile = path.join(data, 'claude-hooks.json');
        await until(() => fs.existsSync(hooksFile), 'hooks file');
        await until(async () => (await run("window.DeckApp.state.panes.get('pr')[0].status")) === 'running', 'tile running');
        await type('r1', 'command -v claude; claude\r');
        await until(async () => { const e = await entry('r1'); return e && e.nativeSessionId; }, 'SessionStart from the real claude', 60000);
        const e = await entry('r1');
        assert.equal(e.state, 'unknown'); assert.equal(e.source, 'claude-hook:SessionStart');
        assert.equal((await dot('r1')).state, 'unknown');
        assert.match(await screen('r1'), new RegExp(path.join(data, 'bin', 'claude').replace(/[/.]/g, '\\$&')));
        await run("document.getElementById('btn-attention').click()");
        await shot('echtes-claude');
        origLog('REAL session id', e.nativeSessionId.slice(0, 8) + '...', 'label:', await run("document.getElementById('attention-panel').innerText.split('\\n').slice(0,6).join(' | ')"));
        ok('real claude: SessionStart arrives (state unknown/"bereit"), session id set');
        await sleep(7000); // let the start screen settle, else the first Ctrl-C is swallowed
        await type('r1', '/exit'); await sleep(600); await type('r1', '\r'); // slash command, no model call
        await until(async () => !(await entry('r1')), 'SessionEnd removes the entry', 20000).catch(async (err) => {
          origLog('SCREEN AFTER CTRL-C>>>', (await screen('r1')).replace(/\s+/g, ' ').slice(-700));
          throw err;
        });
        assert.equal((await dot('r1')).hidden, true);
        ok('real claude: SessionEnd removes the display');
        assert.equal(sha(claudeSettings), before.claude);
        ok('~/.claude/settings.json unchanged after the real session');
      }
      assert.equal(sha(claudeSettings), before.claude);
      assert.equal(fs.existsSync(path.join(realHome, '.codex')), before.codex);
    } catch (error) {
      failed = true; console.error(error.stack || String(error));
      try { await shot('fehler'); console.error('entries:', JSON.stringify(await entries())); } catch (_) { /* ignore */ }
    }
    try { await run('Promise.all([...window.DeckApp.state.panes.values()].flat().map(p => window.deck.terminals.kill(p.id)))'); } catch (_) { /* ignore */ }
    clearTimeout(timeout);
    origLog(JSON.stringify({ mode, passed: results.length, failed, notifications: notifyLog.length }));
    win.close();
    setTimeout(() => { fs.rmSync(root, { recursive: true, force: true }); app.exit(failed ? 1 : 0); }, 500);
  });
});
require('../src/main/main');
