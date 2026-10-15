'use strict';

// `mt-browser`: command line tool that steers the mini browser of the
// Multiterminal tile it runs in. No dependencies; runs with plain node and with
// ELECTRON_RUN_AS_NODE=1 <electron>. Logic is exported as pure functions, the
// network part only runs when the file is started directly.

const net = require('net');
const path = require('path');

const TIMEOUT_MS = 40000;

const HELP = `mt-browser - control the mini browser of your own Multiterminal tile

This command steers the mini browser of the tile (terminal) it runs in.
Use it to show a page you are working on (e.g. a dev server on localhost) in the
browser next to this terminal and to look at the result yourself. The user watches
the same browser while you work. It only works inside a Multiterminal tile.

Usage:
  mt-browser open <url>             Open a page (http/https only; "localhost:3000" is fine).
                                    Shows the browser if it is hidden. Prints the final URL.
  mt-browser reload                 Reload the current page.
  mt-browser back | forward         Go one step in the history.
  mt-browser url                    Print the current URL.
  mt-browser screenshot [file.png]  Save a screenshot of the page and print the file path.
                                    Without a file name a temporary PNG is created.
  mt-browser console [--limit n]    Print recent console messages of the page, one per line
                                    as "[level] message" (default: the last 100).
  mt-browser text [--limit n]       Print the visible text of the page (at most n characters).
  mt-browser click <selector>       Click the element matching the CSS selector (must be visible).
  mt-browser type <selector> <text> Set the text of an input, textarea or editable element and
                                    fire its input/change events. Only these two page actions exist.
  mt-browser show | hide            Show or hide the browser in the tile.
  mt-browser --help                 This text.

Examples:
  mt-browser open localhost:5173
  mt-browser screenshot ./home.png
  mt-browser console --limit 20

Output goes to stdout. Errors go to stderr with exit code 1; exit code 2 means
the command is not running inside a Multiterminal tile or was called wrongly.
`;

const SIMPLE = ['reload', 'back', 'forward', 'url', 'show', 'hide'];

function parseLimit(rest) {
  let limit;
  const free = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    let value = null;
    if (a === '--limit' || a === '-n') value = rest[++i];
    else if (a.startsWith('--limit=')) value = a.slice(8);
    else { free.push(a); continue; }
    if (!/^\d+$/.test(String(value)) || Number(value) < 1) return { error: '--limit braucht eine positive ganze Zahl.' };
    limit = Number(value);
  }
  return { limit, free };
}

// argv without node and script path -> { help } | { cmd, args } | { error }
function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') return { help: true };
  if (cmd === 'open') {
    if (rest.length !== 1) return { error: 'Aufruf: mt-browser open <url>' };
    return { cmd, args: { url: rest[0] } };
  }
  if (SIMPLE.includes(cmd)) {
    if (rest.length) return { error: `mt-browser ${cmd} erwartet keine Argumente.` };
    return { cmd, args: {} };
  }
  if (cmd === 'screenshot') {
    if (rest.length > 1) return { error: 'Aufruf: mt-browser screenshot [datei.png]' };
    return { cmd, args: rest.length ? { out: path.resolve(rest[0]) } : {} };
  }
  if (cmd === 'click') { // F05
    if (rest.length !== 1) return { error: 'Aufruf: mt-browser click <selektor>' };
    return { cmd, args: { selector: rest[0] } };
  }
  if (cmd === 'type') { // F05
    if (rest.length !== 2) return { error: 'Aufruf: mt-browser type <selektor> <text> (Text in Anführungszeichen)' };
    return { cmd, args: { selector: rest[0], text: rest[1] } };
  }
  if (cmd === 'console' || cmd === 'text') {
    const r = parseLimit(rest);
    if (r.error) return { error: r.error };
    if (r.free.length) return { error: `Aufruf: mt-browser ${cmd} [--limit n]` };
    return { cmd, args: r.limit ? { limit: r.limit } : {} };
  }
  return { error: `Unbekannter Befehl: ${cmd}. Siehe mt-browser --help.` };
}

// Returns the request line (without newline) or an error for a missing environment.
function buildRequest(env, parsed) {
  const sock = env.MULTITERMINAL_BROWSER_SOCK;
  const token = env.MULTITERMINAL_BROWSER_TOKEN;
  if (!sock || !token) return { error: 'Nur in einem Multiterminal-Terminal verfügbar.' };
  return { sock, line: JSON.stringify({ token, cmd: parsed.cmd, args: parsed.args }) };
}

function formatEntry(entry) {
  if (entry && typeof entry === 'object') return `[${entry.level || 'log'}] ${entry.message === undefined ? '' : entry.message}`;
  return String(entry);
}

// Turns a bridge answer into { out } or { error }.
function formatResponse(cmd, response) {
  if (!response || typeof response !== 'object') return { error: 'Ungültige Antwort der App.' };
  if (!response.ok) return { error: String(response.error || 'Unbekannter Fehler.') };
  const r = response.result;
  if (cmd === 'console') return { out: Array.isArray(r) ? r.map(formatEntry).join('\n') : String(r ?? '') };
  if (r === null || r === undefined || r === true) return { out: cmd === 'text' ? '' : 'OK' };
  if (typeof r === 'object') return { out: String(r.path || r.url || JSON.stringify(r)) };
  return { out: String(r) };
}

function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// Content of the small `mt-browser` sh script placed on the PATH of terminals.
function wrapperScript({ execPath, scriptPath }) {
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(execPath)} ${shellQuote(scriptPath)} "$@"\n`;
}

function send(sock, line, timeoutMs) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(sock);
    let data = '';
    const timer = setTimeout(() => { conn.destroy(); reject(new Error('Keine Antwort von Multiterminal (Zeitüberschreitung).')); }, timeoutMs);
    conn.on('connect', () => conn.write(line + '\n'));
    conn.on('data', (c) => { data += c; });
    conn.on('error', (e) => { clearTimeout(timer); reject(new Error('Keine Verbindung zu Multiterminal: ' + e.message)); });
    conn.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data.split('\n')[0])); } catch (_) { reject(new Error('Ungültige Antwort der App.')); }
    });
  });
}

// Returns the exit code.
async function run(argv, env, io, timeoutMs) {
  const out = io.stdout || process.stdout;
  const err = io.stderr || process.stderr;
  const parsed = parseArgs(argv);
  if (parsed.help) { out.write(HELP); return 0; }
  if (parsed.error) { err.write(parsed.error + '\n'); return 2; }
  const req = buildRequest(env, parsed);
  if (req.error) { err.write(req.error + '\n'); return 2; }
  let response;
  try {
    response = await send(req.sock, req.line, timeoutMs || TIMEOUT_MS);
  } catch (e) {
    err.write(e.message + '\n');
    return 1;
  }
  const f = formatResponse(parsed.cmd, response);
  if (f.error) { err.write(f.error + '\n'); return 1; }
  if (f.out !== '') out.write(f.out + '\n');
  return 0;
}

module.exports = { HELP, parseArgs, buildRequest, formatResponse, wrapperScript, shellQuote, run };

if (require.main === module) {
  run(process.argv.slice(2), process.env, {}).then((code) => { process.exitCode = code; });
}
