'use strict';

// Loads the personal profile (settings/<provider>/profile.md) into a started agent.
// Nothing of the CLIs is touched: the effect comes only from start flags. Only the
// built-in start/resume commands are decorated, never the user's own quick starts.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildResume } = require('./agent-session-service'); // F02

const PROVIDERS = ['claude', 'codex', 'kimi'];
const MAX_COMMAND_LENGTH = 2000; // same limit as pty-manager.js

const START = Object.freeze({ claude: 'claude', codex: 'codex', kimi: 'kimi' });
const RESUME = Object.freeze({ claude: 'claude --continue', codex: 'codex resume --last', kimi: 'kimi --continue' });
// F02: `claude --resume <id>` / `codex resume <id>` / `kimi --session <id>` as built by agent-session-service.
function isExactIdResume(provider, line) {
  const i = line.lastIndexOf(' ');
  if (i < 0) return false;
  const built = buildResume(provider, line.slice(i + 1));
  return !!built && built.line === line;
}
// Kimi binds the agent at session creation and restores it on resume; no flag is allowed there.
const RESUME_TAKES_FLAG = Object.freeze({ claude: true, codex: true, kimi: false });

// Kimi renders agent files as templates; the docs name no escape for these variables.
const KIMI_VARS = Object.freeze(['skills', 'agents_md', 'cwd', 'cwd_listing', 'os', 'shell', 'now', 'additional_dirs_info', 'base_prompt', 'plugin_sections', 'windows_notes', 'additional_dirs_section', 'skills_section']);
function kimiPlaceholders(text) {
  const found = new Set();
  for (const m of String(text).matchAll(/\$\{\s*([A-Za-z_]+)\s*\}/g)) if (KIMI_VARS.includes(m[1])) found.add(m[1]);
  return [...found];
}

