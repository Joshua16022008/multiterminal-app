'use strict';
// Optional separate Git working copies (worktrees) for terminal tiles.
//
// A record is { workspaceId, projectId, cwd, branch, baseRef, managed, createdAt }.
// The project folder itself stays the default; a worktree is only used when a
// tile is created with its workspaceId. Nothing here merges, resets, stashes or
// force-removes: uncommitted work is reported, never moved or deleted.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { parsePorcelain } = require('./worktree-tree.js');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_RECORDS = 200;

function gitEnv() {
  const home = os.homedir();
  const extra = [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  return {
    ...process.env,
    PATH: [...extra, process.env.PATH || ''].join(':'),
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  };
}

// execFile with an argument array: nothing goes through a shell.
function runGit(args, cwd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: timeoutMs, env: gitEnv(), maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        // Exit status (a number) when git ran and failed; lets callers tell "no" from "error".
        code: error && typeof error.code === 'number' ? error.code : undefined,
        missing: Boolean(error && error.code === 'ENOENT'),
        stdout: String(stdout || ''),
        stderr: String(stderr || '').trim(),
      });
    });
  });
}

function real(p) {
  try { return fs.realpathSync(p); } catch (_) { return null; }
}

function isRecord(r) {
  return r && typeof r === 'object'
    && ID_RE.test(r.workspaceId || '') && ID_RE.test(r.projectId || '')
    && typeof r.cwd === 'string' && r.cwd.length > 0
    && typeof r.branch === 'string' && typeof r.baseRef === 'string';
}

function slug(branch) {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'arbeitskopie';
}

