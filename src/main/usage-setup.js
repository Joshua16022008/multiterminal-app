'use strict';

// Switches the Claude status line on and off in the user's Claude settings file.
// Only the "statusLine" key is ever touched, and only on explicit request.
// A status line of the user's own is never overwritten.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { statuslineSettings } = require('./usage-service');

const SCRIPT_NAME = 'usage-statusline.js';
const BACKUP_SUFFIX = '.multiterminal-bak';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function createUsageSetup({ settingsPath, execPath, scriptPath }) {
  const wanted = statuslineSettings({ execPath, scriptPath }).statusLine;

  // The file the link points to (the link itself is never replaced), or the path itself.
  function targetPath() {
    try {
      return fs.realpathSync(settingsPath);
    } catch (err) {
      return settingsPath;
    }
  }

  // { exists, data }; throws when the file exists but is no JSON object.
  function readSettings() {
    let text;
    try {
      text = fs.readFileSync(targetPath(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { exists: false, data: {} };
      throw new Error('Die Claude-Einstellungen konnten nicht gelesen werden.');
    }
    if (text.trim() === '') return { exists: true, data: {} };
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error('Die Claude-Einstellungen sind kein gültiges JSON. Es wurde nichts geändert.');
    }
    if (!isPlainObject(data)) throw new Error('Die Claude-Einstellungen haben ein unerwartetes Format. Es wurde nichts geändert.');
    return { exists: true, data };
  }

  function stateOf(data) {
    const line = data.statusLine;
    if (line === undefined || line === null) return 'aus';
    const command = isPlainObject(line) && typeof line.command === 'string' ? line.command : '';
    if (!command.includes(SCRIPT_NAME)) return 'fremd';
    return command === wanted.command ? 'aktiv' : 'veraltet';
  }

  function status() {
    try {
      return { state: stateOf(readSettings().data) };
    } catch (err) {
      return { state: 'aus' };
    }
  }

  // Backup once, then write to a temp file next to the target and rename it over.
  function write(data, exists) {
    const target = targetPath();
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    if (exists) {
      const backup = target + BACKUP_SUFFIX;
      if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);
    }
    const tmpPath = path.join(dir, `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
      if (exists) fs.chmodSync(tmpPath, fs.statSync(target).mode & 0o777);
      fs.renameSync(tmpPath, target);
    } catch (err) {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch (cleanupErr) {
        // Ignore: the original error is more important.
      }
      throw err;
    }
  }

  function enable() {
    const { exists, data } = readSettings();
    if (stateOf(data) === 'fremd') {
      throw new Error('In den Claude-Einstellungen ist schon eine eigene Statuszeile gesetzt. Sie wird nicht verändert.');
    }
    write({ ...data, statusLine: wanted }, exists);
    return { state: 'aktiv' };
  }

  function disable() {
    const { exists, data } = readSettings();
    const state = stateOf(data);
    if (state === 'fremd') throw new Error('Die Statuszeile stammt nicht von dieser App und bleibt unverändert.');
    if (state === 'aus') return { state: 'aus' };
    const rest = { ...data };
    delete rest.statusLine;
    write(rest, exists);
    return { state: 'aus' };
  }

  return { status, enable, disable };
}

module.exports = { createUsageSetup, SCRIPT_NAME, BACKUP_SUFFIX };
