'use strict';

const { MAX_EXCERPT_CHARS, validateProjectId } = require('./memory-service');
const MAX_CAPTURE_TERMINALS = 256;
const MAX_PENDING_LINE_CHARS = 16000;

// These patterns cover common credentials, not arbitrary sensitive information.
// Redaction runs before the final tail limit so a cropped key cannot expose its
// value. Credential-bearing lines are redacted as a whole, including chunks.
const SENSITIVE_LINE = /(?:authorization\s*:|\b[\w-]{0,80}(?:token|secret|password|passwd|api[_-]?key|access[_-]?key)[\w-]{0,80}["']?\s*[=:]\s*|https?:\/\/[^\s/@]+:[^\s/@]+@|\b[a-f0-9]{48}\b|\b(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-)|-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----)/i;
function redact(text) {
  return text.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/\b[a-fA-F0-9]{48}\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]');
}

function createMemoryCapture({ memory, flushIntervalMs = 15000, onError = () => {} } = {}) {
  if (!memory || typeof memory.getSettings !== 'function' || typeof memory.checkpoint !== 'function') throw new Error('Memory-Dienst fehlt.');
  if (!Number.isFinite(flushIntervalMs) || flushIntervalMs < 1 || flushIntervalMs > 3600000) throw new Error('Ungültiges Capture-Intervall.');
  const terminals = new Map();
  let disposed = false;

  function report(error) { try { onError(error); } catch (_) { /* reporting never kills a PTY */ } }
  function reset(state) {
    state.text = ''; state.line = ''; state.redactLine = false; state.privateKey = false;
    state.ansi = 'text'; state.dirty = false;
  }
  function enabled() { const settings = memory.getSettings(); return settings.enabled && settings.autoCapture; }
  function attach(meta) {
    if (disposed) return;
    if (!meta || typeof meta.terminalId !== 'string' || !meta.terminalId || meta.terminalId.length > 128) throw new Error('Ungültiges Capture-Terminal.');
    validateProjectId(meta.projectId);
    if (meta.projectId === null) throw new Error('Capture braucht ein Projekt.');
    for (const [key, max] of [['provider', 64], ['cwd', 4096], ['workspaceId', 128]]) {
      if (meta[key] !== undefined && (typeof meta[key] !== 'string' || meta[key].length > max || meta[key].includes('\0'))) throw new Error('Ungültige Capture-Herkunft.');
    }
    if (terminals.has(meta.terminalId)) detach(meta.terminalId);
    if (terminals.size >= MAX_CAPTURE_TERMINALS) throw new Error('Capture-Terminalgrenze erreicht.');
    const state = { meta: Object.fromEntries(['terminalId', 'projectId', 'provider', 'cwd', 'workspaceId'].filter((key) => meta[key] !== undefined).map((key) => [key, meta[key]])) };
    reset(state); terminals.set(meta.terminalId, state);
  }

  function printable(state, text) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      state.line += lines[i];
      if (SENSITIVE_LINE.test(state.line)) state.redactLine = true;
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(state.line)) state.privateKey = true;
      state.line = state.line.slice(-MAX_PENDING_LINE_CHARS);
      if (i === lines.length - 1) break;
      const line = state.redactLine || state.privateKey ? '[REDACTED]' : redact(state.line);
      state.text = (state.text + line + '\n').slice(-MAX_EXCERPT_CHARS);
      if (/-----END [A-Z ]*PRIVATE KEY-----/.test(state.line)) state.privateKey = false;
      state.line = ''; state.redactLine = false;
    }
    state.dirty = true;
  }

  // Stateful ANSI parser handles CSI, OSC, DCS/APC/PM and split terminators;
  // escape payloads are discarded without ever accumulating them in a buffer.
  function clean(state, data) {
    let printableChunk = '';
    for (const char of data) {
      const code = char.charCodeAt(0);
      if (state.ansi === 'csi') { if (code >= 0x40 && code <= 0x7e) state.ansi = 'text'; continue; }
      if (state.ansi === 'string') {
        if (code === 7 || code === 0x9c) state.ansi = 'text';
        else if (code === 27) state.ansi = 'string-escape';
        continue;
      }
      if (state.ansi === 'string-escape') { state.ansi = char === '\\' ? 'text' : 'string'; continue; }
      if (state.ansi === 'escape') {
        if (char === '[') state.ansi = 'csi';
        else if (']PX^_'.includes(char)) state.ansi = 'string';
        else if (code >= 0x20 && code <= 0x2f) state.ansi = 'escape-intermediate';
        else state.ansi = 'text';
        continue;
      }
      if (state.ansi === 'escape-intermediate') { if (code >= 0x30 && code <= 0x7e) state.ansi = 'text'; continue; }
      if (code === 27) { state.ansi = 'escape'; continue; }
      if (code === 0x9b) { state.ansi = 'csi'; continue; }
      if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(code)) { state.ansi = 'string'; continue; }
      if (char === '\n' || char === '\t' || (code >= 32 && (code < 0x7f || code > 0x9f))) {
        printableChunk += char;
        if (printableChunk.length >= 4096) { printable(state, printableChunk); printableChunk = ''; }
      }
    }
    if (printableChunk) printable(state, printableChunk);
  }

  function feed(terminalId, data) {
    const state = terminals.get(terminalId);
    if (disposed || !state || typeof data !== 'string') return;
    try {
      if (!enabled()) { reset(state); return; }
      clean(state, data);
    } catch (err) { reset(state); report(err); }
  }

  function flush(terminalId) {
    if (disposed) return;
    const entries = terminalId === undefined ? [...terminals.values()] : [terminals.get(terminalId)].filter(Boolean);
    for (const state of entries) {
      try {
        if (!enabled()) { reset(state); continue; }
        if (!state.dirty) continue;
        const line = state.redactLine || state.privateKey ? '[REDACTED]' : redact(state.line);
        const summary = (state.text + line).slice(-MAX_EXCERPT_CHARS).trim();
        if (summary) {
          const { projectId, ...provenance } = state.meta;
          memory.checkpoint(projectId, { ...provenance, source: 'terminal', summary });
        }
        state.dirty = false;
      } catch (err) { report(err); }
    }
  }

  function detach(terminalId) { flush(terminalId); terminals.delete(terminalId); }
  function clear(projectId) {
    for (const state of terminals.values()) if (state.meta.projectId === projectId) reset(state);
  }
  function dispose() {
    if (disposed) return;
    clearInterval(timer); flush(); terminals.clear(); disposed = true;
  }
  const timer = setInterval(() => flush(), flushIntervalMs);
  if (timer.unref) timer.unref();
  return { attach, feed, flush, detach, clear, dispose };
}

module.exports = { createMemoryCapture, redact, MAX_EXCERPT_CHARS, MAX_PENDING_LINE_CHARS, MAX_CAPTURE_TERMINALS };
