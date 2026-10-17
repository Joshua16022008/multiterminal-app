'use strict';
// Read-only picture of a project's git worktrees ("Stammbaum"): which working
// copies exist, who owns them and how far each branch is from the trunk.
// Everything goes through an injected run(args, cwd, timeoutMs) that wraps
// execFile with an argument array; nothing here writes to a repository.
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const GIT_TIMEOUT_MS = 10000;
const MAX_PARALLEL = 4;
const CACHE_MS = 10000;
const MAX_NODES = 100;

function real(p) {
  try { return fs.realpathSync(p); } catch (_) { return null; }
}

// Parses `git worktree list --porcelain`. Records are separated by blank lines.
function parsePorcelain(text) {
  const out = [];
  let cur = null;
  const flush = () => { if (cur && cur.path) out.push(cur); cur = null; };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) { flush(); continue; }
    if (line.startsWith('worktree ')) {
      flush();
      cur = {
        path: line.slice('worktree '.length), head: null, branch: null, detached: false,
        bare: false, locked: false, lockReason: null, prunable: false, prunableReason: null,
      };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('HEAD ')) cur.head = line.slice(5).trim() || null;
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '') || null;
    else if (line === 'detached') cur.detached = true;
    else if (line === 'bare') cur.bare = true;
    else if (line === 'locked' || line.startsWith('locked ')) { cur.locked = true; cur.lockReason = line.slice(7).trim() || null; }
    else if (line === 'prunable' || line.startsWith('prunable ')) { cur.prunable = true; cur.prunableReason = line.slice(9).trim() || null; }
  }
  flush();
  return out;
}

