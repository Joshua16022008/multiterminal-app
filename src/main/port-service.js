'use strict';

const { execFile } = require('node:child_process');
const { isIP } = require('node:net');

const LSOF = '/usr/sbin/lsof';
const LSOF_ARGS = ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'];
const PS = '/bin/ps';
const PS_ARGS = ['-axo', 'pid=,ppid='];
const COMMAND_OPTIONS = Object.freeze({
  encoding: 'utf8', timeout: 4000, maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, LC_ALL: 'C' }, windowsHide: true,
});

function runCommand(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else resolve({ stdout, stderr });
    });
  });
}

function boundedOutput(result) {
  const stdout = String(result?.stdout || '');
  const stderr = String(result?.stderr || '');
  if (Buffer.byteLength(stdout) > COMMAND_OPTIONS.maxBuffer || Buffer.byteLength(stderr) > COMMAND_OPTIONS.maxBuffer) {
    throw new Error('Prozessausgabe überschreitet die Größenbegrenzung.');
  }
  return { stdout, stderr };
}

function diagnostic(error) {
  if (error?.killed || error?.code === 'ETIMEDOUT') return 'Zeitlimit der Prozessabfrage erreicht.';
  if (error?.code === 'ENOENT') return 'Systemwerkzeug für die Prozessabfrage fehlt.';
  return String(error?.stderr || error?.message || 'Prozessabfrage fehlgeschlagen.').trim().slice(0, 500);
}

function endpoint(value) {
  // lsof -nP supplies numeric endpoints, not advertised devserver URLs.
  const match = /^(?:\[([^\]]+)\]|(.+)):(\d+)$/.exec(value);
  if (!match) return null;
  const host = match[1] || match[2];
  const port = Number(match[3]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || (host !== '*' && !isIP(host))) return null;
  let urlHost = host;
  if (host === '*') urlHost = 'localhost';
  else if (host === '0.0.0.0') urlHost = '127.0.0.1';
  else if (host === '::') urlHost = '::1';
  // Browsers do not reliably support IPv6 scope identifiers. Keep the listener,
  // but do not invent a reachable address for it.
  const url = host.includes('%') ? null : `http://${isIP(urlHost) === 6 ? `[${urlHost}]` : urlHost}:${port}`;
  return { host, port, url };
}

function parseListeners(stdout) {
  const entries = new Map();
  let pid = null;
  let processName = '';
  for (const line of stdout.split('\n')) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') {
      pid = /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
      processName = '';
    } else if (field === 'c') processName = value.slice(0, 256);
    else if (field === 'n' && pid) {
      const address = endpoint(value);
      if (!address) continue;
      const id = `tcp:${pid}:${encodeURIComponent(address.host)}:${address.port}`;
      entries.set(id, { id, pid, process: processName || 'unbekannt', ...address, terminalId: null, projectId: null });
    }
  }
  return [...entries.values()].sort((a, b) => a.port - b.port || a.pid - b.pid || a.host.localeCompare(b.host));
}

function parseParents(stdout) {
  const parents = new Map();
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!Number.isSafeInteger(pid) || pid < 1 || !Number.isSafeInteger(ppid)) continue;
    if (parents.has(pid) && parents.get(pid) !== ppid) parents.set(pid, null);
    else parents.set(pid, ppid);
  }
  return parents;
}

function snapshot(getTerminals) {
  const terminals = getTerminals();
  if (!Array.isArray(terminals)) throw new Error('Live-Terminalübersicht ist nicht verfügbar.');
  return terminals.filter((t) => t && Number.isSafeInteger(t.pid) && t.pid > 0
    && typeof t.terminalId === 'string' && t.terminalId && typeof t.projectId === 'string' && t.projectId)
    .map((t) => ({ terminalId: t.terminalId, projectId: t.projectId, pid: t.pid,
      ...(typeof t.cwd === 'string' ? { cwd: t.cwd } : {}),
      ...(typeof t.workspaceId === 'string' ? { workspaceId: t.workspaceId } : {}),
    }));
}

function stableRoots(before, after) {
  const roots = new Map();
  // Retain ambiguous/closed roots as null: a more distant ancestor must not
  // accidentally turn an ambiguous nested-terminal relationship into a match.
  for (const t of [...before, ...after]) roots.set(t.pid, null);
  for (const t of before) {
    const samePidBefore = before.filter((other) => other.pid === t.pid);
    const samePidAfter = after.filter((other) => other.pid === t.pid);
    if (samePidBefore.length !== 1 || samePidAfter.length !== 1) continue;
    if (before.filter((other) => other.terminalId === t.terminalId).length !== 1
      || after.filter((other) => other.terminalId === t.terminalId).length !== 1) continue;
    if (JSON.stringify(t) === JSON.stringify(samePidAfter[0])) roots.set(t.pid, t);
  }
  return roots;
}

function owner(pid, parents, roots) {
  const seen = new Set();
  const matches = [];
  while (pid > 0) {
    if (seen.has(pid) || seen.size >= 1024 || !parents.has(pid) || parents.get(pid) === null) return null;
    seen.add(pid);
    if (roots.has(pid)) {
      if (!roots.get(pid)) return null;
      matches.push(roots.get(pid));
    }
    pid = parents.get(pid);
  }
  return matches.length === 1 ? matches[0] : null;
}

function createPortService({ getTerminals = () => [], run = runCommand } = {}) {
  async function list() {
    let before = [];
    const warnings = [];
    try { before = snapshot(getTerminals); }
    catch (error) { warnings.push(diagnostic(error)); }

    let listeners;
    try {
      const result = boundedOutput(await run(LSOF, [...LSOF_ARGS], { ...COMMAND_OPTIONS }));
      listeners = parseListeners(result.stdout);
      if (result.stderr.trim()) warnings.push(result.stderr.trim().slice(0, 500));
    } catch (error) {
      // lsof uses exit 1 with no output for a successful scan with no matches.
      // Any diagnostic, partial output, signal, or timeout is a failure instead.
      if (error?.code === 1 && !error.killed && !error.signal
        && !String(error.stdout || '').trim() && !String(error.stderr || '').trim()) listeners = [];
      else return { ok: false, entries: [], capturedAt: new Date().toISOString(), error: diagnostic(error) };
    }

    if (listeners.length) {
      try {
        const result = boundedOutput(await run(PS, [...PS_ARGS], { ...COMMAND_OPTIONS }));
        if (result.stderr.trim()) {
          // Partial process visibility cannot justify a terminal assignment.
          warnings.push(result.stderr.trim().slice(0, 500));
        } else {
          const after = snapshot(getTerminals);
          const roots = stableRoots(before, after);
          const parents = parseParents(result.stdout);
          for (const entry of listeners) {
            const terminal = owner(entry.pid, parents, roots);
            if (terminal) {
              entry.terminalId = terminal.terminalId;
              entry.projectId = terminal.projectId;
              if (terminal.cwd !== undefined) entry.cwd = terminal.cwd;
              if (terminal.workspaceId !== undefined) entry.workspaceId = terminal.workspaceId;
            }
          }
        }
      } catch (error) { warnings.push(`Kachelzuordnung nicht verfügbar: ${diagnostic(error)}`); }
    }
    if (warnings.length) {
      // Even a partial lsof scan may omit inaccessible listeners.
      return { ok: true, entries: listeners, capturedAt: new Date().toISOString(), warning: [...new Set(warnings)].join(' ') };
    }
    return { ok: true, entries: listeners, capturedAt: new Date().toISOString() };
  }
  return { list };
}

module.exports = { createPortService };
