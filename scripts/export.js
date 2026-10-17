#!/usr/bin/env node
'use strict';

// Export der öffentlichen Version aus einem Git-Archiv: Overlay, Datenschutz und Tests
// laufen vor jedem Schreiben ins Ziel. Der Probeordner bleibt zur GUI-Prüfung erhalten.
//
//   node scripts/export.js [--target <Ordner>] [--dry-run] [--ref <Commit>]
//
// Sicherheit: Geändert wird nur innerhalb des Ziels. Symlinks im Ziel werden nie verfolgt, `keepInTarget`
// (.git, node_modules, dist) bleibt unberührt, es gibt keine Shell (nur execFile für git). Trifft der Wächter,
// bleibt das Ziel unverändert.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { dryRun: false, target: null, source: ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--target' || a === '--ref') {
      const value = argv[++i];
      if (!value || value.startsWith('-')) throw new Error(`${a} braucht einen Wert.`);
      opts[a.slice(2)] = value;
    } else throw new Error(`Unbekannte Option: ${a}`);
  }
  return opts;
}

const run = (file, args, cwd) => new Promise((resolve, reject) => {
  execFile(file, args, { cwd, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

const posix = (p) => p.split(path.sep).join('/');
const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch (err) { if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null; throw err; }
}

// Auflösung eines möglicherweise noch nicht vorhandenen Pfades über den tiefsten vorhandenen Vorfahren.
function realResolve(p) {
  const abs = path.resolve(p);
  const tail = [];
  let cur = abs;
  while (!lstatOrNull(cur)) {
    const up = path.dirname(cur);
    if (up === cur) break;
    tail.unshift(path.basename(cur));
    cur = up;
  }
  return path.join(fs.realpathSync(cur), ...tail);
}

function checkTarget(targetArg, source) {
  const target = realResolve(targetArg);
  if (path.resolve(targetArg) !== target || lstatOrNull(targetArg)?.isSymbolicLink()) throw new Error('Ziel muss ein kanonischer Pfad ohne Symlinks sein.');
  const src = fs.realpathSync(source);
  if (path.dirname(target) === target || target === os.homedir() || target.split(path.sep).filter(Boolean).length < 2) {
    throw new Error(`Ziel ${target} ist zu allgemein.`);
  }
  if (isInside(target, src) || isInside(src, target)) {
    throw new Error('Ziel und Quelle dürfen sich nicht überschneiden (Ziel ist die Quelle, liegt darin oder enthält sie).');
  }
  const st = lstatOrNull(target);
  if (st) {
    if (!st.isDirectory()) throw new Error(`Ziel ${target} ist kein Ordner.`);
    const entries = fs.readdirSync(target);
    if (entries.length) {
      let marker;
      try { marker = JSON.parse(fs.readFileSync(path.join(target, 'edition.json'), 'utf8')); } catch (_) { /* rejected below */ }
      if (lstatOrNull(path.join(target, 'edition.json'))?.isSymbolicLink() || marker?.edition !== 'public' || !lstatOrNull(path.join(target, '.git'))?.isDirectory()) throw new Error('Nichtleeres Ziel ist kein öffentliches Export-Repository.');
    }
  }
  return target;
}

function readManifest(source) {
  const file = path.join(source, 'scripts', 'export-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const extra = JSON.parse(fs.readFileSync(path.join(source, 'export/manifest.json'), 'utf8'));
  manifest.internal.push(...extra.exclude);
  manifest.forbidden = extra.forbidden;
  if (!Array.isArray(manifest.forbidden) || !manifest.forbidden.length) throw new Error('Manifest: Datenschutzregeln fehlen.');
  for (const key of ['devOnly', 'internal']) {
    if (!Array.isArray(manifest[key])) throw new Error(`Manifest: ${key} fehlt.`);
  }
  if (!manifest.publicEdition || manifest.publicEdition.edition !== 'public') throw new Error('Manifest: publicEdition fehlt.');
  return manifest;
}

const listed = (rel, entries) => entries.some((e) => (e.endsWith('/') ? rel.startsWith(e) : rel === e));

function walkFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, base, out);
    else if (e.isFile()) out.push(posix(path.relative(base, full)));
    else throw new Error(`Symlink oder Sonderdatei nicht erlaubt: ${full}`);
  }
  return out;
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  fs.chmodSync(to, fs.statSync(from).mode & 0o777);
}

function transformPackageJson(file, manifest) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.name = 'multiterminal';
  pkg.description = 'A macOS workspace for terminal-based coding agents, projects and Git worktrees.';
  pkg.license = 'MIT'; pkg.private = true;
  pkg.scripts.release = 'node scripts/release.js';
  // URLs are added after the public repository has been named.
  delete pkg.repository; delete pkg.homepage; delete pkg.bugs; delete pkg.author; delete pkg.contributors;
  pkg.productName = manifest.publicEdition.appName || pkg.productName;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  const lockFile = path.join(path.dirname(file), 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  lock.name = pkg.name;
  if (lock.packages?.['']) { lock.packages[''].name = pkg.name; lock.packages[''].license = pkg.license; }
  fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
}

// Baut das Staging-Verzeichnis; liefert die Liste der veröffentlichten Pfade (relativ, mit /).
async function buildStaging({ source, staging, manifest, onWarn }) {
  const tracked = walkFiles(source);
  const skipped = [];
  for (const rel of tracked) {
    if (rel === '.git' || rel.startsWith('.git/')) continue;
    if (listed(rel, manifest.devOnly) || listed(rel, manifest.internal)) continue;
    const from = path.join(source, rel);
    const st = lstatOrNull(from);
    if (!st) continue; // gelöscht, aber noch nicht committet
    if (!st.isFile()) { skipped.push(rel); continue; } // Symlinks und Ähnliches werden nie exportiert
    copyFile(from, path.join(staging, rel));
  }
  if (skipped.length) onWarn(`Übersprungen (kein regulärer Eintrag): ${skipped.join(', ')}`);

  for (const [rel, marker] of Object.entries(manifest.stripLines || {})) {
    const file = path.join(staging, rel);
    if (!lstatOrNull(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => !line.includes(marker));
    fs.writeFileSync(file, lines.join('\n'));
  }

  if (manifest.overlay) {
    const overlayDir = path.join(source, manifest.overlay);
    if (lstatOrNull(overlayDir)) {
      for (const rel of walkFiles(overlayDir)) copyFile(path.join(overlayDir, rel), path.join(staging, rel));
    }
  }

  transformPackageJson(path.join(staging, 'package.json'), manifest);
  fs.writeFileSync(path.join(staging, 'edition.json'), JSON.stringify(manifest.publicEdition, null, 2) + '\n');
  return walkFiles(staging).sort();
}

// Wächter über das Staging-Verzeichnis (Pfade und Inhalt). Gibt Treffer als Zeilen zurück.
function guardScan(staging, files, forbidden) {
  const hits = [];
  for (const rel of files) {
    // No size limit, binary exclusion or allowlist.
    const text = fs.readFileSync(path.join(staging, rel)).toString('utf8');
    for (const term of forbidden) {
      const needle = term.toLowerCase();
      if (rel.toLowerCase().includes(needle)) hits.push(`${rel}: Pfad enthält ${term}`);
      const index = text.toLowerCase().indexOf(needle);
      if (index >= 0) hits.push(`${rel}:${text.slice(0, index).split('\n').length}: ${term}`);
    }
  }
  return hits;
}

function sameContent(a, b) {
  const sa = fs.statSync(a), sb = fs.statSync(b);
  if (sa.size !== sb.size) return false;
  return fs.readFileSync(a).equals(fs.readFileSync(b)) && (sa.mode & 0o777) === (sb.mode & 0o777);
}

// Plant (und führt aus) den Abgleich. Rückgabe: { add, update, remove }. Verfolgt nie Symlinks im Ziel.
function syncTarget({ staging, files, target, keep, apply }) {
  for (const rel of files) {
    if (!rel || rel.includes('\\') || path.posix.isAbsolute(rel) || rel.split('/').some(p => !p || p === '.' || p === '..') || keep.includes(rel.split('/')[0])) throw new Error(`Unsicherer Exportpfad: ${rel}`);
  }
  const plan = { add: [], update: [], remove: [] };
  const wanted = new Set(files);
  const wantedDirs = new Set();
  for (const rel of files) { let d = path.posix.dirname(rel); while (d !== '.') { wantedDirs.add(d); d = path.posix.dirname(d); } }

  if (apply) fs.mkdirSync(target, { recursive: true });

  // 1. Überflüssiges im Ziel entfernen (nur lstat, keine Symlink-Verfolgung).
  const prune = (dirRel) => {
    const dirAbs = path.join(target, dirRel);
    const st = lstatOrNull(dirAbs);
    if (!st || !st.isDirectory()) return;
    for (const name of fs.readdirSync(dirAbs)) {
      const rel = dirRel ? `${dirRel}/${name}` : name;
      if (!dirRel && keep.includes(name)) continue;
      const abs = path.join(target, rel);
      const s = fs.lstatSync(abs);
      if (s.isDirectory()) {
        if (wantedDirs.has(rel)) { prune(rel); continue; }
        for (const f of walkEntries(abs, rel)) plan.remove.push(f);
        if (apply) fs.rmSync(abs, { recursive: true, force: true });
      } else if (!wanted.has(rel)) {
        plan.remove.push(rel);
        if (apply) fs.unlinkSync(abs);
      }
      // Eintrag existiert und wird gebraucht, aber als Symlink/Ordner statt Datei: im Schritt 2 ersetzt.
    }
  };
  prune('');

  // 2. Dateien anlegen oder aktualisieren; Vorfahren, die Symlink oder Datei sind, werden ersetzt.
  for (const rel of files) {
    if (rel === '.git' || rel.startsWith('.git/')) throw new Error(`Interner Fehler: ${rel} darf nicht exportiert werden.`);
    const parts = rel.split('/');
    let cur = target;
    let replacedAncestor = false;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = path.join(cur, parts[i]);
      const st = replacedAncestor ? null : lstatOrNull(cur);
      if (st && !st.isDirectory()) replacedAncestor = true;
      if (st && !st.isDirectory()) { if (apply) fs.unlinkSync(cur); } // Symlink oder Datei, nie ihr Ziel
      if ((!st || !st.isDirectory()) && apply) fs.mkdirSync(cur);
    }
    const dest = path.join(target, rel);
    const from = path.join(staging, rel);
    const st = replacedAncestor && !apply ? null : lstatOrNull(dest);
    if (st && st.isSymbolicLink()) { plan.update.push(rel); if (apply) { fs.unlinkSync(dest); copyFile(from, dest); } continue; }
    if (st && st.isDirectory()) { plan.update.push(rel); if (apply) { fs.rmSync(dest, { recursive: true, force: true }); copyFile(from, dest); } continue; }
    if (!st) { plan.add.push(rel); if (apply) copyFile(from, dest); continue; }
    if (!sameContent(from, dest)) { plan.update.push(rel); if (apply) copyFile(from, dest); }
  }
  return plan;
}

function walkEntries(abs, rel, out = []) {
  for (const name of fs.readdirSync(abs)) {
    const a = path.join(abs, name);
    const s = fs.lstatSync(a);
    if (s.isDirectory()) walkEntries(a, `${rel}/${name}`, out); else out.push(`${rel}/${name}`);
  }
  return out;
}

async function exportEdition(opts) {
  const log = opts.log || (() => {});
  const source = fs.realpathSync(path.resolve(opts.source || ROOT));
  const commonDir = fs.realpathSync(path.resolve(source, (await run('git', ['rev-parse', '--git-common-dir'], source)).trim()));
  const developmentRoot = path.dirname(commonDir);
  const target = checkTarget(opts.target || path.join(path.dirname(developmentRoot), 'multiterminal-export'), source);
  if (isInside(target, developmentRoot) || isInside(developmentRoot, target)) throw new Error('Ziel und Entwickler-Repository dürfen sich nicht überschneiden.');
  const sha = (await run('git', ['rev-parse', '--verify', '--end-of-options', `${opts.ref || 'HEAD'}^{commit}`], source)).trim();
  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mt-export-source-'));
  const staging = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mt-export-public-'));
  let success = false;
  try {
    const entries = (await run('git', ['ls-tree', '-rz', sha], source)).split('\0').filter(Boolean);
    for (const entry of entries) if (!/^100(644|755) blob /.test(entry)) throw new Error(`Nicht unterstützter Git-Eintrag: ${entry}`);
    const archive = path.join(scratch, 'snapshot.tar'), snapshot = path.join(scratch, 'snapshot');
    fs.mkdirSync(snapshot);
    await run('git', ['archive', '--format=tar', '--output', archive, sha], source);
    await run('tar', ['-xf', archive, '-C', snapshot], source);
    const manifest = readManifest(snapshot), keep = ['.git', 'node_modules', 'dist'];
    if (!opts.ref || opts.ref === 'HEAD') {
      // Export machinery is also versioned; never silently omit its unfinished changes.
      const excluded = [...manifest.devOnly, ...manifest.internal].filter(rel => !['scripts/export.js', 'scripts/export-manifest.json', 'tests/export.test.js', 'export/'].includes(rel));
      const dirty = (await run('git', ['ls-files', '-m', '-d', '-o', '--exclude-standard', '-z'], source)).split('\0').filter(Boolean);
      const staged = (await run('git', ['diff', '--cached', '--name-only', '-z'], source)).split('\0').filter(Boolean);
      const relevant = [...new Set([...dirty, ...staged])].filter(rel => rel !== 'node_modules' && !listed(rel, excluded));
      if (relevant.length) throw new Error(`Nicht committierte Exportänderungen: ${relevant.join(', ')}`);
    }
    const files = await buildStaging({ source: snapshot, staging, manifest, onWarn: log });
    let hits = guardScan(staging, files, manifest.forbidden);
    if (hits.length) {
      const err = new Error(`Wächter hat ${hits.length} Treffer; Ziel bleibt unverändert:\n  ${hits.join('\n  ')}`);
      err.hits = hits;
      throw err;
    }
    const dependencies = path.join(source, 'node_modules');
    if (!lstatOrNull(dependencies)) throw new Error('Abhängigkeiten fehlen; zuerst npm install in der Entwicklerversion ausführen.');
    fs.symlinkSync(fs.realpathSync(dependencies), path.join(staging, 'node_modules'), 'dir');
    try {
      const output = await new Promise((resolve, reject) => {
        const env = { ...process.env }; delete env.MULTITERMINAL_EDITION_FILE;
        delete env.NODE_TEST_CONTEXT; delete env.NODE_TEST_REPORTER; delete env.NODE_TEST_REPORTER_DESTINATION;
        execFile('npm', ['test'], { cwd: staging, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => err ? reject(new Error(`Exporttests fehlgeschlagen:\n${stdout}\n${stderr}`)) : resolve(stdout));
      });
      log(output.split('\n').filter(line => /^# (tests|pass|fail|skipped|todo|duration_ms) /.test(line)).join('\n'));
    } finally { fs.unlinkSync(path.join(staging, 'node_modules')); }
    const afterTests = walkFiles(staging).sort();
    if (JSON.stringify(afterTests) !== JSON.stringify(files)) throw new Error('Tests haben den Export-Dateibaum verändert.');
    hits = guardScan(staging, files, manifest.forbidden);
    if (hits.length) throw new Error(`Wächter nach Tests:\n${hits.join('\n')}`);
    checkTarget(target, source);
    const existingRepo = lstatOrNull(path.join(target, '.git'));
    if (existingRepo) {
      if (fs.realpathSync((await run('git', ['rev-parse', '--show-toplevel'], target)).trim()) !== target || (await run('git', ['status', '--porcelain', '--untracked-files=all'], target)).trim()) throw new Error('Export-Ziel enthält ungesicherte Änderungen oder ist kein eigenes Repository.');
    }
    const plan = syncTarget({ staging, files, target, keep, apply: false });
    if (!opts.dryRun) {
      // Check author/committer identity before modifying the target.
      for (const identity of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) await run('git', ['var', identity], existingRepo ? target : source);
      syncTarget({ staging, files, target, keep, apply: true });
      if (!existingRepo) await run('git', ['init', '-b', 'main'], target);
      await run('git', ['add', '-A'], target);
      if ((await run('git', ['diff', '--cached', '--name-only'], target)).trim()) await run('git', ['commit', '-m', `Export aus Entwicklerversion ${sha.slice(0, 12)}`], target);
    }
    success = true;
    log(`${opts.dryRun ? 'Probe-Export' : 'Export'} ${sha.slice(0, 12)}: ${files.length} Dateien, +${plan.add.length} neu, ~${plan.update.length} geändert, -${plan.remove.length} entfernt. Wächter und npm test bestanden.`);
    if (opts.dryRun) log(`Geprüfter Probeordner: ${staging}\nZiel unverändert: ${target}`);
    return { target, files, plan, sha, staging: opts.dryRun ? staging : null, dryRun: Boolean(opts.dryRun) };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    if (!success || !opts.dryRun) fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (require.main === module) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(2); }
  exportEdition({ ...opts, log: (m) => console.log(m) }).catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { parseArgs, exportEdition, checkTarget, buildStaging, guardScan, syncTarget, readManifest };
