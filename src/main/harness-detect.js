'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);
// Explicit command-v exception to IPC §2: fixed executable + script + positional
// binary. No entry/user value is ever inserted into shell source. All subsequent
// CLI invocations use execFile directly. This also loads a Dock launch's PATH.
const LOOKUP_SCRIPT = 'command -v -- "$1"';
const BINARY_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;
const TIMEOUT = 5000;

function createHarnessDetect({ catalog, env = process.env, run = runFile } = {}) {
  const cache = new Map();
  const pending = new Map();
  async function invoke(file, argv) {
    let timer;
    try {
      const result = await Promise.race([
        run(file, argv, { env, timeout: TIMEOUT, maxBuffer: 256 * 1024, encoding: 'utf8', windowsHide: true }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Zeitüberschreitung')), TIMEOUT); }),
      ]);
      const code = result?.exitCode ?? result?.status ?? result?.code ?? 0;
      if (code !== 0) throw new Error('Programmaufruf fehlgeschlagen');
      return String(result?.stdout || '');
    } finally { clearTimeout(timer); }
  }
  async function one(entry) {
    const existing = cache.get(entry.id);
    if (existing && existing.expires > Date.now() && existing.binary === entry.binary) return { ...existing.value };
    if (pending.has(entry.id)) return { ...await pending.get(entry.id) };
    const job = (async () => {
      const value = { id: entry.id, installed: false, path: null, version: existing?.value.version ?? null };
      try {
        if (typeof entry.binary !== 'string' || !BINARY_RE.test(entry.binary)) throw new Error('Ungültiger Programmname');
        const output = await invoke('/bin/zsh', ['-lc', LOOKUP_SCRIPT, 'mt-harness-detect', entry.binary]);
        const found = output.trim().split(/\r?\n/).at(-1);
        // command -v may also return aliases/functions; these cannot be passed to execFile.
        if (!found || !found.startsWith('/') || /[\x00-\x1f\x7f]/.test(found)) throw new Error('Kein ausführbarer Pfad');
        if (entry.detect?.verify) {
          const verify = entry.detect.verify;
          const help = await invoke(found, verify.argv.slice(1));
          if (!help.toLowerCase().includes(verify.pattern.toLowerCase())) throw new Error('Andere CLI');
        }
        value.installed = true; value.path = found;
      } catch { value.version = null; }
      cache.set(entry.id, { value, binary: entry.binary, expires: Date.now() + 30000 });
      return value;
    })();
    pending.set(entry.id, job);
    try { return { ...await job }; } finally { pending.delete(entry.id); }
  }
  return {
    async detect(id) {
      const entries = id === undefined ? catalog.list() : [catalog.get(id)].filter(Boolean);
      return Promise.all(entries.map(one));
    },
    async version(id) {
      const entry = catalog.get(id);
      if (!entry) return null;
      const found = await one(entry);
      if (!found.installed || !entry.detect?.version) return null;
      try {
        const text = await invoke(found.path, entry.detect.version.argv.slice(1));
        const clean = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim().split(/\r?\n/)[0];
        if (!clean || clean.length > 200 || /[\x00-\x1f\x7f]/.test(clean)) return null;
        const cached = cache.get(id);
        if (cached) cached.value.version = clean;
        return clean;
      } catch { return null; }
    },
  };
}

module.exports = { createHarnessDetect, LOOKUP_SCRIPT };
