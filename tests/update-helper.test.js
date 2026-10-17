'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const helperSource = path.resolve(__dirname, '../src/main/update-helper.sh');
const mac = process.platform === 'darwin';
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mt-update-helper-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stage = path.join(root, 'package'), target = path.join(root, 'Multiterminal.app');
  await fs.mkdir(path.join(stage, 'Multiterminal.app', 'Contents'), { recursive: true });
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'old'), 'previous');
  const plist = '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>de.joshua.multiterminal</string><key>CFBundleShortVersionString</key><string>0.2.0</string></dict></plist>';
  await fs.writeFile(path.join(stage, 'Multiterminal.app', 'Contents', 'Info.plist'), plist);
  const hash = crypto.createHash('sha256').update(plist).digest('hex');
  await fs.writeFile(path.join(stage, 'CHECKSUMS.sha256'), `${hash}  Multiterminal.app/Contents/Info.plist\n`);
  const helper = path.join(root, 'copied-helper.sh'); await fs.copyFile(helperSource, helper);
  const opener = path.join(root, 'open-fixture'); await fs.writeFile(opener, '#!/bin/bash\nexit 0\n', { mode: 0o700 });
  const result = path.join(root, 'result.json'), ready = path.join(root, 'ready');
  await fs.writeFile(path.join(root, 'go'), '');
  const args = owner => [helper, String(owner), stage, target, result, ready, '1', opener];
  return { root, stage, target, helper, opener, result, ready, args };
}
async function run(args) {
  return new Promise((resolve, reject) => { const child = spawn('/bin/bash', args); let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; }); child.on('error', reject); child.on('close', code => resolve({ code, output })); });
}
async function result(f) { return JSON.parse(await fs.readFile(f.result, 'utf8')); }
const deadPid = 2147483647;
test('helper detached from an exited owner installs only temp fixture and retains backup', { skip: !mac }, async t => {
  const f = await fixture(t);
  const ownerScript = `const {spawn}=require('node:child_process');const args=JSON.parse(process.argv[1]);args[1]=String(process.pid);const c=spawn('/bin/bash',args,{detached:true,stdio:'ignore'});c.unref();`;
  await new Promise((resolve, reject) => { const owner = spawn(process.execPath, ['-e', ownerScript, JSON.stringify(f.args(0))]); owner.on('error', reject); owner.on('close', code => code === 0 ? resolve() : reject(new Error('owner failed'))); });
  let last;
  for (let i = 0; i < 100; i++) { try { last = await result(f); } catch (_) {} if (last && last.state === 'installed') break; await new Promise(r => setTimeout(r, 50)); }
  assert.equal(last.state, 'installed');
  assert.equal(await fs.readFile(path.join(f.root, 'previous.app', 'old'), 'utf8'), 'previous');
  await fs.access(path.join(f.target, 'Contents', 'Info.plist'));
});
test('helper parent timeout never replaces running-owner target', { skip: !mac }, async t => {
  const f = await fixture(t), done = await run(f.args(process.pid));
  assert.equal(done.code, 1);
  assert.equal((await result(f)).state, 'parent_timeout');
  assert.equal(await fs.readFile(path.join(f.target, 'old'), 'utf8'), 'previous');
});
for (const kind of ['checksum', 'inventory', 'symlink', 'traversal']) {
  test(`helper rejects staged ${kind} mutation before backup`, { skip: !mac }, async t => {
    const f = await fixture(t);
    if (kind === 'checksum') await fs.writeFile(path.join(f.stage, 'Multiterminal.app', 'Contents', 'Info.plist'), 'bad');
    if (kind === 'inventory') await fs.writeFile(path.join(f.stage, 'Multiterminal.app', 'extra'), 'bad');
    if (kind === 'symlink') await fs.symlink(f.target, path.join(f.stage, 'Multiterminal.app', 'escape'));
    if (kind === 'traversal') await fs.writeFile(path.join(f.stage, 'CHECKSUMS.sha256'), `${'a'.repeat(64)}  Multiterminal.app/../outside\n`);
    const done = await run(f.args(deadPid));
    assert.equal(done.code, 1, done.output);
    assert.equal(await fs.readFile(path.join(f.target, 'old'), 'utf8'), 'previous');
    await assert.rejects(fs.access(path.join(f.root, 'previous.app')));
  });
}
test('helper permits safe internal directory and file aliases', { skip: !mac }, async t => {
  const f = await fixture(t);
  await fs.symlink('Contents', path.join(f.stage, 'Multiterminal.app', 'Alias'));
  await fs.symlink('Contents/Info.plist', path.join(f.stage, 'Multiterminal.app', 'InfoAlias'));
  const done = await run(f.args(deadPid));
  assert.equal(done.code, 0, done.output);
  assert.equal((await result(f)).state, 'installed');
});
test('failed replacement restores previous target', { skip: !mac }, async t => {
  const f = await fixture(t), mover = path.join(f.root, 'move-fixture');
  await fs.writeFile(mover, '#!/bin/bash\ncase "$1" in */package/Multiterminal.app) exit 1;; esac\nexec /bin/mv "$@"\n', { mode: 0o700 });
  const args = f.args(deadPid); args.push(mover);
  assert.equal((await run(args)).code, 1);
  assert.equal((await result(f)).state, 'replacement_failed');
  assert.equal(await fs.readFile(path.join(f.target, 'old'), 'utf8'), 'previous');
});
test('failed relaunch rolls back and persists failure', { skip: !mac }, async t => {
  const f = await fixture(t);
  await fs.writeFile(f.opener, '#!/bin/bash\nexit 1\n', { mode: 0o700 });
  assert.equal((await run(f.args(deadPid))).code, 1);
  assert.equal((await result(f)).state, 'relaunch_failed');
  assert.equal(await fs.readFile(path.join(f.target, 'old'), 'utf8'), 'previous');
});

