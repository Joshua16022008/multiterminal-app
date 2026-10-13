'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildSnapshot, formatStatusLine, handle } = require('../src/main/usage-statusline');

const input = {
  session_id: 'geheim',
  cwd: '/privat',
  model: { id: 'x', display_name: 'Opus' },
  context_window: { used_percentage: 33 },
  rate_limits: {
    five_hour: { used_percentage: 12.4, resets_at: 1000, extra: 'weg' },
    seven_day: { used_percentage: 40, resets_at: 2000 },
  },
};

function tmpFile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-statusline-'));
  return path.join(root, 'nested', 'claude-default.json');
}

test('buildSnapshot keeps only the known fields', () => {
  assert.deepStrictEqual(buildSnapshot(input, 5), {
    capturedAt: 5,
    rate_limits: {
      five_hour: { used_percentage: 12.4, resets_at: 1000 },
      seven_day: { used_percentage: 40, resets_at: 2000 },
    },
    model: 'Opus',
  });
});

test('buildSnapshot returns null without rate limits', () => {
  assert.strictEqual(buildSnapshot({ model: { display_name: 'Opus' } }, 1), null);
  assert.strictEqual(buildSnapshot({ rate_limits: {} }, 1), null);
  assert.strictEqual(buildSnapshot(null, 1), null);
});

test('buildSnapshot works with a single window', () => {
  const s = buildSnapshot({ rate_limits: { seven_day: { used_percentage: 3 } } }, 1);
  assert.deepStrictEqual(s.rate_limits, { seven_day: { used_percentage: 3 } });
  assert.strictEqual(s.model, null);
});

test('formatStatusLine shows the present windows', () => {
  assert.strictEqual(formatStatusLine(input), '5h 12% · 7d 40%');
  assert.strictEqual(formatStatusLine({ rate_limits: { seven_day: { used_percentage: 3 } } }), '7d 3%');
  assert.strictEqual(formatStatusLine({ model: { display_name: 'Sonnet' } }), 'Sonnet');
  assert.strictEqual(formatStatusLine({}), '');
  assert.strictEqual(formatStatusLine(null), '');
});

test('handle writes the snapshot atomically and creates the folder', () => {
  const file = tmpFile();
  const line = handle(JSON.stringify(input), file, 77);
  assert.strictEqual(line, '5h 12% · 7d 40%');
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(Object.keys(written).sort(), ['capturedAt', 'model', 'rate_limits']);
  assert.strictEqual(written.capturedAt, 77);
  assert.ok(!JSON.stringify(written).includes('geheim'));
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['claude-default.json']);
});

test('handle without rate_limits does not overwrite the old state', () => {
  const file = tmpFile();
  handle(JSON.stringify(input), file, 1);
  const before = fs.readFileSync(file, 'utf8');
  assert.strictEqual(handle(JSON.stringify({ model: { display_name: 'Opus' } }), file, 2), 'Opus');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

test('handle writes nothing without a target path and survives bad input', () => {
  assert.strictEqual(handle(JSON.stringify(input), undefined, 1), '5h 12% · 7d 40%');
  assert.strictEqual(handle('kein json', tmpFile(), 1), '');
  assert.strictEqual(handle('', tmpFile(), 1), '');
});

test('script run directly exits 0, prints the line and writes the file', () => {
  const file = tmpFile();
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'main', 'usage-statusline.js')], {
    input: JSON.stringify(input),
    env: { ...process.env, MULTITERMINAL_USAGE_FILE: file },
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout.trim(), '5h 12% · 7d 40%');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).rate_limits.five_hour.used_percentage, 12.4);
  const bad = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'main', 'usage-statusline.js')], { input: 'müll', encoding: 'utf8' });
  assert.strictEqual(bad.status, 0);
});
