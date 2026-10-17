'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUsageService, statuslineSettings, STALE_AFTER_MS } = require('../src/main/usage-service');

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const nowSec = NOW / 1000;

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-usage-'));
  const homeDir = path.join(root, 'home');
  const usageDir = path.join(root, 'usage');
  const service = createUsageService({ usageDir, homeDir, now: () => NOW });
  return { root, homeDir, usageDir, service };
}

const codexAccount = (folder) => ({ id: 'codex-default', provider: 'codex', label: 'Standard', builtin: true, folder });

function tokenCount(timestamp, rateLimits) {
  return JSON.stringify({ timestamp: new Date(timestamp).toISOString(), type: 'event_msg', payload: { type: 'token_count', rate_limits: rateLimits } });
}

function writeRollout(folder, day, name, lines) {
  const dir = path.join(folder, 'sessions', ...day.split('-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n');
}

const recent = NOW - 60 * 1000;

test('codex with only a weekly window', () => {
  const { homeDir, service } = setup();
  const folder = path.join(homeDir, '.codex');
  writeRollout(folder, '2026-10-13', 'rollout-a.jsonl', [
    tokenCount(recent, { limit_id: 'codex', primary: { used_percent: 2, window_minutes: 10080, resets_at: nowSec + 86400 * 3 }, secondary: null, plan_type: 'prolite' }),
  ]);
  const r = service.forAccount(codexAccount(folder));
  assert.strictEqual(r.plan, 'prolite');
  assert.strictEqual(r.stale, false);
  assert.strictEqual(r.capturedAt, recent);
  assert.deepStrictEqual(r.windows, [
    { key: 'codex:10080', label: 'Woche', usedPercent: 2, resetsAt: (nowSec + 86400 * 3) * 1000, windowMinutes: 10080 },
  ]);
});

test('codex with 5 hour and weekly window', () => {
  const { homeDir, service } = setup();
  const folder = path.join(homeDir, '.codex');
  writeRollout(folder, '2026-10-13', 'rollout-a.jsonl', [
    tokenCount(recent, {
      limit_id: 'codex',
      primary: { used_percent: 30.5, window_minutes: 300, resets_at: nowSec + 3600 },
      secondary: { used_percent: 10, window_minutes: 10080, resets_at: nowSec + 86400 },
    }),
  ]);
  const r = service.forAccount(codexAccount(folder));
  assert.deepStrictEqual(r.windows.map((w) => [w.label, w.usedPercent]), [['5 Std.', 30.5], ['Woche', 10]]);
});

test('codex takes the newest state per limit_id, main limit first', () => {
  const { homeDir, service } = setup();
  const folder = path.join(homeDir, '.codex');
  writeRollout(folder, '2026-10-12', 'rollout-old.jsonl', [
    tokenCount(recent - 1000, { limit_id: 'codex', primary: { used_percent: 99, window_minutes: 10080, resets_at: nowSec + 100 } }),
  ]);
  writeRollout(folder, '2026-10-13', 'rollout-new.jsonl', [
    tokenCount(recent - 3000, { limit_id: 'codex_bengalfox', limit_name: 'Bengalfox', primary: { used_percent: 5, window_minutes: 300, resets_at: nowSec + 100 } }),
    tokenCount(recent - 2000, { limit_id: 'codex', primary: { used_percent: 11, window_minutes: 10080, resets_at: nowSec + 100 } }),
    tokenCount(recent, { limit_id: 'codex', primary: { used_percent: 12, window_minutes: 10080, resets_at: nowSec + 100 } }),
  ]);
  const r = service.forAccount(codexAccount(folder));
  assert.deepStrictEqual(r.windows.map((w) => [w.key, w.label, w.usedPercent]), [
    ['codex:10080', 'Woche', 12],
    ['codex_bengalfox:300', '5 Std. · Bengalfox', 5],
  ]);
});

test('codex ignores null rate_limits and broken last line', () => {
  const { homeDir, service } = setup();
  const folder = path.join(homeDir, '.codex');
  writeRollout(folder, '2026-10-13', 'rollout-a.jsonl', [
    tokenCount(recent - 1000, { limit_id: 'codex', primary: { used_percent: 7, window_minutes: 10080, resets_at: nowSec + 100 } }),
    tokenCount(recent, null),
    '{"timestamp":"2026-10-13T11:59:00Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"cod',
  ]);
  const r = service.forAccount(codexAccount(folder));
  assert.strictEqual(r.windows.length, 1);
  assert.strictEqual(r.windows[0].usedPercent, 7);
});

test('codex without sessions folder gives a note', () => {
  const { homeDir, service } = setup();
  const r = service.forAccount(codexAccount(path.join(homeDir, '.codex')));
  assert.deepStrictEqual(r.windows, []);
  assert.ok(r.note);
  assert.strictEqual(r.stale, false);
});

test('codex reads only the end of a large file', () => {
  const { homeDir, service } = setup();
  const folder = path.join(homeDir, '.codex');
  const filler = JSON.stringify({ type: 'x', payload: { text: 'y'.repeat(1000) } });
  const lines = [tokenCount(recent - 5000, { limit_id: 'codex', primary: { used_percent: 1, window_minutes: 10080 } })];
  for (let i = 0; i < 600; i += 1) lines.push(filler);
  lines.push(tokenCount(recent, { limit_id: 'codex', primary: { used_percent: 42, window_minutes: 10080 } }));
  writeRollout(folder, '2026-10-13', 'rollout-big.jsonl', lines);
  assert.strictEqual(service.forAccount(codexAccount(folder)).windows[0].usedPercent, 42);
});

test('codex window past its reset counts as reset and stale', () => {
  const { homeDir, service } = setup();
  const folder = path.join(homeDir, '.codex');
  writeRollout(folder, '2026-10-13', 'rollout-a.jsonl', [
    tokenCount(recent, { limit_id: 'codex', primary: { used_percent: 80, window_minutes: 300, resets_at: nowSec - 10 } }),
  ]);
  const r = service.forAccount(codexAccount(folder));
  assert.strictEqual(r.stale, true);
  assert.strictEqual(r.windows[0].usedPercent, 0);
  assert.strictEqual(r.windows[0].resetsAt, null);
});

test('builtin codex account without folder uses the home default', () => {
  const { homeDir, service } = setup();
  writeRollout(path.join(homeDir, '.codex'), '2026-10-13', 'rollout-a.jsonl', [
    tokenCount(recent, { limit_id: 'codex', primary: { used_percent: 3, window_minutes: 10080 } }),
  ]);
  const r = service.forAccount({ id: 'codex-default', provider: 'codex', builtin: true });
  assert.strictEqual(r.windows[0].usedPercent, 3);
});

test('a missing resets_at and invalid numbers are handled', () => {
  const { homeDir, service } = setup();
  const folder = path.join(homeDir, '.codex');
  writeRollout(folder, '2026-10-13', 'rollout-a.jsonl', [
    tokenCount(recent, {
      limit_id: 'codex',
      primary: { used_percent: 250, window_minutes: 10080 },
      secondary: { used_percent: 'viel', window_minutes: 300 },
    }),
  ]);
  const r = service.forAccount(codexAccount(folder));
  assert.deepStrictEqual(r.windows.map((w) => [w.usedPercent, w.resetsAt]), [[100, null]]);
});

const claudeAccount = { id: 'claude-default', provider: 'claude', label: 'Standard', builtin: true, folder: '/x' };

function writeSnapshot(usageDir, id, content) {
  fs.mkdirSync(usageDir, { recursive: true });
  fs.writeFileSync(path.join(usageDir, `${id}.json`), typeof content === 'string' ? content : JSON.stringify(content));
}

test('claude snapshot with both windows', () => {
  const { usageDir, service } = setup();
  writeSnapshot(usageDir, 'claude-default', {
    capturedAt: recent,
    rate_limits: {
      five_hour: { used_percentage: 12, resets_at: nowSec + 7800 },
      seven_day: { used_percentage: 40.4, resets_at: nowSec + 86400 * 2 },
    },
    model: 'Opus',
  });
  const r = service.forAccount(claudeAccount);
  assert.strictEqual(r.stale, false);
  assert.strictEqual(r.capturedAt, recent);
  assert.deepStrictEqual(r.windows.map((w) => [w.key, w.label, w.usedPercent, w.windowMinutes]), [
    ['five_hour', '5 Std.', 12, 300],
    ['seven_day', 'Woche', 40.4, 10080],
  ]);
  assert.strictEqual(r.windows[0].resetsAt, (nowSec + 7800) * 1000);
});

test('claude snapshot with one window', () => {
  const { usageDir, service } = setup();
  writeSnapshot(usageDir, 'claude-default', { capturedAt: recent, rate_limits: { seven_day: { used_percentage: 5 } } });
  const r = service.forAccount(claudeAccount);
  assert.deepStrictEqual(r.windows.map((w) => w.key), ['seven_day']);
  assert.strictEqual(r.windows[0].resetsAt, null);
});

test('claude snapshot missing or broken gives a note', () => {
  const { usageDir, service } = setup();
  const missing = service.forAccount(claudeAccount);
  assert.deepStrictEqual(missing.windows, []);
  assert.match(missing.note, /Noch kein Stand/);
  writeSnapshot(usageDir, 'claude-default', '{kaputt');
  const broken = service.forAccount(claudeAccount);
  assert.deepStrictEqual(broken.windows, []);
  assert.match(broken.note, /Noch kein Stand/);
});

test('claude window past its reset is zeroed and the result stale', () => {
  const { usageDir, service } = setup();
  writeSnapshot(usageDir, 'claude-default', {
    capturedAt: recent,
    rate_limits: { five_hour: { used_percentage: 90, resets_at: nowSec - 5 }, seven_day: { used_percentage: 20, resets_at: nowSec + 100 } },
  });
  const r = service.forAccount(claudeAccount);
  assert.strictEqual(r.stale, true);
  assert.strictEqual(r.windows[0].usedPercent, 0);
  assert.strictEqual(r.windows[0].resetsAt, null);
  assert.strictEqual(r.windows[1].usedPercent, 20);
});

test('an old snapshot is stale', () => {
  const { usageDir, service } = setup();
  writeSnapshot(usageDir, 'claude-default', {
    capturedAt: NOW - STALE_AFTER_MS - 1,
    rate_limits: { seven_day: { used_percentage: 20, resets_at: nowSec + 100 } },
  });
  assert.strictEqual(service.forAccount(claudeAccount).stale, true);
});

test('usageFileFor rejects ids that escape the folder', () => {
  const { usageDir, service } = setup();
  assert.strictEqual(service.usageFileFor('claude-ab12cd34'), path.join(usageDir, 'claude-ab12cd34.json'));
  for (const bad of ['../x', 'a/b', '..', '', 'a\\b', null, 'x'.repeat(65)]) {
    assert.throws(() => service.usageFileFor(bad), /Ungültige/);
  }
  const r = service.forAccount({ id: '../evil', provider: 'claude' });
  assert.deepStrictEqual(r.windows, []);
  assert.ok(r.note);
});

test('forAccounts isolates failures per account', () => {
  const { homeDir, usageDir, service } = setup();
  writeSnapshot(usageDir, 'claude-default', { capturedAt: recent, rate_limits: { seven_day: { used_percentage: 5, resets_at: nowSec + 10 } } });
  const out = service.forAccounts([
    claudeAccount,
    null,
    { id: 'foo-1', provider: 'foo' },
    codexAccount(path.join(homeDir, '.codex')),
  ]);
  assert.strictEqual(out.length, 4);
  assert.strictEqual(out[0].windows.length, 1);
  assert.deepStrictEqual(out[1].windows, []);
  assert.ok(out[1].note);
  assert.deepStrictEqual(out[2].windows, []);
  assert.deepStrictEqual(out[3].windows, []);
});

test('statuslineSettings quotes paths with spaces and quotes', () => {
  const s = statuslineSettings({ execPath: '/Applications/Multi Terminal.app/Contents/MacOS/Multiterminal', scriptPath: "/home/j/My Projects/it's/usage-statusline.js" });
  assert.strictEqual(s.statusLine.type, 'command');
  assert.strictEqual(
    s.statusLine.command,
    `ELECTRON_RUN_AS_NODE=1 '/Applications/Multi Terminal.app/Contents/MacOS/Multiterminal' '/home/j/My Projects/it'\\''s/usage-statusline.js'`
  );
});
