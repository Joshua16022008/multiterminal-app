'use strict';

// Run ONLY after integrator wiring: electron scripts/qa-harness.js [packaged/main.js].
// A supervisor keeps a fake keychain in RAM across TWO real Electron processes.
// Secret seeding happens in main, never through executeJavaScript/the renderer.
// Actual keychain, installed providers, paid endpoints and the user's app stay untouched.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { app } = require('electron');
const phase = process.env.MT_HARNESS_QA_PHASE;
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mainFile = path.resolve(process.argv[2] || path.join(__dirname, '../src/main/main.js'));

function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const file = path.join(dir, item.name);
    return item.isDirectory() ? filesIn(file) : item.isFile() ? [file] : [];
  });
}
async function supervise() {
  // macOS UNIX sockets have a short path limit; the default /var/folders TMPDIR
  // can already consume it before the fixture suffix is appended.
  const root = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'mt-harness-qa-'));
  const home = path.join(root, 'home'), data = path.join(root, 'data'), repo = path.join(root, 'project');
  const bin = path.join(home, '.local/bin'), socket = path.join(root, 'keychain.sock');
  const records = path.join(root, 'records.jsonl');
  const FAKE_KEY = 'FAKE_KEY_' + crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(FAKE_KEY).digest('hex');
  const keys = new Map();
  let leaked = false;
  for (const dir of [home, data, repo, bin, path.join(data, 'session')]) fs.mkdirSync(dir, { recursive: true });
  const git = (...args) => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Harness QA'); git('config', 'user.email', 'qa@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), '# HARNESS_QA_CONTEXT\n');
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'Only the assigned local QA task.\n');
  git('add', '.'); git('commit', '-qm', 'inert QA fixture');
  fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'qa-harness', name: 'Harness QA', path: repo }]));
  fs.writeFileSync(path.join(data, 'session/session.json'), JSON.stringify({ version: 1, activeProjectId: 'qa-harness', projects: { 'qa-harness': { terminals: [] } } }));
  const recorder = path.join(root, 'recorder.js');
  fs.writeFileSync(recorder, `const fs=require('node:fs'),crypto=require('node:crypto');
const provider=process.argv[2],args=process.argv.slice(3);
if(args.includes('--version')){console.log(provider+' QA 1.0.0');process.exit(0)}
if(args.includes('--help')){console.log(provider==='kimi'?'Kimi Code CLI usage':provider+' QA CLI usage');process.exit(0)}
if(args.includes('models')){console.log('qa/model');process.exit(0)}
const key=process.env.ANTHROPIC_AUTH_TOKEN||process.env.MT_ENDPOINT_KEY||'';
fs.appendFileSync(${JSON.stringify(records)},JSON.stringify({provider,args,cwd:process.cwd(),keyHash:key?crypto.createHash('sha256').update(key).digest('hex'):null})+'\\n');
console.log('INERT_HARNESS_READY');process.stdin.resume();setInterval(()=>{},10000);
`);
  for (const name of ['claude', 'codex', 'kimi', 'opencode', 'dsh']) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(recorder) + ' ' + quote(name) + ' "$@"\n', { mode: 0o755 });
  }
  // Fake security gets its response through a private local socket. No key in this file.
  const securityClient = path.join(root, 'security-client.js');
  fs.writeFileSync(securityClient, `const net=require('node:net');const s=net.createConnection(${JSON.stringify(socket)});
s.on('connect',()=>s.write(JSON.stringify({mode:'lookup',argv:process.argv.slice(2)})+'\\n'));
let body='';s.on('data',data=>body+=data);s.on('end',()=>{const r=JSON.parse(body);if(r.status===0)process.stdout.write(r.stdout||'');process.exit(r.status)});
s.on('error',()=>process.exit(1));
`);
  fs.writeFileSync(path.join(bin, 'security'), '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ' + quote(process.execPath) + ' ' + quote(securityClient) + ' "$@"\n', { mode: 0o755 });
  const qaShell = path.join(root, 'qa-shell');
  fs.writeFileSync(qaShell, '#!/bin/sh\nexport PATH=' + quote(bin + ':/usr/bin:/bin:/usr/sbin:/sbin') + '\nexec /bin/bash --noprofile --norc -i\n', { mode: 0o755 });
  // Detection intentionally uses the approved /bin/zsh -lc path. It must see the
  // fixture PATH and never load the user's startup files, even with ZDOTDIR set.
  const startup = 'export PATH=' + quote(bin + ':/usr/bin:/bin:/usr/sbin:/sbin') + '\n';
  fs.writeFileSync(path.join(home, '.zshenv'), startup);
  fs.writeFileSync(path.join(home, '.zprofile'), startup);
  const server = net.createServer(connection => {
    let text = '';
    connection.on('data', chunk => {
      text += chunk;
      if (!text.includes('\n')) return;
      try {
        const request = JSON.parse(text.slice(0, text.indexOf('\n'))), argv = request.argv || [];
        const account = argv[argv.indexOf('-a') + 1];
        let result;
        if (request.mode === 'seed') { keys.set(request.account, FAKE_KEY); result = { status: 0 }; }
        else if (argv[0] === '-i') {
          assert.equal(argv.some(value => value.includes(FAKE_KEY)), false, 'secret in argv');
          const tokens = [...String(request.input).matchAll(/"((?:\\.|[^"\\])*)"/g)].map(match => match[1].replace(/\\([\\"])/g, '$1'));
          assert.equal(tokens[0], 'add-generic-password');
          keys.set(tokens[tokens.indexOf('-a') + 1], tokens[tokens.indexOf('-w') + 1]); result = { status: 0 };
        } else if (argv[0] === 'delete-generic-password') { result = { status: keys.delete(account) ? 0 : 44 }; }
        else result = keys.has(account) ? { status: 0, ...(request.mode === 'lookup' ? { stdout: keys.get(account) } : {}) } : { status: 44 };
        connection.end(JSON.stringify(result));
      } catch (_) { connection.end(JSON.stringify({ status: 1 })); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  fs.chmodSync(socket, 0o600);
  const scan = () => {
    for (const file of filesIn(root)) assert.equal(fs.readFileSync(file).includes(Buffer.from(FAKE_KEY)), false, 'Secret persisted in fixture: ' + path.relative(root, file));
    assert.equal(leaked, false, 'Secret leaked to child output');
  };
  const child = step => new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, [__filename, mainFile], {
      env: { ...process.env, MT_HARNESS_QA_PHASE: step, MT_HARNESS_QA_ROOT: root, MT_HARNESS_QA_HASH: hash }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => { processChild.kill('SIGKILL'); reject(new Error('Electron phase timeout: ' + step)); }, 120000);
    // Buffer per stream so a split write cannot bypass the secret check.
    const output = [];
    for (const stream of [processChild.stdout, processChild.stderr]) stream.on('data', data => output.push(data));
    processChild.once('error', error => { clearTimeout(timeout); reject(error); });
    processChild.once('exit', code => {
      clearTimeout(timeout);
      const text = Buffer.concat(output).toString('utf8');
      if (text.includes(FAKE_KEY)) leaked = true;
      process.stdout.write(text.replaceAll(FAKE_KEY, '[redacted]'));
      if (code !== 0) reject(new Error('Electron phase failed: ' + step + ' (exit ' + code + ')')); else resolve();
    });
  });
  try {
    await child('initial'); scan();
    await child('restart'); scan();
    console.log(JSON.stringify({ result: 'passed', root, nativeProcesses: 2, screenshot: 'harness-settings.png' }));
    server.close(); app.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ result: 'failed', root, error: String(error.message).replaceAll(FAKE_KEY, '[redacted]') }));
    server.close(); app.exit(1);
  }
}

