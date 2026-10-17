'use strict';

// Local bridge that lets an agent inside a terminal tile steer the mini browser
// of its own tile. A Unix-domain socket receives one JSON line per request
//   { token, cmd, args }  ->  { ok: true, result } | { ok: false, error }
// and closes the connection. The server executes nothing itself: it checks the
// token, validates the command and hands it to the injected handler.

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

// sockaddr_un.sun_path holds 104 bytes on macOS (108 on Linux); keep a margin.
const MAX_SOCKET_PATH_BYTES = 100;
const MAX_REQUEST_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const HANDLER_TIMEOUT_MS = 30000;
const MAX_LIMIT = 10000;
const { validateSelector, validateTypeText } = require('./browser-feedback'); // F05
const { validateCheckpointInput } = require('./memory-service');

const COMMANDS = Object.freeze(['open', 'reload', 'back', 'forward', 'url', 'screenshot', 'console', 'text', 'show', 'hide', 'click', 'type']); // F05: click, type

// Same rules as normalizeUrl in terminal-pane.js: bare localhost addresses get
// http://, other bare hosts https://, and only http(s) survives.
function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (/^(javascript|data|file|about|blob|chrome|view-source|vbscript):/i.test(s)) return null;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?=[:/?#]|$)/i.test(s)) s = 'http://' + s;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch (_) {
    return null;
  }
}

function defaultIsAllowedUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function positiveInt(value, name) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new Error(`${name} muss eine ganze Zahl zwischen 1 und ${MAX_LIMIT} sein.`);
  }
  return value;
}

// Returns the cleaned args for a command or throws a German message.
function validateCommand(cmd, args, isAllowedUrl) {
  if (typeof cmd !== 'string' || !COMMANDS.includes(cmd)) {
    throw new Error('Unbekannter Befehl. Erlaubt: ' + COMMANDS.join(', ') + '.');
  }
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  if (cmd === 'open') {
    if (typeof a.url !== 'string' || !a.url.trim()) throw new Error('open braucht eine Adresse (url).');
    const url = normalizeUrl(a.url);
    if (!url || !isAllowedUrl(url)) throw new Error('Adresse nicht erlaubt. Erlaubt sind nur http- und https-Adressen.');
    return { url };
  }
  if (cmd === 'screenshot') {
    if (a.out !== undefined && a.out !== null && (typeof a.out !== 'string' || !a.out.trim() || a.out.length > 1024)) {
      throw new Error('out muss ein Dateipfad sein.');
    }
    return a.out ? { out: a.out } : {};
  }
  // F05
  if (cmd === 'click') return { selector: validateSelector(a.selector) };
  if (cmd === 'type') return { selector: validateSelector(a.selector), text: validateTypeText(a.text) };
  if (cmd === 'console' || cmd === 'text') {
    const limit = positiveInt(a.limit, 'limit');
    return limit === undefined ? {} : { limit };
  }
  return {};
}

// Agent status events (`mt-event`, called from Claude Code hooks). They never
// reach the browser handler. Only these few fields travel: no prompts, no answer
// text, no transcript path.
const EVENT_COMMAND = 'event';
const EVENT_NAMES = Object.freeze(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'StopFailure', 'Notification', 'PermissionRequest']);

function shortString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
}

function validateEvent(args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  if (!EVENT_NAMES.includes(a.hook_event_name)) throw new Error('Unbekanntes Ereignis. Erlaubt: ' + EVENT_NAMES.join(', ') + '.');
  const clean = { hook_event_name: a.hook_event_name };
  const type = shortString(a.notification_type, 64);
  const session = shortString(a.session_id, 128);
  const error = shortString(a.error, 64);
  if (type) clean.notification_type = type;
  if (session) clean.session_id = session;
  if (error) clean.error = error;
  if (Number.isFinite(a.at)) clean.at = a.at;
  return clean;
}

