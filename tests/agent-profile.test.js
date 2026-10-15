'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createAgentProfile, shellQuote, tomlString, kimiPlaceholders } = require('../src/main/agent-profile');
const { createSettingsService } = require('../src/main/settings-service');

// The data folder name has a space and a single quote, like "Application Support".
function fixture(t, folder = "Application Support's") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-profile-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, folder);
  const settings = createSettingsService({ dataDir, homeDir: path.join(root, 'home') });
  const profile = createAgentProfile({ dataDir, readProfile: scope => settings.readProfile(scope) });
  const save = (scope, text) => settings.saveProfile(scope, text, settings.readProfile(scope).revision);
  return { root, dataDir, settings, profile, save };
}
// Runs a decorated command through sh with a stand-in that prints its arguments as JSON.
function argsOf(f, command, bin) {
  const dir = path.join(f.root, 'bin'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, bin), '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n', { mode: 0o755 });
  return JSON.parse(execFileSync('/bin/sh', ['-c', command], { env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH }, encoding: 'utf8' }));
}

test('switch is off by default, persists per provider and rejects unknown providers', t => {
  const f = fixture(t); f.save('claude', 'Profil');
  assert.equal(f.profile.isEnabled('claude'), false);
  assert.equal(f.profile.decorateCommand({ command: 'claude' }), 'claude');
  assert.equal(f.profile.setEnabled('claude', true).enabled, true);
  assert.equal(f.profile.isEnabled('codex'), false);
  assert.equal(f.profile.state('kimi').resumeTakesFlag, false);
  assert.equal(createAgentProfile({ dataDir: f.dataDir, readProfile: () => ({}) }).isEnabled('claude'), true);
  f.profile.setEnabled('claude', false);
  assert.equal(f.profile.decorateCommand({ command: 'claude' }), 'claude');
  assert.throws(() => f.profile.setEnabled('common', true), /Unbekannter/);
});

test('empty or missing profile leaves the command unchanged', t => {
  const f = fixture(t);
  for (const p of ['claude', 'codex', 'kimi']) f.profile.setEnabled(p, true);
  assert.deepEqual(f.profile.decorate({ command: 'claude' }), { command: 'claude', applied: false, reason: 'Profil leer' });
  f.save('claude', '  \n');
  assert.equal(f.profile.decorateCommand({ command: 'claude' }), 'claude');
  assert.equal(f.profile.decorateCommand({ command: 'codex' }), 'codex');
  assert.equal(f.profile.decorateCommand({ command: 'kimi' }), 'kimi');
});

test('claude: profile is appended through a safely quoted path with space and apostrophe', t => {
  const f = fixture(t); f.save('claude', '# Ziele\n"Quote" $HOME `x` \'y\'\n'); f.profile.setEnabled('claude', true);
  const r = f.profile.decorate({ provider: 'claude', command: 'claude' });
  assert.equal(r.applied, true);
  const args = argsOf(f, r.command, 'claude');
  assert.equal(args[0], '--append-system-prompt');
  assert.equal(args[1], '# Ziele\n"Quote" $HOME `x` \'y\'');
  const resume = argsOf(f, f.profile.decorateCommand({ provider: 'claude', command: 'claude --continue', resume: true }), 'claude');
  assert.deepEqual(resume.slice(0, 2), ['--continue', '--append-system-prompt']);
});

test('codex: developer_instructions is a TOML string, also for text that is valid TOML by itself', t => {
  const f = fixture(t); f.profile.setEnabled('codex', true);
  for (const text of ['"nur ein String"', '123', '[a]\nb = "c"', 'Zeile 1\nZeile 2 \\ "x" é']) {
    f.save('codex', text);
    const args = argsOf(f, f.profile.decorateCommand({ command: 'codex' }), 'codex');
    assert.equal(args[0], '-c');
    assert.match(args[1], /^developer_instructions=/);
    assert.equal(JSON.parse(args[1].slice('developer_instructions='.length)), text);
  }
  const resume = argsOf(f, f.profile.decorateCommand({ command: 'codex resume --last' }), 'codex');
  assert.deepEqual(resume.slice(0, 2), ['resume', '--last']); assert.equal(resume[2], '-c');
  assert.equal(tomlString('a\u007fb'), '"a\\u007fb"');
});

test('kimi: derived agent file keeps the base prompt; resume gets no flag', t => {
  const f = fixture(t); f.save('kimi', 'Mein Profil'); f.profile.setEnabled('kimi', true);
  const args = argsOf(f, f.profile.decorateCommand({ command: 'kimi' }), 'kimi');
  assert.equal(args[0], '--agent-file');
  assert.equal(args[1], path.join(f.dataDir, 'settings', 'kimi', 'agent.md'));
  const file = fs.readFileSync(args[1], 'utf8');
  assert.match(file, /^---\nname: multiterminal-profil\ndescription: .+\n---\n/);
  assert.ok(file.includes('${base_prompt}\n\nMein Profil'));
  assert.deepEqual(f.profile.decorate({ command: 'kimi --continue' }), { command: 'kimi --continue', applied: false, reason: 'Fortsetzen ohne Flag' });
  assert.equal(fs.readFileSync(path.join(f.dataDir, 'settings', 'kimi', 'profile.md'), 'utf8'), 'Mein Profil');
});

