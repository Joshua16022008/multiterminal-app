'use strict';

// Quota usage per account. The service only reads two kinds of files:
//  - Codex session logs (<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl), which
//    carry the rate limits in their token_count events.
//  - Its own snapshot files (<usageDir>/<accountId>.json), written by
//    usage-statusline.js while a Claude terminal runs.
// Login or credential files are never touched.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// A snapshot older than this is shown dimmed; the app cannot know the current value.
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
// Only the end of a rollout file is read: the newest rate limits are at the end.
const TAIL_BYTES = 256 * 1024;
// Upper bound of files looked at per Codex account (newest first), so that
// limit ids besides "codex" are found without walking hundreds of files.
const MAX_CODEX_FILES = 6;
const MAIN_LIMIT_ID = 'codex';
const NO_CLAUDE_STATE_NOTE = 'Noch kein Stand – erscheint nach der ersten Antwort in einem Claude-Terminal';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Percent as a number between 0 and 100, or null when the value is unusable.
function toPercent(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(100, Math.max(0, v));
}

// Unix seconds -> milliseconds, or null.
function secondsToMs(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : null;
}

function toMs(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function minutesLabel(minutes) {
  if (minutes === 10080) return 'Woche';
  if (minutes % 1440 === 0) return `${minutes / 1440} Tage`;
  if (minutes % 60 === 0) return `${minutes / 60} Std.`;
  return `${minutes} Min.`;
}

function emptyResult(account, note) {
  return {
    accountId: account && typeof account.id === 'string' ? account.id : '',
    provider: account && typeof account.provider === 'string' ? account.provider : '',
    capturedAt: null,
    stale: false,
    plan: null,
    windows: [],
    note,
  };
}

function createUsageService({ usageDir, homeDir = os.homedir(), now = Date.now }) {
  function usageFileFor(accountId) {
    if (typeof accountId !== 'string' || !ID_RE.test(accountId)) throw new Error('Ungültige Konto-ID.');
    return path.join(usageDir, `${accountId}.json`);
  }

  // Resets windows whose reset time has passed and decides whether the result is stale.
  function finish(result) {
    const t = now();
    let stale = result.capturedAt !== null && t - result.capturedAt > STALE_AFTER_MS;
    const windows = result.windows.map((w) => {
      if (w.resetsAt !== null && w.resetsAt <= t) {
        stale = true;
        return { ...w, usedPercent: 0, resetsAt: null };
      }
      return w;
    });
    return { ...result, stale, windows };
  }

  // ---------- Claude ----------

  function claudeWindow(key, label, minutes, raw) {
    if (!isPlainObject(raw)) return null;
    const usedPercent = toPercent(raw.used_percentage);
    if (usedPercent === null) return null;
    return { key, label, usedPercent, resetsAt: secondsToMs(raw.resets_at), windowMinutes: minutes };
  }

  function forClaude(account) {
    const result = emptyResult(account, null);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(usageFileFor(account.id), 'utf8'));
    } catch (err) {
      result.note = NO_CLAUDE_STATE_NOTE;
      return result;
    }
    const limits = isPlainObject(data) && isPlainObject(data.rate_limits) ? data.rate_limits : {};
    result.capturedAt = toMs(data && data.capturedAt);
    result.windows = [
      claudeWindow('five_hour', '5 Std.', 300, limits.five_hour),
      claudeWindow('seven_day', 'Woche', 10080, limits.seven_day),
    ].filter(Boolean);
    if (result.windows.length === 0) result.note = NO_CLAUDE_STATE_NOTE;
    return finish(result);
  }

  // ---------- Codex ----------

  function listNames(dir, pattern) {
    try {
      return fs.readdirSync(dir).filter((n) => pattern.test(n)).sort().reverse();
    } catch (err) {
      return [];
    }
  }

  // Rollout files, newest first. Day folders are walked lazily by the caller.
  function* rolloutFiles(sessionsDir) {
    for (const y of listNames(sessionsDir, /^\d{4}$/)) {
      for (const m of listNames(path.join(sessionsDir, y), /^\d{2}$/)) {
        for (const d of listNames(path.join(sessionsDir, y, m), /^\d{2}$/)) {
          const dayDir = path.join(sessionsDir, y, m, d);
          for (const f of listNames(dayDir, /^rollout-.*\.jsonl$/)) yield path.join(dayDir, f);
        }
      }
    }
  }

  function readTail(file) {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, TAIL_BYTES);
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, size - length);
      let text = buf.toString('utf8');
      // A cut-off first line is not valid JSON; skip it.
      if (size > length) text = text.slice(text.indexOf('\n') + 1);
      return text;
    } finally {
      fs.closeSync(fd);
    }
  }

  // Latest rate-limit state per limit_id found in the end of one file.
  function limitsInFile(file, found) {
    let text;
    try {
      text = readTail(file);
    } catch (err) {
      return;
    }
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i].indexOf('rate_limits') === -1) continue;
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch (err) {
        continue; // last line may still be written
      }
      const payload = isPlainObject(entry) ? entry.payload : null;
      if (!isPlainObject(payload) || payload.type !== 'token_count' || !isPlainObject(payload.rate_limits)) continue;
      const limits = payload.rate_limits;
      const id = typeof limits.limit_id === 'string' && limits.limit_id ? limits.limit_id : MAIN_LIMIT_ID;
      if (found.has(id)) continue;
      const stamp = Date.parse(entry.timestamp);
      found.set(id, { limits, capturedAt: Number.isFinite(stamp) ? stamp : null });
    }
  }

  function codexWindows(id, state) {
    const out = [];
    for (const slot of ['primary', 'secondary']) {
      const raw = state.limits[slot];
      if (!isPlainObject(raw)) continue;
      const usedPercent = toPercent(raw.used_percent);
      const minutes = typeof raw.window_minutes === 'number' && raw.window_minutes > 0 ? raw.window_minutes : null;
      if (usedPercent === null) continue;
      const base = minutes === null ? 'Limit' : minutesLabel(minutes);
      const name = typeof state.limits.limit_name === 'string' && state.limits.limit_name ? state.limits.limit_name : id;
      out.push({
        key: `${id}:${minutes === null ? slot : minutes}`,
        label: id === MAIN_LIMIT_ID ? base : `${base} · ${name}`,
        usedPercent,
        resetsAt: secondsToMs(raw.resets_at),
        windowMinutes: minutes,
      });
    }
    return out;
  }

  function forCodex(account) {
    const result = emptyResult(account, null);
    let folder = typeof account.folder === 'string' && account.folder ? account.folder : null;
    if (folder === null && account.builtin) folder = path.join(homeDir, '.codex');
    if (folder === null) {
      result.note = 'Kein Konfigurationsordner bekannt.';
      return result;
    }
    const found = new Map();
    let seen = 0;
    for (const file of rolloutFiles(path.join(folder, 'sessions'))) {
      limitsInFile(file, found);
      seen += 1;
      if (seen >= MAX_CODEX_FILES) break;
    }
    if (found.size === 0) {
      result.note = 'Noch kein Stand – erscheint nach der ersten Antwort in einem Codex-Terminal';
      return result;
    }
    // "codex" first, the others in alphabetical order.
    const ids = [...found.keys()].sort((a, b) => (a === MAIN_LIMIT_ID ? -1 : b === MAIN_LIMIT_ID ? 1 : a < b ? -1 : 1));
    for (const id of ids) {
      const state = found.get(id);
      result.windows.push(...codexWindows(id, state));
      if (state.capturedAt !== null && (result.capturedAt === null || state.capturedAt > result.capturedAt)) {
        result.capturedAt = state.capturedAt;
      }
      const plan = state.limits.plan_type;
      if (result.plan === null && typeof plan === 'string' && plan) result.plan = plan;
    }
    if (result.windows.length === 0) result.note = 'Keine Limit-Angaben in den letzten Sitzungen.';
    return finish(result);
  }

  // ---------- Public ----------

  function forAccount(account) {
    if (!isPlainObject(account) || typeof account.id !== 'string') {
      return emptyResult(account, 'Konto nicht lesbar.');
    }
    try {
      if (account.provider === 'claude') return forClaude(account);
      if (account.provider === 'codex') return forCodex(account);
      return emptyResult(account, 'Für diesen Anbieter gibt es keine Verbrauchsanzeige.');
    } catch (err) {
      return emptyResult(account, 'Stand konnte nicht gelesen werden.');
    }
  }

  function forAccounts(accounts) {
    return (Array.isArray(accounts) ? accounts : []).map((a) => forAccount(a));
  }

  return { forAccount, forAccounts, usageFileFor };
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Settings entry for Claude Code that runs usage-statusline.js through Electron acting as Node.
function statuslineSettings({ execPath, scriptPath }) {
  return {
    statusLine: {
      type: 'command',
      command: `ELECTRON_RUN_AS_NODE=1 ${shellQuote(execPath)} ${shellQuote(scriptPath)}`,
    },
  };
}

module.exports = { createUsageService, statuslineSettings, STALE_AFTER_MS };
