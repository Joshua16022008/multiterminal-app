'use strict';

// "Quick starts": commands the user can launch in a new terminal with one click.
// Built-in presets are fixed; only the user's own presets are written to the file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_LABEL_LENGTH = 40;
const MAX_COMMAND_LENGTH = 2000;

const DEFAULT_PRESETS = Object.freeze([
  Object.freeze({
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    resumeCommand: 'claude --continue',
    builtin: true,
  }),
  Object.freeze({
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    resumeCommand: 'codex resume --last',
    builtin: true,
  }),
  Object.freeze({
    id: 'kimi',
    label: 'Kimi Code',
    command: 'kimi',
    resumeCommand: 'kimi --continue',
    builtin: true,
  }),
]);

const BUILTIN_IDS = new Set(DEFAULT_PRESETS.map((p) => p.id));

function hasLineBreak(value) {
  return /[\n\r]/.test(value);
}

// Checks a command-like string. Returns the trimmed value or throws.
function checkCommand(value, fieldName) {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} muss ein Text sein.`);
  }
  if (hasLineBreak(value)) {
    throw new Error(`${fieldName} darf keinen Zeilenumbruch enthalten.`);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new Error(`${fieldName} darf nicht leer sein.`);
  }
  if (trimmed.length > MAX_COMMAND_LENGTH) {
    throw new Error(`${fieldName} ist länger als ${MAX_COMMAND_LENGTH} Zeichen.`);
  }
  return trimmed;
}

function isValidOwnPreset(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    !BUILTIN_IDS.has(entry.id) &&
    typeof entry.label === 'string' &&
    entry.label.trim().length > 0 &&
    typeof entry.command === 'string' &&
    entry.command.trim().length > 0 &&
    (entry.resumeCommand === null || typeof entry.resumeCommand === 'string')
  );
}

function createPresetStore(filePath) {
  function readOwn() {
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      return [];
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      keepCorruptCopy();
      return [];
    }

    if (!Array.isArray(data)) {
      keepCorruptCopy();
      return [];
    }

    return data.filter(isValidOwnPreset).map((p) => ({
      id: p.id,
      label: p.label,
      command: p.command,
      resumeCommand: p.resumeCommand,
      builtin: false,
    }));
  }

  // Copies a broken file aside so that the user's presets are not lost on the next write.
  function keepCorruptCopy() {
    try {
      fs.copyFileSync(filePath, filePath + '.corrupt');
    } catch (err) {
      // Nothing to copy or no permission: continue without it.
    }
  }

  // Writes to a temp file in the same folder, then renames it over the real file.
  function writeOwn(presets) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = path.join(
      dir,
      `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(presets, null, 2) + '\n', 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch (cleanupErr) {
        // Ignore: the original error is more important.
      }
      throw err;
    }
  }

  function list() {
    const builtins = DEFAULT_PRESETS.map((p) => ({ ...p }));
    return [...builtins, ...readOwn()];
  }

  function add({ label, command, resumeCommand } = {}) {
    if (typeof label !== 'string' || label.trim() === '') {
      throw new Error('Bezeichnung darf nicht leer sein.');
    }
    const trimmedLabel = label.trim();
    if (trimmedLabel.length > MAX_LABEL_LENGTH) {
      throw new Error(`Bezeichnung ist länger als ${MAX_LABEL_LENGTH} Zeichen.`);
    }

    const trimmedCommand = checkCommand(command, 'Befehl');

    let trimmedResume = null;
    if (resumeCommand !== undefined && resumeCommand !== null) {
      if (typeof resumeCommand !== 'string') {
        throw new Error('Resume-Befehl muss ein Text sein.');
      }
      if (resumeCommand.trim() !== '' || hasLineBreak(resumeCommand)) {
        trimmedResume = checkCommand(resumeCommand, 'Resume-Befehl');
      }
    }

    const preset = {
      id: crypto.randomUUID(),
      label: trimmedLabel,
      command: trimmedCommand,
      resumeCommand: trimmedResume,
      builtin: false,
    };

    const own = readOwn();
    own.push(preset);
    writeOwn(own);
    return preset;
  }

  function remove(id) {
    if (BUILTIN_IDS.has(id)) return false;
    const own = readOwn();
    const remaining = own.filter((p) => p.id !== id);
    if (remaining.length === own.length) return false;
    writeOwn(remaining);
    return true;
  }

  return { list, add, remove };
}

module.exports = { DEFAULT_PRESETS, createPresetStore };
