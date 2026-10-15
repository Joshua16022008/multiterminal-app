'use strict';
// F10 (Variante A): Aufgaben aus Second Brain nur LESEN. Läuft ausschließlich im Main-Prozess,
// weil die Web-App jeden Origin-Header mit 403 ablehnt (Node-fetch sendet keinen). Nur GET.

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_URL = 'http://localhost:4321';
const LINK_TYPES = new Set(['todo', 'goal']);
const SPACES = new Set(['Arbeit', 'Privat', 'Schule']);
const MAX_TITLE = 200;
const MAX_TASKS = 500;

function validTaskId(v) { return typeof v === 'string' && ID_RE.test(v); }

// Nur lokale Adressen sind als Überschreibung erlaubt (Tests / QA), sonst Standard.
function resolveBaseUrl(v) {
  if (typeof v !== 'string') return DEFAULT_URL;
  try {
    const u = new URL(v);
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && u.port) {
      return u.protocol + '//' + u.hostname + ':' + u.port;
    }
  } catch (_) { /* Standard */ }
  return DEFAULT_URL;
}

function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
function date(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null; }

function cleanTask(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !validTaskId(raw.id)) return null;
  if (!LINK_TYPES.has(raw.type)) return null;
  return {
    id: raw.id,
    type: raw.type,
    title: str(raw.title, MAX_TITLE).trim() || '(ohne Titel)',
    space: SPACES.has(raw.space) ? raw.space : '',
    dueDate: date(raw.dueDate),
    priority: str(raw.priority, 20),
    done: raw.done === true,
    overdue: raw.overdue === true,
    dueToday: raw.dueToday === true,
  };
}

function createSecondBrainTasks({ baseUrl = DEFAULT_URL, fetchImpl = fetch, timeoutMs = 3000 } = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');

  async function getJson(pathname) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(base + pathname, { method: 'GET', signal: ctl.signal, headers: { Accept: 'application/json' } });
      } catch (err) {
        if (err && err.name === 'AbortError') return { ok: false, offline: true, error: 'Second Brain antwortet nicht (Zeitüberschreitung).' };
        return { ok: false, offline: true, error: 'Second Brain nicht erreichbar.' };
      }
      if (!res.ok) return { ok: false, offline: false, error: 'Second Brain lehnt die Anfrage ab (HTTP ' + res.status + ').' };
      let data;
      try { data = await res.json(); } catch (_) {
        return { ok: false, offline: false, error: 'Second Brain lieferte keine lesbare Antwort.' };
      }
      return { ok: true, data };
    } catch (_) {
      return { ok: false, offline: true, error: 'Second Brain nicht erreichbar.' };
    } finally { clearTimeout(timer); }
  }

  function toTasks(data) {
    return (Array.isArray(data) ? data : []).map(cleanTask).filter(Boolean);
  }

  return {
    async list() {
      const r = await getJson('/api/todos');
      if (!r.ok) return r;
      if (!Array.isArray(r.data)) return { ok: false, offline: false, error: 'Second Brain lieferte keine Aufgabenliste.' };
      const tasks = toTasks(r.data).sort((a, b) => Number(a.done) - Number(b.done)).slice(0, MAX_TASKS);
      return { ok: true, tasks };
    },

    async get(id) {
      if (!validTaskId(id)) return { ok: false, offline: false, error: 'Ungültige Aufgaben-ID.' };
      const open = await getJson('/api/todos');
      if (!open.ok) return open;
      const hit = toTasks(open.data).find((t) => t.id === id);
      if (hit) return { ok: true, task: hit };
      const done = await getJson('/api/todos/erledigt');
      if (done.ok) {
        const hit2 = toTasks(done.data).find((t) => t.id === id);
        if (hit2) return { ok: true, task: { ...hit2, done: true } };
      }
      return { ok: true, missing: true };
    },
  };
}

module.exports = { createSecondBrainTasks, validTaskId, resolveBaseUrl, cleanTask, DEFAULT_URL };
