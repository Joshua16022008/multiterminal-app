'use strict';
// Native macOS release: build the current edition, then make a drag-to-Applications DMG.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const edition = require('../src/main/edition');
const ROOT = path.resolve(__dirname, '..');

function releasePlan({ root = ROOT, appName = edition.appName, version, platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'darwin' || arch !== 'arm64') throw new Error('Release requires macOS on Apple Silicon (darwin/arm64).');
  if (typeof appName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,62}$/.test(appName)) throw new Error('Invalid release app name.');
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid release version.');
  root = path.resolve(root);
  const fileName = `${appName}-${version}-darwin-${arch}.dmg`;
  const releaseDir = path.join(root, 'dist', 'release');
  return { root, appName, version, arch, fileName, releaseDir,
    appBundle: path.join(root, 'dist', `${appName}-darwin-${arch}`, `${appName}.app`),
    dmg: path.join(releaseDir, fileName), checksum: path.join(releaseDir, `${fileName}.sha256`),
    volumeName: `${appName} ${version}` };
}

function hdiutilArgs(plan, source, output) {
  return ['create', '-volname', plan.volumeName, '-srcfolder', source, '-fs', 'HFS+', '-format', 'UDZO', output];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, shell: false, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.signal || result.status}).`);
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Kept separate from building so native image packaging can be checked with a tiny fixture.
async function packageDmg(plan, { execute = run } = {}) {
  const stat = fs.lstatSync(plan.appBundle);
  if (!stat.isDirectory() || !plan.appBundle.endsWith('.app')) throw new Error(`App bundle not found: ${plan.appBundle}`);
  fs.mkdirSync(plan.releaseDir, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(plan.releaseDir, '.release-'));
  try {
    const source = path.join(temporary, 'image');
    fs.mkdirSync(source);
    fs.cpSync(plan.appBundle, path.join(source, `${plan.appName}.app`), { recursive: true, verbatimSymlinks: true });
    fs.symlinkSync('/Applications', path.join(source, 'Applications'));
    const output = path.join(temporary, plan.fileName);
    execute('/usr/bin/hdiutil', hdiutilArgs(plan, source, output), { cwd: plan.root });
    if (!fs.statSync(output).isFile() || fs.statSync(output).size === 0) throw new Error('hdiutil produced no DMG.');
    const digest = await sha256(output);
    const checksum = path.join(temporary, 'checksum');
    fs.writeFileSync(checksum, `${digest}  ${plan.fileName}\n`, { flag: 'wx' });
    fs.renameSync(output, plan.dmg);
    fs.renameSync(checksum, plan.checksum);
    return { dmg: plan.dmg, checksum: plan.checksum, sha256: digest };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function release({ root = ROOT, currentEdition = edition, platform = process.platform, arch = process.arch, execute = run } = {}) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const plan = releasePlan({ root, appName: currentEdition.appName, version, platform, arch });
  execute(process.execPath, [path.join(plan.root, 'scripts', 'build.js')], { cwd: plan.root });
  return packageDmg(plan, { execute });
}

if (require.main === module) {
  if (process.argv.length > 2) {
    console.error('Usage: node scripts/release.js');
    process.exitCode = 1;
  } else {
    release().then(result => {
      console.log(`DMG: ${result.dmg}\nSHA256: ${result.checksum}`);
      console.log('Unsigned release; code signing and notarization are separate steps.');
    }).catch(error => {
      console.error('Release failed:', error.stack || error);
      process.exitCode = 1;
    });
  }
}

module.exports = { releasePlan, hdiutilArgs, sha256, packageDmg, release, run };
