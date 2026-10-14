'use strict';

// `mt-event`: called by Claude Code hooks. Reads the hook JSON from stdin and
// reports one status event to Multiterminal over the bridge socket of the
// terminal it runs in. It must never disturb Claude: no output at all, a hard
// time limit and exit code 0 in every case (also without socket or token).
// Only the event name, notification type, session id, error type and time are
// sent: no prompt, no answer text, no transcript path.

const net = require('net');

const TOTAL_TIMEOUT_MS = 1200;
const STDIN_TIMEOUT_MS = 400;
const MAX_STDIN_BYTES = 4 * 1024 * 1024;

// Hook JSON (object) + event name from argv -> bridge args, or null.
function buildEventArgs(input, argvName, now) {
  const data = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const name = typeof data.hook_event_name === 'string' && data.hook_event_name ? data.hook_event_name : argvName;
  if (typeof name !== 'string' || !name) return null;
  const args = { hook_event_name: name, at: now };
  if (typeof data.notification_type === 'string') args.notification_type = data.notification_type;
  if (typeof data.session_id === 'string') args.session_id = data.session_id;
  if (typeof data.error === 'string') args.error = data.error;
  return args;
}

function buildRequest(env, args) {
  const sock = env.MULTITERMINAL_BROWSER_SOCK;
  const token = env.MULTITERMINAL_BROWSER_TOKEN;
  if (!sock || !token || !args) return null;
  return { sock, line: JSON.stringify({ token, cmd: 'event', args }) };
}

function readStdin(stream, timeoutMs) {
  return new Promise((resolve) => {
    if (!stream || stream.isTTY) { resolve(''); return; }
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(finish, timeoutMs);
    stream.on('data', (raw) => {
      const c = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
      size += c.length;
      if (size > MAX_STDIN_BYTES) { finish(); return; }
      chunks.push(c);
    });
    stream.on('end', finish);
    stream.on('error', finish);
  });
}

function send(sock, line, timeoutMs) {
  return new Promise((resolve) => {
    let conn;
    const timer = setTimeout(() => { if (conn) conn.destroy(); resolve(false); }, timeoutMs);
    const done = (ok) => { clearTimeout(timer); resolve(ok); };
    try {
      conn = net.connect(sock);
    } catch (_) { done(false); return; }
    conn.on('connect', () => conn.write(line + '\n'));
    conn.on('data', () => {});
    conn.on('error', () => done(false));
    conn.on('close', () => done(true));
  });
}

// Always resolves to 0. `io.stdin` may be injected for tests.
async function run(argv, env, io = {}) {
  try {
    const started = Date.now();
    const raw = await readStdin(io.stdin === undefined ? process.stdin : io.stdin, io.stdinTimeoutMs || STDIN_TIMEOUT_MS);
    let input = null;
    try { input = JSON.parse(raw); } catch (_) { input = null; }
    const req = buildRequest(env, buildEventArgs(input, argv[0], Date.now()));
    if (!req) return 0;
    const left = Math.max(100, (io.totalTimeoutMs || TOTAL_TIMEOUT_MS) - (Date.now() - started));
    await send(req.sock, req.line, left);
  } catch (_) { /* never disturb Claude */ }
  return 0;
}

module.exports = { buildEventArgs, buildRequest, run, TOTAL_TIMEOUT_MS };

if (require.main === module) {
  run(process.argv.slice(2), process.env).then(() => process.exit(0), () => process.exit(0));
}
