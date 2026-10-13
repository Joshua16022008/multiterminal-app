'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BACKSPACE = '\x7f';

// Spoken text is typed into a shell: it must never contain a line break or
// another control character, or a transcript could run as a command.
function cleanText(text) {
  return String(text || '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/ {2,}/g, ' ');
}

// What to send to a terminal so that `typed` becomes `target`.
function typingDiff(typed, target) {
  let same = 0;
  const max = Math.min(typed.length, target.length);
  while (same < max && typed[same] === target[same]) same += 1;
  return BACKSPACE.repeat(Array.from(typed.slice(same)).length) + target.slice(same);
}

// Speech-to-text through Flüsterflow's background service. One dictation at a
// time; the text goes straight to the terminal it was started for.
function createDictation({ serviceDir, write, notify, extraArgs = [] }) {
  let child = null;
  let buffer = '';
  let session = null; // { terminalId, live, typed }

  function send(command) {
    if (child && child.stdin.writable) child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  function report(state, extra = {}) {
    notify({ state, terminalId: session ? session.terminalId : null, ...extra });
  }

  function typeTo(target) {
    if (!session) return;
    const text = cleanText(target);
    const data = typingDiff(session.typed, text);
    if (data) write(session.terminalId, data);
    session.typed = text;
  }

  function onEvent(message) {
    switch (message.event) {
      case 'loading':
        report('loading');
        break;
      case 'recording':
        report('recording', { device: message.device });
        break;
      case 'partial':
        if (session && session.live) typeTo(message.text);
        break;
      case 'processing':
        report('processing');
        break;
      case 'final':
        typeTo(message.text);
        report('idle', { empty: !message.text });
        session = null;
        break;
      case 'cancelled':
        report('idle', { cancelled: true });
        session = null;
        break;
      case 'error':
        report('error', { message: String(message.message || 'Unbekannter Fehler') });
        session = null;
        break;
      default:
        break;
    }
  }

  function ensureService() {
    if (child) return null;
    if (!fs.existsSync(path.join(serviceDir, 'fluesterflow', 'server.py'))) {
      return `Flüsterflow wurde nicht gefunden (${serviceDir}).`;
    }
    const home = os.homedir();
    const env = {
      ...process.env,
      PATH: [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':'),
    };
    const proc = spawn('uv', ['run', 'python', '-m', 'fluesterflow.server', ...extraArgs], {
      cwd: serviceDir, env, stdio: ['pipe', 'pipe', 'ignore'],
    });
    child = proc;
    buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line));
        } catch {
          // Not a protocol line; ignore.
        }
      }
    });
    const gone = (reason) => {
      if (child !== proc) return;
      child = null;
      if (session) {
        report('error', { message: reason });
        session = null;
      }
    };
    proc.on('error', (error) => gone(
      error.code === 'ENOENT' ? 'Das Programm „uv“ wurde nicht gefunden.' : `Flüsterflow konnte nicht starten: ${error.message}`,
    ));
    proc.on('exit', () => gone('Flüsterflow wurde unerwartet beendet.'));
    proc.stdin.on('error', () => {});
    return null;
  }

  function start(terminalId, live) {
    if (session) return { ok: false, error: 'Es läuft bereits ein Diktat.' };
    const problem = ensureService();
    if (problem) return { ok: false, error: problem };
    session = { terminalId: String(terminalId), live: Boolean(live), typed: '' };
    send({ cmd: 'start', live: session.live });
    return { ok: true };
  }

  function stop() {
    if (session) send({ cmd: 'stop' });
  }

  // Discards the recording. Text already typed in live mode stays where it is.
  function cancel() {
    if (session) send({ cmd: 'cancel' });
  }

  function cancelFor(terminalId) {
    if (session && session.terminalId === terminalId) cancel();
  }

  function shutdown() {
    if (!child) return;
    const proc = child;
    child = null;
    session = null;
    try {
      proc.stdin.end(`${JSON.stringify({ cmd: 'quit' })}\n`);
    } catch {
      // Already closed.
    }
    setTimeout(() => proc.kill(), 500).unref();
  }

  return { start, stop, cancel, cancelFor, shutdown };
}

module.exports = { createDictation, cleanText, typingDiff };
