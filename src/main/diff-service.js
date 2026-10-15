'use strict';
// F04: read-only view of local Git changes. Nothing here stages, resets, commits or checks out.
// Every git call is execFile with an argument array; paths never pass through a shell.

const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MAX_BYTES = 400 * 1024; // larger diffs are cut with a visible note
const MAX_LINES = 5000;
const MAX_FILES = 2000;

function toolEnv() {
  const home = os.homedir();
  const extra = [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  return { ...process.env, PATH: [...extra, process.env.PATH || ''].join(':'), GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' };
}

function git(cwd, args, { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=off', '-c', 'color.ui=never', ...args],
      { cwd, timeout, env: toolEnv(), maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => resolve({
        code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
        missing: Boolean(error && error.code === 'ENOENT'),
        stdout: String(stdout || ''),
        stderr: String(stderr || '').trim(),
      }));
  });
}

// `git status --porcelain=v1 -z`: "XY path\0", renames/copies add "\0old".
function parseStatus(raw) {
  const parts = raw.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const x = entry[0], y = entry[1], file = entry.slice(3);
    let oldPath = null;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') oldPath = parts[++i] || null;
    if (x === '!' && y === '!') continue;
    const untracked = x === '?' && y === '?';
    files.push({
      path: file, oldPath, index: x, worktree: y, untracked,
      staged: !untracked && x !== ' ',
      unstaged: !untracked && y !== ' ',
    });
    if (files.length >= MAX_FILES) break;
  }
  return files;
}

// Unified diff → hunks with numbered lines. Binary and header lines are reported separately.
function parseDiff(text) {
  const hunks = [];
  let binary = false, cur = null, oldNo = 0, newNo = 0;
  for (const line of text.split('\n')) {
    if (/^Binary files .* differ$/.test(line) || line === 'GIT binary patch') { binary = true; continue; }
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (m) {
      oldNo = Number(m[1]); newNo = Number(m[2]);
      cur = { header: line, lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue; // diff --git, index, ---/+++ headers
    if (line.startsWith('+')) cur.lines.push({ type: '+', oldNo: null, newNo: newNo++, text: line.slice(1) });
    else if (line.startsWith('-')) cur.lines.push({ type: '-', oldNo: oldNo++, newNo: null, text: line.slice(1) });
    else if (line.startsWith(' ')) cur.lines.push({ type: ' ', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    else if (line.startsWith('\\')) cur.lines.push({ type: '\\', oldNo: null, newNo: null, text: line });
  }
  return { binary, hunks };
}

function limit(stdout) {
  let text = stdout, truncated = false;
  if (Buffer.byteLength(text) > MAX_BYTES) { text = Buffer.from(text).subarray(0, MAX_BYTES).toString('utf8'); truncated = true; }
  const lines = text.split('\n');
  if (lines.length > MAX_LINES) { text = lines.slice(0, MAX_LINES).join('\n'); truncated = true; }
  if (truncated) text = text.slice(0, text.lastIndexOf('\n') + 1); // never end mid-line
  return { text, truncated };
}

function createDiffService({ run = git } = {}) {
  async function listChanges(cwd) {
    const top = await run(cwd, ['rev-parse', '--show-toplevel']);
    if (top.missing) return { ok: false, error: 'Git ist nicht installiert oder nicht im PATH.' };
    if (top.code !== 0) return { ok: false, notRepo: true, error: 'Dieser Ordner ist kein Git-Repository.' };
    const [status, branch, head] = await Promise.all([
      run(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
      run(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']),
    ]);
    if (status.code !== 0) return { ok: false, error: status.stderr || 'git status ist fehlgeschlagen.' };
    const files = parseStatus(status.stdout);
    return {
      ok: true,
      root: top.stdout.trim(),
      branch: branch.code === 0 ? branch.stdout.trim() : null,
      hasHead: head.code === 0,
      files,
      truncated: files.length >= MAX_FILES,
    };
  }

  // mode: 'staged' (Index gegen HEAD), 'unstaged' (Arbeitsbaum gegen Index), 'untracked' (neue Datei).
  // The path must be one that `git status` currently reports — no arbitrary file reads.
  async function fileDiff(cwd, file, mode) {
    if (typeof file !== 'string' || !file || file.length > 4096) return { ok: false, error: 'Ungültiger Dateipfad.' };
    if (!['staged', 'unstaged', 'untracked'].includes(mode)) return { ok: false, error: 'Unbekannter Vergleich.' };
    const list = await listChanges(cwd);
    if (!list.ok) return list;
    const entry = list.files.find((f) => f.path === file);
    const fits = entry && (mode === 'untracked' ? entry.untracked : mode === 'staged' ? entry.staged : entry.unstaged);
    if (!fits) return { ok: false, gone: true, error: 'Diese Änderung gibt es nicht mehr. Bitte aktualisieren.' };
    let args;
    if (mode === 'untracked') args = ['diff', '--no-index', '--no-ext-diff', '--', '/dev/null', file];
    else if (mode === 'staged') args = ['diff', '--cached', '--no-ext-diff', '-M', '--', ...(entry.oldPath ? [entry.oldPath] : []), file];
    else args = ['diff', '--no-ext-diff', '-M', '--', file];
    const res = await run(list.root, args);
    // --no-index exits 1 when the files differ; a real error has no stdout.
    if (res.code !== 0 && !(mode === 'untracked' && res.code === 1 && res.stdout)) {
      return { ok: false, error: res.stderr || 'git diff ist fehlgeschlagen.' };
    }
    const { text, truncated } = limit(res.stdout);
    const parsed = parseDiff(text);
    return {
      ok: true, path: file, oldPath: entry.oldPath, mode,
      compare: mode === 'staged' ? (list.hasHead ? 'Index gegen HEAD' : 'Index (noch kein Commit)') : mode === 'unstaged' ? 'Arbeitsbaum gegen Index' : 'Neue, noch nicht verfolgte Datei',
      status: { index: entry.index, worktree: entry.worktree },
      binary: parsed.binary, hunks: parsed.hunks, truncated, empty: !parsed.binary && parsed.hunks.length === 0,
    };
  }

  return { listChanges, fileDiff };
}

module.exports = { createDiffService, parseStatus, parseDiff, MAX_BYTES, MAX_LINES };
