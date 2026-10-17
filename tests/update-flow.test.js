'use strict';
// Actual PM controller -> preload -> authorized IPC -> update service. The app,
// dialogs and helper launcher are stand-ins; every filesystem path is temporary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { createPmMain } = require('../src/main/pm-main');
const { createUpdateService } = require('../src/main/update-service');

test('PM update UI reaches verified staging only after native confirmation', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mt-update-flow-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'prepared update'), target = path.join(root, 'Multiterminal.app');
  const data = path.join(root, 'data');
  const info = version => JSON.stringify({ CFBundleIdentifier: require('../src/main/edition').bundleId, CFBundleShortVersionString: version });
  for (const base of [target, path.join(input, 'Multiterminal.app')]) await fs.mkdir(path.join(base, 'Contents'), { recursive: true });
  await fs.writeFile(path.join(target, 'Contents/Info.plist'), info('0.2.0'));
  const next = info('0.3.0');
  await fs.writeFile(path.join(input, 'Multiterminal.app/Contents/Info.plist'), next);
  await fs.writeFile(path.join(input, 'CHECKSUMS.sha256'), crypto.createHash('sha256').update(next).digest('hex') + '  Multiterminal.app/Contents/Info.plist\n');
  let confirmation = 0, quits = 0, helperArgs;
  const dialogs = [];
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '0.2.0', getPath: () => path.join(target, 'Contents/MacOS/Multiterminal'), quit: () => { quits++; } },
    dialog: {
      showOpenDialog: async parent => { dialogs.push(['picker', parent]); return { canceled: false, filePaths: [input] }; },
      showMessageBox: async (parent, options) => { dialogs.push(['confirmation', parent, options]); return { response: confirmation }; },
    },
    dataDir: data, targetPath: target, platform: 'darwin',
    readPlist: async (file, key) => JSON.parse(await fs.readFile(file, 'utf8'))[key],
    launchHelper: args => { helperArgs = args; return { pid: process.pid, exitCode: null }; },
    waitReady: async ready => {
      assert.equal(quits, 0, 'quit waits for helper readiness');
      assert.equal(await fs.readFile(path.join(helperArgs[2], 'Multiterminal.app/Contents/Info.plist'), 'utf8'), next);
      assert.ok(!helperArgs[0].startsWith(target + path.sep), 'helper is copied outside installed app');
      await fs.writeFile(ready, '');
    },
  });
  const handlers = new Map(); let id = 0;
  class Window {
    constructor() { this.events = {}; this.webContents = { id: ++id, mainFrame: {}, setWindowOpenHandler() {}, on() {}, send() {} }; }
    isDestroyed() { return false; } on(name, fn) { this.events[name] = fn; } loadFile() {} destroy() {}
  }
  const main = new Window(), created = [];
  class PmWindow extends Window { constructor() { super(); created.push(this); } }
  const pmMain = createPmMain({
    electron: { BrowserWindow: PmWindow, ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} }, shell: {} },
    updateService: service, getMainWindow: () => main, getDataDir: () => data,
    getProjects: () => new Map([['qa', { id: 'qa', name: 'Update-Test', path: root }]]),
    getSessions: () => ({ load: () => ({ projects: {} }) }),
    getPtys: () => ({ snapshot: () => [] }), getWorktrees: () => ({}), getPorts: () => ({}),
    getAgentStore: () => ({ list: () => [] }), getTerminalMeta: () => new Map(),
    getAccounts: () => ({}), getBrowserBridge: () => null, getBinDir: () => null, getZdotdir: () => null,
    statusEnabled: () => false, forgetTerminal() {}, createDiffService: () => ({}),
  });
  const event = win => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  pmMain.registerIpc();
  await handlers.get('pm:openWindow')(event(main), 'qa');
  const parent = created[0]; let api;
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../src/main/pm-preload.js'), 'utf8'), {
    URLSearchParams, location: { search: '?project=qa' },
    require: () => ({ contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
      ipcRenderer: { invoke: (channel, ...args) => Promise.resolve().then(() => handlers.get(channel)(event(parent), ...args)) } }),
  });
  const elements = new Map();
  const html = await fs.readFile(path.join(__dirname, '../src/renderer/pm.html'), 'utf8');
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], {
    hidden: false, disabled: false, textContent: '', setAttribute() {}, addEventListener() {}, focus() {},
  });
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../src/renderer/pm-update.js'), 'utf8'), {
    window: { pm: api }, document: { getElementById: name => elements.get(name) },
  });
  const click = name => elements.get('pm-update-' + name).onclick();
  await click('open'); await click('select');
  assert.equal(elements.get('pm-update-version').textContent, '0.3.0');
  assert.equal(quits, 0); assert.equal(helperArgs, undefined);
  await click('install');
  assert.equal(quits, 0, 'native cancellation leaves app and helper untouched');
  assert.equal(helperArgs, undefined);
  assert.equal((await service.status()).busy, false);
  confirmation = 1;
  await click('select'); await click('install');
  assert.equal(quits, 1, 'one graceful quit request after staged readiness');
  assert.ok(helperArgs);
  assert.equal(await fs.readFile(path.join(target, 'Contents/Info.plist'), 'utf8'), info('0.2.0'), 'service never replaces running app');
  assert.equal((await service.status()).busy, true, 'armed install cannot race another PM window');
  for (const entry of dialogs) assert.equal(entry[1], parent, 'dialog is bound to requesting PM window');
  const options = dialogs.find(entry => entry[0] === 'confirmation')[2];
  assert.equal(options.defaultId, 0);
  assert.match(options.detail, /Terminals/);
  assert.match(options.message, /0\.2\.0.*0\.3\.0/);
  await pmMain.shutdown();
});
