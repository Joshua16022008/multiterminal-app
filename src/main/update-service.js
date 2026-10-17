'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const ID = 'de.joshua.multiterminal';
const within = (base, item) => item === base || item.startsWith(base + path.sep);
async function plistValue(file, key) {
  return (await run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, file])).stdout.trim();
}
async function validatePackage(folder, target, readPlist = plistValue) {
  const root = await fsp.realpath(folder);
  const bundle = path.join(root, 'Multiterminal.app');
  if (within(root, target) || within(target, root)) throw new Error('Update-Paket und installierte App überlappen.');
  if ((await fsp.lstat(bundle)).isSymbolicLink()) throw new Error('App-Bundle darf kein symbolischer Link sein.');
  const manifest = await fsp.readFile(path.join(root, 'CHECKSUMS.sha256'), 'utf8');
  const entries = new Map();
  for (const line of manifest.trimEnd().split('\n')) {
    const match = /^([a-fA-F0-9]{64})  (Multiterminal\.app\/.+)$/.exec(line);
    if (!match || /[\x00-\x1f\\]/.test(match[2]) || match[2].split('/').some(p => p === '..' || p === '.' || !p) || entries.has(match[2])) throw new Error('Ungültige Prüfsummenliste.');
    entries.set(match[2], match[1].toLowerCase());
  }
  let count = 0;
  async function walk(dir) {
    for (const name of await fsp.readdir(dir)) {
      if (/[\x00-\x1f\\]/.test(name)) throw new Error('Ungültiger Dateiname.');
      const file = path.join(dir, name), stat = await fsp.lstat(file);
      if (stat.isSymbolicLink()) {
        if (!within(bundle, await fsp.realpath(file))) throw new Error('Symbolischer Link verlässt das App-Bundle.');
      } else if (stat.isDirectory()) await walk(file);
      else if (stat.isFile()) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        const digest = crypto.createHash('sha256');
        for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
        const hash = digest.digest('hex');
        if (entries.get(rel) !== hash) throw new Error(`Prüfsumme fehlt oder stimmt nicht: ${rel}`);
        entries.delete(rel); count++;
      } else throw new Error('Unzulässiger Dateityp im App-Bundle.');
    }
  }
  await walk(bundle);
  if (!count || entries.size) throw new Error('Prüfsummenliste enthält fehlende Dateien.');
  const info = path.join(bundle, 'Contents', 'Info.plist');
  if (await readPlist(info, 'CFBundleIdentifier') !== ID) throw new Error('Falsche App-Kennung.');
  const version = await readPlist(info, 'CFBundleShortVersionString');
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error('Ungültige App-Version.');
  return { packagePath: root, version, fileCount: count, manifestDigest: crypto.createHash('sha256').update(manifest).digest('hex') };
}
function createUpdateService(options) {
  const { app, dialog, dataDir, getParentWindow = () => undefined } = options;
  const platform = options.platform || process.platform;
  const readPlist = options.readPlist || plistValue;
  const targetPath = options.targetPath || path.resolve(path.dirname(app.getPath('exe')), '..', '..');
  const supported = platform === 'darwin' && app.isPackaged && path.basename(targetPath) === 'Multiterminal.app';
  const resultFile = path.join(dataDir, 'updates', 'last-result.json');
  let busy = false;
  const selections = new Map();
  const error = e => ({ ok: false, error: e.message });
  async function select(parentWindow = getParentWindow()) {
    if (!supported) return error(new Error('App-Updates sind nur in der installierten macOS-App verfügbar.'));
    if (busy) return error(new Error('Eine Aktualisierung läuft bereits.'));
    try {
      const picked = await dialog.showOpenDialog(parentWindow, { title: 'Vorbereitetes Update-Paket wählen', properties: ['openDirectory'] });
      if (picked.canceled || !picked.filePaths.length) return { ok: false, cancelled: true };
      const target = await fsp.realpath(targetPath);
      if (await readPlist(path.join(target, 'Contents', 'Info.plist'), 'CFBundleIdentifier') !== ID) throw new Error('Installierte App-Kennung stimmt nicht.');
      const selected = await validatePackage(picked.filePaths[0], target, readPlist);
      const token = crypto.randomBytes(24).toString('hex');
      selections.set(token, selected);
      return { ok: true, token, packagePath: selected.packagePath, version: selected.version, fileCount: selected.fileCount, targetPath, currentVersion: app.getVersion() };
    } catch (e) { return error(e); }
  }
  async function install(token, parentWindow = getParentWindow()) {
    if (!supported || busy || typeof token !== 'string' || !selections.has(token)) return error(new Error('Update-Auswahl ungültig oder Aktualisierung läuft bereits.'));
    busy = true;
    const selected = selections.get(token); selections.delete(token);
    let work, started = false;
    try {
      const answer = await dialog.showMessageBox(parentWindow, { type: 'warning', title: 'Multiterminal aktualisieren', message: `Multiterminal ${app.getVersion()} → ${selected.version} installieren?`, detail: `Alle Terminals und Projektmanager-Agenten werden beendet. Die App wird danach neu gestartet.\n\nPaket: ${selected.packagePath}\nZiel: ${targetPath}`, buttons: ['Abbrechen', 'Installieren und neu starten'], defaultId: 0, cancelId: 0, noLink: true });
      if (answer.response !== 1) return { ok: false, cancelled: true };
      const target = await fsp.realpath(targetPath);
      const current = await validatePackage(selected.packagePath, target, readPlist);
      if (current.manifestDigest !== selected.manifestDigest || current.version !== selected.version) throw new Error('Das Update-Paket wurde seit der Auswahl verändert.');
      await fsp.mkdir(path.dirname(resultFile), { recursive: true, mode: 0o700 });
      work = await fsp.mkdtemp(path.join(path.dirname(target), '.multiterminal-update-'));
      await fsp.chmod(work, 0o700);
      const stage = path.join(work, 'package'); await fsp.mkdir(stage);
      await (options.copyBundle || (async (source, dest) => { await run('/usr/bin/ditto', [source, dest]); }))(path.join(selected.packagePath, 'Multiterminal.app'), path.join(stage, 'Multiterminal.app'));
      await fsp.copyFile(path.join(selected.packagePath, 'CHECKSUMS.sha256'), path.join(stage, 'CHECKSUMS.sha256'));
      const staged = await validatePackage(stage, target, readPlist);
      if (staged.manifestDigest !== selected.manifestDigest || staged.version !== selected.version) throw new Error('Das kopierte Update-Paket wurde verändert.');
      const helper = path.join(work, 'update-helper.sh');
      await fsp.copyFile(path.join(__dirname, 'update-helper.sh'), helper);
      const ready = path.join(work, 'ready');
      const launchHelper = options.launchHelper || ((args, log) => {
        const fd = fs.openSync(log, 'a', 0o600);
        try { const child = spawn('/bin/bash', args, { detached: true, stdio: ['ignore', fd, fd] }); child.on('error', () => {}); child.unref(); return child; } finally { fs.closeSync(fd); }
      });
      const child = launchHelper([helper, String(process.pid), stage, target, resultFile, ready, '60', '/usr/bin/open', '/bin/mv', selected.manifestDigest], path.join(work, 'update.log'));
      await (options.waitReady || (async () => {
        const end = Date.now() + 5000;
        while (Date.now() < end) {
          if (fs.existsSync(ready)) return;
          if (child.exitCode != null || child.pid == null) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('Update-Helfer konnte nicht sicher gestartet werden.');
      }))(ready, child);
      // The helper waits for this process; quit uses the existing graceful shutdown path.
      await fsp.writeFile(path.join(work, 'go'), '', { mode: 0o600 });
      started = true;
      selections.clear();
      app.quit();
      return { ok: true, started: true };
    } catch (e) {
      started = false;
      if (work) {
        // A failed or cancelled quit must never arm a later, unrelated shutdown.
        await fsp.rm(path.join(work, 'go'), { force: true }).catch(() => {});
        await fsp.writeFile(path.join(work, 'cancelled'), '').catch(() => {});
        await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      }
      await fsp.mkdir(path.dirname(resultFile), { recursive: true, mode: 0o700 }).catch(() => {});
      await fsp.writeFile(resultFile, JSON.stringify({ state: 'start_failed', message: e.message }), { mode: 0o600 }).catch(() => {});
      return error(e);
    }
    finally { if (!started) busy = false; }
  }
  async function status() {
    let lastResult = null;
    try { lastResult = JSON.parse(await fsp.readFile(resultFile, 'utf8')); } catch (_) { /* No previous update. */ }
    return { ok: true, supported, busy, lastResult, message: supported ? '' : 'Nur in der installierten macOS-App verfügbar.' };
  }
  return { select, install, status };
}
module.exports = { createUpdateService, validatePackage };
