'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TERMINALS = 10;
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

function sanitizeTerminal(t) {
  if (!isPlainObject(t) || !validId(t.id)) return null;
  const title = typeof t.title === 'string' ? t.title.slice(0, MAX_TITLE) : '';
  return {
    id: t.id,
    title,
    presetId: validId(t.presetId) ? t.presetId : null,
    command: optString(t.command, MAX_COMMAND),
    resumeCommand: optString(t.resumeCommand, MAX_COMMAND),
    browserUrl: optString(t.browserUrl, MAX_URL),
    browserOpen: t.browserOpen === true,
  };
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
