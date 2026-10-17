'use strict';

// F02: exact conversation per tile. Only IDs that an agent event really reported are kept
// (never guessed from the "last changed conversation"); every ID is validated before it
// reaches a command line.
//
// Resume syntax, checked with the local CLIs' --help (15.10.2026):
//   claude  : `claude --resume <session-id>`   (-r, --resume [value]: "Resume a conversation by session ID")
//   codex   : `codex resume <SESSION_ID>`      (`codex resume [OPTIONS] [SESSION_ID] [PROMPT]`, UUID or name)
//   kimi    : `kimi --session <id>`            (-S, --session [id]: "With ID: resume that session")
// Only Claude has an event source in the app (hooks -> session_id). Codex and Kimi have the
// syntax but no belegte ID, so they stay on "letztes Gespräch" with a visible note.

const PROVIDERS = Object.freeze(['claude', 'codex', 'kimi']);
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/; // kein führendes "-": sonst als Option gelesen
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const ARGV = Object.freeze({
  claude: (id) => ['claude', '--resume', id],
  codex: (id) => ['codex', 'resume', id],
  kimi: (id) => ['kimi', '--session', id],
});

function isValidSessionId(v) {
  return typeof v === 'string' && SESSION_ID_RE.test(v);
}

// Safe single-quoted shell word. IDs are already restricted to [A-Za-z0-9_-]; quoting is a second line of defence.
function quote(word) {
  return /^[A-Za-z0-9_\-./=]+$/.test(word) ? word : "'" + word.replace(/'/g, "'\\''") + "'";
}

// -> { argv, line } or null for an unknown provider / invalid ID.
function buildResume(provider, nativeSessionId) {
  if (!PROVIDERS.includes(provider) || !isValidSessionId(nativeSessionId)) return null;
  const argv = ARGV[provider](nativeSessionId);
  return { argv, line: argv.map(quote).join(' ') };
}

// Catalog templates stay argv data. Entries without verified resume support
// deliberately fall back to their bare binary in harness-launch instead.
function resumeFromCatalog(entry, id) {
  if (!entry || entry.evidence === 'unconfirmed' || !isValidSessionId(id)
      || !Array.isArray(entry.resume?.byId) || entry.resume.byId[0] !== entry.binary) return null;
  const argv = entry.resume.byId.map(word => typeof word === 'string' ? word.replaceAll('{sessionId}', id) : null);
  if (argv.some(word => word === null || /[\r\n\0{}]/.test(word))) return null;
  return { argv, line: argv.map(quote).join(' ') };
}

// Stored/IPC value -> clean record or null. projectId/accountId may be null.
function sanitizeNativeSession(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (!PROVIDERS.includes(v.provider) || !isValidSessionId(v.nativeSessionId)) return null;
  return {
    provider: v.provider,
    accountId: typeof v.accountId === 'string' && ID_RE.test(v.accountId) ? v.accountId : null,
    projectId: typeof v.projectId === 'string' && ID_RE.test(v.projectId) ? v.projectId : null,
    nativeSessionId: v.nativeSessionId,
    observedAt: Number.isFinite(v.observedAt) ? v.observedAt : 0,
  };
}

// Decides how a tile is resumed.
//   stored: the tile's nativeSession (or null); provider: provider of the tile's preset (or null);
//   currentAccountId: account the tile will start with for that provider; projectId: the tile's project.
// -> { exact: true, command, nativeSessionId } | { exact: false, command: null, reason }
function resumePlan({ provider, stored, currentAccountId = null, projectId = null } = {}) {
  if (!PROVIDERS.includes(provider)) return { exact: false, command: null, reason: 'Anbieter ohne feste Gesprächszuordnung' };
  const ns = sanitizeNativeSession(stored);
  if (!ns) return { exact: false, command: null, reason: stored ? 'Gespeicherte Gesprächs-ID ungültig' : 'Keine Gesprächs-ID belegt' };
  if (ns.provider !== provider) return { exact: false, command: null, reason: 'Gespräch gehört zu einem anderen Anbieter' };
  if (ns.accountId !== null && currentAccountId !== null && ns.accountId !== currentAccountId) {
    return { exact: false, command: null, reason: 'Gespräch gehört zu einem anderen Konto' };
  }
  if (ns.projectId !== null && projectId !== null && ns.projectId !== projectId) {
    return { exact: false, command: null, reason: 'Gespräch gehört zu einem anderen Projekt' };
  }
  const built = buildResume(provider, ns.nativeSessionId);
  return { exact: true, command: built.line, argv: built.argv, nativeSessionId: ns.nativeSessionId };
}

// Holds the observed identity per terminal. Accepts only events that carry a valid nativeSessionId.
function createAgentSessionService() {
  const byTerminal = new Map();

  // event: normalized agent event (agent-events.js). -> new record when it changed, else null.
  function observe(event) {
    if (!event || typeof event.terminalId !== 'string' || !ID_RE.test(event.terminalId)) return null;
    const rec = sanitizeNativeSession({
      provider: event.provider, accountId: event.accountId, projectId: event.projectId,
      nativeSessionId: event.nativeSessionId, observedAt: event.observedAt,
    });
    if (!rec) return null;
    const cur = byTerminal.get(event.terminalId);
    if (cur && rec.observedAt < cur.observedAt) return null; // stale
    if (cur && cur.nativeSessionId === rec.nativeSessionId && cur.provider === rec.provider
      && cur.accountId === rec.accountId && cur.projectId === rec.projectId) return null;
    byTerminal.set(event.terminalId, rec);
    return { ...rec };
  }

  function get(terminalId) {
    const r = byTerminal.get(String(terminalId));
    return r ? { ...r } : null;
  }

  function forget(terminalId) { return byTerminal.delete(String(terminalId)); }

  return { observe, get, forget };
}

module.exports = { PROVIDERS, SESSION_ID_RE, isValidSessionId, buildResume, resumeFromCatalog, sanitizeNativeSession, resumePlan, createAgentSessionService };