test('helper does not emit readiness when persistent status cannot be written', { skip: !mac }, async t => {
  const f = await fixture(t), args = f.args(deadPid);
  args[4] = path.join(f.root, 'missing-directory', 'result.json');
  assert.equal((await run(args)).code, 1);
  await assert.rejects(fs.access(f.ready));
  assert.equal(await fs.readFile(path.join(f.target, 'old'), 'utf8'), 'previous');
});
test('helper cancellation marker prevents a later owner exit installing staged app', { skip: !mac }, async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'cancelled'), '');
  assert.equal((await run(f.args(deadPid))).code, 1);
  assert.equal((await result(f)).state, 'start_cancelled');
  assert.equal(await fs.readFile(path.join(f.target, 'old'), 'utf8'), 'previous');
});
test('helper rejects replaced but internally valid manifest after handoff', { skip: !mac }, async t => {
  const f = await fixture(t), args = f.args(deadPid);
  args.push('/bin/mv', '0'.repeat(64));
  assert.equal((await run(args)).code, 1);
  assert.equal((await result(f)).state, 'invalid_manifest');
  assert.equal(await fs.readFile(path.join(f.target, 'old'), 'utf8'), 'previous');
});

test('helper rechecks processes after validation and before target rename', { skip: !mac }, async t => {
  const f = await fixture(t), processFixture = path.join(f.root, 'process-fixture');
  await fs.writeFile(processFixture, `#!/bin/bash
root="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$root/process-checked" ]; then
  printf '%s/Multiterminal.app/Contents/MacOS/Multiterminal\\n' "$root"
else
  : > "$root/process-checked"
fi
`, { mode: 0o700 });
  const args = f.args(deadPid);
  args.push('/bin/mv', '', processFixture);
  const done = await run(args);
  assert.equal(done.code, 1, done.output);
  assert.equal((await result(f)).state, 'target_running');
  assert.equal(await fs.readFile(path.join(f.target, 'old'), 'utf8'), 'previous');
  await assert.rejects(fs.access(path.join(f.root, 'previous.app')));
});