function createBrowserBridge({ socketPath, handler, eventHandler, memoryHandler, isAllowedUrl, requestTimeoutMs, handlerTimeoutMs } = {}) {
  if (typeof socketPath !== 'string' || !path.isAbsolute(socketPath)) throw new Error('socketPath muss ein absoluter Pfad sein.');
  if (typeof handler !== 'function') throw new Error('handler fehlt.');
  const allowed = typeof isAllowedUrl === 'function' ? isAllowedUrl : defaultIsAllowedUrl;
  const readTimeout = requestTimeoutMs || REQUEST_TIMEOUT_MS;
  const runTimeout = handlerTimeoutMs || HANDLER_TIMEOUT_MS;

  const tokens = new Map(); // terminalId -> token
  let server = null;

  function register(terminalId) {
    const id = String(terminalId);
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(id, token);
    return token;
  }

  function unregister(terminalId) {
    tokens.delete(String(terminalId));
  }

  function envFor(terminalId) {
    const token = tokens.get(String(terminalId));
    if (!token) return {};
    return { MULTITERMINAL_BROWSER_SOCK: socketPath, MULTITERMINAL_BROWSER_TOKEN: token };
  }

  // Constant-time lookup: compares against every token, no early exit.
  function terminalForToken(token) {
    if (typeof token !== 'string') return null;
    const given = Buffer.from(token);
    let found = null;
    for (const [id, own] of tokens) {
      const ownBuf = Buffer.from(own);
      const same = given.length === ownBuf.length && crypto.timingSafeEqual(given, ownBuf);
      if (same) found = id;
    }
    return found;
  }

  async function execute(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Ungültige Anfrage.');
    const terminalId = terminalForToken(request.token);
    if (terminalId === null) throw new Error('Nicht berechtigt.');
    if (request.cmd === EVENT_COMMAND) {
      if (typeof eventHandler !== 'function') throw new Error('Unbekannter Befehl. Erlaubt: ' + COMMANDS.join(', ') + '.');
      await eventHandler(terminalId, validateEvent(request.args));
      return null;
    }
    let args, run;
    if (request.cmd === 'memory-read' || request.cmd === 'memory-save') {
      if (typeof memoryHandler !== 'function') throw new Error('Memory-Handler nicht verfügbar.');
      if (request.cmd === 'memory-read') {
        const input = request.args === undefined ? {} : request.args;
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('memory-read akzeptiert keine Projekt- oder Scope-Overrides.');
        args = {};
      } else {
        args = validateCheckpointInput(request.args, { allowProvenance: false });
      }
      run = () => memoryHandler(terminalId, request.cmd === 'memory-read' ? 'read' : 'save', args);
    } else {
      args = validateCommand(request.cmd, request.args, allowed);
      run = () => handler(terminalId, request.cmd, args);
    }
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Zeitüberschreitung beim Ausführen des Befehls.')), runTimeout);
    });
    try {
      return await Promise.race([Promise.resolve(run()), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  function onConnection(socket) {
    let buffer = Buffer.alloc(0);
    let done = false;
    const timer = setTimeout(() => finish({ ok: false, error: 'Zeitüberschreitung beim Lesen der Anfrage.' }), readTimeout);

    function finish(response) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (socket.destroyed) return;
      socket.end(JSON.stringify(response) + '\n');
    }

    socket.on('error', () => { done = true; clearTimeout(timer); });
    socket.on('data', (chunk) => {
      if (done) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_REQUEST_BYTES) {
        finish({ ok: false, error: 'Anfrage zu groß.' });
        return;
      }
      const nl = buffer.indexOf(10);
      if (nl < 0) return;
      clearTimeout(timer); // request complete: the handler has its own time limit
      let request;
      try {
        request = JSON.parse(buffer.slice(0, nl).toString('utf8'));
      } catch (_) {
        finish({ ok: false, error: 'Ungültiges JSON.' });
        return;
      }
      execute(request).then(
        (result) => finish({ ok: true, result: result === undefined ? null : result }),
        (err) => finish({ ok: false, error: err && err.message ? err.message : String(err) }),
      );
    });
  }

  // True if a live server answers on the path; false if the file is stale.
  function isInUse() {
    return new Promise((resolve) => {
      const probe = net.connect(socketPath);
      probe.once('connect', () => { probe.destroy(); resolve(true); });
      probe.once('error', () => resolve(false));
    });
  }

  async function start() {
    if (server) return;
    if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES) {
      throw new Error(`Socket-Pfad zu lang (${Buffer.byteLength(socketPath)} Bytes, höchstens ${MAX_SOCKET_PATH_BYTES}): ${socketPath}`);
    }
    const dir = path.dirname(socketPath);
    const created = fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (created) fs.chmodSync(dir, 0o700); // only a folder we made ourselves
    if (fs.existsSync(socketPath)) {
      if (await isInUse()) throw new Error('Auf dem Socket läuft bereits ein anderer Server: ' + socketPath);
      fs.unlinkSync(socketPath);
    }
    const srv = net.createServer(onConnection);
    await new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(socketPath, () => { srv.removeListener('error', reject); resolve(); });
    });
    fs.chmodSync(socketPath, 0o600);
    server = srv;
  }

  async function stop() {
    const srv = server;
    server = null;
    if (srv) await new Promise((resolve) => srv.close(() => resolve()));
    try { fs.unlinkSync(socketPath); } catch (_) { /* already gone */ }
  }

  return { start, stop, register, unregister, envFor, socketPath };
}

module.exports = { createBrowserBridge, normalizeUrl, COMMANDS, EVENT_NAMES, MAX_SOCKET_PATH_BYTES, MAX_REQUEST_BYTES };