// getProjectPath(projectId) is optional; adopt() needs the repository folder.
function createWorktreeService({ dataDir, run = runGit, getProjectPath } = {}) {
  if (typeof dataDir !== 'string' || !dataDir) throw new Error('createWorktreeService: dataDir must be a non-empty string');
  const file = path.join(dataDir, 'worktrees.json');
  const baseDir = path.join(dataDir, 'worktrees');

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const list = Array.isArray(raw && raw.worktrees) ? raw.worktrees : [];
      const seen = new Set();
      const out = [];
      for (const r of list) {
        if (!isRecord(r) || seen.has(r.workspaceId)) continue;
        seen.add(r.workspaceId);
        out.push({
          workspaceId: r.workspaceId, projectId: r.projectId, cwd: r.cwd, branch: r.branch,
          baseRef: r.baseRef, managed: r.managed !== false, createdAt: Number(r.createdAt) || 0,
        });
        if (out.length >= MAX_RECORDS) break;
      }
      return out;
    } catch (_) {
      return [];
    }
  }

  function save(list) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, worktrees: list }, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      throw err;
    }
  }

  // Which paths git itself knows as worktrees of this repository.
  async function registeredPaths(repoPath) {
    const r = await run(['worktree', 'list', '--porcelain'], repoPath);
    if (!r.ok) return null;
    const out = new Set();
    for (const entry of parsePorcelain(r.stdout)) {
      const p = real(entry.path);
      if (p) out.add(p);
    }
    return out;
  }

  async function isDirty(cwd) {
    const r = await run(['status', '--porcelain'], cwd);
    if (!r.ok) return null;
    return r.stdout.split('\n').filter((l) => l.trim()).length;
  }

  return {
    list(projectId) {
      const all = load();
      return projectId === undefined ? all : all.filter((r) => r.projectId === String(projectId));
    },

    get(workspaceId) {
      return load().find((r) => r.workspaceId === String(workspaceId)) || null;
    },

    // Creates a new branch in a new folder under <dataDir>/worktrees. The project
    // folder is only read: its uncommitted changes are not taken along, and the
    // result says how many there are so the UI can make that visible.
    async create({ project, branch, baseRef } = {}) {
      if (!project || !ID_RE.test(project.id || '') || typeof project.path !== 'string') {
        return { ok: false, error: 'Projekt unbekannt.' };
      }
      const name = typeof branch === 'string' ? branch.trim() : '';
      if (!name || name.length > 120 || name.startsWith('-') || /\s/.test(name)) {
        return { ok: false, error: 'Ungültiger Branch-Name.' };
      }
      const check = await run(['check-ref-format', '--branch', name], project.path);
      if (check.missing) return { ok: false, error: 'git wurde nicht gefunden.' };
      if (!check.ok) return { ok: false, error: 'Ungültiger Branch-Name.' };

      const inside = await run(['rev-parse', '--is-inside-work-tree'], project.path);
      if (!inside.ok || inside.stdout.trim() !== 'true') return { ok: false, error: 'Das Projekt ist kein Git-Repository.' };

      const base = typeof baseRef === 'string' && baseRef.trim() ? baseRef.trim() : 'HEAD';
      if (base.startsWith('-') || /\s/.test(base) || base.length > 200) return { ok: false, error: 'Ungültige Ausgangsbasis.' };
      const baseOk = await run(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], project.path);
      if (!baseOk.ok) return { ok: false, error: `Ausgangsbasis „${base}“ nicht gefunden.` };

      const exists = await run(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], project.path);
      if (exists.ok) return { ok: false, error: `Branch „${name}“ existiert bereits.` };

      const workspaceId = `wt-${crypto.randomBytes(4).toString('hex')}`;
      const dir = path.join(baseDir, project.id, `${slug(name)}-${workspaceId.slice(3)}`);
      if (fs.existsSync(dir)) return { ok: false, error: 'Zielordner existiert bereits.' };
      fs.mkdirSync(path.dirname(dir), { recursive: true });

      const projectChanges = await isDirty(project.path);
      const added = await run(['worktree', 'add', '-b', name, dir, base], project.path);
      if (!added.ok) return { ok: false, error: added.stderr || 'Arbeitskopie konnte nicht angelegt werden.' };

      const record = {
        workspaceId, projectId: project.id, cwd: real(dir) || dir, branch: name, baseRef: base,
        managed: true, createdAt: Date.now(),
      };
      const list = load();
      list.push(record);
      try {
        save(list);
      } catch (err) {
        // Without a record the folder would be orphaned; undo only what was just made.
        await run(['worktree', 'remove', dir], project.path);
        await run(['branch', '-d', name], project.path);
        return { ok: false, error: `Zuordnung nicht gespeichert: ${err.message}` };
      }
      return { ok: true, worktree: record, projectChanges: projectChanges || 0 };
    },

    // The folder a tile may start in. A missing or unregistered worktree is an
    // error, never a silent fallback to the project folder.
    async resolveCwd(workspaceId, projectId, projectPath) {
      const rec = this.get(workspaceId);
      if (!rec || rec.projectId !== String(projectId)) return { ok: false, error: 'Arbeitskopie unbekannt.' };
      const cwd = real(rec.cwd);
      if (!cwd) return { ok: false, missing: true, error: `Arbeitskopie fehlt: ${rec.cwd}` };
      const known = await registeredPaths(projectPath);
      if (known && !known.has(cwd)) return { ok: false, missing: true, error: 'Arbeitskopie ist bei Git nicht mehr eingetragen.' };
      return { ok: true, cwd, worktree: rec };
    },

    // Read-only state for the UI: exists, current branch, number of changed files.
    async inspect(workspaceId) {
      const rec = this.get(workspaceId);
      if (!rec) return { ok: false, error: 'Arbeitskopie unbekannt.' };
      const cwd = real(rec.cwd);
      if (!cwd) return { ok: true, exists: false, branch: rec.branch, changes: 0, worktree: rec };
      const changes = await isDirty(cwd);
      const head = await run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
      return {
        ok: true, exists: true, branch: head.ok ? head.stdout.trim() : rec.branch,
        changes: changes === null ? 0 : changes, unreadable: changes === null, worktree: rec,
      };
    },

    // Links a working copy that another tool created (managed:false). Git must
    // list it for this project; the project folder itself and prunable entries
    // are refused. Adopting the same folder again returns the existing record.
    async adopt({ projectId, cwd, projectPath } = {}) {
      if (!ID_RE.test(projectId || '')) return { ok: false, error: 'Projekt unbekannt.' };
      if (typeof cwd !== 'string' || !cwd) return { ok: false, error: 'Ordner fehlt.' };
      const repo = typeof projectPath === 'string' && projectPath ? projectPath
        : (typeof getProjectPath === 'function' ? getProjectPath(projectId) : null);
      if (typeof repo !== 'string' || !repo) return { ok: false, error: 'Projekt unbekannt.' };
      const target = real(cwd);
      if (!target) return { ok: false, error: 'Ordner nicht gefunden.' };
      if (target === real(repo)) return { ok: false, error: 'Das ist der Projektordner selbst.' };

      const existing = load().find((r) => r.projectId === projectId && real(r.cwd) === target);
      if (existing) return { ok: true, workspace: existing, existing: true };

      const listed = await run(['worktree', 'list', '--porcelain'], repo);
      if (!listed.ok) return { ok: false, error: listed.stderr || 'Arbeitskopien nicht lesbar.' };
      const entry = parsePorcelain(listed.stdout).find((e) => real(e.path) === target);
      if (!entry) return { ok: false, error: 'Dieser Ordner ist bei Git keine Arbeitskopie des Projekts.' };
      if (entry.prunable || entry.bare) return { ok: false, error: 'Diese Arbeitskopie ist verwaist.' };

      const list = load();
      if (list.length >= MAX_RECORDS) return { ok: false, error: 'Zu viele Arbeitskopien verknüpft.' };
      const record = {
        workspaceId: `wt-${crypto.randomBytes(4).toString('hex')}`, projectId, cwd: target,
        branch: entry.branch || '', baseRef: '', managed: false, createdAt: Date.now(),
      };
      list.push(record);
      try { save(list); } catch (err) { return { ok: false, error: `Zuordnung nicht gespeichert: ${err.message}` }; }
      return { ok: true, workspace: record };
    },

    // Explicit user action only. Refuses when there is anything uncommitted
    // (or the state cannot be read) and never uses --force. The branch stays.
    async remove(workspaceId, projectPath) {
      const rec = this.get(workspaceId);
      if (!rec) return { ok: false, error: 'Arbeitskopie unbekannt.' };
      // A linked working copy belongs to someone else: only forget the record,
      // never touch the folder or git's worktree registration.
      if (!rec.managed) {
        save(load().filter((r) => r.workspaceId !== rec.workspaceId));
        return { ok: true, forgotten: true };
      }
      const cwd = real(rec.cwd);
      if (cwd) {
        const changes = await isDirty(cwd);
        if (changes === null) return { ok: false, error: 'Zustand der Arbeitskopie nicht lesbar; nichts entfernt.' };
        if (changes > 0) return { ok: false, dirty: true, changes, error: `${changes} nicht gesicherte Änderungen; nichts entfernt.` };
        const r = await run(['worktree', 'remove', cwd], projectPath);
        if (!r.ok) return { ok: false, error: r.stderr || 'Entfernen fehlgeschlagen.' };
      }
      save(load().filter((r) => r.workspaceId !== rec.workspaceId));
      return { ok: true, branchKept: rec.branch };
    },
  };
}

module.exports = { createWorktreeService, runGit };
