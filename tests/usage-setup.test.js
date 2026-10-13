'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUsageSetup, BACKUP_SUFFIX } = require('../src/main/usage-setup');

function setup(content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-usagesetup-'));
  const settingsPath = path.join(root, 'claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  if (content !== undefined) fs.writeFileSync(settingsPath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  const make = (scriptPath = '/data dir/usage-statusline.js') => createUsageSetup({ settingsPath, execPath: '/App/Electron', scriptPath });
  return { root, settingsPath, setup: make(), make };
}

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

test('status covers all four states', () => {
  assert.strictEqual(setup().setup.status().state, 'aus');
  assert.strictEqual(setup({ theme: 'dark' }).setup.status().state, 'aus');
  assert.strictEqual(setup({ statusLine: { type: 'command', command: 'echo hi' } }).setup.status().state, 'fremd');
  const s = setup({});
  s.setup.enable();
  assert.strictEqual(s.setup.status().state, 'aktiv');
  assert.strictEqual(s.make('/anderswo/usage-statusline.js').status().state, 'veraltet');
});

test('enable keeps other keys, formatting and makes a backup', () => {
  const original = { permissions: { allow: ['Bash(ls)'] }, theme: 'dark' };
  const s = setup(original);
  s.setup.enable();
  const text = fs.readFileSync(s.settingsPath, 'utf8');
  const data = JSON.parse(text);
  assert.deepStrictEqual(data.permissions, original.permissions);
  assert.strictEqual(data.theme, 'dark');
  assert.strictEqual(data.statusLine.type, 'command');
  assert.match(data.statusLine.command, /ELECTRON_RUN_AS_NODE=1 '\/App\/Electron' '\/data dir\/usage-statusline\.js'/);
  assert.ok(text.includes('\n  "theme"'));
  assert.deepStrictEqual(read(s.settingsPath + BACKUP_SUFFIX), original);
  // A second run keeps the first backup.
  s.setup.disable();
  s.setup.enable();
  assert.deepStrictEqual(read(s.settingsPath + BACKUP_SUFFIX), original);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(s.settingsPath)).sort(), ['settings.json', 'settings.json' + BACKUP_SUFFIX]);
});

test('enable creates a missing file', () => {
  const s = setup();
  s.setup.enable();
  assert.strictEqual(read(s.settingsPath).statusLine.type, 'command');
  assert.ok(!fs.existsSync(s.settingsPath + BACKUP_SUFFIX));
});

test('enable replaces an outdated entry of ours', () => {
  const s = setup({});
  s.make('/alt/usage-statusline.js').enable();
  s.setup.enable();
  assert.strictEqual(s.setup.status().state, 'aktiv');
});

test('broken JSON is never written', () => {
  const s = setup('{kaputt');
  assert.throws(() => s.setup.enable(), /kein gültiges JSON/);
  assert.throws(() => s.setup.disable(), /kein gültiges JSON/);
  assert.strictEqual(fs.readFileSync(s.settingsPath, 'utf8'), '{kaputt');
  assert.ok(!fs.existsSync(s.settingsPath + BACKUP_SUFFIX));
  assert.strictEqual(s.setup.status().state, 'aus');
});

test('a foreign status line is not overwritten or removed', () => {
  const content = { statusLine: { type: 'command', command: 'my-line.sh' }, a: 1 };
  const s = setup(content);
  assert.throws(() => s.setup.enable(), /eigene Statuszeile/);
  assert.throws(() => s.setup.disable(), /nicht von dieser App/);
  assert.deepStrictEqual(read(s.settingsPath), content);
});

test('disable removes only our entry', () => {
  const s = setup({ a: 1 });
  s.setup.enable();
  assert.deepStrictEqual(s.setup.disable(), { state: 'aus' });
  assert.deepStrictEqual(read(s.settingsPath), { a: 1 });
  assert.deepStrictEqual(s.setup.disable(), { state: 'aus' });
});

test('a symlinked settings file stays a symlink', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-usagesetup-'));
  const real = path.join(root, 'real', 'settings.json');
  const link = path.join(root, 'claude', 'settings.json');
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.writeFileSync(real, '{"a":1}');
  fs.symlinkSync(real, link);
  const u = createUsageSetup({ settingsPath: link, execPath: '/E', scriptPath: '/s/usage-statusline.js' });
  u.enable();
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.strictEqual(read(real).a, 1);
  assert.strictEqual(read(real).statusLine.type, 'command');
  u.disable();
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.deepStrictEqual(read(real), { a: 1 });
});
