'use strict';

// Status line command for Claude Code. Claude pipes a JSON document to stdin on
// every update; this script stores the rate limits in the snapshot file named by
// MULTITERMINAL_USAGE_FILE and prints a short line for the status bar.
// It must never fail or hang: every problem is swallowed and the exit code is 0.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_INPUT = 1024 * 1024;
const INPUT_TIMEOUT_MS = 2000;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Only the two known windows with their two known fields are kept; nothing else of the input.
function pickWindow(raw) {
  if (!isPlainObject(raw)) return null;
  const out = {};
  if (typeof raw.used_percentage === 'number' && Number.isFinite(raw.used_percentage)) out.used_percentage = raw.used_percentage;
  if (typeof raw.resets_at === 'number' && Number.isFinite(raw.resets_at)) out.resets_at = raw.resets_at;
  return 'used_percentage' in out ? out : null;
}

// Snapshot for the usage service, or null when the input carries no rate limits.
function buildSnapshot(input, capturedAt) {
  if (!isPlainObject(input) || !isPlainObject(input.rate_limits)) return null;
  const rateLimits = {};
  for (const key of ['five_hour', 'seven_day']) {
    const w = pickWindow(input.rate_limits[key]);
    if (w) rateLimits[key] = w;
  }
  if (Object.keys(rateLimits).length === 0) return null;
  const model = isPlainObject(input.model) && typeof input.model.display_name === 'string' ? input.model.display_name : null;
  return { capturedAt, rate_limits: rateLimits, model };
}

function formatStatusLine(input) {
  if (!isPlainObject(input)) return '';
  const parts = [];
  const limits = isPlainObject(input.rate_limits) ? input.rate_limits : {};
  for (const [key, short] of [['five_hour', '5h'], ['seven_day', '7d']]) {
    const w = pickWindow(limits[key]);
    if (w) parts.push(`${short} ${Math.round(Math.min(100, Math.max(0, w.used_percentage)))}%`);
  }
  if (parts.length > 0) return parts.join(' · ');
  return isPlainObject(input.model) && typeof input.model.display_name === 'string' ? input.model.display_name : '';
}

// Writes to a temp file in the same folder, then renames it over the real file.
function writeAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data) + '\n', 'utf8');
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

// Handles one input text; returns the status line. Never throws.
function handle(text, filePath, capturedAt) {
  try {
    const input = JSON.parse(text);
    if (filePath) {
      const snapshot = buildSnapshot(input, capturedAt);
      if (snapshot) {
        try {
          writeAtomic(filePath, snapshot);
        } catch (err) {
          // Writing failed: the status line still works.
        }
      }
    }
    return formatStatusLine(input);
  } catch (err) {
    return '';
  }
}

function main() {
  let text = '';
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try {
      process.stdout.write(handle(text, process.env.MULTITERMINAL_USAGE_FILE, Date.now()) + '\n');
    } catch (err) {
      // Nothing to do.
    }
    process.exit(0);
  };
  const timer = setTimeout(finish, INPUT_TIMEOUT_MS);
  timer.unref();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (text.length < MAX_INPUT) text += chunk;
  });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
}

if (require.main === module) main();

module.exports = { buildSnapshot, formatStatusLine, handle };
