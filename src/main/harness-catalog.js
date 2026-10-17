'use strict';

// IPC contract §2: synchronous JSON catalog; execution belongs to the caller.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MODEL_RE = /^[A-Za-z0-9._:/@\[\]+-]{1,200}$/;
const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const BINARY_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;
const PLACEHOLDERS = Object.freeze(['model', 'sessionId', 'prompt', 'baseUrl', 'opencodeProviderJson']);
const TYPES = ['anthropic', 'openai', 'ollama', 'deepseek'];
const MAX_FILE = 1024 * 1024;
const isValidModel = (value) => typeof value === 'string' && MODEL_RE.test(value);
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const clone = (v) => JSON.parse(JSON.stringify(v));

function validateEntry(entry) {
  const errors = [];
  const fail = (key, message) => errors.push(`${key}: ${message}`);
  function object(value, key, allowed) {
    if (!plain(value)) { fail(key, 'Objekt erwartet'); return false; }
    for (const name of Object.keys(value)) {
      if (!allowed.includes(name)) fail(`${key}.${name}`, 'unbekanntes Feld');
    }
    return true;
  }
  function string(value, key, max = 500, empty = false) {
    if (typeof value !== 'string' || (!empty && !value.length) || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
      fail(key, 'ungültiger Text'); return false;
    }
    return true;
  }
  function template(value, key) {
    if (!string(value, key, 8000, true)) return;
    const stripped = value.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, name) => {
      if (!PLACEHOLDERS.includes(name)) fail(key, `unbekannter Platzhalter ${name}`);
      return '';
    });
    if (/[{}]/.test(stripped)) fail(key, 'ungültiger Platzhalter');
  }
  function argv(value, key, executable = false) {
    if (!Array.isArray(value) || value.length > 64 || (executable && !value.length)) { fail(key, 'argv-Array erwartet'); return; }
    value.forEach((arg, i) => template(arg, `${key}[${i}]`));
    if (executable && value[0] !== entry.binary) fail(key, 'erstes Argument muss binary sein');
  }
  if (!object(entry, 'entry', ['schema', 'id', 'label', 'binary', 'kind', 'evidence', 'verifiedWith', 'docsUrl', 'install', 'start', 'model', 'resume', 'prompt', 'endpoints', 'profileInjection', 'supportsHooks', 'accounts', 'fullAccess', 'detect', 'defaultModel', 'webUrl', 'hint'])) return { ok: false, errors };
  if (entry.schema !== 1) fail('schema', 'Version 1 erwartet');
  if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) fail('id', 'ungültige ID');
  string(entry.label, 'label', 120);
  if (typeof entry.binary !== 'string' || !BINARY_RE.test(entry.binary)) fail('binary', 'einfacher Programmname ohne Pfad erwartet');
  if (!['tui', 'web', 'headless'].includes(entry.kind)) fail('kind', 'unbekannte Startart');
  if (!['local', 'doc', 'third-party', 'unconfirmed'].includes(entry.evidence)) fail('evidence', 'unbekannte Belegstufe');
  string(entry.verifiedWith, 'verifiedWith', 200);
  for (const field of ['docsUrl', 'webUrl']) {
    if (entry[field] == null && field === 'webUrl') continue;
    try {
      const url = new URL(entry[field]);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error();
      string(entry[field], field, 2000);
    } catch { fail(field, 'HTTP(S)-URL ohne Zugangsdaten erwartet'); }
  }
  if (entry.hint !== undefined) string(entry.hint, 'hint', 600);
  if (!Array.isArray(entry.install) || entry.install.length > 8) fail('install', 'Liste erwartet');
  else entry.install.forEach((item, i) => {
    if (object(item, `install[${i}]`, ['method', 'display'])) {
      if (!['npm', 'brew', 'pip', 'script', 'manual'].includes(item.method)) fail('install.method', 'unbekannte Methode');
      string(item.display, 'install.display', 2000);
    }
  });
  argv(entry.start, 'start', true);
  if (entry.model != null && object(entry.model, 'model', ['args', 'format', 'static', 'query'])) {
    argv(entry.model.args, 'model.args');
    if (!Array.isArray(entry.model.args) || !entry.model.args.some((arg) => typeof arg === 'string' && arg.includes('{model}'))) fail('model.args', 'model fehlt');
    if (!['name', 'provider/model'].includes(entry.model.format)) fail('model.format', 'unbekanntes Format');
    if (!Array.isArray(entry.model.static) || entry.model.static.length > 2000 || entry.model.static.some((m) => !isValidModel(m))) fail('model.static', 'ungültige Modellliste');
    if (entry.model.query != null && object(entry.model.query, 'model.query', ['argv', 'parse'])) {
      argv(entry.model.query.argv, 'model.query.argv', true);
      if (!['lines', 'ollama', 'openrouter'].includes(entry.model.query.parse)) fail('model.query.parse', 'unbekannter Parser');
      if (Array.isArray(entry.model.query.argv) && entry.model.query.argv.some((arg) => typeof arg === 'string' && /[{}]/.test(arg))) fail('model.query.argv', 'Abfragen erlauben keine Platzhalter');
    }
  }
  if (entry.resume != null && object(entry.resume, 'resume', ['last', 'byId'])) {
    if (entry.resume.last != null) argv(entry.resume.last, 'resume.last', true);
    if (entry.resume.byId != null) {
      argv(entry.resume.byId, 'resume.byId', true);
      if (!Array.isArray(entry.resume.byId) || !entry.resume.byId.some((arg) => typeof arg === 'string' && arg.includes('{sessionId}'))) fail('resume.byId', 'sessionId fehlt');
    }
  }
  if (entry.prompt != null && object(entry.prompt, 'prompt', ['args'])) {
    argv(entry.prompt.args, 'prompt.args');
    if (!Array.isArray(entry.prompt.args) || !entry.prompt.args.some((arg) => typeof arg === 'string' && arg.includes('{prompt}'))) fail('prompt.args', 'prompt fehlt');
  }
  if (!object(entry.endpoints, 'endpoints', TYPES)) { /* error already recorded */ }
  else for (const [type, config] of Object.entries(entry.endpoints)) {
    if (!object(config, `endpoints.${type}`, ['env', 'args', 'secretEnv'])) continue;
    if (config.env !== undefined) {
      if (!plain(config.env) || Object.keys(config.env).length > 20) fail(`endpoints.${type}.env`, 'Umgebungsobjekt erwartet');
      else for (const [name, value] of Object.entries(config.env)) {
        if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(name)) fail('endpoints.env', 'ungültiger Variablenname');
        template(value, `endpoints.${type}.env.${name}`);
      }
    }
    if (config.args !== undefined) argv(config.args, `endpoints.${type}.args`);
    if (config.secretEnv != null && !/^[A-Z][A-Z0-9_]{0,79}$/.test(config.secretEnv)) fail('endpoints.secretEnv', 'ungültiger Variablenname');
  }
  if (![null, 'claude-append', 'codex-developer', 'kimi-agent-file'].includes(entry.profileInjection)) fail('profileInjection', 'unbekannte Injektion');
  if (typeof entry.supportsHooks !== 'boolean') fail('supportsHooks', 'Boolean erwartet');
  if (![null, 'claude', 'codex'].includes(entry.accounts)) fail('accounts', 'unbekannte Kontenart');
  if (entry.fullAccess !== undefined) {
    argv(entry.fullAccess, 'fullAccess');
    if (entry.id !== 'codex' || JSON.stringify(entry.fullAccess) !== '["--dangerously-bypass-approvals-and-sandbox"]') fail('fullAccess', 'nur festes Codex-Flag erlaubt');
  }
  if (entry.defaultModel != null && !isValidModel(entry.defaultModel)) fail('defaultModel', 'ungültiges Modell');
  if (entry.detect !== undefined && object(entry.detect, 'detect', ['verify', 'version'])) {
    for (const key of ['verify', 'version']) {
      const spec = entry.detect[key];
      if (spec == null) continue;
      if (object(spec, `detect.${key}`, key === 'verify' ? ['argv', 'pattern'] : ['argv'])) {
        argv(spec.argv, `detect.${key}.argv`, true);
        if (Array.isArray(spec.argv) && spec.argv.some((arg) => typeof arg === 'string' && /[{}]/.test(arg))) fail(`detect.${key}.argv`, 'keine Platzhalter erlaubt');
        if (key === 'verify') string(spec.pattern, 'detect.verify.pattern', 120);
      }
    }
  }
  if (['agent', 'kimi'].includes(entry.binary) && !entry.detect?.verify) fail('detect.verify', 'Identitätsprüfung für mehrdeutigen Programmnamen erforderlich');
  if (entry.evidence === 'unconfirmed') {
    if (JSON.stringify(entry.start) !== JSON.stringify([entry.binary]) || entry.model != null || entry.resume != null || entry.prompt != null || Object.keys(entry.endpoints || {}).length || entry.fullAccess || entry.profileInjection || entry.supportsHooks || entry.accounts || entry.defaultModel) fail('evidence', 'unbestätigte Einträge dürfen nur den nackten Befehl starten');
  }
  return { ok: errors.length === 0, errors };
}

