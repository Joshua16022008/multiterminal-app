'use strict';

// Real sidebar functions in gstack Chromium; isolated IPC fixture, no providers.
// Run: node scripts/qa-sidebar-tooltips.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-sidebar-tips-'));
const renderer = path.resolve(__dirname, '../src/renderer');
const browse = process.env.GSTACK_BROWSE || path.join(os.homedir(), '.agents/skills/gstack/browse/dist/browse');
const call = (...args) => execFileSync(browse, args, { encoding: 'utf8', timeout: 30000 }).trim();
const js = code => call('js', code);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixtureStatus = '{ isRepo: true, branch: "main", changes: 1, ahead: 7, behind: 4 }';
const appSource = fs.readFileSync(path.join(renderer, 'app.js'), 'utf8');
const sidebarFunction = appSource.slice(appSource.indexOf('  function renderSidebar()'), appSource.indexOf('  function renderHeader()'));
assert.ok(sidebarFunction.includes('D.git.line(p)'));
let html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8')
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, file) => `<style>${fs.readFileSync(path.resolve(renderer, file), 'utf8')}</style>`)
  .replace(/<script src="([^"]+)"><\/script>/g, (_, file) => file === 'app.js' ? '' : `<script>${fs.readFileSync(path.resolve(renderer, file), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`);
html = html.replace('<body>', `<body><script>window.deck = { git: { status: async () => (${fixtureStatus}), pull: async () => (${fixtureStatus}) } };</script>`);
html = html.replace('</body>', `<script>
  const D = window.DeckApp, h = D.h, $ = id => document.getElementById(id);
  const S = { projects: [{ id: 'qa', name: 'Tooltip-Test', path: '/tmp/qa' }], activeId: 'qa' };
  const panesOf = () => Array.from({ length: 4 }, () => ({ status: 'running' }));
  const startRename = () => {}, selectProject = () => {}, removeProject = () => {};
  window.qaClicks = 0; const openProjectManager = () => window.qaClicks++;
  ${sidebarFunction}
  window.qaRender = renderSidebar;
  D.git.init({ projects: () => S.projects, activeId: () => S.activeId, render: renderSidebar });
  D.git.onSelect(S.projects[0]); renderSidebar();
  window.qaTip = () => { const t = document.getElementById('sidebar-tooltip'); return t && !t.hidden ? t.textContent : null; };
</script></body>`);
const fixture = path.join(root, 'fixture.html');
fs.writeFileSync(fixture, html);
if (process.argv.includes('--fixture-only')) { console.log(fixture); process.exit(0); }

(async () => {
  const tab = call('newtab');
  try {
    call('viewport', '900x620'); call('goto', 'file://' + fixture);
    for (const [selector, expected] of [
      ['.git-ind.ahead', '7 Commits noch nicht auf GitHub'],
      ['.git-ind.changes', '1 nicht committete Änderung'],
      ['.git-ind.behind', '4 Commits auf GitHub'],
      ['.proj-count', '4 laufende Terminals'],
      ['.proj-pm', 'Projektmanager öffnen'],
      ['.git-branch', 'Branch: main'],
      ['.proj-sync', 'Mit GitHub synchronisieren'],
    ]) {
      call('hover', selector); await sleep(60);
      assert.ok(js('qaTip()').includes(expected), selector + ': ' + js('qaTip()'));
      js('qaRender(); qaRender(); qaRender()'); await sleep(80);
      assert.ok(js('qaTip()').includes(expected), 'stationary hover after redraw: ' + selector);
      assert.equal(js(`document.querySelector(${JSON.stringify(selector)}).getAttribute('title') === ''`), 'true');
    }
    js("document.querySelector('.git-ind.ahead').focus()"); await sleep(80);
    assert.ok(js('qaTip()').includes('7 Commits'), 'keyboard focus');
    call('press', 'Escape'); assert.equal(js('qaTip()'), 'null');
    call('hover', '.proj-pm');
    assert.equal(js(`(() => { const r = document.getElementById('sidebar-tooltip').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`), 'true');
    const screenshot = path.join(root, 'sidebar-tooltip.png'); call('screenshot', screenshot);
    call('click', '.proj-pm'); assert.equal(js('qaClicks'), '1'); assert.equal(js('qaTip()'), 'null');
    js("document.querySelector('.proj-count').focus()"); await sleep(60);
    js("document.querySelector('.proj-count').setAttribute('data-tooltip', 'Neue Terminalanzahl')"); await sleep(60);
    assert.ok(js('qaTip()').includes('Neue Terminalanzahl'), 'tooltip content updates');
    js("document.getElementById('project-list').replaceChildren()"); await sleep(60);
    assert.equal(js('qaTip()'), 'null', 'removed target hides');
    call('viewport', '400x350'); js('qaRender()'); call('hover', '.proj-pm');
    assert.equal(js(`(() => { const r = document.getElementById('sidebar-tooltip').getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight; })()`), 'true', 'small viewport');
    call('hover', '#ws-title'); assert.equal(js('qaTip()'), 'null', 'leaving sidebar');
    console.log(JSON.stringify({ result: 'passed', checks: ['seven real sidebar indicators', 'stationary hover across redraws', 'no native duplicates', 'keyboard and Escape', 'viewport bounds including narrow window', 'button click', 'content update and target removal', 'pointer leave'], root, screenshot, tab }));
  } finally { call('closetab'); }
})().catch(error => { console.error(error.stack, { root }); process.exitCode = 1; });
