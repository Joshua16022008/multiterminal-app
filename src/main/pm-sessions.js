'use strict';

// Gesprächs-ID des Projektmanagers je Projekt: { [projectId]: { nativeSessionId, observedAt } }
// in <userData>/pm/sessions.json. Es zählen nur IDs, die ein Agentenereignis wirklich gemeldet hat;
// jede ID wird geprüft, bevor sie auf eine Kommandozeile kommt. Schreiben ist atomar.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isValidSessionId } = require('./agent-session-service');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sanitize(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const projectId of Object.keys(raw)) {
    const rec = raw[projectId];
    if (!ID_RE.test(projectId) || !isPlainObject(rec) || !isValidSessionId(rec.nativeSessionId)) continue;
    out[projectId] = { nativeSessionId: rec.nativeSessionId, observedAt: Number.isFinite(rec.observedAt) ? rec.observedAt : 0 };
  }
  return out;
}

function createPmSessions({ filePath } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('filePath muss ein absoluter Pfad sein.');

  // Kaputte oder fehlende Datei = leer; nie ein Wurf.
  function load() {
    try {
      return sanitize(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (_) {
      return {};
    }
  }

  function save(data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, filePath);
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch (_) { /* schon umbenannt */ }
    }
  }

  // -> gültige Gesprächs-ID oder null
  function get(projectId) {
    const rec = load()[String(projectId)];
    return rec ? rec.nativeSessionId : null;
  }

  // -> true, wenn gespeichert; false bei ungültigen Werten, veralteter Meldung oder unverändert.
  function observe(projectId, nativeSessionId, observedAt = Date.now()) {
    const id = String(projectId);
    if (!ID_RE.test(id) || !isValidSessionId(nativeSessionId)) return false;
    const data = load();
    const cur = data[id];
    const at = Number.isFinite(observedAt) ? observedAt : Date.now();
    if (cur && at < cur.observedAt) return false;
    if (cur && cur.nativeSessionId === nativeSessionId) return false;
    data[id] = { nativeSessionId, observedAt: at };
    try { save(data); } catch (_) { return false; }
    return true;
  }

  function forget(projectId) {
    const data = load();
    if (!(String(projectId) in data)) return false;
    delete data[String(projectId)];
    try { save(data); } catch (_) { return false; }
    return true;
  }

  return { get, observe, forget, load };
}

module.exports = { createPmSessions, sanitize };
