'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { slugify, seedFiles } = require('./project-seed');

const REPO_NAME = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const MAX_REPOS = 300;

// Started from the Dock the app only gets a minimal PATH, so the usual
// install locations of git and gh are added explicitly.
function toolEnv() {
  const home = os.homedir();
  const extra = [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  return {
    ...process.env,
    PATH: [...extra, process.env.PATH || ''].join(':'),
    GIT_TERMINAL_PROMPT: '0', // never hang waiting for a password
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    LC_ALL: 'C',
  };
}

// Always execFile with an argument array — nothing here goes through a shell.
function run(command, args, { cwd, timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout, env: toolEnv(), maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        missing: Boolean(error && error.code === 'ENOENT'),
        stdout: String(stdout || ''),
        stderr: String(stderr || '').trim(),
      });
    });
  });
}

function lastLine(text) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

// Compares repository addresses regardless of protocol, case and ".git".
function normalizeRemote(url) {
  return String(url || '').trim().toLowerCase()
    .replace(/^git@github\.com:/, 'github.com/')
    .replace(/^[a-z]+:\/\/([^@/]+@)?/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
}

// Parses `git status --porcelain=v2 --branch`.
function parseStatus(output) {
  const status = { isRepo: true, branch: null, hasUpstream: false, ahead: 0, behind: 0, changes: 0 };
  for (const line of String(output).split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      status.branch = head === '(detached)' ? null : head;
    } else if (line.startsWith('# branch.upstream ')) {
      status.hasUpstream = true;
    } else if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(line);
      if (match) {
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
    } else if (line && !line.startsWith('#')) {
      status.changes += 1;
    }
  }
  return status;
}

async function githubStatus() {
  const result = await run('gh', ['auth', 'status', '--hostname', 'github.com'], { timeout: 15000 });
  if (result.missing) return { installed: false, loggedIn: false, user: null };
  const match = /account (\S+)/.exec(`${result.stdout}\n${result.stderr}`);
  return { installed: true, loggedIn: result.ok, user: result.ok && match ? match[1] : null };
}

async function originOf(dir) {
  const result = await run('git', ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: 10000 });
  return result.ok ? result.stdout.trim() : null;
}

