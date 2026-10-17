'use strict';

// Accounts per AI CLI provider. Accounts are separated only by their own config
// folder, passed to the CLI through an environment variable. The app never
// stores or reads credentials; the CLI logs in by itself inside the terminal.
// Each provider has a built-in "Standard" account that sets no variable, so the
// user's existing login keeps working unchanged.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MAX_LABEL_LENGTH = 40;

// Adding another provider is one more row here.
// shared: entries of the default folder that new accounts link to (settings
// only, never login or history data). loginCommand: typed into a terminal to sign in.
const PROVIDERS = Object.freeze({
  claude: Object.freeze({
    name: 'Claude Code',
    envVar: 'CLAUDE_CONFIG_DIR',
    defaultDir: '.claude',
    loginCommand: 'claude',
    shared: Object.freeze([
      'settings.json', 'CLAUDE.md', 'skills', 'commands', 'agents', 'hooks', 'plugins', 'keybindings.json',
    ]),
  }),
  codex: Object.freeze({
    name: 'Codex',
    envVar: 'CODEX_HOME',
    defaultDir: '.codex',
    loginCommand: 'codex login',
    shared: Object.freeze(['config.toml', 'AGENTS.md', 'prompts', 'skills']),
  }),
});

function defaultId(provider) {
  return `${provider}-default`;
}

function checkProvider(provider) {
  if (typeof provider !== 'string' || !Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) {
    throw new Error('Unbekannter Anbieter.');
  }
}

function checkLabel(label) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error('Bezeichnung darf nicht leer sein.');
  }
  const trimmed = label.trim();
  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw new Error(`Bezeichnung ist länger als ${MAX_LABEL_LENGTH} Zeichen.`);
  }
  return trimmed;
}

function isValidOwnAccount(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.id === 'string' &&
    /^[a-z]+-[0-9a-f]{8}$/.test(entry.id) &&
    typeof entry.provider === 'string' &&
    Object.prototype.hasOwnProperty.call(PROVIDERS, entry.provider) &&
    entry.id.startsWith(`${entry.provider}-`) &&
    typeof entry.label === 'string' &&
    entry.label.trim().length > 0
  );
}

function linkShared(provider, target, { homeDir = os.homedir(), isolateClaudeConfig = false } = {}) {
  checkProvider(provider);
  const source = path.join(homeDir, PROVIDERS[provider].defaultDir);
  for (const name of PROVIDERS[provider].shared) {
    if (provider === 'claude' && isolateClaudeConfig && name === 'settings.json') continue;
    try {
      fs.lstatSync(path.join(source, name));
      fs.symlinkSync(path.join(source, name), path.join(target, name));
    } catch { /* Missing source or an existing destination remains unchanged. */ }
  }
}

