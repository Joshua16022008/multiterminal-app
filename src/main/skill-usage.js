'use strict';

// Ermittelt aus lokalen Sitzungsprotokollen, welche Skills tatsächlich genutzt wurden.
// Liefert nur die dritte Stufe (Fund / Aktivierung / Ausführung): den Beleg im Protokoll.
//   Claude: evidence 'executed' – Skill-Tool-Aufruf oder Slash-Befehl.
//   Codex:  evidence 'read'     – nur belegt, dass ein Tool-Aufruf einen SKILL.md-Pfad nennt.
//   Kimi / unbekannt: evidence 'none', kein Scan.
// Der Zwischenspeicher enthält ausschließlich Skill-Namen, Zähler und Zeitpunkte.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

const CACHE_VERSION = 1;
const MAX_CLAUDE_FILES = 200;
const MAX_CODEX_FILES = 40;
const MAX_BYTES_PER_FILE = 8 * 1024 * 1024;
const MAX_BYTES_TOTAL = 160 * 1024 * 1024;

const DEFAULT_LIMITS = Object.freeze({
  claudeFiles: MAX_CLAUDE_FILES,
  codexFiles: MAX_CODEX_FILES,
  bytesPerFile: MAX_BYTES_PER_FILE,
  bytesTotal: MAX_BYTES_TOTAL
});

const PROVIDERS = {
  claude: { dir: '.claude', sub: 'projects', match: (n) => n.endsWith('.jsonl'), evidence: 'executed' },
  codex: { dir: '.codex', sub: 'sessions', match: (n) => /^rollout-.*\.jsonl$/.test(n), evidence: 'read' }
};

const COMMAND_RE = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/;
const CODEX_SKILL_RE = /skills\/([A-Za-z0-9_.:-]+)\/SKILL\.md/g;
const CODEX_CALL_TYPES = new Set(['function_call', 'custom_tool_call', 'local_shell_call']);

function cleanName(name) {
  return String(name || '').trim().replace(/^\/+/, '');
}

// Regel: Vergleich ohne Groß-/Kleinschreibung und ohne Plugin-Präfix (alles bis zum letzten ':').
function baseName(name) {
  const n = cleanName(name).toLowerCase();
  const i = n.lastIndexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
}

function addHit(skills, name, ts) {
  const key = cleanName(name);
  if (!key) return;
  const e = skills[key] || (skills[key] = { count: 0, lastUsedAt: 0 });
  e.count += 1;
  if (ts > e.lastUsedAt) e.lastUsedAt = ts;
}

function timeOf(o) {
  const t = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
  return '';
}

function handleClaudeLine(line, skills, seenIds) {
  const tool = line.includes('"name":"Skill"');
  const cmd = line.includes('<command-name>');
  if (!tool && !cmd) return;
  let o;
  try { o = JSON.parse(line); } catch { return; }
  if (!o || typeof o !== 'object') return;
  const content = o.message && o.message.content;
  if (tool && o.type === 'assistant' && Array.isArray(content)) {
    for (const b of content) {
      if (!b || b.type !== 'tool_use' || b.name !== 'Skill' || !b.input || typeof b.input.skill !== 'string') continue;
      if (b.id) { if (seenIds.has(b.id)) continue; seenIds.add(b.id); }
      addHit(skills, b.input.skill, timeOf(o));
    }
  } else if (cmd && o.type === 'user') {
    const m = COMMAND_RE.exec(textOf(content));
    if (m) addHit(skills, m[1], timeOf(o));
  }
}

function handleCodexLine(line, skills) {
  if (!line.includes('/SKILL.md')) return;
  let o;
  try { o = JSON.parse(line); } catch { return; }
  const pl = o && o.payload;
  if (!pl || o.type !== 'response_item' || !CODEX_CALL_TYPES.has(pl.type)) return;
  const text = JSON.stringify(pl.arguments || pl.input || pl.action || '');
  const names = new Set();
  for (const m of text.matchAll(CODEX_SKILL_RE)) names.add(m[1]);
  for (const n of names) addHit(skills, n, timeOf(o));
}

async function realOrNull(p) {
  try { return await fs.promises.realpath(p); } catch { return null; }
}

// Läuft ohne Symlinks zu folgen; liefert nur reguläre Dateien unterhalb von root.
async function walk(root, match) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && match(e.name)) out.push(full);
    }
  }
  return out;
}

