'use strict';

// F08: benannte Arbeitsaufbauten. Eine Vorlage beschreibt NEUE Kacheln; sie speichert
// ausschließlich Felder einer positiven Liste (Whitelist). Gesprächs-IDs (nativeSession),
// resumeCommand, workspaceId, Konten und alles Künftige werden nie übernommen.

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TILES = 30;
const MAX_TEMPLATES = 100;
const MAX_NAME = 60;
const MAX_TITLE = 120;
const MAX_COMMAND = 2000;
const MAX_URL = 2000;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const validId = (v) => typeof v === 'string' && ID_RE.test(v);

function cleanCommand(v) {
  if (typeof v !== 'string' || /[\r\n]/.test(v)) return null;
  const t = v.trim();
  return t && t.length <= MAX_COMMAND ? t : null;
}

function cleanUrl(v) {
  if (typeof v !== 'string' || v.length > MAX_URL) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? v : null;
  } catch (_) { return null; }
}

// Whitelist: nur diese Felder überleben, alles andere fällt weg.
function sanitizeTile(t) {
  if (!isPlain(t)) return null;
  const title = typeof t.title === 'string' ? t.title.trim().slice(0, MAX_TITLE) : '';
  const out = { title: title || 'Terminal', presetId: validId(t.presetId) ? t.presetId : null };
  const cmd = cleanCommand(t.startCommand);
  if (cmd) out.startCommand = cmd;
  if (Number.isInteger(t.color) && t.color >= 0 && t.color < 64) out.color = t.color;
  const url = cleanUrl(t.browserUrl);
  if (url) out.browserUrl = url;
  return out;
}

function cleanName(v) {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) : '';
}

function sanitizeTemplate(raw) {
  if (!isPlain(raw) || !validId(raw.id)) return null;
  const name = cleanName(raw.name);
  if (!name || !Array.isArray(raw.tiles)) return null;
  const tiles = raw.tiles.map(sanitizeTile).filter(Boolean).slice(0, MAX_TILES);
  if (!tiles.length) return null;
  const createdAt = typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt)) ? raw.createdAt : new Date(0).toISOString();
  return { id: raw.id, name, createdAt, tiles };
}

const sameName = (a, b) => a.toLocaleLowerCase('de') === b.toLocaleLowerCase('de');

function createWorkspaceTemplateStore({ filePath, warn = (m) => console.warn(m) }) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Ein Dateipfad für Aufbauten fehlt.');

  function read() {
    let text;
    try { text = fs.readFileSync(filePath, 'utf8'); } catch (_) { return []; }
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error('keine Liste');
      const seen = new Set();
      const out = [];
      for (const item of data) {
        const t = sanitizeTemplate(item);
        if (!t || seen.has(t.id) || out.some((o) => sameName(o.name, t.name))) continue;
        seen.add(t.id);
        out.push(t);
        if (out.length >= MAX_TEMPLATES) break;
      }
      return out;
    } catch (err) {
      warn(`Aufbauten konnten nicht gelesen werden (${err.message}); die Liste ist leer.`);
      try { fs.copyFileSync(filePath, filePath + '.corrupt'); } catch (_) { /* nichts zu sichern */ }
      return [];
    }
  }

  function write(list) {
    const tmp = `${filePath}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, filePath);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch (_) { /* ursprünglichen Fehler behalten */ }
      throw new Error(`Aufbau konnte nicht gespeichert werden: ${err.message}`);
    }
  }

  return {
    list() { return read(); },

    // save({ name, tiles, replace }) -> gespeicherte Vorlage. replace:true ersetzt gleichnamige.
    save({ name, tiles, replace = false } = {}) {
      const clean = cleanName(name);
      if (!clean) throw new Error('Der Name des Aufbaus darf nicht leer sein.');
      if (!Array.isArray(tiles) || !tiles.length) throw new Error('Der Aufbau enthält keine Kacheln.');
      if (tiles.length > MAX_TILES) throw new Error(`Ein Aufbau kann höchstens ${MAX_TILES} Kacheln enthalten.`);
      const cleanTiles = tiles.map(sanitizeTile);
      if (cleanTiles.some((t) => !t)) throw new Error('Ungültige Kachel im Aufbau.');
      let list = read();
      const dup = list.find((t) => sameName(t.name, clean));
      if (dup && !replace) throw new Error(`Ein Aufbau namens „${dup.name}“ existiert bereits.`);
      if (!dup && list.length >= MAX_TEMPLATES) throw new Error(`Höchstens ${MAX_TEMPLATES} Aufbauten möglich.`);
      const template = { id: dup ? dup.id : randomUUID(), name: clean, createdAt: new Date().toISOString(), tiles: cleanTiles };
      list = dup ? list.map((t) => (t.id === dup.id ? template : t)) : [...list, template];
      write(list);
      return template;
    },

    remove(id) {
      const list = read();
      const next = list.filter((t) => t.id !== id);
      if (next.length === list.length) return false;
      write(next);
      return true;
    },
  };
}

module.exports = { createWorkspaceTemplateStore, sanitizeTile, sanitizeTemplate, MAX_TILES };
