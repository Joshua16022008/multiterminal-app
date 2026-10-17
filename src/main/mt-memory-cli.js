'use strict';

// Standalone: copied/executed with node or ELECTRON_RUN_AS_NODE, builtins only.
const net = require('node:net');
const path = require('node:path');
const TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_FIELD_CHARS = 8000;
const MAX_CHECKPOINT_CHARS = 16000;
const FLAGS = Object.freeze({ '--goal': 'goal', '--summary': 'summary', '--decisions': 'decisions', '--questions': 'openQuestions', '--next': 'nextStep', '--files': 'files' });
const HELP = `mt-memory – gemeinsames lokales Projekt-Memory der eigenen Multiterminal-Kachel

  mt-memory read
  mt-memory save --summary 'Tests bestanden' --next 'Bedienung prüfen'

save: --goal, --summary, --decisions, --questions, --next, --files
Textwerte in Anführungszeichen setzen; mindestens ein Textfeld ist erforderlich.
read gibt Markdown aus. save gibt Erfolgs-JSON aus. Nur in App-Terminals verfügbar.
`;

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== 'string')) return { error: 'Ungültige Argumente.' };
  if (argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0])) return { help: true };
  const [command, ...rest] = argv;
  if (command === 'read') return rest.length ? { error: 'Aufruf: mt-memory read (ohne Projekt-Override).' } : { cmd: 'memory-read', args: {} };
  if (command !== 'save') return { error: 'Aufruf: mt-memory read | save [Textfelder]. Siehe --help.' };
  const args = {};
  let total = 0;
  for (let i = 0; i < rest.length; i += 2) {
    const field = FLAGS[rest[i]];
    if (!Object.hasOwn(FLAGS, rest[i])) return { error: 'Unbekannte Option: ' + rest[i] };
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: rest[i] + ' braucht einen Textwert.' };
    if (Object.hasOwn(args, field)) return { error: 'Doppelte Option: ' + rest[i] };
    if (value.length > MAX_FIELD_CHARS || value.includes('\0')) return { error: 'Textfeld zu groß oder ungültig (höchstens 8000 Zeichen).' };
    total += value.length;
    args[field] = value;
  }
  if (!Object.values(args).some((s) => s.trim())) return { error: 'save braucht mindestens ein Textfeld.' };
  if (total > MAX_CHECKPOINT_CHARS) return { error: 'Checkpoint zu groß (höchstens 16000 Zeichen).' };
  return { cmd: 'memory-save', args };
}

function buildRequest(env, parsed) {
  const sock = env.MULTITERMINAL_BROWSER_SOCK;
  const token = env.MULTITERMINAL_BROWSER_TOKEN;
  if (typeof sock !== 'string' || !path.isAbsolute(sock) || typeof token !== 'string' || !token) return { error: 'Nur in einem Multiterminal-Terminal mit Socket und Token verfügbar.' };
  return { sock, line: JSON.stringify({ token, cmd: parsed.cmd, args: parsed.args }) };
}

function shellQuote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }
function wrapperScript({ execPath, scriptPath }) {
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(execPath)} ${shellQuote(scriptPath)} "$@"\n`;
}

function send(sock, line, timeoutMs) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(sock);
    let buffer = Buffer.alloc(0), settled = false;
    const timer = setTimeout(() => finish(new Error('Keine Antwort von Multiterminal (Zeitüberschreitung).')), timeoutMs);
    function finish(err, response) {
      if (settled) return;
      settled = true; clearTimeout(timer); conn.destroy();
      if (err) reject(err); else resolve(response);
    }
    conn.on('connect', () => conn.write(line + '\n'));
    conn.on('error', (err) => finish(new Error('Keine Verbindung zu Multiterminal: ' + err.message)));
    conn.on('data', (chunk) => {
      if (settled) return;
      if (buffer.length + chunk.length > MAX_RESPONSE_BYTES) { finish(new Error('Antwort der App zu groß.')); return; }
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(10);
      if (newline >= 0) {
        try { finish(null, JSON.parse(buffer.subarray(0, newline).toString('utf8'))); }
        catch (_) { finish(new Error('Ungültige Antwort der App.')); }
      }
    });
    conn.on('close', () => { if (!settled) finish(new Error('Unvollständige Antwort der App.')); });
  });
}

function formatResponse(cmd, response) {
  if (!response || typeof response !== 'object' || Array.isArray(response) || typeof response.ok !== 'boolean') return { error: 'Ungültige Antwort der App.' };
  if (!response.ok) return { error: String(response.error || 'Memory-Aufruf fehlgeschlagen.') };
  if (cmd === 'memory-read') return typeof response.result === 'string' ? { out: response.result } : { error: 'Memory-read erwartet Markdown.' };
  return { out: JSON.stringify(response.result === undefined ? { ok: true } : response.result) };
}

async function run(argv, env = process.env, io = {}, timeoutMs = TIMEOUT_MS) {
  const out = io.stdout || process.stdout, err = io.stderr || process.stderr;
  const parsed = parseArgs(argv);
  if (parsed.help) { out.write(HELP); return 0; }
  if (parsed.error) { err.write(parsed.error + '\n'); return 2; }
  const req = buildRequest(env, parsed);
  if (req.error) { err.write(req.error + '\n'); return 2; }
  try {
    const response = await send(req.sock, req.line, Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 60000) : TIMEOUT_MS);
    const formatted = formatResponse(parsed.cmd, response);
    if (formatted.error) { err.write(formatted.error + '\n'); return 1; }
    if (formatted.out) out.write(formatted.out + (formatted.out.endsWith('\n') ? '' : '\n'));
    return 0;
  } catch (error) { err.write(error.message + '\n'); return 1; }
}

module.exports = { parseArgs, buildRequest, formatResponse, wrapperScript, shellQuote, run, TIMEOUT_MS, MAX_RESPONSE_BYTES, HELP };
if (require.main === module) run(process.argv.slice(2), process.env, {}).then((code) => { process.exitCode = code; });