// Single quotes are safe in sh/zsh for any path, including spaces and quotes.
function shellQuote(text) {
  return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

// A TOML basic string, so that `-c key=value` never falls back to guessing the type.
function tomlString(text) {
  const clean = String(text).toWellFormed();
  return JSON.stringify(clean).replace(/\u007f/g, '\\u007f');
}

function createAgentProfile({ dataDir, readProfile }) {
  if (!dataDir) throw new Error('Datenordner fehlt.');
  if (typeof readProfile !== 'function') throw new Error('Profilleser fehlt.');
  const switchFile = path.join(dataDir, 'agent-profile.json');

  function readSwitches() {
    try {
      const data = JSON.parse(fs.readFileSync(switchFile, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch (err) {
      return {};
    }
  }

  function check(provider) {
    if (!PROVIDERS.includes(provider)) throw new Error('Unbekannter Anbieter.');
  }

  function isEnabled(provider) {
    return PROVIDERS.includes(provider) && readSwitches()[provider] === true;
  }

  function setEnabled(provider, enabled) {
    check(provider);
    const next = {};
    const current = readSwitches();
    for (const p of PROVIDERS) next[p] = current[p] === true;
    next[provider] = enabled === true;
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = switchFile + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
      fs.renameSync(tmp, switchFile);
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch (err) { /* already renamed */ }
    }
    return state(provider);
  }

  function state(provider) {
    check(provider);
    return { provider, enabled: isEnabled(provider), resumeTakesFlag: RESUME_TAKES_FLAG[provider] };
  }

  // Derived files live next to the profile, in the app's own data folder.
  function writeDerived(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, file);
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch (err) { /* already renamed */ }
    }
    return file;
  }

  function derivedPath(provider, name) {
    return path.join(dataDir, 'settings', provider, name);
  }

  function flagFor(provider, profile) {
    const text = profile.text;
    if (provider === 'claude') {
      return `--append-system-prompt "$(cat ${shellQuote(profile.path)})"`;
    }
    if (provider === 'codex') {
      // developer_instructions adds a developer message; model_instructions_file would replace the base prompt.
      const file = writeDerived(derivedPath('codex', 'profile.toml-string'), tomlString(text));
      return `-c developer_instructions="$(cat ${shellQuote(file)})"`;
    }
    // ${base_prompt} keeps the default prompt; the profile is added behind it.
    const body = `---\nname: multiterminal-profil\ndescription: Persönliches Profil aus Multiterminal\n---\n\n\${base_prompt}\n\n${text}\n`;
    return `--agent-file ${shellQuote(writeDerived(derivedPath('kimi', 'agent.md'), body))}`;
  }

  // Returns { command, applied, reason }. `command` is the input unchanged unless applied.
  function decorate({ provider, command, resume = false } = {}) {
    const unchanged = reason => ({ command, applied: false, reason });
    if (typeof command !== 'string') return unchanged('kein Befehl');
    const trimmed = command.trim();
    const known = provider || PROVIDERS.find(p => trimmed === START[p] || trimmed === RESUME[p] || isExactIdResume(p, trimmed));
    if (!PROVIDERS.includes(known)) return unchanged('kein eingebauter Start');
    // F02: the exact resume line with a validated conversation ID counts as the built-in resume.
    const idResume = isExactIdResume(known, trimmed);
    const isResume = trimmed === RESUME[known] || idResume;
    if (!idResume && trimmed !== (resume || isResume ? RESUME[known] : START[known])) return unchanged('eigener Befehl');
    if (!isEnabled(known)) return unchanged('Schalter aus');
    if (isResume && !RESUME_TAKES_FLAG[known]) return unchanged('Fortsetzen ohne Flag');
    let profile;
    try { profile = readProfile(known); } catch (err) { return unchanged('Profil nicht lesbar'); }
    if (!profile || typeof profile.text !== 'string' || profile.text.trim() === '') return unchanged('Profil leer');
    let flag;
    try {
      flag = flagFor(known, profile);
    } catch (err) { return unchanged('Profildatei nicht schreibbar'); }
    const decorated = `${trimmed} ${flag}`;
    if (decorated.length > MAX_COMMAND_LENGTH) return unchanged('Befehl zu lang');
    const holders = known === 'kimi' ? kimiPlaceholders(profile.text) : [];
    const warning = holders.length ? `Kimi ersetzt ${holders.map(h => '${' + h + '}').join(', ')} im Profil durch eigene Inhalte.` : '';
    return { command: decorated, applied: true, reason: '', warning };
  }

  function decorateCommand(options) {
    const decorated = options?.skipProfile ? options.command : decorate(options).command;
    const command = options?.command;
    if (typeof command !== 'string' || (options.provider && options.provider !== 'codex')) return decorated;
    const trimmed = command.trim();
    // Full Access is independent of the optional personal profile. Restrict it to
    // the app's exact built-in commands so custom permission choices survive.
    if (trimmed !== START.codex && trimmed !== RESUME.codex && !isExactIdResume('codex', trimmed)) return decorated;
    return `${decorated} --dangerously-bypass-approvals-and-sandbox`;
  }

  // argv interface for catalog callers. Legacy decorators retain their exact
  // file-backed shell spelling; these values are data, never shell fragments.
  function argsFor(provider, { resume = false } = {}) {
    if (!PROVIDERS.includes(provider) || !isEnabled(provider) || (resume && !RESUME_TAKES_FLAG[provider])) return [];
    let profile;
    try { profile = readProfile(provider); } catch { return []; }
    if (!profile || typeof profile.text !== 'string' || !profile.text.trim()) return [];
    if (provider === 'claude') return ['--append-system-prompt', profile.text];
    if (provider === 'codex') return ['-c', `developer_instructions=${tomlString(profile.text)}`];
    try {
      const body = `---\nname: multiterminal-profil\ndescription: Persönliches Profil aus Multiterminal\n---\n\n\${base_prompt}\n\n${profile.text}\n`;
      return ['--agent-file', writeDerived(derivedPath('kimi', 'agent.md'), body)];
    } catch { return []; }
  }

  // The line the app types for its own command (decorated, ending in Enter); null for anything unusable.
  function builtinLine(command) {
    if (typeof command !== 'string' || command.trim() === '' || /[\r\n]/.test(command)) return null;
    return decorateCommand({ command }) + '\r';
  }

  return { isEnabled, setEnabled, state, decorate, decorateCommand, builtinLine, argsFor };
}

module.exports = { createAgentProfile, shellQuote, tomlString, kimiPlaceholders, KIMI_VARS, PROVIDERS };