function expandArgv(argv, values = {}) {
  if (!Array.isArray(argv)) throw new Error('Ungültige Argumentvorlage.');
  return argv.map((arg) => {
    if (typeof arg !== 'string') throw new Error('Ungültige Argumentvorlage.');
    const expanded = arg.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, name) => {
      if (!PLACEHOLDERS.includes(name) || !Object.hasOwn(values, name) || typeof values[name] !== 'string') throw new Error('Unbekannter oder fehlender Platzhalter.');
      if (name === 'model' && !isValidModel(values[name])) throw new Error('Ungültiger Modellname.');
      if (name === 'sessionId' && !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(values[name])) throw new Error('Ungültige Gesprächs-ID.');
      if (/[\x00-\x1f\x7f]/.test(values[name])) throw new Error('Ungültiger Platzhalterwert.');
      return values[name];
    });
    // Validate template braces before replacement; replacement text may be JSON.
    if (/[{}]/.test(arg.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, ''))) throw new Error('Ungültige Argumentvorlage.');
    return expanded;
  });
}

function createHarnessCatalog({ builtinDir = path.join(__dirname, 'harness-catalog'), userFile } = {}) {
  const builtins = new Map();
  const own = new Map();
  function checked(entry) {
    const result = validateEntry(entry);
    if (!result.ok) throw new Error(`Ungültiger Harness-Eintrag: ${result.errors.join('; ')}`);
    return clone(entry);
  }
  function readJson(file) {
    if (fs.statSync(file).size > MAX_FILE) throw new Error('Harness-Katalog ist zu groß.');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  for (const name of fs.readdirSync(builtinDir).filter((name) => name.endsWith('.json')).sort()) {
    const entry = checked(readJson(path.join(builtinDir, name)));
    if (name !== `${entry.id}.json` || builtins.has(entry.id)) throw new Error('Doppelter oder falsch benannter Harness-Eintrag.');
    builtins.set(entry.id, entry);
  }
  if (userFile && fs.existsSync(userFile)) {
    let stored;
    try { stored = readJson(userFile); } catch { throw new Error('Eigener Harness-Katalog kann nicht gelesen werden.'); }
    if (!plain(stored) || Object.keys(stored).some((key) => !['version', 'harnesses'].includes(key)) || stored.version !== 1 || !Array.isArray(stored.harnesses) || stored.harnesses.length > 100) throw new Error('Ungültiger eigener Harness-Katalog.');
    for (const item of stored.harnesses) {
      const entry = checked(item);
      if (builtins.has(entry.id) || own.has(entry.id)) throw new Error('Doppelte Harness-ID im eigenen Katalog.');
      own.set(entry.id, entry);
    }
  }
  function persist(next) {
    if (!userFile) throw new Error('Speicherort für eigene Harnesses fehlt.');
    const serialized = JSON.stringify({ version: 1, harnesses: [...next.values()] }, null, 2) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE) throw new Error('Eigener Harness-Katalog ist zu groß.');
    const dir = path.dirname(userFile);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(userFile) && fs.lstatSync(userFile).isSymbolicLink()) throw new Error('Harness-Katalog darf kein symbolischer Link sein.');
    const temp = path.join(dir, `.harnesses-${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temp, serialized, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, userFile);
    } finally { try { fs.unlinkSync(temp); } catch {} }
  }
  function get(id) {
    const entry = builtins.get(id) || own.get(id);
    return entry ? { ...clone(entry), builtin: builtins.has(id) } : null;
  }
  return {
    list: () => [...builtins.keys(), ...own.keys()].map(get), get, validate: validateEntry,
    addOwn(entry) {
      const clean = checked(entry);
      if (builtins.has(clean.id)) throw new Error('Mitgelieferte Harnesses können nicht überschrieben werden.');
      if (!own.has(clean.id) && own.size >= 100) throw new Error('Maximal 100 eigene Harnesses erlaubt.');
      const next = new Map(own).set(clean.id, clean);
      persist(next); own.set(clean.id, clean); return get(clean.id);
    },
    removeOwn(id) {
      if (!own.has(id)) return false;
      const next = new Map(own); next.delete(id); persist(next); own.delete(id); return true;
    },
    exportEntry(id) {
      const entry = builtins.get(id) || own.get(id);
      if (!entry) throw new Error('Harness nicht gefunden.');
      return JSON.stringify(entry, null, 2) + '\n';
    },
  };
}

module.exports = { createHarnessCatalog, validateEntry, expandArgv, isValidModel, MODEL_RE, PLACEHOLDERS };
