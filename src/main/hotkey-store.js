'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const hotkeys = require('../renderer/hotkeys');

function withNewDefaults(saved, platform) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return saved;
  const merged = { ...saved };
  const used = new Set(Object.values(saved).filter(Array.isArray).flat());
  for (const [id, combos] of Object.entries(hotkeys.defaults(platform))) {
    if (Object.prototype.hasOwnProperty.call(merged, id)) continue;
    merged[id] = combos.filter(combo => !used.has(combo));
    merged[id].forEach(combo => used.add(combo));
  }
  return merged;
}

function createHotkeyStore({ filePath, platform = process.platform }) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Ein Dateipfad für Tastenkürzel fehlt.');
  let current = hotkeys.defaults(platform);
  // F03: Neue Aktionen in einer älteren Datei mit Standardwerten ergänzen, statt alle eigenen Belegungen zu verwerfen.
  // Ein neuer Standard, den der Nutzer schon anderweitig belegt hat, wird dabei weggelassen
  // (Aktion zunächst ohne Kürzel), sonst würde der Konflikt die ganze eigene Belegung kippen.
  try { current = hotkeys.validate(withNewDefaults(JSON.parse(fs.readFileSync(filePath, 'utf8')), platform), platform); } catch { /* Missing or corrupt settings use safe defaults. */ }
  const clone = value => Object.fromEntries(Object.entries(value).map(([id, bindings]) => [id, [...bindings]]));
  return {
    get() { return clone(current); },
    save(bindings) {
      const next = hotkeys.validate(bindings, platform);
      const temporary = `${filePath}.${randomUUID()}.tmp`;
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, filePath);
      } catch (error) {
        try { fs.unlinkSync(temporary); } catch { /* Preserve the original error. */ }
        throw new Error(`Tastenkürzel konnten nicht gespeichert werden: ${error.message}`);
      }
      current = next;
      return clone(current);
    }
  };
}

module.exports = { createHotkeyStore };
