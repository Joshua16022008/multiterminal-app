'use strict';
// Run with the project's Electron: isolated home/data, real renderer, preload and IPC.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, Menu } = require('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multiterminal-settings-qa-'));
const home = path.join(root, 'home');
const data = path.join(root, 'data');
fs.mkdirSync(data, { recursive: true });
function fixture(relative, text) {
  const file = path.join(home, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
fixture('.claude/skills/qa-skill/SKILL.md', '# QA Skill\n<script>window.qaInjected = true</script>');
fixture('.claude/CLAUDE.md', '# Native Claude instructions');
fixture('.claude/settings.json', JSON.stringify({ enabledPlugins: { 'qa-plugin@local': true } }));
fixture('.claude/plugins/cache/local/qa-plugin/1/README.md', '# QA plugin');
fixture('.claude/plugins/installed_plugins.json', JSON.stringify({ plugins: {
  'qa-plugin@local': [{ installPath: path.join(home, '.claude/plugins/cache/local/qa-plugin/1') }],
} }));
fixture('.codex/skills/codex-skill/SKILL.md', '# Codex Skill');
fixture('.codex/AGENTS.md', '# Native Codex instructions');
fixture('.kimi-code/skills/kimi-skill/SKILL.md', '# Kimi Skill');
os.homedir = () => home;
app.setName('Multiterminal Settings QA ' + process.pid);
app.setPath('userData', data);
const timeout = setTimeout(() => { console.error('Settings QA timed out'); app.exit(1); }, 45000);
let failed = false;
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3 && !message.includes('Electron Security Warning')) console.error('Renderer:', message);
  });
  win.webContents.once('did-finish-load', async () => {
    const run = code => win.webContents.executeJavaScript(code);
    const wait = async expression => {
      const started = Date.now();
      while (!await run(expression)) {
        if (Date.now() - started > 7000) throw new Error('UI condition timed out: ' + expression);
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    };
    const clickText = async (selector, text) => run(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if(!el) throw new Error('Button missing: ' + ${JSON.stringify(text)}); el.click(); })()`);
    const edit = async text => run(`(() => { const e = document.querySelector('.settings-editor'); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    try {
      await wait('!!window.DeckApp.settingsPanel');
      await run("document.getElementById('btn-settings').click()");
      await wait("!!document.querySelector('.settings-editor')");
      assert.equal(await run("document.getElementById('settings-panel').hidden"), false);
      assert.equal(await run("document.getElementById('sidebar').inert"), false);
      assert.equal(await run("document.getElementById('project-list').inert"), true);
      assert.equal(await run("document.querySelector('.side-head').inert"), true);
      assert.equal(await run("document.getElementById('btn-settings').closest('[inert]') === null"), true);
      assert.deepEqual(await run("[...document.querySelectorAll('.settings-provider')].map(e=>e.textContent)"), ['Claude Code', 'Codex', 'Kimi']);
      await edit('# Claude Ziele\nNur Claude');
      await clickText('#settings-panel button', 'Profil speichern');
      await wait("document.querySelector('.settings-message')?.textContent === 'Profil gespeichert.'");
      assert.equal(fs.readFileSync(path.join(data, 'settings/claude/profile.md'), 'utf8'), '# Claude Ziele\nNur Claude');
      await clickText('.settings-provider', 'Codex');
      await wait("document.querySelector('.settings-editor')?.getAttribute('aria-label')?.startsWith('Codex')");
      assert.equal(await run("document.querySelector('.settings-editor').value"), '');
      await edit('# Codex Ziele\nNur Codex');
      await clickText('#settings-panel button', 'Profil speichern');
      await wait("document.querySelector('.settings-message')?.textContent === 'Profil gespeichert.'");
      assert.equal(fs.readFileSync(path.join(data, 'settings/codex/profile.md'), 'utf8'), '# Codex Ziele\nNur Codex');
      await clickText('.settings-provider', 'Kimi');
      await wait("document.querySelector('.settings-editor')?.getAttribute('aria-label')?.startsWith('Kimi')");
      await edit('# Kimi Entwurf');
      await run('window.confirm = () => false; void 0');
      await clickText('.settings-provider', 'Claude Code');
      assert.equal(await run("document.querySelector('.settings-provider.active').textContent"), 'Kimi');
      await run('window.confirm = () => true; void 0');
      await clickText('.settings-provider', 'Claude Code');
      await clickText('.settings-provider', 'Kimi');
      assert.equal(await run("document.querySelector('.settings-editor').value"), '# Kimi Entwurf');
      await clickText('#settings-panel button', 'Profil speichern');
      await wait("document.querySelector('.settings-message')?.textContent === 'Profil gespeichert.'");
      await clickText('.settings-tab', 'Skills');
      await wait("document.querySelector('.settings-resource-list')?.textContent.includes('kimi-skill')");
      assert.equal(await run("document.querySelector('.settings-resource-list').textContent.includes('codex-skill')"), false);
      await clickText('.settings-provider', 'Claude Code');
      await wait("document.querySelector('.settings-resource-list')?.textContent.includes('qa-skill')");
      await clickText('.settings-resource button', 'Ansehen');
      await wait("!!document.querySelector('.settings-source')");
      assert.equal(await run('window.qaInjected === undefined'), true);
      const saved = '# Claude Ziele\nExtern geändert';
      fs.writeFileSync(path.join(data, 'settings/claude/profile.md'), saved);
      await clickText('.settings-tab', 'Profil');
      await edit('# Lokaler Konflikt');
      await clickText('#settings-panel button', 'Profil speichern');
      await wait("document.querySelector('.settings-error')?.textContent.includes('inzwischen geändert')");
      assert.equal(fs.readFileSync(path.join(data, 'settings/claude/profile.md'), 'utf8'), saved);
      await clickText('#settings-panel button', 'Gespeicherten Stand laden');
      await wait("document.querySelector('.settings-editor')?.value.includes('Extern geändert')");
      await clickText('.settings-tab', 'Plugins');
      await wait("document.querySelector('.settings-resource-list')?.textContent.includes('qa-plugin@local')");
      assert.equal(await run("document.querySelector('.settings-resource-list').textContent.includes('Aktiviert')"), true);
      await clickText('.settings-provider', 'Codex');
      await clickText('.settings-tab', 'Kontingente');
      await wait("!!document.querySelector('.settings-quota')");
      assert.equal(await run("document.querySelector('.settings-quota').textContent.includes('Standard')"), true);
      await clickText('.settings-provider', 'Kimi');
      assert.equal(await run("document.getElementById('settings-content').textContent.includes('keine lokale Quelle für Kontingente')"), true);
      await clickText('.settings-provider', 'Claude Code');
      await clickText('.settings-tab', 'Profil');
      await wait("document.querySelector('.settings-editor')?.value.includes('Extern geändert') && document.querySelector('.settings-provider.active')?.textContent === 'Claude Code'");
      await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))');
      fs.writeFileSync(path.join(root, 'settings.png'), (await win.webContents.capturePage()).toPNG());
      await clickText('#settings-panel button', 'Schließen');
      assert.equal(await run("document.getElementById('settings-panel').hidden"), true);
      assert.equal(await run("document.getElementById('sidebar').inert"), false);
      assert.equal(await run("document.getElementById('project-list').inert"), false);
      assert.equal(await run("document.querySelector('.side-head').inert"), false);
      const item = Menu.getApplicationMenu().items[0].submenu.items.find(i => i.label === 'Einstellungen…');
      assert.ok(item); item.click();
      await wait("!document.getElementById('settings-panel').hidden");
      assert.ok(!fs.existsSync(path.join(data, 'settings/common')));
      console.log(JSON.stringify({ result: 'passed', checks: ['real renderer/preload/IPC', 'three isolated profiles', 'save', 'dirty navigation', 'provider inventory separation', 'safe preview', 'conflict and reload', 'plugin activation evidence', 'quotas', 'modal focus boundary', 'settings menu'], screenshot: path.join(root, 'settings.png'), dataDir: data }));
    } catch (err) { failed = true; console.error(err.stack || String(err)); }
    clearTimeout(timeout);
    app.exit(failed ? 1 : 0);
  });
});
require(process.argv[2] ? path.resolve(process.argv[2]) : '../src/main/main');