function createGitService({ cloneDir }) {
  function targetFor(nameWithOwner) {
    return path.join(cloneDir, nameWithOwner.split('/')[1]);
  }

  // Where a repository already lives on disk, or null.
  async function existingClone(nameWithOwner) {
    const target = targetFor(nameWithOwner);
    if (!fs.existsSync(path.join(target, '.git'))) return null;
    const origin = await originOf(target);
    return normalizeRemote(origin) === `github.com/${nameWithOwner.toLowerCase()}` ? target : null;
  }

  async function listRepos() {
    const result = await run('gh', [
      'repo', 'list', '--limit', String(MAX_REPOS),
      '--json', 'nameWithOwner,description,isPrivate,updatedAt',
    ], { timeout: 45000 });
    if (!result.ok) throw new Error(lastLine(result.stderr) || 'Repos konnten nicht geladen werden.');
    let repos;
    try {
      repos = JSON.parse(result.stdout);
    } catch {
      throw new Error('Unerwartete Antwort von GitHub.');
    }
    const list = [];
    for (const repo of Array.isArray(repos) ? repos : []) {
      if (!repo || !REPO_NAME.test(String(repo.nameWithOwner))) continue;
      list.push({
        nameWithOwner: repo.nameWithOwner,
        description: typeof repo.description === 'string' ? repo.description : '',
        isPrivate: Boolean(repo.isPrivate),
        updatedAt: typeof repo.updatedAt === 'string' ? repo.updatedAt : null,
        localPath: await existingClone(repo.nameWithOwner),
      });
    }
    list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return list;
  }

  // Returns the folder of the repository, cloning it first if needed.
  async function cloneRepo(nameWithOwner) {
    if (!REPO_NAME.test(String(nameWithOwner))) throw new Error('Ungültiger Repo-Name.');
    const existing = await existingClone(nameWithOwner);
    if (existing) return { path: existing, cloned: false };
    const target = targetFor(nameWithOwner);
    if (path.dirname(target) !== cloneDir) throw new Error('Ungültiger Repo-Name.');
    if (fs.existsSync(target)) {
      throw new Error(`Der Ordner „${path.basename(target)}“ existiert bereits und gehört nicht zu diesem Repo.`);
    }
    fs.mkdirSync(cloneDir, { recursive: true });
    const result = await run('gh', ['repo', 'clone', nameWithOwner, target], { timeout: 10 * 60 * 1000 });
    if (!result.ok) throw new Error(lastLine(result.stderr) || 'Klonen fehlgeschlagen.');
    return { path: target, cloned: true };
  }

  async function status(projectPath) {
    const result = await run('git', ['-C', projectPath, 'status', '--porcelain=v2', '--branch'], { timeout: 15000 });
    if (!result.ok) return { isRepo: false, branch: null, hasUpstream: false, ahead: 0, behind: 0, changes: 0 };
    return parseStatus(result.stdout);
  }

  // Fetches and fast-forwards. Never merges, rebases, commits or discards anything:
  // if the histories have diverged or local edits are in the way, git refuses
  // and the message says so.
  async function pull(projectPath) {
    const before = await status(projectPath);
    if (!before.isRepo || !before.hasUpstream) return { ...before, pulled: false, pushed: false, message: null };
    const fetched = await run('git', ['-C', projectPath, 'fetch', '--quiet'], { timeout: 60000 });
    if (!fetched.ok) {
      return { ...before, pulled: false, pushed: false, message: `Abrufen fehlgeschlagen: ${lastLine(fetched.stderr)}` };
    }
    const current = await status(projectPath);
    if (current.behind === 0) return { ...current, pulled: false, pushed: false, message: null };
    if (current.ahead > 0) {
      return {
        ...current, pulled: false, pushed: false,
        message: 'Lokal und auf GitHub gibt es unterschiedliche Commits. Bitte im Terminal zusammenführen.',
      };
    }
    const pulled = await run('git', ['-C', projectPath, 'pull', '--ff-only', '--quiet'], { timeout: 120000 });
    const after = await status(projectPath);
    if (!pulled.ok) {
      return { ...after, pulled: false, pushed: false, message: `Aktualisieren nicht möglich: ${lastLine(pulled.stderr)}` };
    }
    return { ...after, pulled: true, pushed: false, message: null };
  }

  // Pull as above, then push existing commits. Does not commit.
  async function sync(projectPath) {
    const pulled = await pull(projectPath);
    if (!pulled.isRepo) return { ...pulled, message: 'Dieser Ordner ist kein Git-Repo.' };
    if (!pulled.hasUpstream) {
      return { ...pulled, message: 'Dieser Branch ist noch nicht mit GitHub verbunden (kein Upstream).' };
    }
    if (pulled.message || pulled.ahead === 0) return pulled;
    const pushed = await run('git', ['-C', projectPath, 'push', '--quiet'], { timeout: 120000 });
    const after = await status(projectPath);
    if (!pushed.ok) {
      return { ...after, pulled: pulled.pulled, pushed: false, message: `Push fehlgeschlagen: ${lastLine(pushed.stderr)}` };
    }
    return { ...after, pulled: pulled.pulled, pushed: true, message: null };
  }

  // A new local project: its own folder under cloneDir, git init, planning files, first commit.
  // A missing git identity only skips the commit; the folder is usable either way.
  async function createLocalProject(name) {
    const slug = slugify(name);
    if (!slug) throw new Error('Ungültiger Projektname. Erlaubt sind Buchstaben, Ziffern, Leerzeichen, „-“, „_“ und „.“.');
    const target = path.join(cloneDir, slug);
    if (fs.existsSync(target)) throw new Error(`Der Ordner „${slug}“ existiert bereits.`);
    fs.mkdirSync(target, { recursive: true });
    for (const [file, content] of Object.entries(seedFiles(slug))) {
      fs.writeFileSync(path.join(target, file), content, 'utf8');
    }
    const init = await run('git', ['-C', target, 'init', '-b', 'main']);
    if (!init.ok) {
      return { path: target, name: slug, isRepo: false, committed: false, message: `git init fehlgeschlagen: ${lastLine(init.stderr)}` };
    }
    await run('git', ['-C', target, 'add', '-A']);
    const commit = await run('git', ['-C', target, 'commit', '-m', 'Projekt angelegt (Planungsstand)']);
    return {
      path: target, name: slug, isRepo: true, committed: commit.ok,
      message: commit.ok ? null : `Erster Commit fehlgeschlagen: ${lastLine(commit.stderr)}`,
    };
  }

  // Creates the GitHub repo for an existing local project and pushes it.
  // The visibility is always passed explicitly by the caller.
  async function publishRepo(projectPath, { isPrivate }) {
    const local = await status(projectPath);
    if (!local.isRepo) throw new Error('Dieser Ordner ist kein Git-Repo.');
    if (await originOf(projectPath)) throw new Error('Dieses Projekt hat bereits ein GitHub-Repo (origin).');
    const name = path.basename(projectPath);
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name)) {
      throw new Error('Der Ordnername ist als Repo-Name ungeeignet (nur Buchstaben, Ziffern, „-“, „_“, „.“).');
    }
    const result = await run('gh', [
      'repo', 'create', name, isPrivate ? '--private' : '--public',
      '--source', projectPath, '--remote', 'origin', '--push',
    ], { timeout: 120000 });
    if (!result.ok) throw new Error(lastLine(result.stderr) || 'Repo konnte nicht angelegt werden.');
    return { ...(await status(projectPath)), repo: lastLine(result.stdout) || name };
  }

  return { githubStatus, listRepos, cloneRepo, status, pull, sync, createLocalProject, publishRepo };
}

module.exports = { createGitService, parseStatus, normalizeRemote, REPO_NAME };
