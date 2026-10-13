'use strict';

const fs = require('fs');
const pty = require('node-pty');

const MAX_PER_PROJECT = 30;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_COMMAND_LENGTH = 2000;
// A quick-start command is typed only once the shell's line editor is ready.
// zsh, fish and current bash announce that by switching on bracketed paste;
// typing earlier could answer a startup question (e.g. zsh's compinit prompt).
const PROMPT_READY = '\x1b[?2004h';
const READY_SHELLS = /(^|\/)(zsh|fish)$/;
const COMMAND_DELAY_MS = 150;
// Shells that never announce readiness: wait until startup output goes quiet.
const QUIET_DELAY_MS = 700;

function clampSize(value, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 2), 1000);
}

function isValidCommand(command) {
  return typeof command === 'string'
    && command.trim().length > 0
    && command.length <= MAX_COMMAND_LENGTH
    && !/[\r\n]/.test(command);
}

// The shell must look like a normal terminal session, not like a child of
// whatever launched the app (Electron, or an agent session during development).
// extraEnv adds or overrides variables; a null value removes one, so an
// inherited CLAUDE_CONFIG_DIR cannot leak into a terminal using the default account.
function shellEnv(extraEnv) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith('ELECTRON_') || key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) continue;
    env[key] = value;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'MultiterminalApp';
  if (!env.LANG) env.LANG = 'de_DE.UTF-8';
  if (extraEnv && typeof extraEnv === 'object') {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value === null || value === undefined) delete env[key];
      else if (typeof value === 'string') env[key] = value;
    }
  }
  return env;
}

function createPtyManager({ onData, onExit }) {
  const terminals = new Map(); // id -> { proc, projectId }

  function countFor(projectId) {
    let count = 0;
    for (const entry of terminals.values()) {
      if (entry.projectId === projectId) count += 1;
    }
    return count;
  }

  function create({ id, projectId, cwd, cols, rows, command, extraEnv }) {
    if (!ID_PATTERN.test(String(id))) return { ok: false, error: 'Ungültige Terminal-ID.' };
    if (terminals.has(id)) return { ok: false, error: 'Dieses Terminal läuft bereits.' };
    if (countFor(projectId) >= MAX_PER_PROJECT) {
      return { ok: false, error: `Maximal ${MAX_PER_PROJECT} Terminals pro Projekt.` };
    }
    if (command != null && command !== '' && !isValidCommand(command)) {
      return { ok: false, error: 'Ungültiger Startbefehl.' };
    }
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(cwd).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isDirectory) return { ok: false, error: `Projektordner nicht gefunden: ${cwd}` };

    const shell = process.env.SHELL || '/bin/zsh';
    let proc;
    try {
      // Interactive login shell: loads the user's full PATH even when the app
      // was started from the Dock, so claude, codex, kimi etc. are found.
      proc = pty.spawn(shell, ['-l', '-i'], {
        name: 'xterm-256color',
        cols: clampSize(cols, 80),
        rows: clampSize(rows, 24),
        cwd,
        env: shellEnv(extraEnv),
      });
    } catch (error) {
      return { ok: false, error: `Shell konnte nicht gestartet werden: ${error.message}` };
    }

    const entry = { proc, projectId };
    terminals.set(id, entry);

    let commandTimer = null;
    let commandSent = !isValidCommand(command);
    const sendCommand = () => {
      if (commandSent || terminals.get(id) !== entry) return;
      commandSent = true;
      proc.write(`${command}\r`);
    };
    const announcesReady = READY_SHELLS.test(shell);
    let tail = '';

    proc.onData((data) => {
      if (!commandSent) {
        tail = (tail + data).slice(-64);
        if (tail.includes(PROMPT_READY)) {
          clearTimeout(commandTimer);
          commandTimer = setTimeout(sendCommand, COMMAND_DELAY_MS);
        } else if (!announcesReady) {
          clearTimeout(commandTimer);
          commandTimer = setTimeout(sendCommand, QUIET_DELAY_MS);
        }
      }
      onData(id, data);
    });
    proc.onExit(({ exitCode }) => {
      if (commandTimer) clearTimeout(commandTimer);
      if (terminals.get(id) === entry) terminals.delete(id);
      onExit(id, exitCode);
    });

    return { ok: true };
  }

  function write(id, data) {
    const entry = terminals.get(id);
    if (entry && typeof data === 'string') entry.proc.write(data);
  }

  function resize(id, cols, rows) {
    const entry = terminals.get(id);
    if (!entry) return;
    try {
      entry.proc.resize(clampSize(cols, 80), clampSize(rows, 24));
    } catch {
      // The shell may have exited between the resize request and now.
    }
  }

  function kill(id) {
    const entry = terminals.get(id);
    if (!entry) return;
    terminals.delete(id);
    try {
      entry.proc.kill();
    } catch {
      // Already gone.
    }
  }

  function killProject(projectId) {
    for (const [id, entry] of [...terminals]) {
      if (entry.projectId === projectId) kill(id);
    }
  }

  function killAll() {
    for (const id of [...terminals.keys()]) kill(id);
  }

  return { create, write, resize, kill, killProject, killAll, countFor };
}

module.exports = { createPtyManager, shellEnv, MAX_PER_PROJECT };
