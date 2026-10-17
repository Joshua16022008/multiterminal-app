'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createUpdateService, validatePackage } = require('../src/main/update-service');
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mt-update-service-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'input'), target = path.join(root, 'Multiterminal.app');
  await fs.mkdir(path.join(folder, 'Multiterminal.app', 'Contents'), { recursive: true });
  await fs.mkdir(path.join(target, 'Contents'), { recursive: true });
  await fs.writeFile(path.join(folder, 'Multiterminal.app', 'Contents', 'Info.plist'), 'new');
  await fs.writeFile(path.join(target, 'Contents', 'Info.plist'), 'old');
  const hash = crypto.createHash('sha256').update('new').digest('hex');
  await fs.writeFile(path.join(folder, 'CHECKSUMS.sha256'), `${hash}  Multiterminal.app/Contents/Info.plist\n`);
  let quits = 0, confirmation = { response: 1 };
  const windows = [];
  const options = {
    platform: 'darwin', targetPath: target, dataDir: path.join(root, 'data'),
    app: { isPackaged: true, getPath: () => path.join(target, 'Contents', 'MacOS', 'Multiterminal'), getVersion: () => '0.2.0', quit: () => quits++ },
    dialog: { showOpenDialog: async parent => { windows.push(parent); return { canceled: false, filePaths: [folder] }; }, showMessageBox: async parent => { windows.push(parent); return confirmation; } },
    readPlist: async (_, key) => key === 'CFBundleIdentifier' ? require('../src/main/edition').bundleId : '0.2.0',
    copyBundle: (a, b) => fs.cp(a, b, { recursive: true, verbatimSymlinks: true }),
    launchHelper: () => ({ pid: 123, exitCode: null }), waitReady: async () => {}
  };
  return { root, folder, target, options, windows, quits: () => quits, cancel: () => { confirmation = { response: 0 }; } };
}
test('valid complete package allows internal framework-style links', async t => {
  const f = await fixture(t);
  await fs.symlink('Contents', path.join(f.folder, 'Multiterminal.app', 'Alias'));
  const value = await validatePackage(f.folder, f.target, f.options.readPlist);
  assert.equal(value.fileCount, 1);
});
for (const kind of ['checksum', 'traversal', 'unlisted', 'missing', 'escape', 'duplicate', 'identity']) {
  test(`rejects ${kind} package without quitting`, async t => {
    const f = await fixture(t), manifest = path.join(f.folder, 'CHECKSUMS.sha256');
    if (kind === 'checksum') await fs.writeFile(path.join(f.folder, 'Multiterminal.app', 'Contents', 'Info.plist'), 'tampered');
    if (kind === 'traversal') await fs.appendFile(manifest, `${'a'.repeat(64)}  Multiterminal.app/../outside\n`);
    if (kind === 'unlisted') await fs.writeFile(path.join(f.folder, 'Multiterminal.app', 'extra'), 'extra');
    if (kind === 'missing') await fs.appendFile(manifest, `${'a'.repeat(64)}  Multiterminal.app/missing\n`);
    if (kind === 'escape') await fs.symlink(f.target, path.join(f.folder, 'Multiterminal.app', 'outside'));
    if (kind === 'duplicate') await fs.appendFile(manifest, await fs.readFile(manifest));
    if (kind === 'identity') f.options.readPlist = async () => 'other.app';
    assert.equal((await createUpdateService(f.options).select()).ok, false);
    assert.equal(f.quits(), 0);
  });
}
test('picker and native confirmation are parented; cancellation consumes token and preserves app', async t => {
  const f = await fixture(t); f.cancel();
  const service = createUpdateService(f.options), parent = {};
  const selected = await service.select(parent);
  assert.equal(selected.ok, true);
  assert.equal((await service.install(selected.token, parent)).cancelled, true);
  assert.deepEqual(f.windows, [parent, parent]);
  assert.equal((await service.install(selected.token)).ok, false);
  assert.equal(f.quits(), 0);
});
test('picker cancellation and source development are unsupported without quitting', async t => {
  const f = await fixture(t);
  f.options.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  assert.equal((await createUpdateService(f.options).select()).cancelled, true);
  f.options.app.isPackaged = false;
  assert.equal((await createUpdateService(f.options).status()).supported, false);
  assert.equal((await createUpdateService(f.options).select()).ok, false);
});
test('source mutation between selection and install is rejected', async t => {
  const f = await fixture(t), service = createUpdateService(f.options), selected = await service.select();
  await fs.writeFile(path.join(f.folder, 'Multiterminal.app', 'Contents', 'Info.plist'), 'tampered');
  assert.equal((await service.install(selected.token)).ok, false);
  assert.equal(f.quits(), 0);
});
test('helper readiness failure never quits or arms installation', async t => {
  const f = await fixture(t);
  f.options.waitReady = async () => { throw new Error('not ready'); };
  const service = createUpdateService(f.options), selected = await service.select();
  assert.equal((await service.install(selected.token)).error, 'not ready');
  assert.equal(f.quits(), 0);
  assert.equal((await fs.readdir(f.root)).some(name => name.startsWith('.multiterminal-update-')), false);
  assert.equal((await service.status()).lastResult.state, 'start_failed');
});
test('staging is revalidated before ready/quit and successful install stays serialized', async t => {
  const f = await fixture(t); let release;
  f.options.waitReady = () => new Promise(resolve => { release = resolve; });
  const service = createUpdateService(f.options), selected = await service.select();
  const installing = service.install(selected.token);
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.quits(), 0);
  assert.equal((await service.status()).busy, true);
  assert.equal((await service.install(selected.token)).ok, false);
  release();
  assert.deepEqual(await installing, { ok: true, started: true });
  assert.equal(f.quits(), 1);
  assert.equal((await service.status()).busy, true);
});
test('corrupted staged copy is rejected before helper spawn', async t => {
  const f = await fixture(t); let launched = false;
  f.options.copyBundle = async (a, b) => { await fs.cp(a, b, { recursive: true }); await fs.writeFile(path.join(b, 'extra'), 'bad'); };
  f.options.launchHelper = () => { launched = true; };
  const service = createUpdateService(f.options), selected = await service.select();
  assert.equal((await service.install(selected.token)).ok, false);
  assert.equal(launched, false);
  assert.equal(f.quits(), 0);
});

test('valid but changed checksum manifest is rejected after confirmation', async t => {
  const f = await fixture(t), service = createUpdateService(f.options), selected = await service.select();
  await fs.writeFile(path.join(f.folder, 'Multiterminal.app', 'Contents', 'Info.plist'), 'other valid content');
  const hash = crypto.createHash('sha256').update('other valid content').digest('hex');
  await fs.writeFile(path.join(f.folder, 'CHECKSUMS.sha256'), `${hash}  Multiterminal.app/Contents/Info.plist\n`);
  assert.match((await service.install(selected.token)).error, /seit der Auswahl/);
  assert.equal(f.quits(), 0);
});
test('throwing quit disarms installation and clears staged app', async t => {
  const f = await fixture(t);
  f.options.app.quit = () => { throw new Error('quit rejected'); };
  const service = createUpdateService(f.options), selected = await service.select();
  assert.equal((await service.install(selected.token)).error, 'quit rejected');
  assert.equal((await service.status()).busy, false);
  assert.equal((await fs.readdir(f.root)).some(name => name.startsWith('.multiterminal-update-')), false);
});