function createAccountStore({ filePath, profilesDir, homeDir = os.homedir() }) {
  function defaultDirOf(provider) {
    return path.join(homeDir, PROVIDERS[provider].defaultDir);
  }

  function folderOf(provider, id) {
    return path.join(profilesDir, provider, id);
  }

  // Copies a broken file aside so that the user's accounts are not lost on the next write.
  function keepCorruptCopy() {
    try {
      fs.copyFileSync(filePath, filePath + '.corrupt');
    } catch (err) {
      // Nothing to copy or no permission: continue without it.
    }
  }

  function read() {
    const empty = { accounts: [], active: {}, defaultLabels: {} };
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      return empty;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      keepCorruptCopy();
      return empty;
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.accounts)) {
      keepCorruptCopy();
      return empty;
    }
    const seen = new Set();
    const accounts = [];
    for (const entry of data.accounts) {
      if (!isValidOwnAccount(entry) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      accounts.push({ id: entry.id, provider: entry.provider, label: entry.label });
    }
    const active = {};
    const rawActive = data.active !== null && typeof data.active === 'object' ? data.active : {};
    for (const provider of Object.keys(PROVIDERS)) {
      const id = rawActive[provider];
      if (id === defaultId(provider) || accounts.some((a) => a.id === id && a.provider === provider)) {
        active[provider] = id;
      }
    }
    const defaultLabels = {};
    for (const provider of Object.keys(PROVIDERS)) {
      try {
        defaultLabels[provider] = checkLabel(data.defaultLabels && data.defaultLabels[provider]);
      } catch { /* Older files and invalid labels keep the built-in name. */ }
    }
    return { accounts, active, defaultLabels };
  }

  // Writes to a temp file in the same folder, then renames it over the real file.
  function write(state) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = path.join(
      dir,
      `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    try {
      fs.writeFileSync(tmpPath, JSON.stringify({ version: 1, ...state }, null, 2) + '\n', 'utf8');
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

  function activeIdOf(state, provider) {
    return state.active[provider] || defaultId(provider);
  }

  function defaultLabelOf(state, provider) {
    return state.defaultLabels[provider] || 'Standard';
  }

  function checkUniqueLabel(state, provider, label, id) {
    const lower = label.toLowerCase();
    if ((id !== defaultId(provider) && defaultLabelOf(state, provider).toLowerCase() === lower)
      || state.accounts.some((a) => a.id !== id && a.provider === provider && a.label.toLowerCase() === lower)) {
      throw new Error('Dieser Name ist bei diesem Anbieter schon vergeben.');
    }
  }

  // Links the shared settings into a new account folder. Failures are ignored:
  // the account is still usable, just without that shared entry.
  function share(provider, target, options = {}) {
    return linkShared(provider, target, { ...options, homeDir });
  }

  function list() {
    const state = read();
    return Object.keys(PROVIDERS).map((provider) => {
      const activeId = activeIdOf(state, provider);
      const own = state.accounts.filter((a) => a.provider === provider);
      const accounts = [
        { id: defaultId(provider), provider, label: defaultLabelOf(state, provider), builtin: true, folder: defaultDirOf(provider) },
        ...own.map((a) => ({ ...a, builtin: false, folder: folderOf(provider, a.id) })),
      ].map((a) => ({ ...a, active: a.id === activeId }));
      const { name, loginCommand } = PROVIDERS[provider];
      return { provider, name, loginCommand, accounts };
    });
  }

  function add({ provider, label } = {}) {
    checkProvider(provider);
    const trimmed = checkLabel(label);
    const state = read();
    checkUniqueLabel(state, provider, trimmed);
    const account = { id: `${provider}-${crypto.randomBytes(4).toString('hex')}`, provider, label: trimmed };
    const folder = folderOf(provider, account.id);
    fs.mkdirSync(folder, { recursive: true });
    share(provider, folder);
    state.accounts.push(account);
    write(state);
    return { ...account, builtin: false, folder, active: false };
  }

  function rename(id, label) {
    const trimmed = checkLabel(label);
    const state = read();
    const provider = Object.keys(PROVIDERS).find((p) => defaultId(p) === id);
    if (provider) {
      checkUniqueLabel(state, provider, trimmed, id);
      state.defaultLabels[provider] = trimmed;
      write(state);
      return { id, provider, label: trimmed };
    }
    const account = state.accounts.find((a) => a.id === id);
    if (!account) throw new Error('Konto nicht gefunden oder nicht änderbar.');
    checkUniqueLabel(state, account.provider, trimmed, id);
    account.label = trimmed;
    write(state);
    return { ...account };
  }

  function setActive(provider, id) {
    checkProvider(provider);
    const state = read();
    if (id !== defaultId(provider) && !state.accounts.some((a) => a.id === id && a.provider === provider)) {
      throw new Error('Konto nicht gefunden.');
    }
    state.active[provider] = id;
    write(state);
    return true;
  }

  // Removes only the entry. The folder is returned so the caller can move it to the trash.
  function remove(id) {
    const state = read();
    const account = state.accounts.find((a) => a.id === id);
    if (!account) return null;
    state.accounts = state.accounts.filter((a) => a.id !== id);
    if (state.active[account.provider] === id) state.active[account.provider] = defaultId(account.provider);
    write(state);
    return { provider: account.provider, folder: folderOf(account.provider, id) };
  }

  // env: variable -> folder, or null when the variable must not be set (default account).
  // accounts: the accounts that apply, for display on the tile.
  // overrides: { provider: accountId }; unknown or foreign ids fall back to the active account.
  function envFor(overrides) {
    const state = read();
    const wanted = overrides !== null && typeof overrides === 'object' ? overrides : {};
    const env = {};
    const accounts = [];
    for (const provider of Object.keys(PROVIDERS)) {
      let id = activeIdOf(state, provider);
      const over = wanted[provider];
      if (typeof over === 'string' && (over === defaultId(provider)
        || state.accounts.some((a) => a.id === over && a.provider === provider))) {
        id = over;
      }
      const own = state.accounts.find((a) => a.id === id);
      env[PROVIDERS[provider].envVar] = own ? folderOf(provider, id) : null;
      accounts.push({ provider, id, label: own ? own.label : defaultLabelOf(state, provider) });
    }
    return { env, accounts };
  }

  function loginCommand(provider) {
    checkProvider(provider);
    return PROVIDERS[provider].loginCommand;
  }

  return { list, add, rename, setActive, remove, envFor, loginCommand, linkShared: share };
}

module.exports = { createAccountStore, PROVIDERS, linkShared };
