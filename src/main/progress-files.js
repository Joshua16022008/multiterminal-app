'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MAX_TEXT = 2000000;
const PROGRESS_NAME = 'PROGRESS.md';

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Validates projectPath and returns its real (symlink-resolved) path.
function resolveProject(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath || projectPath.includes('\0')) {
    throw new Error('projectPath must be a non-empty string');
  }
  if (!path.isAbsolute(projectPath)) throw new Error('projectPath must be an absolute path');
  let real;
  try {
    real = fs.realpathSync(projectPath);
    if (!fs.statSync(real).isDirectory()) throw new Error('not a directory');
  } catch (_) {
    throw new Error('projectPath must be an existing directory');
  }
  return real;
}

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

// If p exists (possibly as a symlink), its real path must stay inside root.
function assertNoEscape(root, p) {
  const st = lstatOrNull(p);
  if (!st) return;
  const real = fs.realpathSync(p); // throws on dangling symlink: also refused
  if (!isInside(root, real)) throw new Error(`Refusing to use ${path.basename(p)}: it points outside the project folder`);
}

function template(projectName) {
  const name = String(projectName || 'Projekt').replace(/[\r\n]+/g, ' ').trim() || 'Projekt';
  return [
    `# ${name} – Fortschritt`,
    '',
    '> Agenten: Diese Datei nach jedem abgeschlossenen Schritt aktualisieren.',
    '',
    '## Aktueller Stand',
    '',
    '- ',
    '',
    '## Nächster Schritt',
    '',
    '- ',
    '',
    '## Erledigt',
    '',
    '- ',
    '',
    '## Offene Fragen',
    '',
    '- ',
    '',
  ].join('\n');
}

function ensureProgress(projectPath, projectName) {
  const root = resolveProject(projectPath);
  const file = path.join(root, PROGRESS_NAME);
  assertNoEscape(root, file);
  if (lstatOrNull(file)) {
    return { path: file, content: fs.readFileSync(file, 'utf8'), created: false };
  }
  const content = template(projectName);
  try {
    fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      assertNoEscape(root, file);
      return { path: file, content: fs.readFileSync(file, 'utf8'), created: false };
    }
    throw err;
  }
  return { path: file, content, created: true };
}

function readProgress(projectPath) {
  const root = resolveProject(projectPath);
  const file = path.join(root, PROGRESS_NAME);
  if (!lstatOrNull(file)) return null;
  assertNoEscape(root, file);
  return { path: file, content: fs.readFileSync(file, 'utf8') };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function slugify(title) {
  const s = String(title == null ? '' : title)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s || 'terminal';
}

function chooseFence(text) {
  let longest = 0;
  const re = /`+/g;
  let m;
  while ((m = re.exec(text)) !== null) longest = Math.max(longest, m[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

function writeSnapshot(projectPath, title, text, now = new Date()) {
  const root = resolveProject(projectPath);
  const when = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const dirMt = path.join(root, '.multiterminal');
  assertNoEscape(root, dirMt);
  const snapDir = path.join(dirMt, 'snapshots');
  fs.mkdirSync(snapDir, { recursive: true });
  // Verify again after creation (covers a symlinked snapshots dir too).
  const realSnap = fs.realpathSync(snapDir);
  if (!isInside(root, realSnap)) throw new Error('Refusing to write: snapshots folder points outside the project folder');

  const cleanTitle = String(title == null ? '' : title).replace(/[\r\n]+/g, ' ').trim() || 'Terminal';
  let body = typeof text === 'string' ? text : String(text == null ? '' : text);
  if (body.length > MAX_TEXT) body = body.slice(body.length - MAX_TEXT);

  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}_${pad(when.getHours())}-${pad(when.getMinutes())}-${pad(when.getSeconds())}`;
  const human = `${stamp.slice(0, 10)} ${stamp.slice(11).replace(/-/g, ':')}`;
  const fence = chooseFence(body);
  const content = `# ${cleanTitle}\n\nGespeichert: ${human}\n\n${fence}\n${body}${body.endsWith('\n') ? '' : '\n'}${fence}\n`;
  const base = `${stamp}-${slugify(cleanTitle)}`;

  for (let i = 0; i < 1000; i++) {
    const name = i === 0 ? `${base}.md` : `${base}-${i + 1}.md`;
    const target = path.join(realSnap, name);
    if (!isInside(root, target)) throw new Error('Resolved path escapes the project folder');
    try {
      fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
      return { path: target };
    } catch (err) {
      if (err && err.code === 'EEXIST') continue;
      throw err;
    }
  }
  throw new Error('Could not find a free snapshot file name');
}

module.exports = { ensureProgress, readProgress, writeSnapshot };