async function readFileHits(file, size, provider, bytesPerFile) {
  const skills = {};
  const seenIds = new Set();
  const start = Math.max(0, size - bytesPerFile);
  const stream = fs.createReadStream(file, { start, end: Math.max(start, size - 1), encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let first = start > 0; // erste Zeile ist dann angeschnitten
  try {
    for await (const line of rl) {
      if (first) { first = false; continue; }
      if (provider === 'claude') handleClaudeLine(line, skills, seenIds);
      else handleCodexLine(line, skills);
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return skills;
}

function emptyResult(provider, evidence, note, now) {
  return { provider, evidence, skills: {}, scannedFiles: 0, skippedFiles: 0, truncated: false, scannedAt: now(), note };
}

function createSkillUsage({ cacheFile, homeDir = os.homedir(), now = Date.now, limits } = {}) {
  const lim = { ...DEFAULT_LIMITS, ...(limits || {}) };

  async function loadCache() {
    if (!cacheFile) return { version: CACHE_VERSION, files: {} };
    try {
      const c = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8'));
      if (c && c.version === CACHE_VERSION && c.files && typeof c.files === 'object') return c;
    } catch { /* fehlt oder kaputt: verwerfen */ }
    return { version: CACHE_VERSION, files: {} };
  }

  async function saveCache(cache) {
    if (!cacheFile) return;
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    try {
      await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.promises.writeFile(tmp, JSON.stringify(cache));
      await fs.promises.rename(tmp, cacheFile);
    } catch {
      try { await fs.promises.unlink(tmp); } catch { /* nichts zu tun */ }
    }
  }

  async function scan({ provider, configDirs } = {}) {
    const spec = PROVIDERS[provider];
    if (!spec) {
      return emptyResult(provider, 'none', 'Für diesen Anbieter gibt es keine belegte Protokollquelle; die Nutzung wird nicht erfasst.', now);
    }
    const dirs = Array.isArray(configDirs) && configDirs.length ? configDirs : [path.join(homeDir, spec.dir)];
    const roots = new Set();
    for (const d of dirs) {
      const r = await realOrNull(path.join(d, spec.sub));
      if (r) roots.add(r);
    }

    const candidates = [];
    for (const root of roots) {
      for (const f of await walk(root, spec.match)) {
        try {
          const st = await fs.promises.stat(f);
          candidates.push({ file: f, size: st.size, mtimeMs: st.mtimeMs });
        } catch { /* verschwunden */ }
      }
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const maxFiles = provider === 'claude' ? lim.claudeFiles : lim.codexFiles;
    const chosen = candidates.slice(0, maxFiles);
    let truncated = candidates.length > chosen.length;
    let skippedFiles = candidates.length - chosen.length;

    const cache = await loadCache();
    const old = cache.files[provider] || {};
    const fresh = {};
    let bytesUsed = 0;
    let scannedFiles = 0;
    let anyCut = false;

    for (const c of chosen) {
      const hit = old[c.file];
      let skills;
      if (hit && hit.size === c.size && hit.mtimeMs === c.mtimeMs) {
        skills = hit.skills;
      } else {
        const cost = Math.min(c.size, lim.bytesPerFile);
        if (bytesUsed + cost > lim.bytesTotal) {
          truncated = true;
          skippedFiles += 1;
          continue;
        }
        bytesUsed += cost;
        try {
          skills = await readFileHits(c.file, c.size, provider, lim.bytesPerFile);
        } catch {
          skippedFiles += 1;
          continue;
        }
        fresh[c.file] = { size: c.size, mtimeMs: c.mtimeMs, skills };
      }
      if (!fresh[c.file]) fresh[c.file] = { size: c.size, mtimeMs: c.mtimeMs, skills };
      if (c.size > lim.bytesPerFile) { truncated = true; anyCut = true; }
      scannedFiles += 1;
    }

    cache.files[provider] = fresh;
    await saveCache(cache);

    const merged = {};
    for (const entry of Object.values(fresh)) {
      for (const [name, e] of Object.entries(entry.skills)) {
        const m = merged[name] || (merged[name] = { count: 0, lastUsedAt: 0, sessions: 0 });
        m.count += e.count;
        m.sessions += 1;
        if (e.lastUsedAt > m.lastUsedAt) m.lastUsedAt = e.lastUsedAt;
      }
    }

    const parts = [];
    if (provider === 'codex') parts.push('Codex protokolliert kein Skill-Ereignis; belegt ist nur, dass ein Tool-Aufruf einen SKILL.md-Pfad nennt (nicht, ob gelesen oder ausgeführt).');
    if (roots.size === 0) parts.push('Kein Protokollordner gefunden.');
    if (candidates.length > chosen.length) parts.push(`Nur die ${chosen.length} jüngsten von ${candidates.length} Protokolldateien ausgewertet.`);
    if (anyCut) parts.push('Sehr große Dateien wurden nur in ihrem letzten Abschnitt ausgewertet.');
    if (skippedFiles > Math.max(0, candidates.length - chosen.length)) parts.push('Wegen der Größenobergrenze wurden einzelne Dateien übersprungen.');

    return {
      provider,
      evidence: spec.evidence,
      skills: merged,
      scannedFiles,
      skippedFiles,
      truncated,
      scannedAt: now(),
      note: parts.join(' ')
    };
  }

  return { scan };
}

// Sucht einen Skill im Scan-Ergebnis. Regel: Vergleich ohne Groß-/Kleinschreibung und ohne
// Plugin-Präfix (`plugin:skill` und `skill` sind derselbe Skill); alle Treffer werden summiert.
// Liefert { count, lastUsedAt, sessions } oder null.
function forSkill(result, name) {
  if (!result || !result.skills) return null;
  const want = baseName(name);
  if (!want) return null;
  let found = null;
  for (const [key, e] of Object.entries(result.skills)) {
    if (baseName(key) !== want) continue;
    found = found || { count: 0, lastUsedAt: 0, sessions: 0 };
    found.count += e.count;
    found.sessions += e.sessions;
    if (e.lastUsedAt > found.lastUsedAt) found.lastUsedAt = e.lastUsedAt;
  }
  return found;
}

module.exports = {
  createSkillUsage,
  forSkill,
  DEFAULT_LIMITS,
  MAX_CLAUDE_FILES,
  MAX_CODEX_FILES,
  MAX_BYTES_PER_FILE,
  MAX_BYTES_TOTAL
};
