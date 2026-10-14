'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createExtensionManager } = require('./extension-manager');
const { createSkillUsage, forSkill } = require('./skill-usage');
const SCOPES = ['claude', 'codex', 'kimi'];
const MAX_BYTES = 128 * 1024;
const MAX_ENTRIES = 600;
const MAX_DEPTH = 7;
const within = (child, root) => child === root || child.startsWith(root + path.sep);
const DOCS = new Set(['SKILL.md', 'README.md', 'CLAUDE.md', 'AGENTS.md']);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
// Native config folder per provider (Kimi Code keeps its files under ~/.kimi-code).
const NATIVE_DIR = { claude: '.claude', codex: '.codex', kimi: '.kimi-code' };
const PROVIDER_NAMES = { claude: 'Claude Code', codex: 'Codex', kimi: 'Kimi' };
const APP_SOURCE = 'Multiterminal / app-only';
// Longest time the overview waits for a first (uncached) usage scan; it then continues in the background.
const USAGE_WAIT_MS = 1500;
function createSettingsService({ dataDir, homeDir = os.homedir(), loadsAtStart = () => false, skillUsage, extensions, usageWaitMs = USAGE_WAIT_MS }) {
  if (!dataDir) throw new Error('Datenordner fehlt.');
  const manager = extensions || createExtensionManager({ dataDir, homeDir });
  let usageService = skillUsage;
  const inflight = new Map();
  const registry = new Map();
  function profilePath(scope) {
    if (!SCOPES.includes(scope)) throw new Error('Unbekannter Profilbereich.');
    return path.join(dataDir, 'settings', scope, 'profile.md');
  }
  function readText(file) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Dokument fehlt oder ist zu groß.');
    return fs.readFileSync(file, 'utf8');
  }
  function readProfile(scope) {
    const file = profilePath(scope);
    let text = '', exists = false;
    try { if (!within(fs.realpathSync(path.dirname(file)), fs.realpathSync(dataDir))) throw new Error('Profilordner liegt außerhalb des App-Datenordners.'); if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Profil darf kein symbolischer Link sein.'); text = readText(file); exists = true; } catch (err) { if (err.code !== 'ENOENT') throw err; }
    return { scope, text, path: file, revision: hash(text), exists, appliesTo: loadsAtStart(scope) ? 'start-flag' : 'app-only', loadAtStart: loadsAtStart(scope) === true };
  }
  function ensureFolders(scope) {
    const providerDir = path.dirname(profilePath(scope));
    fs.mkdirSync(dataDir, { recursive: true });
    const realData = fs.realpathSync(dataDir);
    for (const component of [path.join(dataDir, 'settings'), providerDir, ...['skills', 'plugins', 'mods', 'library'].map(name => path.join(providerDir, name))]) {
      if (fs.existsSync(component)) {
        if (!within(fs.realpathSync(component), realData) || !fs.statSync(component).isDirectory()) throw new Error('Profilordner liegt außerhalb des App-Datenordners oder ist kein Ordner.');
      } else {
        if (!within(fs.realpathSync(path.dirname(component)), realData)) throw new Error('Profilordner liegt außerhalb des App-Datenordners.');
        fs.mkdirSync(component);
      }
    }
    return { path: providerDir };
  }
  function saveProfile(scope, text, expectedRevision) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES || text.includes('\0')) throw new Error('Ungültiger oder zu großer Profiltext.');
    const current = readProfile(scope);
    if (expectedRevision !== current.revision) {
      const err = new Error('Das Profil wurde inzwischen geändert. Bitte neu laden.'); err.code = 'REVISION_CONFLICT'; throw err;
    }
    ensureFolders(scope);
    const tmp = current.path + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, current.path); }
    finally { try { fs.unlinkSync(tmp); } catch {} }
    return readProfile(scope);
  }
  function register(file, readable = false, identity = '') {
    const id = hash(path.resolve(file) + identity);
    let real; try { real = fs.realpathSync(file); } catch { return id; }
    registry.set(id, { path: file, real, readable }); return id;
  }
  function resource(id) {
    const item = registry.get(id);
    if (!item) throw new Error('Unbekannte Ressource. Übersicht neu laden.');
    if (fs.realpathSync(item.path) !== item.real) throw new Error('Ressourcenpfad wurde geändert.');
    return item;
  }
  function readResource(id) {
    const item = resource(id);
    if (!item.readable) throw new Error('Diese Ressource ist kein freigegebenes Textdokument.');
    return { id, path: item.path, text: readText(item.path) };
  }
  function revealPath(id) { return resource(id).path; }
  // Without usage data; `overview` adds it asynchronously.
  function overviewSync({ projectPath, accounts = [] } = {}) {
    registry.clear();
    const providers = ['claude', 'codex', 'kimi'].map(provider => {
      const base = path.join(homeDir, NATIVE_DIR[provider]);
      const model = { id: provider, name: { claude: 'Claude Code', codex: 'Codex', kimi: 'Kimi' }[provider], profile: readProfile(provider), roots: [], categories: { skills: [], plugins: [], mods: [], libraries: [] }, instructions: [], notes: ['Gefunden bedeutet nicht aktiviert oder verwendet. Nutzung unbekannt.', 'Persönliche Profile gelten nur in Multiterminal und werden nur beim Start aus Multiterminal geladen, wenn der Schalter an ist.'] };
      const seenItems = new Set();
      function add(file, category, source, status = 'found', externalLink = false) {
        if (seenItems.has(file)) return; seenItems.add(file);
        let stat; try { stat = fs.statSync(file); } catch { return; }
        const readable = !externalLink && stat.isFile() && DOCS.has(path.basename(file)) && stat.size <= MAX_BYTES;
        model.categories[category].push({ id: register(file, readable), name: stat.isDirectory() ? path.basename(file) : path.basename(path.dirname(file)), path: file, source, status, readable, usage: 'unknown', ...(externalLink ? { description: 'Externer symbolischer Link; keine Textvorschau.' } : {}) });
      }
      function scan(root, category, source) {
        const exists = fs.existsSync(root);
        model.roots.push({ id: register(root), label: source, path: root, exists });
        if (!exists) return;
        const visited = new Set();
        let count = 0;
        function walk(dir, depth) {
          if (depth > MAX_DEPTH || count >= MAX_ENTRIES) return;
          let real, entries; try { real = fs.realpathSync(dir); if (!within(real, fs.realpathSync(root)) || visited.has(real)) return; visited.add(real); entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)); } catch { return; }
          for (const entry of entries) {
            if (/^(node_modules|\.git|dist|build|assets|tests?|__tests__|__pycache__|\.cache|sessions|history|credentials|auth|logs|debug|projects|telemetry)$/i.test(entry.name)) continue;
            if (!DOCS.has(entry.name) && !entry.isDirectory() && !entry.isSymbolicLink()) continue;
            if (++count > MAX_ENTRIES) { if (!model.notes.includes('Scan-Grenze erreicht: ' + root)) model.notes.push('Scan-Grenze erreicht: ' + root); break; }
            const file = path.join(dir, entry.name);
            if (category === 'plugins' && entry.isDirectory()) {
              for (const marker of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
                const manifest = path.join(file, marker);
                try {
                  const metadata = JSON.parse(readText(manifest));
                  const name = typeof metadata.name === 'string' && metadata.name.length <= 120 ? metadata.name : path.basename(file);
                  const item = { id: register(file), name, path: file, source: source + ' / plugin.json', status: 'found', readable: false, usage: 'unknown' };
                  if (!seenItems.has(file)) { seenItems.add(file); model.categories.plugins.push(item); }
                  break;
                } catch {}
              }
            }
            if (DOCS.has(entry.name) && (!(category === 'plugins' || category === 'libraries') || entry.name === 'SKILL.md' || depth === 0)) { try { const external = !within(fs.realpathSync(file), fs.realpathSync(root)); add(file, entry.name === 'SKILL.md' ? 'skills' : category, source, 'found', external); } catch {} }
            else if (entry.isDirectory() || entry.isSymbolicLink()) {
              if (depth === 0 && category === 'libraries') {
                try { add(file, category, source, 'found', entry.isSymbolicLink() && !within(fs.realpathSync(file), fs.realpathSync(root))); } catch {}
              }
              // Follow only curated trees, never descend credential/session stores.
              if (/^(sessions|history|credentials|auth|logs|debug|projects|telemetry)$/i.test(entry.name)) continue;
              try {
                if (entry.isSymbolicLink() && !within(fs.realpathSync(file), fs.realpathSync(root))) add(file, category, source, 'found', true);
                else walk(file, depth + 1);
              } catch {}
            }
          }
        }
        walk(root, 0);
      }
      const managed = path.join(dataDir, 'settings', provider);
      scan(path.join(managed, 'skills'), 'skills', 'Multiterminal / app-only');
      scan(path.join(managed, 'plugins'), 'plugins', 'Multiterminal / app-only');
      scan(path.join(managed, 'mods'), 'mods', 'Multiterminal / app-only');
      scan(path.join(managed, 'library'), 'libraries', 'Multiterminal / app-only');
      const accountGroups = Array.isArray(accounts) ? accounts : [];
      const dirs = [{ folder: base, label: 'Benutzer' }];
      for (const group of accountGroups) {
        if (group.provider !== provider) continue;
        for (const account of group.accounts || [group]) if (typeof account.folder === 'string' && !dirs.some(d => d.folder === account.folder)) dirs.push({ folder: account.folder, label: 'Konto: ' + (account.label || account.id || provider) });
      }
      for (const dir of dirs) {
        scan(path.join(dir.folder, 'skills'), 'skills', dir.label);
        scan(path.join(dir.folder, 'mods'), 'mods', dir.label);
        scan(path.join(dir.folder, 'plugins', 'cache'), 'plugins', dir.label);
        scan(path.join(dir.folder, 'plugins', 'marketplaces'), 'libraries', dir.label);
        scan(path.join(dir.folder, 'library'), 'libraries', dir.label);
        const instruction = provider === 'claude' ? 'CLAUDE.md' : provider === 'codex' ? 'AGENTS.md' : null;
        if (instruction) {
          const file = path.join(dir.folder, instruction);
          try {
            const stat = fs.statSync(file);
            if (stat.isFile() && within(fs.realpathSync(file), fs.realpathSync(dir.folder))) model.instructions.push({ id: register(file, stat.size <= MAX_BYTES), name: instruction, path: file, source: dir.label, status: 'native-file', readable: stat.size <= MAX_BYTES, usage: 'unknown' });
          } catch {}
        }
        // Parse only plugin metadata, never return raw settings or other config.
        if (provider === 'claude') {
          let enabled = {}, installed = {};
          try {
            const settingsFile = path.join(dir.folder, 'settings.json');
            const settings = JSON.parse(readText(settingsFile)); enabled = settings.enabledPlugins || {};
            for (const key of ['hooks', 'statusLine']) if (settings[key] && typeof settings[key] === 'object') model.categories.mods.push({ id: register(settingsFile, false, ':integration:' + key), name: key === 'hooks' ? 'Claude Hooks' : 'Claude Statuszeile', path: settingsFile, source: dir.label + ' / settings.json', status: 'configured', readable: false, usage: 'unknown', description: 'Konfiguration vorhanden; tatsächliche Ausführung unbekannt.' });
          } catch {}
          try { installed = JSON.parse(readText(path.join(dir.folder, 'plugins', 'installed_plugins.json'))).plugins || {}; } catch {}
          for (const name of Object.keys(installed).slice(0, MAX_ENTRIES)) {
            const entries = Array.isArray(installed[name]) ? installed[name] : [installed[name]];
            const entry = entries.find(e => e && typeof e.installPath === 'string');
            const pluginRoot = path.join(dir.folder, 'plugins');
            const file = entry && within(path.resolve(entry.installPath), path.resolve(pluginRoot)) ? entry.installPath : pluginRoot;
            const item = { id: register(file, false, ':plugin:' + name), name, path: file, source: dir.label + ' / installed_plugins.json', status: enabled[name] === true ? 'enabled' : enabled[name] === false ? 'disabled' : 'installed', readable: false, usage: 'unknown' };
            const existing = entry ? model.categories.plugins.findIndex(p => path.resolve(p.path) === path.resolve(file)) : -1;
            if (existing >= 0) model.categories.plugins[existing] = item; else model.categories.plugins.push(item);
          }
        }
      }
      if (provider === 'codex' || provider === 'kimi') scan(path.join(homeDir, '.agents', 'skills'), 'skills', 'Gemeinsame Agent-Skills');
      if (projectPath) {
        scan(path.join(projectPath, NATIVE_DIR[provider], 'skills'), 'skills', 'Projekt');
        if (provider === 'codex' || provider === 'kimi') scan(path.join(projectPath, '.agents', 'skills'), 'skills', 'Projekt / gemeinsame Agent-Skills');
      }
      if (provider === 'kimi') model.notes.push('Native Kimi-Anweisungs- und Plugin-Semantik nicht verifiziert; Dateien sind ausschließlich lokale Funde.');
      return model;
    });
    annotateSkills(providers);
    return { providers, limits: { maxEntries: MAX_ENTRIES, maxDepth: MAX_DEPTH, maxDocumentBytes: MAX_BYTES } };
  }
  // The folder of a skill entry: SKILL.md files point to their parent, links already are folders.
  function skillDir(item) {
    try { return fs.statSync(item.path).isDirectory() ? item.path : path.basename(item.path) === 'SKILL.md' ? path.dirname(item.path) : null; } catch { return null; }
  }
  // Activation per agent: native (found in its own folders), app (assigned here), changed, none.
  function annotateSkills(providers) {
    for (const model of providers) {
      const target = manager.target(model.id);
      model.skillTarget = { path: target.path, exists: target.exists, note: target.note };
      const own = new Set();
      for (const item of model.categories.skills) {
        const state = manager.stateOf(model.id, item.name);
        item.activation = state === 'app' || state === 'changed' ? state : item.source === APP_SOURCE ? 'none' : 'native';
        item.assignable = item.activation === 'none' && skillDir(item) !== null;
        if (item.assignable) item.assignTarget = path.join(target.path, item.name);
        if (item.activation !== 'none') own.add(item.name);
      }
      model.candidates = [];
      const seen = new Set();
      for (const other of providers) {
        if (other.id === model.id) continue;
        for (const item of other.categories.skills) {
          if (item.source === APP_SOURCE || own.has(item.name) || seen.has(item.name) || manager.stateOf(other.id, item.name) !== 'none' || skillDir(item) === null) continue;
          seen.add(item.name);
          model.candidates.push({ id: item.id, name: item.name, path: item.path, source: item.source, from: PROVIDER_NAMES[other.id], activation: 'none', assignable: true, assignTarget: path.join(target.path, item.name) });
        }
      }
      // Items of the app library that are already assigned would also be offered by the other agents.
      model.candidates = model.candidates.filter(c => !own.has(c.name));
    }
  }
  function configDirsFor(model, accounts) {
    const dirs = [path.join(homeDir, NATIVE_DIR[model.id])];
    for (const group of Array.isArray(accounts) ? accounts : []) {
      if (group.provider !== model.id) continue;
      for (const account of group.accounts || [group]) if (typeof account.folder === 'string' && !dirs.includes(account.folder)) dirs.push(account.folder);
    }
    return dirs;
  }
  function usageScan(provider, configDirs) {
    if (!usageService) {
      let cacheFile = path.join(dataDir, 'settings', 'skill-usage-cache.json');
      try { if (fs.lstatSync(path.dirname(cacheFile)).isSymbolicLink()) cacheFile = undefined; } catch {}
      usageService = createSkillUsage({ cacheFile, homeDir });
    }
    const key = provider + '\0' + configDirs.join('\0');
    if (!inflight.has(key)) inflight.set(key, Promise.resolve().then(() => usageService.scan({ provider, configDirs })).finally(() => inflight.delete(key)));
    return inflight.get(key);
  }
  // Adds evidence of use to the skills. A failing or slow scan never blocks the overview.
  async function overview(options = {}) {
    const result = overviewSync(options);
    await Promise.all(result.providers.map(async model => {
      let scan = null, status = 'ready';
      try {
        const pending = usageScan(model.id, configDirsFor(model, options.accounts));
        pending.catch(() => {});
        scan = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve(null), usageWaitMs).unref())]);
        if (!scan) status = 'pending';
      } catch { status = 'failed'; }
      model.usage = { status, evidence: scan ? scan.evidence : 'none', scannedFiles: scan ? scan.scannedFiles : 0, skippedFiles: scan ? scan.skippedFiles : 0, truncated: scan ? scan.truncated : false, scannedAt: scan ? scan.scannedAt : null, note: scan ? scan.note || '' : status === 'pending' ? 'Die Nutzungsauswertung läuft noch; beim nächsten Aktualisieren ist sie fertig.' : 'Die Nutzungsauswertung ist fehlgeschlagen.' };
      for (const item of model.categories.skills) {
        if (!scan) { item.usage = { evidence: status, count: 0, lastUsedAt: 0, sessions: 0 }; continue; }
        const hit = scan.evidence === 'none' ? null : forSkill(scan, item.name);
        item.usage = { evidence: scan.evidence, count: hit ? hit.count : 0, lastUsedAt: hit ? hit.lastUsedAt : 0, sessions: hit ? hit.sessions : 0 };
      }
    }));
    return result;
  }
  function assignSkill(provider, id) {
    const item = resource(id), real = item.path;
    let dir;
    try { dir = fs.statSync(real).isDirectory() ? real : path.basename(real) === 'SKILL.md' ? path.dirname(real) : null; } catch { dir = null; }
    if (!dir) throw new Error('Diese Ressource ist kein Skill-Ordner.');
    return manager.assign({ provider, sourceDir: dir });
  }
  function unassignSkill(provider, name) { return manager.unassign({ provider, name }); }
  return { overview, overviewSync, assignSkill, unassignSkill, readProfile, saveProfile, ensureFolders, readResource, revealPath };
}
module.exports = { createSettingsService };
