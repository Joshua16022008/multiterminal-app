'use strict';

// Projektmanager: nur lesendes Lagebild eines Projekts. Alle Abhängigkeiten werden
// eingespeist; jede Funktion fängt Fehler ab und liefert { ok:false, error }.
// Unbekanntes bleibt null/'unknown' – es wird nichts geraten.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_DOC_BYTES = 64 * 1024;
const AGENT_STATES = ['working', 'needs-input', 'turn-complete', 'error', 'unknown'];
const DOC_FILES = Object.freeze({ progress: 'PROGRESS.md', workInProgress: 'WORK_IN_PROGRESS.md', projectStatus: 'PROJECT_STATUS.md' });

function managerIdFor(projectId) {
  return 'pm-' + projectId;
}

function isValidManagerProject(projectId) {
  return typeof projectId === 'string' && ID_RE.test('pm-' + projectId) && ID_RE.test(projectId);
}

function message(err) {
  return err && err.message ? err.message : String(err);
}

function readLimited(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(MAX_DOC_BYTES);
    const n = fs.readSync(fd, buf, 0, MAX_DOC_BYTES, 0);
    return buf.slice(0, n).toString('utf8');
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) { /* closed */ } }
  }
}

// Erster Absatz unter '## Nächster Schritt' (bis zur nächsten Leerzeile oder Überschrift).
function parseNextStep(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s+Nächster Schritt\s*$/i.test(l.trim()));
  if (start < 0) return null;
  const para = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6}\s/.test(l)) break;
    if (l.trim() === '') { if (para.length) break; continue; }
    para.push(l.trim());
  }
  return para.length ? para.join(' ') : null;
}

// Aktive Reservierungen = Abschnitte '### …' unter '## Aktive Reservierungen', deren Status
// nicht mit abgeschlossen/erledigt/freigegeben beginnt. Ohne den Abschnitt: null (unbekannt).
function countActiveReservations(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s+Aktive Reservierungen\s*$/i.test(l.trim()));
  if (start < 0) return null;
  let count = 0;
  let inBlock = false;
  let status = null;
  const close = () => {
    if (inBlock && !(status && /^(abgeschlossen|erledigt|freigegeben)/i.test(status))) count += 1;
  };
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s/.test(l)) break;
    if (/^###\s/.test(l)) { close(); inBlock = true; status = null; continue; }
    const m = /^-\s*Status:\s*(.*)$/i.exec(l.trim());
    if (inBlock && m && status === null) status = m[1].trim();
  }
  close();
  return count;
}

function runGit(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 15000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' } }, (error, stdout) => {
      resolve(error ? null : String(stdout || ''));
    });
  });
}

// Standard für `gitInfo`: git log --all --oneline -n 40 und git branch -a (execFile, keine Shell).
async function defaultGitInfo(projectPath) {
  const [log, branches] = await Promise.all([
    runGit(['log', '--all', '--oneline', '-n', '40'], projectPath),
    runGit(['branch', '-a'], projectPath),
  ]);
  return { log, branches };
}

// Standard für `readDocs`: die drei Koordinationsdokumente (je max. 64 KB, fehlend = null).
function defaultReadDocs(projectPath) {
  const out = {};
  for (const [key, name] of Object.entries(DOC_FILES)) out[key] = readLimited(path.join(projectPath, name));
  return out;
}

