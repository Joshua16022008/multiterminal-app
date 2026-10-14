'use strict';

// Agent status and attention. Three parts:
//  - normalizeHookEvent(): Claude Code hook event -> contract event
//      { terminalId, projectId, provider, accountId, nativeSessionId?, state, observedAt, source }
//    state is working | needs-input | turn-complete | error | unknown.
//    A missing signal stays "unknown"; silence is never read as "done".
//  - createAgentStatusStore(): current state and unread flag per terminal.
//  - createAgentSettings(): on/off switches (default off) in <dataDir>/agent-events.json;
//    "on" writes the hooks file that the `claude` wrapper passes via --settings.

const fs = require('fs');
const path = require('path');
const { hookSettingsJson } = require('./agent-wrapper');

const STATES = Object.freeze(['working', 'needs-input', 'turn-complete', 'error', 'unknown']);
// idle_prompt is ignored on purpose: "Antwort fertig" already covers the idle case.
const NEEDS_INPUT_NOTIFICATIONS = Object.freeze(['permission_prompt', 'elicitation_dialog', 'agent_needs_input']);
const ERROR_TYPES = Object.freeze([
  'rate_limit', 'overloaded', 'authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'billing_error',
  'invalid_request', 'model_not_found', 'server_error', 'max_output_tokens', 'cloud_credential_error', 'unknown',
]);
const UNREAD_STATES = Object.freeze(['turn-complete', 'needs-input', 'error']);

const DEFAULT_DEDUPE_MS = 1500;
const MAX_FUTURE_SKEW_MS = 5000;
const MAX_PAST_SKEW_MS = 60000;

const SETTINGS_FILE = 'agent-events.json';
const HOOKS_FILE = 'claude-hooks.json';
const DEFAULT_SETTINGS = Object.freeze({ statusEnabled: false, desktopNotification: false, sound: false });

// Bridge args (see browser-bridge validateEvent) + terminal metadata -> event,
// or null for events that carry no status. SessionEnd gives { ended: true }.
// meta: { projectId, accountId, provider = 'claude' }
function normalizeHookEvent(args, meta = {}, terminalId, now = Date.now()) {
  if (!args || typeof args !== 'object') return null;
  const name = args.hook_event_name;
  let state;
  let errorType;
  let ended = false;
  switch (name) {
    case 'UserPromptSubmit': state = 'working'; break;
    case 'Stop': state = 'turn-complete'; break;
    case 'StopFailure':
      state = 'error';
      errorType = ERROR_TYPES.includes(args.error) ? args.error : 'unknown';
      break;
    case 'Notification':
      if (!NEEDS_INPUT_NOTIFICATIONS.includes(args.notification_type)) return null;
      state = 'needs-input';
      break;
    case 'PermissionRequest': state = 'needs-input'; break;
    case 'SessionStart': state = 'unknown'; break;
    case 'SessionEnd': state = 'unknown'; ended = true; break;
    default: return null;
  }
  let observedAt = now;
  if (Number.isFinite(args.at) && args.at <= now + MAX_FUTURE_SKEW_MS && args.at >= now - MAX_PAST_SKEW_MS) observedAt = args.at;
  const event = {
    terminalId: String(terminalId),
    projectId: meta.projectId === undefined ? null : meta.projectId,
    provider: meta.provider || 'claude',
    accountId: meta.accountId === undefined ? null : meta.accountId,
    state,
    observedAt,
    source: 'claude-hook:' + name,
  };
  if (typeof args.session_id === 'string' && args.session_id) event.nativeSessionId = args.session_id;
  if (errorType) event.errorType = errorType;
  if (ended) event.ended = true;
  if (name === 'SessionStart') event.identity = true;
  return event;
}

