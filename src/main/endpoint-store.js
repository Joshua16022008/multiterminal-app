'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MODEL = /^[A-Za-z0-9._:/@\[\]+-]{1,200}$/;
const TYPES = new Set(['anthropic', 'openai', 'ollama', 'deepseek']);
const CONTROL = /[\x00-\x1f\x7f]/;

function checkId(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Ungültige Endpunkt-ID.');
  return id;
}

function model(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !MODEL.test(value)) throw new Error('Ungültiger Modellname.');
  return value;
}

function profileData(profile, generateId = false) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Ungültiges Endpunkt-Profil.');
  const id = checkId(profile.id === undefined && generateId ? 'ep-' + randomUUID() : profile.id);
  if (typeof profile.label !== 'string' || !profile.label.trim() || profile.label.length > 100 || CONTROL.test(profile.label)) {
    throw new Error('Die Endpunkt-Bezeichnung muss zwischen 1 und 100 Zeichen lang sein.');
  }
  if (!TYPES.has(profile.type)) throw new Error('Ungültiger Endpunkt-Typ.');
  if (typeof profile.baseUrl !== 'string' || profile.baseUrl.length > 1000 || /\s|[\\?#]/.test(profile.baseUrl) || CONTROL.test(profile.baseUrl)) {
    throw new Error('Ungültige Endpunkt-URL.');
  }
  let url;
  try { url = new URL(profile.baseUrl); } catch { throw new Error('Ungültige Endpunkt-URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error('Die Endpunkt-URL muss HTTP oder HTTPS ohne Zugangsdaten, Suchparameter oder Fragment verwenden.');
  }
  let modelMap = null;
  if (profile.modelMap !== undefined && profile.modelMap !== null) {
    if (typeof profile.modelMap !== 'object' || Array.isArray(profile.modelMap) || Object.keys(profile.modelMap).length > 32) {
      throw new Error('Ungültige Modellzuordnung.');
    }
    modelMap = {};
    for (const [key, value] of Object.entries(profile.modelMap)) {
      if (!MODEL.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || typeof value !== 'string' || !MODEL.test(value)) {
        throw new Error('Ungültige Modellzuordnung.');
      }
      modelMap[key] = value;
    }
  }
  if (profile.isolateClaudeConfig !== undefined && typeof profile.isolateClaudeConfig !== 'boolean') {
    throw new Error('Die Claude-Konfigurationsisolation muss ein Wahrheitswert sein.');
  }
  // Deliberately whitelist: neither secret, apiKey, hasSecret nor arbitrary fields persist.
  return { id, label: profile.label.trim(), type: profile.type, baseUrl: profile.baseUrl,
    defaultModel: model(profile.defaultModel), modelMap,
    isolateClaudeConfig: profile.isolateClaudeConfig !== false };
}

function createEndpointStore({ file, keychain } = {}) {
  if (typeof file !== 'string' || !file || !keychain || typeof keychain.has !== 'function' ||
      typeof keychain.set !== 'function' || typeof keychain.remove !== 'function') {
    throw new Error('Endpunkt-Speicher ist nicht konfiguriert.');
  }
  let pending = Promise.resolve();

  function serialized(operation) {
    const next = pending.then(operation);
    pending = next.catch(() => {});
    return next;
  }

  function read() {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
      fs.chmodSync(file, 0o600);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new Error('Endpunkt-Profile konnten nicht gelesen werden.');
    }
    try {
      const data = JSON.parse(text);
      if (!data || data.version !== 1 || !Array.isArray(data.endpoints) || data.endpoints.length > 500) throw new Error();
      const entries = data.endpoints.map((entry) => profileData(entry));
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error();
      return entries;
    } catch {
      // Preserve the original before any later write; never silently overwrite it.
      const backup = file + '.corrupt-' + randomUUID();
      try { fs.renameSync(file, backup); } catch {
        throw new Error('Defekte Endpunkt-Datei konnte nicht gesichert werden.');
      }
      return [];
    }
  }

  function write(entries) {
    const tmp = path.join(path.dirname(file), '.' + path.basename(file) + '.' + randomUUID() + '.tmp');
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, endpoints: entries }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, file);
    } catch {
      try { fs.unlinkSync(tmp); } catch {}
      throw new Error('Endpunkt-Profile konnten nicht gespeichert werden.');
    }
  }

  async function view(entry) {
    let hasSecret;
    try { hasSecret = Boolean(await keychain.has(entry.id)); } catch {
      throw new Error('Endpunkt-Schlüsselbund konnte nicht geprüft werden.');
    }
    return { ...entry, modelMap: entry.modelMap && { ...entry.modelMap }, hasSecret };
  }

  function list() { return serialized(async () => Promise.all(read().map(view))); }

  function get(id) {
    checkId(id);
    return serialized(async () => { const entry = read().find((item) => item.id === id); return entry ? view(entry) : null; });
  }

  function save(profile, secret) {
    return serialized(async () => {
      const entry = profileData(profile, true);
      const entries = read();
      const index = entries.findIndex((item) => item.id === entry.id);
      if (index < 0 && entries.length >= 500) throw new Error('Es sind höchstens 500 Endpunkt-Profile möglich.');
      const supplied = secret !== undefined ? secret : profile.secret;
      // Empty password fields mean keep the saved key, as renderer never receives it.
      if (supplied !== undefined && supplied !== '') {
        try { await keychain.set(entry.id, supplied); } catch { throw new Error('Endpunkt-Schlüssel konnte nicht gespeichert werden.'); }
      }
      if (index < 0) entries.push(entry); else entries[index] = entry;
      write(entries);
      return view(entry);
    });
  }

  function remove(id) {
    checkId(id);
    return serialized(async () => {
      const entries = read();
      const filtered = entries.filter((item) => item.id !== id);
      if (filtered.length === entries.length) return false;
      try { await keychain.remove(id); } catch { throw new Error('Endpunkt-Schlüssel konnte nicht entfernt werden.'); }
      write(filtered);
      return true;
    });
  }

  function templates() {
    return [
      { id: 'template-deepseek', label: 'DeepSeek', type: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic' },
      { id: 'template-zai', label: 'Z.ai', type: 'anthropic', baseUrl: 'https://api.z.ai/api/anthropic' },
      { id: 'template-moonshot', label: 'Moonshot', type: 'openai', baseUrl: 'https://api.moonshot.ai/v1' },
      { id: 'template-openrouter', label: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
      { id: 'template-ollama', label: 'Ollama', type: 'ollama', baseUrl: 'http://127.0.0.1:11434' },
    ].map((entry) => ({ ...profileData(entry), hasSecret: false }));
  }

  return { list, get, save, remove, templates };
}

module.exports = { createEndpointStore };
