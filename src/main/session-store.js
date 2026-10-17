'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeNativeSession } = require('./agent-session-service'); // F02
const { sanitizeLaunch } = require('./launch-spec');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TERMINALS = 30;
const MAX_TITLE = 120;
const MAX_COMMAND = 2000;
const MAX_URL = 2000;
const MAX_SCROLLBACK = 2000000;

function emptySession() {
  return { version: 1, activeProjectId: null, projects: {} };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validId(v) {
  return typeof v === 'string' && ID_RE.test(v);
}

function optString(v, max) {
  return typeof v === 'string' && v.length <= max ? v : null;
}

// Account ids the terminal ran with, { provider: accountId }, so a resumed
// terminal starts with the same config folder (sessions live there).
function sanitizeAccounts(v) {
  const out = {};
  if (!isPlainObject(v)) return out;
  for (const provider of Object.keys(v)) {
    if (validId(provider) && validId(v[provider])) out[provider] = v[provider];
  }
  return out;
}

function sanitizeTerminal(t) {
  if (!isPlainObject(t) || !validId(t.id)) return null;
  const title = typeof t.title === 'string' ? t.title.slice(0, MAX_TITLE) : '';
  const out = {
    id: t.id,
    title,
    presetId: validId(t.presetId) ? t.presetId : null,
    command: optString(t.command, MAX_COMMAND),
    resumeCommand: optString(t.resumeCommand, MAX_COMMAND),
    browserUrl: optString(t.browserUrl, MAX_URL),
    browserOpen: t.browserOpen === true,
    accounts: sanitizeAccounts(t.accounts),
  };
  // Optional: Farbindex der Kachel und "Name steht fest" (aus erstem Prompt oder von Hand)
  if (Number.isInteger(t.color) && t.color >= 0 && t.color < 64) out.color = t.color;
  if (t.titleLocked === true) out.titleLocked = true;
  // Working copy (F07): only the id is stored, the folder comes from worktrees.json
  if (validId(t.workspaceId)) out.workspaceId = t.workspaceId;
  // View mode of the mini browser; the default (both side by side) is not stored
  if (t.browserMode === 'terminal' || t.browserMode === 'browser') out.browserMode = t.browserMode;
  // F02: belegte native Gesprächs-ID (nur aus Agentenereignissen); ungültige Werte werden verworfen
  const ns = sanitizeNativeSession(t.nativeSession);
  if (ns) out.nativeSession = ns;
  // F10: verknüpfte Aufgabe (nur die ID; Titel/Status werden live gelesen; nur Entwicklerversion legt sie an)
  if (validId(t.secondBrainTodoId)) out.secondBrainTodoId = t.secondBrainTodoId;
  // Harness start: only the public whitelist { harnessId, model?, endpointId? } is kept.
  // The finished line (environment, keychain lookup, prompt) is rebuilt in main on resume
  // and never stored. An invalid value keeps the tile but marks it, so it opens without an
  // agent start instead of silently falling back to another provider.
  if (t.launch !== undefined && t.launch !== null) {
    const launch = sanitizeLaunch(t.launch);
    out.command = null;
    out.resumeCommand = null;
    if (launch) out.launch = launch; else out.launchInvalid = true;
  } else if (t.launchInvalid === true) {
    out.command = null;
    out.resumeCommand = null;
    out.launchInvalid = true;
  }
  return out;
}

function sanitizeSession(raw) {
  const out = emptySession();
  if (!isPlainObject(raw) || !isPlainObject(raw.projects)) return out;
  for (const projectId of Object.keys(raw.projects)) {
    if (!validId(projectId)) continue;
    const proj = raw.projects[projectId];
    if (!isPlainObject(proj) || !Array.isArray(proj.terminals)) continue;
    const seen = new Set();
    const terminals = [];
    for (const t of proj.terminals) {
      const clean = sanitizeTerminal(t);
      if (!clean || seen.has(clean.id)) continue;
      seen.add(clean.id);
      terminals.push(clean);
      if (terminals.length >= MAX_TERMINALS) break;
    }
    // Object.defineProperty-free: ids are validated, so no __proto__ key can appear.
    out.projects[projectId] = { terminals };
  }
  if (validId(raw.activeProjectId) && Object.prototype.hasOwnProperty.call(out.projects, raw.activeProjectId)) {
    out.activeProjectId = raw.activeProjectId;
  }
  return out;
}

function assertTerminalId(id) {
  if (!validId(id)) throw new Error('Invalid terminal id: must match [A-Za-z0-9_-]{1,64}');
}

function createSessionStore(dir) {
  if (typeof dir !== 'string' || !dir) throw new Error('createSessionStore: dir must be a non-empty string');
  const sessionFile = path.join(dir, 'session.json');
  const scrollDir = path.join(dir, 'scrollback');
  const SCROLL_EXT = '.txt';

  function atomicWrite(file, data) {
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      fs.writeFileSync(tmp, data, 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      throw err;
    }
  }

  function scrollPath(id) {
    assertTerminalId(id);
    return path.join(scrollDir, id + SCROLL_EXT);
  }

  return {
    load() {
      try {
        return sanitizeSession(JSON.parse(fs.readFileSync(sessionFile, 'utf8')));
      } catch (_) {
        return emptySession();
      }
    },

    save(session) {
      const clean = sanitizeSession(session);
      fs.mkdirSync(dir, { recursive: true });
      atomicWrite(sessionFile, JSON.stringify(clean, null, 2));
      return clean;
    },

    saveScrollback(terminalId, text) {
      const file = scrollPath(terminalId);
      let s = typeof text === 'string' ? text : String(text == null ? '' : text);
      if (s.length > MAX_SCROLLBACK) s = s.slice(s.length - MAX_SCROLLBACK);
      fs.mkdirSync(scrollDir, { recursive: true });
      atomicWrite(file, s);
    },

    loadScrollback(terminalId) {
      const file = scrollPath(terminalId);
      try {
        return fs.readFileSync(file, 'utf8');
      } catch (_) {
        return null;
      }
    },

    deleteScrollback(terminalId) {
      const file = scrollPath(terminalId);
      try {
        fs.unlinkSync(file);
      } catch (err) {
        if (!err || err.code !== 'ENOENT') throw err;
      }
    },

    pruneScrollback(keepIds) {
      const keep = new Set(Array.isArray(keepIds) ? keepIds.filter((x) => typeof x === 'string') : []);
      let entries;
      try {
        entries = fs.readdirSync(scrollDir);
      } catch (_) {
        return 0;
      }
      let removed = 0;
      for (const name of entries) {
        if (!name.endsWith(SCROLL_EXT)) continue;
        const id = name.slice(0, -SCROLL_EXT.length);
        if (!validId(id) || keep.has(id)) continue;
        try {
          fs.unlinkSync(path.join(scrollDir, name));
          removed++;
        } catch (_) { /* ignore */ }
      }
      return removed;
    },
  };
}

module.exports = { createSessionStore, sanitizeSession };
