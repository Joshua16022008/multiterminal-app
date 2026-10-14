'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSkillUsage, forSkill } = require('../src/main/skill-usage');

const NOW = Date.parse('2026-10-13T12:00:00Z');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-usage-'));
}

function jl(...objs) {
  return objs.map((o) => (typeof o === 'string' ? o : JSON.stringify(o))).join('\n') + '\n';
}

function toolUse(skill, ts, id) {
  return { type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id, name: 'Skill', input: { skill } }] } };
}

function slash(name, ts) {
  return { type: 'user', timestamp: ts, message: { role: 'user', content: `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>` } };
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function setup() {
  const home = tmp();
  const cacheFile = path.join(tmp(), 'cache.json');
  const svc = createSkillUsage({ cacheFile, homeDir: home, now: () => NOW });
  return { home, cacheFile, svc, claudeDir: path.join(home, '.claude'), codexDir: path.join(home, '.codex') };
}

test('Claude: Tool-Aufruf und Slash-Befehl zaehlen, Zeitpunkt aus timestamp', async () => {
  const { svc, claudeDir } = setup();
  write(path.join(claudeDir, 'projects', 'a', 's1.jsonl'), jl(
    toolUse('alpha', '2026-10-01T10:00:00Z', 't1'),
    toolUse('alpha', '2026-10-02T10:00:00Z', 't2'),
    slash('beta', '2026-10-03T10:00:00Z')
  ));
  const r = await svc.scan({ provider: 'claude' });
  assert.equal(r.evidence, 'executed');
  assert.equal(r.skills.alpha.count, 2);
  assert.equal(r.skills.alpha.lastUsedAt, Date.parse('2026-10-02T10:00:00Z'));
  assert.equal(r.skills.alpha.sessions, 1);
  assert.equal(r.skills.beta.count, 1);
  assert.equal(r.scannedFiles, 1);
  assert.equal(r.truncated, false);
  assert.equal(r.scannedAt, NOW);
});

test('Claude: mehrere Dateien zaehlen als mehrere Sitzungen, doppelte tool_use-Id nur einmal', async () => {
  const { svc, claudeDir } = setup();
  write(path.join(claudeDir, 'projects', 'a', 's1.jsonl'), jl(toolUse('alpha', '2026-10-01T10:00:00Z', 'x'), toolUse('alpha', '2026-10-01T10:00:01Z', 'x')));
  write(path.join(claudeDir, 'projects', 'b', 's2.jsonl'), jl(toolUse('alpha', '2026-10-05T10:00:00Z', 'y')));
  const r = await svc.scan({ provider: 'claude' });
  assert.equal(r.skills.alpha.count, 2);
  assert.equal(r.skills.alpha.sessions, 2);
  assert.equal(r.skills.alpha.lastUsedAt, Date.parse('2026-10-05T10:00:00Z'));
});

test('Claude: kaputte Zeilen werden uebersprungen', async () => {
  const { svc, claudeDir } = setup();
  write(path.join(claudeDir, 'projects', 'a', 's1.jsonl'),
    jl('{"name":"Skill" kaputt', toolUse('alpha', '2026-10-01T10:00:00Z', 't1'), '<command-name>{{'));
  const r = await svc.scan({ provider: 'claude' });
  assert.equal(r.skills.alpha.count, 1);
});

test('Claude: blosse Erwaehnung und andere Tools zaehlen nicht', async () => {
  const { svc, claudeDir } = setup();
  write(path.join(claudeDir, 'projects', 'a', 's1.jsonl'), jl(
    { type: 'assistant', timestamp: '2026-10-01T10:00:00Z', message: { content: [{ type: 'text', text: 'Ich nutze den "name":"Skill" Aufruf nicht' }] } },
    { type: 'assistant', timestamp: '2026-10-01T10:00:00Z', message: { content: [{ type: 'tool_use', id: 'o', name: 'Read', input: { skill: 'fremd' } }] } },
    { type: 'assistant', timestamp: '2026-10-01T10:00:00Z', message: { content: [{ type: 'text', text: '<command-name>/zitat</command-name>' }] } },
    { type: 'user', timestamp: '2026-10-01T10:00:00Z', message: { content: [{ type: 'tool_result', content: 'Skill' }] } }
  ));
  const r = await svc.scan({ provider: 'claude' });
  assert.deepEqual(r.skills, {});
});

test('forSkill: Plugin-Praefix und Gross-/Kleinschreibung', async () => {
  const { svc, claudeDir } = setup();
  write(path.join(claudeDir, 'projects', 'a', 's1.jsonl'), jl(
    toolUse('plug:Review', '2026-10-01T10:00:00Z', 't1'),
    toolUse('review', '2026-10-02T10:00:00Z', 't2'),
    toolUse('other', '2026-10-02T10:00:00Z', 't3')
  ));
  const r = await svc.scan({ provider: 'claude' });
  assert.equal(r.skills['plug:Review'].count, 1);
  const f = forSkill(r, 'REVIEW');
  assert.equal(f.count, 2);
  assert.equal(f.lastUsedAt, Date.parse('2026-10-02T10:00:00Z'));
  assert.equal(forSkill(r, 'other:review').count, 2);
  assert.equal(forSkill(r, 'fehlt'), null);
  assert.equal(forSkill(null, 'x'), null);
});

test('Codex: SKILL.md im Befehl ergibt evidence read, Text-Erwaehnung zaehlt nicht', async () => {
  const { svc, codexDir } = setup();
  write(path.join(codexDir, 'sessions', '2026', '10', '12', 'rollout-1.jsonl'), jl(
    { type: 'response_item', timestamp: '2026-10-12T09:00:00Z', payload: { type: 'custom_tool_call', name: 'exec', input: 'cat /x/skills/demo/SKILL.md' } },
    { type: 'response_item', timestamp: '2026-10-12T09:01:00Z', payload: { type: 'function_call', name: 'shell', arguments: '{"cmd":"sed -n 1,5p /x/skills/demo/SKILL.md; ls /y/skills/zwei/SKILL.md"}' } },
    { type: 'response_item', timestamp: '2026-10-12T09:02:00Z', payload: { type: 'message', content: [{ type: 'text', text: 'siehe skills/nurtext/SKILL.md' }] } }
  ));
  const r = await svc.scan({ provider: 'codex' });
  assert.equal(r.evidence, 'read');
  assert.equal(r.skills.demo.count, 2);
  assert.equal(r.skills.zwei.count, 1);
  assert.equal(r.skills.nurtext, undefined);
  assert.match(r.note, /SKILL\.md gelesen/);
});

test('Kimi und unbekannte Anbieter: none ohne Scan', async () => {
  const { svc } = setup();
  const r = await svc.scan({ provider: 'kimi' });
  assert.equal(r.evidence, 'none');
  assert.deepEqual(r.skills, {});
  assert.equal(r.scannedFiles, 0);
  assert.ok(r.note);
});

test('configDirs: nur uebergebene Ordner, Symlinks werden nicht gefolgt', async () => {
  const { svc, claudeDir } = setup();
  const acct = tmp();
  const outside = tmp();
  write(path.join(acct, 'projects', 'p', 's.jsonl'), jl(toolUse('konto', '2026-10-01T10:00:00Z', 'k')));
  write(path.join(outside, 'geheim.jsonl'), jl(toolUse('draussen', '2026-10-01T10:00:00Z', 'd')));
  write(path.join(claudeDir, 'projects', 'p', 'x.jsonl'), jl(toolUse('standard', '2026-10-01T10:00:00Z', 's')));
  fs.symlinkSync(outside, path.join(acct, 'projects', 'link'));
  fs.symlinkSync(path.join(outside, 'geheim.jsonl'), path.join(acct, 'projects', 'p', 'l.jsonl'));
  const r = await svc.scan({ provider: 'claude', configDirs: [acct] });
  assert.deepEqual(Object.keys(r.skills), ['konto']);
});

test('Grenzen: Dateilimit setzt truncated und neueste Dateien gewinnen', async () => {
  const home = tmp();
  const svc = createSkillUsage({ cacheFile: path.join(tmp(), 'c.json'), homeDir: home, now: () => NOW, limits: { claudeFiles: 2 } });
  const dir = path.join(home, '.claude', 'projects', 'p');
  for (let i = 0; i < 4; i += 1) {
    const f = path.join(dir, `s${i}.jsonl`);
    write(f, jl(toolUse(`skill${i}`, '2026-10-01T10:00:00Z', `t${i}`)));
    const t = new Date(NOW - (10 - i) * 1000);
    fs.utimesSync(f, t, t);
  }
  const r = await svc.scan({ provider: 'claude' });
  assert.equal(r.truncated, true);
  assert.equal(r.scannedFiles, 2);
  assert.equal(r.skippedFiles, 2);
  assert.deepEqual(Object.keys(r.skills).sort(), ['skill2', 'skill3']);
  assert.match(r.note, /jüngsten/);
});

test('Grenzen: Byte-Obergrenze je Datei liest nur den Schluss und meldet truncated', async () => {
  const home = tmp();
  const line = jl(toolUse('alt', '2026-10-01T10:00:00Z', 'a'));
  const svc = createSkillUsage({ cacheFile: path.join(tmp(), 'c.json'), homeDir: home, now: () => NOW, limits: { bytesPerFile: line.length * 2 + 5 } });
  write(path.join(home, '.claude', 'projects', 'p', 's.jsonl'),
    line + jl(toolUse('mitte', '2026-10-01T10:00:00Z', 'b')) + jl(toolUse('neu', '2026-10-01T10:00:00Z', 'c')));
  const r = await svc.scan({ provider: 'claude' });
  assert.equal(r.truncated, true);
  assert.equal(r.skills.alt, undefined);
  assert.equal(r.skills.neu.count, 1);
});

test('Grenzen: Gesamt-Byte-Obergrenze ueberspringt aeltere Dateien', async () => {
  const home = tmp();
  const svc = createSkillUsage({ cacheFile: path.join(tmp(), 'c.json'), homeDir: home, now: () => NOW, limits: { bytesTotal: 10 } });
  write(path.join(home, '.claude', 'projects', 'p', 's.jsonl'), jl(toolUse('x', '2026-10-01T10:00:00Z', 'a')));
  const r = await svc.scan({ provider: 'claude' });
  assert.equal(r.truncated, true);
  assert.equal(r.skippedFiles, 1);
  assert.equal(r.scannedFiles, 0);
});

test('Cache: unveraenderte Datei wird nicht erneut gelesen, geaenderte schon', async () => {
  const { svc, claudeDir, cacheFile } = setup();
  const f = path.join(claudeDir, 'projects', 'p', 's.jsonl');
  const a = jl(toolUse('alpha', '2026-10-01T10:00:00Z', 'a'));
  write(f, a);
  const t = new Date(NOW - 5000);
  fs.utimesSync(f, t, t);
  await svc.scan({ provider: 'claude' });

  // gleicher Umfang und gleiche mtime, anderer Inhalt: nur ein Cache-Treffer zaehlt weiter alpha
  write(f, a.replace('alpha', 'omega'));
  fs.utimesSync(f, t, t);
  let r = await svc.scan({ provider: 'claude' });
  assert.equal(r.skills.alpha.count, 1);
  assert.equal(r.skills.omega, undefined);

  // neue Groesse: wird neu gelesen
  write(f, a.replace('alpha', 'omega') + jl(toolUse('omega', '2026-10-02T10:00:00Z', 'b')));
  r = await svc.scan({ provider: 'claude' });
  assert.equal(r.skills.alpha, undefined);
  assert.equal(r.skills.omega.count, 2);

  // der Cache enthaelt nur Namen, Zaehler und Zeitpunkte
  const raw = fs.readFileSync(cacheFile, 'utf8');
  assert.ok(!raw.includes('tool_use'));
  assert.ok(!fs.readdirSync(path.dirname(cacheFile)).some((n) => n.endsWith('.tmp')));
});

test('Cache: kaputte Datei wird verworfen', async () => {
  const { svc, claudeDir, cacheFile } = setup();
  write(path.join(claudeDir, 'projects', 'p', 's.jsonl'), jl(toolUse('alpha', '2026-10-01T10:00:00Z', 'a')));
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, '{kaputt');
  const r = await svc.scan({ provider: 'claude' });
  assert.equal(r.skills.alpha.count, 1);
  assert.equal(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).version, 1);
});

test('fehlender Protokollordner liefert leeres Ergebnis ohne Absturz', async () => {
  const { svc } = setup();
  const r = await svc.scan({ provider: 'claude' });
  assert.deepEqual(r.skills, {});
  assert.equal(r.scannedFiles, 0);
  assert.match(r.note, /Kein Protokollordner/);
});
