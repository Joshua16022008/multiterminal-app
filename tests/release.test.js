'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { releasePlan, hdiutilArgs, packageDmg, release, run } = require('../scripts/release');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release space '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plan = releasePlan({ root, appName: 'My Terminal', version: '1.2.3-beta.1', platform: 'darwin', arch: 'arm64' });
  fs.mkdirSync(path.join(plan.appBundle, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(plan.appBundle, 'Contents', 'fixture'), 'app');
  fs.symlinkSync('fixture', path.join(plan.appBundle, 'Contents', 'link'));
  return plan;
}

test('release paths use the edition identity and version safely, including spaces', () => {
  const plan = releasePlan({ root: '/tmp/project space', appName: 'Public Terminal', version: '0.3.0', platform: 'darwin', arch: 'arm64' });
  assert.equal(plan.appBundle, '/tmp/project space/dist/Public Terminal-darwin-arm64/Public Terminal.app');
  assert.equal(plan.dmg, '/tmp/project space/dist/release/Public Terminal-0.3.0-darwin-arm64.dmg');
  assert.deepEqual(hdiutilArgs(plan, '/tmp/source space', '/tmp/out space.dmg'), ['create', '-volname', 'Public Terminal 0.3.0', '-srcfolder', '/tmp/source space', '-fs', 'HFS+', '-format', 'UDZO', '/tmp/out space.dmg']);
  for (const bad of ['../App', 'App; touch x', '-App', 'App\n']) assert.throws(() => releasePlan({ appName: bad, version: '1.0.0', platform: 'darwin', arch: 'arm64' }));
  for (const bad of ['../1', '1.0', '1.0.0\n']) assert.throws(() => releasePlan({ version: bad, platform: 'darwin', arch: 'arm64' }));
  assert.throws(() => releasePlan({ version: '1.0.0', platform: 'linux', arch: 'arm64' }), /macOS/);
  assert.throws(() => releasePlan({ version: '1.0.0', platform: 'darwin', arch: 'x64' }), /Apple Silicon/);
});

test('DMG stage contains the app and Applications link; digest matches published bytes', async t => {
  const plan = fixture(t);
  const result = await packageDmg(plan, { execute(command, args, options) {
    assert.equal(command, '/usr/bin/hdiutil');
    assert.equal(options.cwd, plan.root);
    const stage = args[args.indexOf('-srcfolder') + 1];
    assert.deepEqual(fs.readdirSync(stage).sort(), ['Applications', 'My Terminal.app']);
    assert.equal(fs.readlinkSync(path.join(stage, 'Applications')), '/Applications');
    assert.equal(fs.readlinkSync(path.join(stage, 'My Terminal.app', 'Contents', 'link')), 'fixture');
    fs.writeFileSync(args.at(-1), 'mock image bytes');
  } });
  const expected = crypto.createHash('sha256').update('mock image bytes').digest('hex');
  assert.equal(result.sha256, expected);
  assert.equal(fs.readFileSync(plan.checksum, 'utf8'), `${expected}  ${plan.fileName}\n`);
  assert.deepEqual(fs.readdirSync(plan.releaseDir).sort(), [plan.fileName, `${plan.fileName}.sha256`].sort());
});

test('failed image creation preserves previous release and removes temporary stage', async t => {
  const plan = fixture(t);
  fs.mkdirSync(plan.releaseDir, { recursive: true });
  fs.writeFileSync(plan.dmg, 'previous');
  fs.writeFileSync(plan.checksum, 'previous hash');
  await assert.rejects(packageDmg(plan, { execute() { throw new Error('image failed'); } }), /image failed/);
  assert.equal(fs.readFileSync(plan.dmg, 'utf8'), 'previous');
  assert.equal(fs.readFileSync(plan.checksum, 'utf8'), 'previous hash');
  assert.equal(fs.readdirSync(plan.releaseDir).length, 2);
});

test('release builds first with Node argv and stops on build failure', async t => {
  const plan = fixture(t);
  fs.writeFileSync(path.join(plan.root, 'package.json'), JSON.stringify({ version: plan.version }));
  const calls = [];
  await release({ root: plan.root, currentEdition: { appName: plan.appName }, platform: 'darwin', arch: 'arm64', execute(command, args, options) {
    calls.push({ command, args, options });
    if (command === '/usr/bin/hdiutil') fs.writeFileSync(args.at(-1), 'image');
  } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args, [path.join(plan.root, 'scripts', 'build.js')]);
  assert.equal(calls[0].options.cwd, plan.root);
  let count = 0;
  await assert.rejects(release({ root: plan.root, platform: 'darwin', arch: 'arm64', execute() { count++; throw new Error('build failed'); } }), /build failed/);
  assert.equal(count, 1);
});

test('missing app or empty image cannot publish a release', async t => {
  const plan = fixture(t);
  await assert.rejects(packageDmg(plan, { execute(command, args) { fs.writeFileSync(args.at(-1), ''); } }), /no DMG/);
  assert.deepEqual(fs.readdirSync(plan.releaseDir), []);
  fs.rmSync(plan.appBundle, { recursive: true });
  await assert.rejects(packageDmg(plan), /ENOENT/);
});

test('command runner propagates nonzero exits without a shell', () => {
  assert.throws(() => run(process.execPath, ['-e', 'process.exit(7)']), /failed \(7\)/);
});
