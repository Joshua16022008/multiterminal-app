'use strict';

// Assigns an existing skill folder to an agent by creating a symlink in the agent's
// native skill folder, and takes it back again. Only links created here (recorded in
// settings/assignments.json) are ever removed; nothing is overwritten.
//   Claude: ~/.claude/skills        (documented; account folders link to it)
//   Codex:  ~/.agents/skills        (shared with Kimi; Codex also bundles ~/.codex/skills/.system)
//   Kimi:   ~/.kimi-code/skills     (documented: moonshotai.github.io/kimi-code/en/customization/skills.md)

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PROVIDERS = ['claude', 'codex', 'kimi'];
const NATIVE_SKILLS = Object.freeze({
  claude: ['.claude', 'skills'],
  codex: ['.agents', 'skills'],
  kimi: ['.kimi-code', 'skills'],
});
const SHARED_NOTE = Object.freeze({
  claude: 'Der Ordner ist der Standardordner von Claude Code; Zusatzkonten verweisen darauf, die Zuordnung gilt also für alle Claude-Konten.',
  codex: 'Dieser Ordner (~/.agents/skills) wird von mehreren Agenten gelesen, auch von Kimi. Die Zuordnung gilt für alle, die ihn lesen.',
  kimi: 'Kimi liest zusätzlich ~/.agents/skills; die Zuordnung hier gilt nur für Kimi.',
});
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const within = (child, root) => child === root || child.startsWith(root + path.sep);

function fail(message, state) {
  const err = new Error(message);
  err.state = state;
  return err;
}

function createExtensionManager({ dataDir, homeDir = os.homedir() }) {
  if (!dataDir) throw new Error('Datenordner fehlt.');
  const manifestFile = path.join(dataDir, 'settings', 'assignments.json');

  function check(provider) {
    if (!PROVIDERS.includes(provider)) throw fail('Unbekannter Anbieter.');
  }
  function checkName(name) {
    if (typeof name !== 'string' || !NAME_RE.test(name) || name === '.' || name === '..') throw fail('Ungültiger Skill-Name.');
  }

  // The native folder; if it is a symlink the real folder is used.
  function targetDir(provider) {
    check(provider);
    const dir = path.join(homeDir, ...NATIVE_SKILLS[provider]);
    try { return { path: fs.realpathSync(dir), exists: true, linked: fs.lstatSync(dir).isSymbolicLink() }; }
    catch (err) { return { path: dir, exists: false, linked: false }; }
  }
  function target(provider) {
    const t = targetDir(provider);
    return { path: t.path, exists: t.exists, note: SHARED_NOTE[provider] };
  }

  function readManifest() {
    try {
      const data = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      if (data && Array.isArray(data.items)) {
        return data.items.filter(i => i && PROVIDERS.includes(i.provider) && typeof i.name === 'string' && NAME_RE.test(i.name) && typeof i.target === 'string' && typeof i.source === 'string');
      }
    } catch (err) { /* missing or damaged: empty */ }
    return [];
  }
  function writeManifest(items) {
    const dir = path.dirname(manifestFile);
    fs.mkdirSync(dir, { recursive: true });
    const realData = fs.realpathSync(dataDir);
    if (!within(fs.realpathSync(dir), realData)) throw fail('Der Einstellungsordner liegt außerhalb des App-Datenordners.');
    const tmp = manifestFile + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, manifestFile);
    } finally { try { fs.rmSync(tmp, { force: true }); } catch (err) { /* renamed */ } }
  }

  function linkIntact(entry) {
    try { return fs.lstatSync(entry.target).isSymbolicLink() && fs.readlinkSync(entry.target) === entry.source; }
    catch (err) { return false; }
  }

  // 'app' (link made here and intact), 'changed' (recorded but different), 'none'.
  function stateOf(provider, name) {
    check(provider);
    const entry = readManifest().find(i => i.provider === provider && i.name === name);
    if (!entry) return 'none';
    return linkIntact(entry) ? 'app' : 'changed';
  }
  function list(provider) {
    return readManifest().filter(i => !provider || i.provider === provider).map(i => ({ ...i, state: linkIntact(i) ? 'app' : 'changed' }));
  }

  function assign({ provider, sourceDir, name }) {
    check(provider);
    const skillName = name !== undefined ? name : path.basename(String(sourceDir || ''));
    checkName(skillName);
    let source;
    try {
      source = fs.realpathSync(sourceDir);
      if (!fs.statSync(source).isDirectory() || !fs.statSync(path.join(source, 'SKILL.md')).isFile()) throw new Error();
    } catch (err) { throw fail('Die Quelle ist kein Skill-Ordner mit SKILL.md.'); }
    const dir = targetDir(provider);
    if (within(source, dir.path)) throw fail('Der Skill liegt schon im Skill-Ordner dieses Agenten.');
    if (readManifest().some(i => i.provider === provider && i.name === skillName)) throw fail('Dieser Skill ist diesem Agenten bereits zugeordnet.', 'app');
    const link = path.join(dir.path, skillName);
    let exists = true;
    try { fs.lstatSync(link); } catch (err) { if (err.code === 'ENOENT') exists = false; else throw err; }
    if (exists) throw fail(`Im Zielordner gibt es bereits „${skillName}“ (${link}). Es wird nichts überschrieben.`, 'native');
    if (!dir.exists) fs.mkdirSync(dir.path, { recursive: true });
    fs.symlinkSync(source, link);
    try {
      writeManifest([...readManifest(), { provider, name: skillName, target: link, source, createdAt: new Date().toISOString() }]);
    } catch (err) {
      try { fs.unlinkSync(link); } catch (e) { /* link stays out of the manifest only if this fails too */ }
      throw err;
    }
    return { ok: true, state: 'app', target: link, source };
  }

  function unassign({ provider, name }) {
    check(provider);
    checkName(name);
    const items = readManifest();
    const entry = items.find(i => i.provider === provider && i.name === name);
    if (!entry) throw fail('Diese Zuordnung stammt nicht von Multiterminal. Es wird nichts entfernt.', 'none');
    let present = true;
    try { fs.lstatSync(entry.target); } catch (err) { if (err.code === 'ENOENT') present = false; else throw err; }
    if (present && !linkIntact(entry)) throw fail(`Der Eintrag ${entry.target} wurde verändert (kein Link auf die gemerkte Quelle). Es wird nichts entfernt.`, 'changed');
    if (present) fs.unlinkSync(entry.target);
    writeManifest(items.filter(i => i !== entry));
    return { ok: true, state: 'none', target: entry.target, wasMissing: !present };
  }

  return { target, stateOf, list, assign, unassign };
}

module.exports = { createExtensionManager, NATIVE_SKILLS, PROVIDERS };
