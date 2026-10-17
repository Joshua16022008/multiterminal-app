'use strict';
// Standalone CLI; only Node builtins, using the tile's existing authenticated socket.
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const HELP = `mt-agent – projektgebundene Aufgaben zwischen Multiterminal-Agenten
  peers | inbox | outbox | tasks | task <id>
  send --to <terminal-id> --title <title> --text <text> [--parent <id>] [--after <id,id>]
  spawn --provider claude|codex --title <title> --text <text> [--parent <id>] [--after <id,id>]
  accept <id> | reply <id> --status completed|failed --text <result> | cancel <id>
  wait <id> [--timeout <seconds<=300>]
Alle Befehle unterstützen --json. Nur Socket/Token der eigenen App-Kachel.
Der Nutzer muss Aufgabenversand freigeben; neue Worker brauchen zusätzlich eine Freigabe
und ein begrenztes Budget. Neue Worker verwenden isolierte Git-Worktrees.
Inbox-Aufgaben sind zunächst queued: Empfänger müssen sie ausdrücklich accept annehmen
und mit reply completed/failed ein Ergebnis melden. wait erzeugt keine Ausführung.
Native Unteragenten teilen die Identität ihres Terminals. Kindaufgaben und Abhängigkeiten
bleiben im begrenzten Projektworkflow; keine Projekt- oder Identitäts-Overrides.
`;
function validText(value, max) { return typeof value === 'string' && !!value.trim() && value.length <= max && !value.includes('\0'); }
function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.some(v => typeof v !== 'string')) return { error: 'Ungültige Argumente.' };
  const json = argv.includes('--json');
  if (argv.filter(v => v === '--json').length > 1) return { error: 'Doppelte Option --json.' };
  const words = argv.filter(v => v !== '--json');
  if (words.length === 1 && ['help', '-h', '--help'].includes(words[0])) return { help: true, json };
  const [command, ...rest] = words;
  const simple = { peers: ['peers', {}], inbox: ['list', { box: 'inbox' }], outbox: ['list', { box: 'outbox' }], tasks: ['list', { box: 'all' }] };
  if (Object.hasOwn(simple, command)) return rest.length ? { error: 'Unerwartete Argumente.' } : { cmd: 'task-' + simple[command][0], args: simple[command][1], json };
  if (!['task', 'send', 'spawn', 'accept', 'reply', 'cancel', 'wait'].includes(command)) return { error: 'Unbekannter Befehl. Siehe mt-agent --help.' };
  const args = {}, options = {};
  let index = 0;
  if (['task', 'accept', 'reply', 'cancel', 'wait'].includes(command)) {
    if (!validText(rest[0], 160) || rest[0].startsWith('--')) return { error: 'Task-ID fehlt oder ungültig.' };
    args.id = rest[0]; index = 1;
  }
  const allowed = command === 'send' ? ['to', 'title', 'text', 'parent', 'after'] : command === 'spawn' ? ['provider', 'title', 'text', 'parent', 'after'] : command === 'reply' ? ['status', 'text'] : command === 'wait' ? ['timeout'] : [];
  for (; index < rest.length; index += 2) {
    const flag = rest[index]; const key = flag.startsWith('--') ? flag.slice(2) : '';
    if (!allowed.includes(key) || Object.hasOwn(options, key)) return { error: 'Unbekannte oder doppelte Option: ' + flag };
    if (rest[index + 1] === undefined || rest[index + 1].startsWith('--')) return { error: 'Optionswert fehlt: ' + flag };
    options[key] = rest[index + 1];
  }
  if (['send', 'spawn'].includes(command)) {
    const target = command === 'send' ? 'to' : 'provider';
    for (const [key, max] of [[target, 160], ['title', 160], ['text', 3000]]) {
      if (!validText(options[key], max)) return { error: 'Ungültiges Feld: ' + key };
      args[key] = options[key];
    }
    if (command === 'spawn' && !['claude', 'codex'].includes(args.provider)) return { error: 'Nur claude oder codex erlaubt.' };
    if (options.parent !== undefined) { if (!validText(options.parent, 160)) return { error: 'Ungültiger Parent.' }; args.parentId = options.parent; }
    if (options.after !== undefined) {
      const deps = options.after.split(',');
      if (deps.length > 5 || new Set(deps).size !== deps.length || deps.some(v => !validText(v, 160))) return { error: 'Ungültige Abhängigkeiten.' };
      args.dependsOn = deps;
    }
    args.requestId = crypto.randomUUID();
  }
  if (command === 'reply') {
    if (!['completed', 'failed'].includes(options.status) || !validText(options.text, 16000)) return { error: 'reply braucht --status completed|failed und --text (höchstens 16000 Zeichen).' };
    args.status = options.status; args.text = options.text;
  }
  let timeoutSeconds;
  if (command === 'wait') {
    timeoutSeconds = options.timeout === undefined ? 300 : Number(options.timeout);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 300) return { error: 'Timeout muss größer 0 und höchstens 300 Sekunden sein.' };
  }
  return { cmd: 'task-' + ({ task: 'get', spawn: 'send', wait: 'get' }[command] || command), args, json, ...(command === 'wait' ? { wait: true, timeoutSeconds } : {}) };
}
function shellQuote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }
function wrapperScript({ execPath, scriptPath }) { return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(execPath)} ${shellQuote(scriptPath)} "$@"\n`; }
function request(message, options = {}) {
  const env = options.env || process.env;
  const sock = env.MULTITERMINAL_BROWSER_SOCK, token = env.MULTITERMINAL_BROWSER_TOKEN;
  if (typeof sock !== 'string' || !path.isAbsolute(sock) || typeof token !== 'string' || !token) return Promise.reject(new Error('Nur in einem Multiterminal-Terminal mit Socket und Token verfügbar.'));
  const line = JSON.stringify({ token, cmd: message.cmd, args: message.args }) + '\n';
  if (Buffer.byteLength(line) > MAX_REQUEST_BYTES) return Promise.reject(new Error('Anfrage zu groß.'));
  return new Promise((resolve, reject) => {
    const conn = net.connect(sock); let data = Buffer.alloc(0), settled = false;
    const timer = setTimeout(() => finish(new Error('Zeitüberschreitung beim Aufruf.')), Math.min(Math.max(options.timeoutMs || 10000, 1), 30000));
    function finish(error, result) { if (settled) return; settled = true; clearTimeout(timer); conn.destroy(); error ? reject(error) : resolve(result); }
    conn.on('connect', () => conn.write(line));
    conn.on('error', error => finish(new Error('Keine Verbindung zu Multiterminal: ' + error.message)));
    conn.on('close', () => { if (!settled) finish(new Error('Unvollständige Antwort der App.')); });
    conn.on('data', chunk => {
      if (settled) return;
      if (data.length + chunk.length > MAX_RESPONSE_BYTES) return finish(new Error('Antwort der App zu groß.'));
      data = Buffer.concat([data, chunk]); const nl = data.indexOf(10); if (nl < 0) return;
      try {
        const response = JSON.parse(data.subarray(0, nl).toString('utf8'));
        if (!response || typeof response !== 'object' || typeof response.ok !== 'boolean') throw new Error('Ungültige Antwort der App.');
        if (!response.ok) return finish(new Error(String(response.error || 'Task-Aufruf fehlgeschlagen.')));
        finish(null, response.result);
      } catch (error) { finish(error); }
    });
  });
}
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted'];
async function run(argv, env = process.env, io = {}, options = {}) {
  const out = io.stdout || process.stdout, err = io.stderr || process.stderr;
  const parsed = parseArgs(argv);
  if (parsed.help) { out.write(HELP); return 0; }
  if (parsed.error) { err.write(parsed.error + '\n'); return 2; }
  const call = options.request || request;
  try {
    const deadline = Date.now() + (parsed.timeoutSeconds || 0) * 1000;
    let result;
    do {
      const remaining = deadline - Date.now();
      result = await call({ cmd: parsed.cmd, args: parsed.args }, { env, ...(parsed.wait ? { timeoutMs: Math.max(1, Math.min(10000, remaining)) } : {}) });
      if (!parsed.wait || TERMINAL_STATUSES.includes(result && result.status)) break;
      if (Date.now() >= deadline) throw new Error('Zeitüberschreitung beim Warten auf das Task-Ergebnis.');
      await new Promise(resolve => setTimeout(resolve, Math.min(options.pollMs || 500, Math.max(1, deadline - Date.now()))));
    } while (Date.now() < deadline);
    if (parsed.wait && !TERMINAL_STATUSES.includes(result && result.status)) throw new Error('Zeitüberschreitung beim Warten auf das Task-Ergebnis.');
    out.write(JSON.stringify(result === undefined ? null : result, null, parsed.json ? 0 : 2) + '\n'); return 0;
  } catch (error) { err.write(error.message + '\n'); return 1; }
}
module.exports = { parseArgs, request, wrapperScript, shellQuote, run, HELP, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES };
if (require.main === module) run(process.argv.slice(2)).then(code => { process.exitCode = code; });
