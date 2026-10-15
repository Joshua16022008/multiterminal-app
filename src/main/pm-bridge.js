'use strict';

// Lokale Brücke für den Projektmanager-Agenten (`mt-pm`). Ein Unix-Socket nimmt je Verbindung
// eine JSON-Zeile { token, cmd, args } entgegen und antwortet { ok, result } | { ok:false, error }.
// Eigener Socket (nicht der des Mini-Browsers), eigenes Token je Manager, das Token ist an genau
// ein Projekt gebunden. Der Server schreibt nie selbst in ein Terminal: `send` legt den Text nur
// als Promptvorschau in die Zielkachel (über requestSend), die der Nutzer bestätigen muss.

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const MAX_SOCKET_PATH_BYTES = 100;
const MAX_REQUEST_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const HANDLER_TIMEOUT_MS = 30000;
const MAX_SEND_CHARS = 4000;
const MAX_LINES = 500;
const DEFAULT_LINES = 50;

const COMMANDS = Object.freeze(['status', 'output', 'changes', 'ports', 'docs', 'send']);

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Alle Steuerzeichen außer \n entfernen (auch ESC, \r, \t, DEL und C1).
function cleanText(text) {
  return String(text).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '');
}

function terminalRef(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Es fehlt die Kachel (ID oder Titel).');
  if (value.length > 200) throw new Error('Kachelname zu lang.');
  return value;
}

function validateCommand(cmd, args) {
  if (typeof cmd !== 'string' || !COMMANDS.includes(cmd)) {
    throw new Error('Unbekannter Befehl. Erlaubt: ' + COMMANDS.join(', ') + '.');
  }
  const a = isObject(args) ? args : {};
  if (cmd === 'output') {
    let lines = DEFAULT_LINES;
    if (a.lines !== undefined && a.lines !== null) {
      if (!Number.isInteger(a.lines) || a.lines < 1 || a.lines > MAX_LINES) throw new Error(`lines muss eine ganze Zahl von 1 bis ${MAX_LINES} sein.`);
      lines = a.lines;
    }
    return { terminal: terminalRef(a.terminal), lines };
  }
  if (cmd === 'send') {
    if (typeof a.text !== 'string') throw new Error('send braucht einen Text.');
    if (a.text.length > MAX_SEND_CHARS) throw new Error(`Der Auftrag ist zu lang (höchstens ${MAX_SEND_CHARS} Zeichen).`);
    const text = cleanText(a.text).trim();
    if (!text) throw new Error('Der Auftrag ist leer.');
    return { terminal: terminalRef(a.terminal), text };
  }
  return {};
}

// service: createPmService(...); requestSend({ projectId, terminalId, text }) -> Promise<{ ok, error? }>
function createPmBridge({ socketPath, service, requestSend, requestTimeoutMs, handlerTimeoutMs } = {}) {
  if (typeof socketPath !== 'string' || !path.isAbsolute(socketPath)) throw new Error('socketPath muss ein absoluter Pfad sein.');
  if (!service) throw new Error('service fehlt.');
  if (typeof requestSend !== 'function') throw new Error('requestSend fehlt.');
  const readTimeout = requestTimeoutMs || REQUEST_TIMEOUT_MS;
  const runTimeout = handlerTimeoutMs || HANDLER_TIMEOUT_MS;

  const tokens = new Map(); // projectId -> token
  let server = null;

  function register(projectId) {
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(String(projectId), token);
    return token;
  }

  function unregister(projectId) {
    tokens.delete(String(projectId));
  }

  function envFor(projectId) {
    const token = tokens.get(String(projectId));
    if (!token) return {};
    return { MULTITERMINAL_PM_SOCKET: socketPath, MULTITERMINAL_PM_TOKEN: token };
  }

  // Zeitkonstanter Vergleich mit allen Tokens, kein frühes Ende.
  function projectForToken(token) {
    if (typeof token !== 'string') return null;
    const given = Buffer.from(token);
    let found = null;
    for (const [id, own] of tokens) {
      const ownBuf = Buffer.from(own);
      if (given.length === ownBuf.length && crypto.timingSafeEqual(given, ownBuf)) found = id;
    }
    return found;
  }

  async function send(projectId, args) {
    const res = service.resolveTerminal(projectId, args.terminal);
    if (!res.ok) throw new Error(res.error);
    const target = res.terminal;
    if (target.id === 'pm-' + projectId) throw new Error('Der Manager kann sich selbst keinen Auftrag schicken.');
    if (!target.running) throw new Error(`Die Kachel „${target.title}“ läuft nicht.`);
    let answer;
    try {
      answer = await requestSend({ projectId, terminalId: target.id, text: args.text });
    } catch (err) {
      throw new Error(err && err.message ? err.message : 'Promptvorschau nicht möglich.');
    }
    if (!answer || answer.ok !== true) throw new Error((answer && answer.error) || 'Promptvorschau nicht möglich.');
    return `In Promptvorschau von ${target.title} gelegt – wartet auf Bestätigung durch Joshua.`;
  }

  async function run(projectId, cmd, args) {
    let r;
    if (cmd === 'status') r = await service.state(projectId);
    else if (cmd === 'output') {
      const res = service.resolveTerminal(projectId, args.terminal);
      if (!res.ok) throw new Error(res.error);
      r = await service.output(projectId, res.terminal.id, args.lines);
      if (r && r.ok) r = { ...r, title: res.terminal.title };
    } else if (cmd === 'changes') r = await service.changes(projectId);
    else if (cmd === 'ports') r = await service.ports(projectId);
    else if (cmd === 'docs') r = await service.docs(projectId);
    else return send(projectId, args);
    if (!r || r.ok === false) throw new Error((r && r.error) || 'Fehler beim Lesen.');
    return r;
  }

  async function execute(request) {
    if (!isObject(request)) throw new Error('Ungültige Anfrage.');
    const projectId = projectForToken(request.token);
    if (projectId === null) throw new Error('Nicht berechtigt.');
    const args = validateCommand(request.cmd, request.args);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Zeitüberschreitung beim Ausführen des Befehls.')), runTimeout);
    });
    try {
      return await Promise.race([run(projectId, request.cmd, args), timeout]);
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
      if (buffer.length > MAX_REQUEST_BYTES) { finish({ ok: false, error: 'Anfrage zu groß.' }); return; }
      const nl = buffer.indexOf(10);
      if (nl < 0) return;
      clearTimeout(timer);
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
    if (created) fs.chmodSync(dir, 0o700);
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
    tokens.clear();
    if (srv) await new Promise((resolve) => srv.close(() => resolve()));
    try { fs.unlinkSync(socketPath); } catch (_) { /* schon weg */ }
  }

  return { start, stop, register, unregister, envFor, socketPath };
}

module.exports = { createPmBridge, validateCommand, cleanText, COMMANDS, MAX_SEND_CHARS, MAX_SOCKET_PATH_BYTES, MAX_REQUEST_BYTES };