// opts: { now, dedupeMs, onChange(list) }
function createAgentStatusStore({ now = Date.now, dedupeMs = DEFAULT_DEDUPE_MS, onChange } = {}) {
  const entries = new Map(); // terminalId -> entry
  const listeners = new Set();
  if (typeof onChange === 'function') listeners.add(onChange);

  function emit() {
    const snapshot = list();
    for (const fn of listeners) {
      try { fn(snapshot); } catch (_) { /* a broken listener must not stop the store */ }
    }
  }

  function list() {
    return [...entries.values()]
      .map((e) => ({ ...e }))
      .sort((a, b) => (Number(b.unread) - Number(a.unread)) || (b.observedAt - a.observedAt));
  }

  // visible: the tile is visible and focused and the window has focus -> no unread flag, no notification.
  // Returns { changed, notify, entry }.
  function apply(event, { visible = false } = {}) {
    const id = String(event.terminalId);
    const current = entries.get(id);

    if (event.ended) {
      if (!current) return { changed: false, notify: false, entry: null };
      entries.delete(id);
      emit();
      return { changed: true, notify: false, entry: null };
    }
    if (current && event.observedAt < current.observedAt) return { changed: false, notify: false, entry: { ...current } }; // stale
    if (current && !event.identity && current.state === event.state && current.errorType === event.errorType
      && event.observedAt - current.observedAt <= dedupeMs) {
      return { changed: false, notify: false, entry: { ...current } }; // duplicate
    }

    let state = event.state;
    let errorType = event.errorType;
    let unread = current ? current.unread : false;
    // A session start (also compact/resume) must not wipe a running turn.
    if (event.identity && current && current.state === 'working') { state = 'working'; errorType = undefined; }
    else if (event.identity) unread = false;
    else if (state === 'working') unread = false;
    else if (UNREAD_STATES.includes(state)) unread = !visible;

    const entry = {
      terminalId: id,
      projectId: event.projectId,
      provider: event.provider,
      accountId: event.accountId,
      state,
      observedAt: event.observedAt,
      source: event.source,
      unread,
    };
    const sid = event.nativeSessionId || (current && current.nativeSessionId);
    if (sid) entry.nativeSessionId = sid;
    if (errorType) entry.errorType = errorType;
    entries.set(id, entry);
    const notify = !event.identity && UNREAD_STATES.includes(state) && !visible
      && !(current && current.state === state && current.errorType === errorType && current.unread);
    emit();
    return { changed: true, notify, entry: { ...entry } };
  }

  // Bridge handler: args from the `event` command, meta from the terminal.
  function ingest(terminalId, args, meta = {}, options = {}) {
    const event = normalizeHookEvent(args, meta, terminalId, now());
    if (!event) return { changed: false, notify: false, entry: null };
    return apply(event, options);
  }

  function markRead(terminalId) {
    const e = entries.get(String(terminalId));
    if (!e || !e.unread) return false;
    e.unread = false;
    emit();
    return true;
  }

  function markAllRead() {
    let any = false;
    for (const e of entries.values()) if (e.unread) { e.unread = false; any = true; }
    if (any) emit();
    return any;
  }

  // The user typed into this terminal. While the agent waited for input, that
  // is the answer: back to "working". Otherwise nothing changes.
  function userInput(terminalId) {
    const e = entries.get(String(terminalId));
    if (!e || e.state !== 'needs-input') return false;
    e.state = 'working';
    delete e.errorType;
    e.unread = false;
    e.observedAt = Math.max(now(), e.observedAt);
    e.source = 'user-input';
    emit();
    return true;
  }

  function terminalClosed(terminalId) {
    if (!entries.delete(String(terminalId))) return false;
    emit();
    return true;
  }

  function get(terminalId) {
    const e = entries.get(String(terminalId));
    return e ? { ...e } : null;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    apply, ingest, markRead, markAllRead, userInput, terminalClosed, get, list, subscribe,
    unreadCount: () => [...entries.values()].filter((e) => e.unread).length,
  };
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// dataDir: app data folder. mtEventPath: absolute path of the `mt-event` wrapper.
function createAgentSettings({ dataDir, mtEventPath }) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('dataDir muss ein absoluter Pfad sein.');
  const settingsFile = path.join(dataDir, SETTINGS_FILE);
  const hooksFile = path.join(dataDir, HOOKS_FILE);

  function read() {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      const out = { ...DEFAULT_SETTINGS };
      for (const k of Object.keys(DEFAULT_SETTINGS)) if (typeof raw[k] === 'boolean') out[k] = raw[k];
      return out;
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  // Makes the hooks file match the status switch.
  function sync() {
    const s = read();
    if (s.statusEnabled) writeAtomic(hooksFile, hookSettingsJson({ mtEventPath }));
    else fs.rmSync(hooksFile, { force: true });
    return s;
  }

  function get() {
    return { ...read(), hooksFile };
  }

  // patch: any of statusEnabled, desktopNotification, sound (booleans); other keys are ignored.
  function set(patch) {
    const next = read();
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (patch && typeof patch[k] === 'boolean') next[k] = patch[k];
    writeAtomic(settingsFile, JSON.stringify(next, null, 2) + '\n');
    sync();
    return { ...next, hooksFile };
  }

  return { get, set, sync, hooksFile, settingsFile };
}

module.exports = {
  STATES, ERROR_TYPES, NEEDS_INPUT_NOTIFICATIONS, DEFAULT_SETTINGS, SETTINGS_FILE, HOOKS_FILE,
  normalizeHookEvent, createAgentStatusStore, createAgentSettings,
};
