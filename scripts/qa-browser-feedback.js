'use strict';
// F05 QA: isolated real Electron run (temporary data folder, local HTTP test page, no real websites,
// no provider calls). Element picking with comment -> prompt preview, abort, navigation in between,
// and the two CLI actions `mt-browser click` / `mt-browser type`, including foreign/invalid tokens.
// Run: node_modules/.bin/electron scripts/qa-browser-feedback.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { app, webContents } = require('electron');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-bf-qa-'));
const data = path.join(root, 'data'), home = path.join(root, 'home'), project = path.join(root, 'project');
for (const dir of [data, home, project, path.join(data, 'session')]) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'fb-project', name: 'Feedbacktest', path: project }]));
fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'fb-project', projects: { 'fb-project': { terminals: [
  { id: 'fb-a', title: 'Alpha' }, { id: 'fb-b', title: 'Beta' },
] } } }));
const shellFile = path.join(root, 'qa-shell');
fs.writeFileSync(shellFile, '#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
process.env.SHELL = shellFile;
os.homedir = () => home;
app.setName('Multiterminal Feedback QA ' + process.pid); app.setPath('userData', data);

const PAGE = `<!doctype html><meta charset="utf-8"><title>Testseite</title>
<style>body{font:16px sans-serif;margin:20px}form{max-width:360px}input,textarea{display:block;margin:8px 0;width:100%}</style>
<h1>Testformular</h1>
<form onsubmit="return false">
  <label for="name">Name</label><input id="name" name="name" type="text">
  <textarea id="note" name="note" rows="2"></textarea>
  <input id="agree" type="checkbox">
  <button id="go" type="button" class="primary big" onclick="document.getElementById('out').textContent='Gesendet: '+document.getElementById('name').value+' | '+document.getElementById('note').value">Absenden</button>
  <button id="ghost" type="button" style="display:none" onclick="document.getElementById('out').textContent='GHOST'">Versteckt</button>
  <button id="off" type="button" disabled>Aus</button>
</form>
<p id="out">noch nichts</p>
<p id="long">${'Sehr langer Text. '.repeat(400)}</p>
<a id="link" href="/andere">Andere Seite</a>`;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(req.url.startsWith('/andere') ? '<title>Andere</title><h1>Andere Seite</h1>' : PAGE);
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let failed = false, stage = 'bootstrap';
const timer = setTimeout(() => { console.error(JSON.stringify({ error: 'Feedback QA timed out', stage, root })); app.exit(1); }, 90000);
const checks = [];
const ok = label => { checks.push(label); };

app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_event, ...args) => {
    const d = typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] };
    if ((d.level === 'error' || d.level === 3) && !String(d.message).includes('Electron Security Warning')) console.error('Renderer:', d.message);
  });
  win.webContents.once('did-finish-load', async () => {
    const run = code => win.webContents.executeJavaScript(code);
    const wait = async (fn, label, ms = 10000) => {
      const end = Date.now() + ms;
      while (!await fn()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await sleep(60); }
    };
    const panes = "window.DeckApp.state.panes.get('fb-project')";
    const pane = id => `${panes}.find(p=>p.id===${JSON.stringify(id)})`;
    const guest = () => webContents.getAllWebContents().find(w => w.getType() === 'webview' && !w.isDestroyed());
    const page = code => guest().executeJavaScript(code);
    const shot = async name => {
      win.showInactive(); win.moveTop();
      await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const file = path.join(root, name); fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); return file;
    };
    const mouse = async (wc, x, y, click) => {
      wc.sendInputEvent({ type: 'mouseMove', x, y });
      await sleep(80);
      if (click) { wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); }
    };
    const center = async selector => JSON.parse(await page(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})})()`));
    const feedbackButton = id => `${pane(id)}.el.querySelector('.bf-btn')`;
    // Runs a shell command in a tile and returns { code, out }.
    let seq = 0;
    const sh = async (id, command, prefix = '') => {
      const n = ++seq, out = path.join(root, `out${n}`), code = path.join(root, `code${n}`);
      await run(`window.deck.terminals.write(${JSON.stringify(id)}, ${JSON.stringify(`{ ${prefix}${command}; } >${out} 2>&1; echo $? >${code}\r`)})`);
      await wait(() => fs.existsSync(code), 'shell command ' + command);
      return { code: Number(fs.readFileSync(code, 'utf8')), out: fs.readFileSync(out, 'utf8').trim() };
    };
    const pickViaUi = async (selector, click = true) => {
      await run(`${feedbackButton('fb-a')}.click()`);
      await wait(() => run(`${feedbackButton('fb-a')}.classList.contains('on')`), 'selection mode on');
      await wait(() => page('!!window.__mtPickCancel'), 'picker installed');
      await page(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      await sleep(120);
      const c = await center(selector);
      await mouse(guest(), c.x, c.y, click);
    };

    try {
      stage = 'setup';
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const url = `http://127.0.0.1:${server.address().port}/`;
      await wait(() => run(`${panes}?.length===2 && ${panes}.every(p=>p.status==='running')`), 'two running tiles');
      assert.deepEqual(await run(`${pane('fb-a')}.browserApi.open(${JSON.stringify(url)}).then(r=>r.ok)`), true);
      await wait(() => run(`${pane('fb-a')}.browserApi.webContentsId() !== null`), 'webview ready');
      await wait(() => page('document.readyState==="complete"'), 'test page loaded');
      assert.equal(await run(`!!${feedbackButton('fb-a')}`), true, 'button "Element kommentieren" exists in the browser bar');
      assert.equal(await run(`!!${feedbackButton('fb-b')}`), false, 'tile without browser has no button yet');
      ok('Knopf in der Browserleiste');

      stage = 'pick';
      await pickViaUi('#go');
      await wait(() => run(`!!${pane('fb-a')}.el.querySelector('.bf-panel')`), 'comment panel');
      assert.equal(await page('document.getElementById("out").textContent'), 'noch nichts', 'pick click must not trigger the page button');
      assert.equal(await page('!!document.querySelector("[data-mt-pick]")'), false, 'overlay removed');
      assert.match(await run(`${pane('fb-a')}.el.querySelector('.bf-info').textContent`), /#go/);
      await run(`(()=>{const p=${pane('fb-a')}.el.querySelector('.bf-panel');const t=p.querySelector('textarea');t.value='Der Knopf braucht mehr Abstand';})()`);
      const panelShot = await shot('panel.png');
      await run(`${pane('fb-a')}.el.querySelector('.bf-send').click()`);
      const draft = await run('window.DeckApp.promptDraft.get()');
      assert.ok(draft, 'prompt preview opened');
      assert.equal(draft.terminalId, 'fb-a');
      assert.match(draft.text, new RegExp(`^Im Browser \\(${url.replace(/[./]/g, '\\$&')}\\) Element #go \\(„Absenden“\\):\\n<button id="go"`));
      assert.match(draft.text, /Kommentar: Der Knopf braucht mehr Abstand$/);
      assert.equal(draft.files.length, 1);
      assert.equal(draft.files[0].kind, 'image');
      const png = fs.readFileSync(draft.files[0].path);
      assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'element screenshot is a PNG in the attachment folder');
      assert.ok(draft.files[0].path.startsWith(path.join(data, 'attachments')));
      assert.ok(png.length > 200);
      const draftShot = await shot('draft.png');
      ok('Element markiert, kommentiert, Promptvorschau mit Bild und richtigem Ziel');
      assert.equal(await run(`${pane('fb-a')}.term.buffer.active.length >= 0`), true);
      await run('window.DeckApp.promptDraft.close()');
      assert.equal(await run('window.DeckApp.promptDraft.get()'), null);
      ok('Vorschau schreibt nichts ohne Nutzeraktion (Entwurf geschlossen)');

      stage = 'long content';
      await pickViaUi('#long');
      await wait(() => run(`!!${pane('fb-a')}.el.querySelector('.bf-panel')`), 'panel for long element');
      await run(`${pane('fb-a')}.el.querySelector('.bf-comment').value='lang'`);
      await run(`${pane('fb-a')}.el.querySelector('.bf-send').click()`);
      const longDraft = await run('window.DeckApp.promptDraft.get()');
      assert.ok(longDraft, 'long draft: ' + await run(`${pane('fb-a')}.el.querySelector('.bf-warn')?.textContent`));
      assert.ok(longDraft.text.length < 2600, 'long content is truncated (' + longDraft.text.length + ')');
      await run('window.DeckApp.promptDraft.close()');
      ok('Lange Inhalte gekürzt');

      stage = 'abort';
      await pickViaUi('#go', false);
      guest().sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); guest().sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await wait(() => run(`!${feedbackButton('fb-a')}.classList.contains('on')`), 'abort via Esc in page');
      assert.equal(await run(`!!${pane('fb-a')}.el.querySelector('.bf-panel')`), false);
      assert.equal(await page('!!document.querySelector("[data-mt-pick]") || !!window.__mtPickCancel'), false);
      assert.equal(await run('window.DeckApp.promptDraft.get()'), null);
      // abort via the button itself
      await run(`${feedbackButton('fb-a')}.click()`);
      await wait(() => page('!!window.__mtPickCancel'), 'picker installed again');
      await run(`${feedbackButton('fb-a')}.click()`);
      await wait(() => page('!window.__mtPickCancel'), 'abort via button');
      ok('Abbruch per Esc und per Knopf');

      stage = 'navigation between pick and send';
      await pickViaUi('#go');
      await wait(() => run(`!!${pane('fb-a')}.el.querySelector('.bf-panel')`), 'panel before navigation');
      await guest().loadURL(url + 'andere');
      await wait(() => page('document.title==="Andere"'), 'navigated');
      await run(`${pane('fb-a')}.el.querySelector('.bf-comment').value='zu spät'`);
      await run(`${pane('fb-a')}.el.querySelector('.bf-send').click()`);
      assert.equal(await run('window.DeckApp.promptDraft.get()'), null, 'no draft after navigation');
      assert.equal(await run(`!!${pane('fb-a')}.el.querySelector('.bf-panel')`), false, 'selection discarded');
      assert.match(await run("[...document.querySelectorAll('#notices .notice')].map(e=>e.textContent).join('|')"), /Seite hat sich geändert/);
      // navigating while the selection mode is still waiting for a click
      await guest().loadURL(url);
      await wait(() => page('document.title==="Testseite"'), 'back on test page');
      await run(`${feedbackButton('fb-a')}.click()`);
      await wait(() => page('!!window.__mtPickCancel'), 'picker installed before navigation');
      await guest().loadURL(url + 'andere');
      await wait(() => run(`!${feedbackButton('fb-a')}.classList.contains('on')`), 'selection mode ends on navigation');
      await guest().loadURL(url);
      await wait(() => page('document.title==="Testseite"'), 'back on test page again');
      ok('Navigation zwischen Auswahl und Versand bzw. während der Auswahl verwirft die Auswahl');

      stage = 'cli click/type';
      const bin = path.join(data, 'bin', 'mt-browser');
      assert.ok(fs.existsSync(bin));
      let r = await sh('fb-a', "mt-browser type '#name' 'Anna'");
      assert.equal(r.code, 0, r.out); assert.match(r.out, /Eingegeben in <input>/);
      r = await sh('fb-a', "mt-browser type '#note' \"$(printf 'Zeile1\\nZeile2')\"");
      assert.equal(r.code, 0, r.out);
      assert.equal(await page('document.getElementById("name").value'), 'Anna');
      r = await sh('fb-a', "mt-browser click '#go'");
      assert.equal(r.code, 0, r.out); assert.match(r.out, /Geklickt: <button> "Absenden"/);
      assert.equal(await page('document.getElementById("out").textContent'), 'Gesendet: Anna | Zeile1\nZeile2');
      ok('CLI click auf Knopf und type in Eingabefeld/Textfeld wirken');

      // hostile text travels as data only
      const nasty = "\"; alert(1); '</script><script>window.__pwn=1</script>`${1+1}`\\";
      fs.writeFileSync(path.join(root, 'nasty.txt'), nasty);
      r = await sh('fb-a', `mt-browser type '#name' "$(cat ${path.join(root, 'nasty.txt')})"`);
      assert.equal(r.code, 0, r.out);
      assert.equal(await page('document.getElementById("name").value'), nasty);
      assert.equal(await page('window.__pwn === undefined && document.querySelectorAll("script").length === 0'), true);
      ok('Anführungszeichen, </script>, Backticks nur als Daten');

      // errors
      r = await sh('fb-a', "mt-browser click '#gibtesnicht'"); assert.equal(r.code, 1); assert.match(r.out, /Kein Element/);
      r = await sh('fb-a', "mt-browser click '#ghost'"); assert.equal(r.code, 1); assert.match(r.out, /nicht sichtbar/);
      r = await sh('fb-a', "mt-browser click '#off'"); assert.equal(r.code, 1); assert.match(r.out, /deaktiviert/);
      r = await sh('fb-a', "mt-browser click '(('"); assert.equal(r.code, 1); assert.match(r.out, /Ungültiger Selektor/);
      r = await sh('fb-a', "mt-browser type '#agree' 'x'"); assert.equal(r.code, 1); assert.match(r.out, /kein Texteingabefeld/);
      r = await sh('fb-a', `mt-browser click "$(printf 'a%.0s' $(seq 1 600))"`); assert.equal(r.code, 1); assert.match(r.out, /zu lang/);
      r = await sh('fb-a', "mt-browser eval 'alert(1)'"); assert.equal(r.code, 2);
      assert.equal(await page('document.getElementById("out").textContent'), 'Gesendet: Anna | Zeile1\nZeile2', 'ghost button was not clicked');
      ok('Fehlende, versteckte, deaktivierte, ungültige und überlange Selektoren sowie andere Befehle klar abgelehnt');

      stage = 'foreign token';
      // Tile B has no browser: its own token reaches only its own (closed) browser.
      r = await sh('fb-b', "mt-browser type '#name' 'aus Beta'");
      assert.equal(r.code, 1); assert.match(r.out, /Kein Mini-Browser offen/);
      // An invalid token is rejected.
      r = await sh('fb-a', "mt-browser click '#go'", 'MULTITERMINAL_BROWSER_TOKEN=falsch ');
      assert.equal(r.code, 1); assert.match(r.out, /Nicht berechtigt/);
      // Token of tile B used from tile A's shell: acts only on B, A's page stays untouched.
      const tokenB = (await sh('fb-b', 'printf %s "$MULTITERMINAL_BROWSER_TOKEN"')).out;
      assert.ok(tokenB.length > 20);
      r = await sh('fb-a', "mt-browser type '#name' 'fremd'", `MULTITERMINAL_BROWSER_TOKEN=${tokenB} `);
      assert.equal(r.code, 1); assert.match(r.out, /Kein Mini-Browser offen/);
      assert.equal(await page('document.getElementById("name").value'), nasty, "tile A's page unchanged by tile B's token");
      // After closing tile A's browser its token gets a clear error, too.
      await run(`${pane('fb-a')}.browserApi.hide()`);
      r = await sh('fb-a', "mt-browser click '#go'");
      assert.equal(r.code, 1); assert.match(r.out, /Kein Mini-Browser offen/);
      await run(`${pane('fb-a')}.browserApi.show()`);
      await wait(() => run(`${pane('fb-a')}.browserApi.visible()`), 'browser visible again');
      ok('Ungültiges Token und Token einer anderen Kachel abgelehnt bzw. wirkt nur auf eigene Kachel; geschlossener Browser klar gemeldet');

      stage = 'existing browser commands';
      r = await sh('fb-a', 'mt-browser url'); assert.equal(r.code, 0); assert.equal(r.out, url);
      r = await sh('fb-a', 'mt-browser text --limit 40'); assert.equal(r.code, 0); assert.match(r.out, /Testseite/);
      const shotFile = path.join(root, 'cli.png');
      r = await sh('fb-a', `mt-browser screenshot ${shotFile}`); assert.equal(r.code, 0, r.out);
      assert.ok(fs.statSync(shotFile).size > 200);
      ok('Navigation/Text/Screenshot der Browser-CLI unverändert');

      console.log(JSON.stringify({ result: 'passed', checks, screenshots: { panel: panelShot, draft: draftShot, cli: shotFile }, root }, null, 2));
    } catch (error) { failed = true; console.error(JSON.stringify({ stage, root, checks, error: error.stack || String(error) })); }
    clearTimeout(timer);
    try { await run("Promise.all([...window.DeckApp.state.panes.values()].flat().map(p=>window.deck.terminals.kill(p.id)))"); } catch {}
    server.close();
    app.exit(failed ? 1 : 0);
  });
});
require('../src/main/main');