test('only the built-in start and resume commands are decorated', t => {
  const f = fixture(t); f.save('claude', 'P'); f.save('codex', 'P'); f.profile.setEnabled('claude', true); f.profile.setEnabled('codex', true);
  for (const command of ['claude --model opus', 'claude --continue --x', 'my-claude', 'codex exec hi', 'ls', '']) {
    assert.equal(f.profile.decorateCommand({ command }), command);
  }
  assert.equal(f.profile.decorateCommand({ command: 'claude --continue' }), f.profile.decorateCommand({ provider: 'claude', command: 'claude --continue', resume: true }));
  assert.equal(f.profile.decorateCommand({ provider: 'claude', command: 'codex' }), 'codex');
  assert.equal(f.profile.decorateCommand({ command: 42 }), 42);
});

test('a command that would exceed 2000 characters stays unchanged', t => {
  const f = fixture(t);
  const long = createAgentProfile({ dataDir: f.dataDir, readProfile: () => ({ text: 'P', path: '/' + 'x'.repeat(2000) }) });
  long.setEnabled('claude', true);
  assert.deepEqual(long.decorate({ command: 'claude' }), { command: 'claude', applied: false, reason: 'Befehl zu lang' });
  const ok = createAgentProfile({ dataDir: f.dataDir, readProfile: () => ({ text: 'P', path: '/' + 'x'.repeat(1900) }) });
  assert.equal(ok.decorate({ command: 'claude' }).applied, true);
});

test('profile state is reported to the settings service and shellQuote escapes quotes', t => {
  const f = fixture(t); f.save('claude', 'P');
  assert.equal(f.settings.readProfile('claude').appliesTo, 'app-only');
  const wired = createSettingsService({ dataDir: f.dataDir, homeDir: path.join(f.root, 'home'), loadsAtStart: s => s === 'claude' });
  assert.equal(wired.readProfile('claude').appliesTo, 'start-flag');
  assert.equal(wired.readProfile('claude').loadAtStart, true);
  assert.equal(wired.readProfile('codex').loadAtStart, false);
  assert.equal(shellQuote("a'b c"), "'a'\\''b c'");
});

test('kimi placeholders in the profile are reported, other dollar text is not', t => {
  const f = fixture(t); f.profile.setEnabled('kimi', true);
  assert.deepEqual(kimiPlaceholders('a ${cwd} b ${ base_prompt } ${cwd} ${unbekannt} $HOME ${x'), ['cwd', 'base_prompt']);
  f.save('kimi', 'Arbeite in ${cwd}.');
  const r = f.profile.decorate({ command: 'kimi' });
  assert.equal(r.applied, true); assert.match(r.warning, /\$\{cwd\}/);
  f.save('kimi', 'Kosten: $5 und ${frei}');
  assert.equal(f.profile.decorate({ command: 'kimi' }).warning, '');
});

test('builtinLine is the only app path that decorates and ends the line itself', t => {
  const f = fixture(t); f.save('claude', 'P'); f.profile.setEnabled('claude', true);
  assert.match(f.profile.builtinLine('claude --continue'), /^claude --continue --append-system-prompt .*\r$/);
  assert.equal(f.profile.builtinLine('echo hi'), 'echo hi\r');
  assert.equal(f.profile.builtinLine('claude\r'), null);
  assert.equal(f.profile.builtinLine('a\nb'), null);
  assert.equal(f.profile.builtinLine(''), null);
  assert.equal(f.profile.builtinLine(5), null);
});

// F02
test('exact resume line with a conversation ID gets the profile flag, injected IDs stay untouched', t => {
  const f = fixture(t); f.save('claude', 'Profil'); f.profile.setEnabled('claude', true);
  const id = 'a1b2c3d4-0000-4000-8000-123456789abc';
  assert.match(f.profile.builtinLine('claude --resume ' + id), /^claude --resume a1b2c3d4-.* --append-system-prompt .*\r$/);
  assert.equal(f.profile.builtinLine('claude --resume ' + id + ';id'), 'claude --resume ' + id + ';id\r');
  assert.equal(f.profile.builtinLine('claude --resume short'), 'claude --resume short\r');
  f.save('codex', 'Profil'); f.profile.setEnabled('codex', true);
  assert.match(f.profile.builtinLine('codex resume ' + id), /^codex resume a1b2.* -c developer_instructions=/);
  f.save('kimi', 'Profil'); f.profile.setEnabled('kimi', true);
  assert.equal(f.profile.builtinLine('kimi --session ' + id), 'kimi --session ' + id + '\r');
});