function createPmService(deps = {}) {
  const {
    getProject, getSessionTerminals, getAgentStates, ptySnapshot, worktrees, diffs, ports,
    readDocs = defaultReadDocs, gitInfo = defaultGitInfo, outputBuffer,
  } = deps;

  async function guarded(fn) {
    try { return await fn(); } catch (err) { return { ok: false, error: message(err) }; }
  }

  function projectOf(projectId) {
    const project = typeof getProject === 'function' ? getProject(String(projectId)) : null;
    if (!project) throw new Error('Projekt nicht gefunden.');
    return { id: project.id, name: project.name, path: project.path };
  }

  // Kacheln des Projekts: gespeicherte Sitzung + laufende Prozesse; der Manager erscheint nie.
  function listTerminals(projectId) {
    const managerId = managerIdFor(projectId);
    const saved = (typeof getSessionTerminals === 'function' ? getSessionTerminals(projectId) : null) || [];
    const live = (typeof ptySnapshot === 'function' ? ptySnapshot() : null) || [];
    const liveIds = new Map(live.filter((t) => t && t.projectId === projectId).map((t) => [t.terminalId, t]));
    const agents = new Map(((typeof getAgentStates === 'function' ? getAgentStates() : null) || []).map((a) => [String(a.terminalId), a]));
    const out = [];
    const seen = new Set();
    const add = (id, title, preset, workspaceId) => {
      if (id === managerId || seen.has(id)) return;
      seen.add(id);
      const a = agents.get(id);
      out.push({
        id,
        title: title || id,
        preset: typeof preset === 'string' && preset ? preset : null,
        running: liveIds.has(id),
        agent: a ? {
          provider: typeof a.provider === 'string' ? a.provider : null,
          state: AGENT_STATES.includes(a.state) ? a.state : 'unknown',
          since: Number.isFinite(a.observedAt) ? a.observedAt : null,
        } : null,
        workspace: workspaceId ? { workspaceId, branch: null } : null,
      });
    };
    for (const t of saved) add(String(t.id), t.title, t.presetId, t.workspaceId);
    for (const [id, t] of liveIds) add(id, null, null, t.workspaceId);
    return out;
  }

  async function worktreeInfo(projectId) {
    let records = [];
    try { records = (await worktrees.list(projectId)) || []; } catch (_) { return []; }
    return Promise.all(records.map(async (rec) => {
      let missing = false;
      let changedFiles = null;
      try {
        const info = await worktrees.inspect(rec.workspaceId);
        if (info && info.ok) {
          missing = info.exists === false;
          changedFiles = !missing && !info.unreadable && Number.isFinite(info.changes) ? info.changes : null;
        }
      } catch (_) { /* unbekannt bleibt null */ }
      return { workspaceId: rec.workspaceId, branch: typeof rec.branch === 'string' ? rec.branch : null, missing, changedFiles };
    }));
  }

  async function changesFor(project) {
    try {
      const r = await diffs.listChanges(project.path);
      if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'Änderungen nicht lesbar.' };
      const files = Array.isArray(r.files) ? r.files : [];
      return {
        ok: true,
        branch: typeof r.branch === 'string' ? r.branch : null,
        staged: files.filter((f) => f.staged).length,
        unstaged: files.filter((f) => f.unstaged).length,
        untracked: files.filter((f) => f.untracked).length,
      };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
  }

  async function portsFor(projectId) {
    const r = await ports.list();
    if (!r || !r.ok) throw new Error((r && r.error) || 'Ports nicht lesbar.');
    return (r.entries || []).filter((e) => e.projectId === projectId).map((e) => ({
      port: e.port, terminalId: e.terminalId || null, url: e.url || null,
    }));
  }

  async function docsFor(project) {
    const d = (await readDocs(project.path)) || {};
    const git = await gitInfo(project.path);
    return {
      progress: d.progress ?? null,
      workInProgress: d.workInProgress ?? null,
      projectStatus: d.projectStatus ?? null,
      gitLog: git && typeof git.log === 'string' ? git.log : null,
      gitBranches: git && typeof git.branches === 'string' ? git.branches : null,
    };
  }

  async function state(projectId) {
    return guarded(async () => {
      const project = projectOf(projectId);
      const [wts, changes, portList, docs] = await Promise.all([
        worktreeInfo(project.id),
        changesFor(project),
        portsFor(project.id).catch(() => []),
        Promise.resolve().then(() => readDocs(project.path)).catch(() => ({})),
      ]);
      const terminals = listTerminals(project.id).map((t) => {
        if (!t.workspace) return t;
        const wt = wts.find((w) => w.workspaceId === t.workspace.workspaceId);
        return { ...t, workspace: { workspaceId: t.workspace.workspaceId, branch: wt ? wt.branch : null } };
      });
      const d = docs || {};
      const managerId = managerIdFor(project.id);
      const live = (typeof ptySnapshot === 'function' ? ptySnapshot() : null) || [];
      return {
        ok: true,
        project,
        capturedAt: Date.now(),
        terminals,
        worktrees: wts,
        changes,
        ports: portList,
        docs: { nextStep: parseNextStep(d.projectStatus), activeReservations: countActiveReservations(d.workInProgress) },
        manager: { running: live.some((t) => t.terminalId === managerId), resumed: typeof deps.managerResumed === 'function' ? !!deps.managerResumed(project.id) : false },
      };
    });
  }

  function output(projectId, terminalId, lines) {
    return guarded(async () => {
      const project = projectOf(projectId);
      const known = listTerminals(project.id).some((t) => t.id === terminalId);
      if (!known) throw new Error('Kachel gehört nicht zu diesem Projekt.');
      const text = outputBuffer ? outputBuffer.tail(terminalId, lines) : [];
      return { ok: true, terminalId, lines: text };
    });
  }

  function changes(projectId) {
    return guarded(async () => {
      const project = projectOf(projectId);
      const main = await changesFor(project);
      const wts = await worktreeInfo(project.id);
      return { ok: true, project: { id: project.id, name: project.name }, changes: main, worktrees: wts };
    });
  }

  function portsOf(projectId) {
    return guarded(async () => {
      const project = projectOf(projectId);
      return { ok: true, ports: await portsFor(project.id) };
    });
  }

  function docs(projectId) {
    return guarded(async () => {
      const project = projectOf(projectId);
      return { ok: true, project: { id: project.id, name: project.name }, ...(await docsFor(project)) };
    });
  }

  // Für die Bridge: Kachel nach ID oder exaktem Titel auflösen. -> { ok, terminal } | { ok:false, error }
  function resolveTerminal(projectId, ref) {
    try {
      const list = listTerminals(projectId);
      const text = String(ref ?? '');
      const byId = list.find((t) => t.id === text);
      if (byId) return { ok: true, terminal: byId };
      const byTitle = list.filter((t) => t.title === text);
      if (byTitle.length === 1) return { ok: true, terminal: byTitle[0] };
      if (byTitle.length > 1) {
        return { ok: false, error: `Der Titel „${text}“ ist mehrdeutig. Bitte die ID nehmen: ${byTitle.map((t) => t.id).join(', ')}.` };
      }
      return { ok: false, error: `Keine Kachel „${text}“ in diesem Projekt.` };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
  }

  return { state, output, changes, ports: portsOf, docs, resolveTerminal };
}

module.exports = {
  createPmService, parseNextStep, countActiveReservations, defaultReadDocs, defaultGitInfo,
  managerIdFor, isValidManagerProject, ID_RE,
};