// Who created a working copy, judged only by its path. `appDir` (optional) is
// the folder this app creates its own worktrees in.
function classifyOrigin(p, homeDir, appDir) {
  const norm = String(p || '').replace(/\\/g, '/');
  const home = String(homeDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (home && (norm === `${home}/.codex/worktrees` || norm.startsWith(`${home}/.codex/worktrees/`))) return 'codex';
  if (norm.includes('/.agent-worktrees/')) return 'agent-worktrees';
  const app = String(appDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (app && (norm === app || norm.startsWith(`${app}/`))) return 'app';
  return 'other';
}

// refs: { originHead: 'origin/main'|null, branches: string[], current: string|null }
// Order: origin/HEAD, main, master, the project folder's current branch.
function pickTrunk(refs) {
  const r = refs || {};
  const branches = Array.isArray(r.branches) ? r.branches : [];
  if (typeof r.originHead === 'string' && r.originHead) {
    const bare = r.originHead.replace(/^origin\//, '');
    return branches.includes(bare) ? bare : r.originHead;
  }
  if (branches.includes('main')) return 'main';
  if (branches.includes('master')) return 'master';
  if (typeof r.current === 'string' && r.current && r.current !== 'HEAD') return r.current;
  return null;
}

function toInt(text) {
  const n = Number.parseInt(String(text).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

// Runs at most `limit` tasks at the same time.
function createLimiter(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || !queue.length) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active -= 1; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

function createWorktreeTree({ run, worktrees, homeDir = os.homedir(), appDir = null, now = Date.now, cacheMs = CACHE_MS } = {}) {
  const baseRun = run || ((args, cwd, timeout) => require('./worktree-service.js').runGit(args, cwd, timeout));
  const cache = new Map(); // project key -> { at, signature, value }

  async function tree(project) {
    if (!project || typeof project.path !== 'string' || !project.path) {
      return { ok: true, isGit: false, projectPath: '', generatedAt: now(), trunk: null, nodes: [] };
    }
    const records = worktrees && typeof worktrees.list === 'function' ? worktrees.list(String(project.id)) : [];
    const signature = JSON.stringify(records.map((r) => [r.workspaceId, r.cwd, r.managed, r.branch]));
    const key = `${project.id}\u0000${project.path}`;
    const hit = cache.get(key);
    if (hit && hit.signature === signature && now() - hit.at < cacheMs) return hit.value;

    const limit = createLimiter(MAX_PARALLEL);
    const git = (args, cwd) => limit(async () => {
      try {
        const r = await baseRun(args, cwd, GIT_TIMEOUT_MS);
        return r || { ok: false, stdout: '', stderr: '' };
      } catch (err) {
        return { ok: false, stdout: '', stderr: String(err && err.message || err) };
      }
    });

    const value = await build(project, records, git);
    // Only a real result is cached; a missing git binary or a transient failure is retried.
    if (value.isGit) cache.set(key, { at: now(), signature, value });
    else cache.delete(key);
    return value;
  }

  async function build(project, records, git) {
    const empty = { ok: true, isGit: false, projectPath: project.path, generatedAt: now(), trunk: null, nodes: [] };
    const inside = await git(['rev-parse', '--is-inside-work-tree'], project.path);
    if (!inside.ok || inside.stdout.trim() !== 'true') return empty;
    const listed = await git(['worktree', 'list', '--porcelain'], project.path);
    if (!listed.ok) return empty;
    const entries = parsePorcelain(listed.stdout).filter((e) => !e.bare).slice(0, MAX_NODES);

    const [originHead, localBranches, current] = await Promise.all([
      git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], project.path),
      git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], project.path),
      git(['rev-parse', '--abbrev-ref', 'HEAD'], project.path),
    ]);
    const trunkName = pickTrunk({
      originHead: originHead.ok ? originHead.stdout.trim() : null,
      branches: localBranches.ok ? localBranches.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [],
      current: current.ok ? current.stdout.trim() : null,
    });
    const trunk = trunkName ? await commitInfo(git, project.path, trunkName) : null;
    const trunkRef = trunk ? trunkName : null;

    const projectReal = real(project.path) || project.path;
    const recByPath = new Map();
    for (const r of records) { const rp = real(r.cwd); if (rp && !recByPath.has(rp)) recByPath.set(rp, r); }

    const nodes = await Promise.all(entries.map((e) => nodeFor(git, e, {
      projectReal, projectPath: project.path, recByPath, trunkRef, trunkName, homeDir, appDir,
    })));
    return {
      ok: true, isGit: true, projectPath: project.path, generatedAt: now(),
      trunk: trunk ? { name: trunkName, head: trunk.sha, subject: trunk.subject, time: trunk.time } : null,
      nodes,
    };
  }

  async function commitInfo(git, cwd, ref) {
    const r = await git(['log', '-1', '--format=%H%x00%s%x00%ct%x00%an', ref, '--'], cwd);
    if (!r.ok) return null;
    const [sha, subject, ct, author] = r.stdout.replace(/\n$/, '').split('\0');
    if (!sha) return null;
    const time = Number(ct) ? Number(ct) * 1000 : null;
    return { sha, subject: subject || '', time, author: author || '' };
  }

  async function nodeFor(git, e, ctx) {
    const rp = real(e.path);
    const pathKey = rp || e.path;
    const rec = ctx.recByPath.get(pathKey) || null;
    const isProject = pathKey === ctx.projectReal;
    const kind = isProject ? 'project' : rec ? (rec.managed ? 'managed' : 'linked') : 'external';
    let origin = classifyOrigin(pathKey, ctx.homeDir, ctx.appDir);
    if (kind === 'managed') origin = 'app';
    const missing = !rp;
    const node = {
      id: rec ? rec.workspaceId : `path:${crypto.createHash('sha1').update(pathKey).digest('hex').slice(0, 10)}`,
      path: e.path, branch: e.detached ? null : e.branch, head: e.head, detached: Boolean(e.detached),
      locked: e.locked, prunable: e.prunable, missing, kind, origin,
      workspaceId: rec ? rec.workspaceId : null,
      forkPoint: null, ahead: null, behind: null, merged: null, last: null, changes: null,
    };
    const ref = e.head;
    const canRead = !e.prunable && Boolean(ref);

    const tasks = [];
    if (canRead) {
      tasks.push(commitInfo(git, ctx.projectPath, ref).then((c) => { node.last = c; }));
      if (ctx.trunkRef) {
        const isTrunkNode = !node.detached && node.branch === ctx.trunkName;
        if (isTrunkNode) {
          node.ahead = 0; node.behind = 0; node.forkPoint = ref;
        } else {
          tasks.push(git(['merge-base', ctx.trunkRef, ref], ctx.projectPath).then((r) => {
            node.forkPoint = r.ok ? (r.stdout.trim() || null) : null;
          }));
          tasks.push(git(['rev-list', '--left-right', '--count', `${ctx.trunkRef}...${ref}`], ctx.projectPath).then((r) => {
            const parts = r.ok ? r.stdout.trim().split(/\s+/) : [];
            if (parts.length === 2) { node.behind = toInt(parts[0]); node.ahead = toInt(parts[1]); }
          }));
          tasks.push(git(['merge-base', '--is-ancestor', ref, ctx.trunkRef], ctx.projectPath).then((r) => {
            if (r.ok) node.merged = true;
            else if (r.code === 1 || (r.code === undefined && !r.stderr)) node.merged = false;
          }));
        }
      }
    }
    if (canRead && !missing) {
      tasks.push(git(['status', '--porcelain'], pathKey).then((r) => {
        if (r.ok) node.changes = r.stdout.split('\n').filter((l) => l.trim()).length;
      }));
    }
    await Promise.all(tasks);
    return node;
  }

  // Branch checked out in `cwd`, or null when detached, unreadable or not a repo.
  async function branchOf(cwd) {
    if (typeof cwd !== 'string' || !cwd) return null;
    try {
      const r = await baseRun(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, GIT_TIMEOUT_MS);
      if (!r || !r.ok) return null;
      const name = r.stdout.trim();
      return name && name !== 'HEAD' ? name : null;
    } catch (_) {
      return null;
    }
  }

  return { tree, branchOf, invalidate: (projectId) => { for (const k of [...cache.keys()]) if (k.startsWith(`${projectId}\u0000`)) cache.delete(k); } };
}

module.exports = { createWorktreeTree, parsePorcelain, classifyOrigin, pickTrunk };