function runPhase() {
  const root = process.env.MT_HARNESS_QA_ROOT, home = path.join(root, 'home'), data = path.join(root, 'data');
  const bin = path.join(home, '.local/bin'), socket = path.join(root, 'keychain.sock');
  const expectedHash = process.env.MT_HARNESS_QA_HASH;
  const records = () => fs.existsSync(path.join(root, 'records.jsonl')) ? fs.readFileSync(path.join(root, 'records.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  const rpc = request => new Promise((resolve, reject) => {
    const connection = net.createConnection(socket); let body = '';
    connection.on('connect', () => connection.write(JSON.stringify(request) + '\n'));
    connection.on('data', chunk => { body += chunk; });
    connection.on('end', () => { try { resolve(JSON.parse(body)); } catch (_) { reject(new Error('Fake keychain protocol')); } });
    connection.on('error', () => reject(new Error('Fake keychain socket unavailable')));
  });
  // Inject only the narrow keychain boundary before the production main module loads.
  const keychain = require(path.join(path.dirname(mainFile), 'keychain.js')), original = keychain.createKeychain;
  keychain.createKeychain = options => {
    return original({ ...options, run: (_file, argv, opts = {}) => rpc({ mode: 'run', argv, input: opts.input }) });
  };
  // Retain the real lookup expression through ALL production validation. Only
  // the final QA command boundary substitutes the executable; no product escape
  // hatch and no chance of falling through to the actual macOS keychain.
  const harnessLaunch = require(path.join(path.dirname(mainFile), 'harness-launch.js'));
  const createHarnessLaunch = harnessLaunch.createHarnessLaunch;
  harnessLaunch.createHarnessLaunch = options => {
    const instance = createHarnessLaunch(options), build = instance.build;
    instance.build = async request => {
      const result = await build(request);
      const command = result.command.replace(/\$\(\/usr\/bin\/security find-generic-password -s 'de\.multiterminal\.endpoint' -a '([A-Za-z0-9][A-Za-z0-9_-]{0,63})' -w\)/g,
        (_match, account) => '$(' + quote(path.join(bin, 'security')) + " find-generic-password -s 'de.multiterminal.endpoint' -a '" + account + "' -w)");
      assert.equal(command.includes('/usr/bin/security'), false, 'Unmocked keychain lookup at QA process boundary');
      return { ...result, command };
    };
    return instance;
  };
  os.homedir = () => home;
  process.env.HOME = home; process.env.ZDOTDIR = home;
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  delete process.env.ANTHROPIC_AUTH_TOKEN; delete process.env.ANTHROPIC_API_KEY;
  delete process.env.MT_ENDPOINT_KEY; delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CODEX_HOME;
  process.env.SHELL = path.join(root, 'qa-shell'); process.env.PATH = bin + ':/usr/bin:/bin:/usr/sbin:/sbin';
  app.setName('Multiterminal Harness QA ' + process.pid); app.setPath('userData', data);
  let stage = 'bootstrap';
  app.on('browser-window-created', (_event, win) => {
    win.webContents.setBackgroundThrottling(false);
    win.webContents.once('did-finish-load', async () => {
      const run = code => win.webContents.executeJavaScript(code);
      const wait = async (check, label) => {
        const until = Date.now() + 15000;
        while (!await check()) { if (Date.now() > until) throw new Error('Timeout: ' + label); await sleep(80); }
      };
      const clickText = (selector, label) => run(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(label)});if(!el)throw Error('Missing action: '+${JSON.stringify(label)});el.click()})()`);
      const set = (id, value) => run(`(()=>{const el=document.getElementById(${JSON.stringify(id)});if(!el)throw Error('Missing field');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`);
      const menu = async label => {
        await run("if(!document.getElementById('toolbar-options').getClientRects().length)document.getElementById('btn-toolbar').click();document.getElementById('btn-menu').click()");
        await run(`(()=>{const row=[...document.querySelectorAll('#menu .menu-item')].find(el=>(el.querySelector('.grow')?.textContent.trim()||el.textContent.trim())===${JSON.stringify(label)});if(!row)throw Error('Missing quickstart');row.click()})()`);
      };
      let failed = false;
      try {
        await wait(() => run('window.DeckApp?.state?.activeId === "qa-harness"'), 'app ready');
        assert.equal(await run('!!window.deck.harness && !!window.deck.endpoints && !!window.DeckHarnessPanel'), true, 'Harness integration missing');
        if (phase === 'initial') {
          await run('window.deck.memory.setSettings({enabled:false})');
          stage = 'legacy direct starts';
          for (const [provider, label] of [['claude', 'Claude Code'], ['codex', 'Codex'], ['kimi', 'Kimi Code']]) {
            await menu(label); await wait(() => records().some(record => record.provider === provider), provider);
            const record = records().find(item => item.provider === provider);
            assert.deepEqual(record.args, provider === 'codex' ? ['--dangerously-bypass-approvals-and-sandbox'] : []);
            assert.equal(record.keyHash, null);
          }
          stage = 'endpoint editor';
          await run("document.getElementById('btn-settings').click()");
          await clickText('.settings-nav button', 'Harnesses & Modelle');
          await wait(() => run("!!document.querySelector('[data-harness-id=claude]')"), 'catalog');
          await clickText('.harness-panel button', 'Endpunkt hinzufügen');
          await set('harness-endpoint-label', 'QA DeepSeek'); await set('harness-endpoint-url', 'https://qa.example.invalid/anthropic');
          await set('harness-endpoint-model', 'qa-model');
          await clickText('.harness-panel button', 'Endpunkt speichern');
          await wait(() => run("!document.getElementById('harness-endpoint-secret')"), 'endpoint saved');
          const endpoint = (await run('window.deck.endpoints.list()')).find(item => item.label === 'QA DeepSeek');
          assert.ok(endpoint); assert.equal('secret' in endpoint, false);
          // Main-only seed. Actual saved secrets are never read back into renderer.
          await rpc({ mode: 'seed', account: endpoint.id });
          await clickText('.harness-panel button', 'Katalog neu laden');
          await wait(() => run("document.querySelector('.harness-panel').textContent.includes('Schlüssel gespeichert')"), 'key status');
          await set('harness-endpoint-claude', endpoint.id);
          await clickText('[data-harness-id=claude] button', 'Als Schnellstart anlegen');
          await wait(() => run("window.DeckApp.state.presets.some(p=>p.harnessId==='claude' && p.endpointId)"), 'quickstart integrated');
          const preset = await run("window.DeckApp.state.presets.find(p=>p.harnessId==='claude' && p.endpointId)");
          win.showInactive();
          fs.writeFileSync(path.join(root, 'harness-settings.png'), (await win.webContents.capturePage()).toPNG());
          await clickText('#settings-panel button', 'Schließen'); await menu(preset.label);
          await wait(() => records().some(item => item.keyHash === expectedHash), 'child env receives key');
          const launched = records().find(item => item.keyHash === expectedHash);
          assert.ok(launched.args.includes('qa-model'));
          stage = 'opencode context start';
          await menu('Agent mit Kontext starten…');
          await wait(() => run("document.getElementById('agent-launch-dialog').open"), 'context dialog');
          await set('agent-launch-provider', 'opencode'); await set('agent-launch-folder', 'project');
          await set('agent-launch-task', 'Inspect the inert QA fixture');
          await run("document.getElementById('agent-launch-prepare').click()");
          await wait(() => run("!!document.getElementById('agent-launch-context')?.getClientRects().length"), 'context preview');
          await run("document.getElementById('agent-launch-start').click()");
          await wait(() => records().some(item => item.provider === 'opencode'), 'opencode context CLI');
          assert.ok(records().find(item => item.provider === 'opencode').args.some(value => value.includes('launch-context')));
        } else {
          stage = 'real process restart and resume';
          await wait(() => run("[...window.DeckApp.state.panes.values()].flat().some(p=>p.desc.launch?.endpointId)"), 'restored launch');
          const before = records().filter(item => item.keyHash === expectedHash).length;
          await run("(()=>{const pane=[...window.DeckApp.state.panes.values()].flat().find(p=>p.desc.launch?.endpointId);const button=pane.el.querySelector('.btn-resume');if(!button || button.hidden)throw Error('Missing resume action');button.click()})()");
          await wait(() => records().filter(item => item.keyHash === expectedHash).length > before, 'resumed endpoint CLI');
        }
        stage = 'persisted session and renderer scan';
        await run("window.deck.session.save({version:1,activeProjectId:'qa-harness',projects:{'qa-harness':{terminals:window.DeckApp.state.panes.get('qa-harness').map(p=>({...p.desc}))}}})");
        const saved = JSON.parse(fs.readFileSync(path.join(data, 'session/session.json'), 'utf8'));
        assert.ok(saved.projects['qa-harness'].terminals.some(item => item.launch?.endpointId));
        const rendererText = await run("document.body.textContent + JSON.stringify([...window.DeckApp.state.panes.values()].flat().map(p=>({desc:p.desc,scroll:p.serialize()})))");
        assert.equal(rendererText.includes('FAKE_KEY_'), false, 'secret sentinel reached renderer');
        assert.equal(records().some(item => item.args.some(value => value.includes('FAKE_KEY_'))), false);
        console.log(JSON.stringify({ phase, result: 'passed', stage }));
      } catch (error) {
        failed = true;
        // Never print a value returned by the renderer/IPC or a secret-bearing assertion diff.
        console.error(JSON.stringify({ phase, result: 'failed', stage, error: String(error.message).slice(0, 500) }));
      }
      await run('Promise.all([...window.DeckApp.state.panes.values()].flat().map(p=>window.deck.terminals.kill(p.id)))').catch(() => {});
      app.exit(failed ? 1 : 0);
    });
  });
  require(mainFile);
}

if (phase) runPhase(); else supervise().catch(() => { console.error('Harness QA supervisor failed before launch.'); app.exit(1); });
