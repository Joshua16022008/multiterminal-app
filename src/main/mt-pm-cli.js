'use strict';

// `mt-pm`: Werkzeug des Projektmanager-Agenten in Multiterminal. Liest Lagebild, Ausgaben,
// Änderungen, Ports und Dokumente des Projekts und legt Aufträge als Promptvorschau in
// Kacheln (der Nutzer bestätigt). Keine Abhängigkeiten; läuft mit node und mit
// ELECTRON_RUN_AS_NODE=1 <electron>. Die Logik ist als reine Funktionen exportiert.

const net = require('net');

const TIMEOUT_MS = 40000;

const HELP = `mt-pm - Werkzeug des Projektmanagers in Multiterminal

Du bist der Projektmanager dieses Projekts. Mit mt-pm siehst du, was in den Kacheln
passiert, und kannst Aufträge vorschlagen. Es funktioniert nur im Manager-Fenster.

Aufruf:
  mt-pm status                    Lagebild: Kacheln mit Agentenzustand, Arbeitskopien,
                                  Änderungen, Ports, nächster Schritt.
  mt-pm output <kachel> [--lines N]
                                  Letzte Zeilen einer Kachel (ID oder exakter Titel;
                                  Standard 50, höchstens 500), ohne Farb- und Steuercodes.
  mt-pm changes                   Git-Änderungen des Projektordners und der Arbeitskopien.
  mt-pm ports                     Lauschende Ports des Projekts.
  mt-pm docs                      PROGRESS.md, WORK_IN_PROGRESS.md, PROJECT_STATUS.md und
                                  Git-Verlauf/Branches.
  mt-pm send <kachel> <text...>   Auftrag an eine Kachel. Er erscheint dort nur als Vorschau;
                                  der Nutzer bestätigt, erst dann wird etwas eingefügt.
  mt-pm help                      Dieser Text.

Option --json gibt die Rohdaten aus. Ausgabe auf stdout; Fehler auf stderr mit Exit-Code 1.
Exit-Code 2 heißt: falsch aufgerufen oder nicht im Manager-Fenster.
`;

const SIMPLE = ['status', 'changes', 'ports', 'docs'];

// argv ohne node und Skriptpfad -> { help } | { cmd, args, json } | { error }
function parseArgs(argv) {
  let json = false;
  const rest = [];
  for (const a of argv) {
    if (a === '--json') json = true;
    else rest.push(a);
  }
  const [cmd, ...params] = rest;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') return { help: true };
  if (SIMPLE.includes(cmd)) {
    if (params.length) return { error: `mt-pm ${cmd} erwartet keine Argumente.` };
    return { cmd, args: {}, json };
  }
  if (cmd === 'output') {
    let lines;
    const free = [];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      let value = null;
      if (p === '--lines' || p === '-n') value = params[++i];
      else if (p.startsWith('--lines=')) value = p.slice(8);
      else { free.push(p); continue; }
      if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 500) return { error: '--lines braucht eine ganze Zahl von 1 bis 500.' };
      lines = Number(value);
    }
    if (free.length !== 1) return { error: 'Aufruf: mt-pm output <kachel> [--lines N]' };
    return { cmd, args: lines ? { terminal: free[0], lines } : { terminal: free[0] }, json };
  }
  if (cmd === 'send') {
    if (params.length < 2) return { error: 'Aufruf: mt-pm send <kachel> <text...>' };
    const text = params.slice(1).join(' ').trim();
    if (!text) return { error: 'Der Auftragstext ist leer.' };
    return { cmd, args: { terminal: params[0], text }, json };
  }
  return { error: `Unbekannter Befehl: ${cmd}. Siehe mt-pm help.` };
}

// Gibt die Anfragezeile (ohne Zeilenumbruch) zurück oder einen Fehler bei fehlender Umgebung.
function buildRequest(env, parsed) {
  const sock = env.MULTITERMINAL_PM_SOCKET;
  const token = env.MULTITERMINAL_PM_TOKEN;
  if (!sock || !token) return { error: 'Nur im Projektmanager-Fenster von Multiterminal verfügbar.' };
  return { sock, line: JSON.stringify({ token, cmd: parsed.cmd, args: parsed.args }) };
}

const STATE_LABEL = {
  working: 'arbeitet',
  'needs-input': 'wartet auf dich',
  'turn-complete': 'Antwort fertig',
  error: 'Fehler',
  unknown: 'unbekannt',
};

function time(ms) {
  if (!Number.isFinite(ms)) return 'unbekannt';
  try { return new Date(ms).toLocaleString('de-DE'); } catch (_) { return String(ms); }
}

function agentText(agent, statusEnabled) {
  if (!agent) return statusEnabled === false ? 'Agentenzustand unbekannt (Agentenstatus aus)' : 'kein Agentenereignis';
  const provider = agent.provider || 'Agent';
  const since = agent.since ? ` (seit ${time(agent.since)})` : '';
  return `${provider}: ${STATE_LABEL[agent.state] || 'unbekannt'}${since}`;
}

function formatStatus(s) {
  const out = [];
  out.push(`Projekt: ${s.project.name} (${s.project.path})`);
  out.push(`Stand: ${time(s.capturedAt)}`);
  out.push('');
  out.push(`Kacheln (${s.terminals.length}):`);
  if (!s.terminals.length) out.push('  keine');
  for (const t of s.terminals) {
    const ws = t.workspace ? `, Arbeitskopie ${t.workspace.branch || t.workspace.workspaceId}` : '';
    out.push(`  - ${t.title} [${t.id}] ${t.running ? 'läuft' : 'beendet'}; ${agentText(t.agent, s.agentStatusEnabled)}${t.preset ? `; Vorgabe ${t.preset}` : ''}${ws}`);
  }
  out.push('');
  out.push(`Arbeitskopien (${s.worktrees.length}):`);
  if (!s.worktrees.length) out.push('  keine');
  for (const w of s.worktrees) {
    const n = w.missing ? 'Ordner fehlt' : (w.changedFiles === null ? 'Änderungen unbekannt' : `${w.changedFiles} geänderte Dateien`);
    out.push(`  - ${w.branch || w.workspaceId} [${w.workspaceId}]: ${n}`);
  }
  out.push('');
  out.push(s.changes && s.changes.ok
    ? `Änderungen im Projektordner (${s.changes.branch || 'Branch unbekannt'}): ${s.changes.staged} vorgemerkt, ${s.changes.unstaged} geändert, ${s.changes.untracked} neu`
    : `Änderungen im Projektordner: nicht lesbar (${(s.changes && s.changes.error) || 'unbekannt'})`);
  out.push('');
  out.push(`Ports (${s.ports.length}):`);
  if (!s.ports.length) out.push('  keine');
  for (const p of s.ports) out.push(`  - ${p.port}${p.url ? ' ' + p.url : ''}${p.terminalId ? ` (Kachel ${p.terminalId})` : ' (Kachel unbekannt)'}`);
  out.push('');
  out.push(`Nächster Schritt (PROJECT_STATUS.md): ${s.docs.nextStep || 'unbekannt'}`);
  out.push(`Aktive Reservierungen (WORK_IN_PROGRESS.md): ${s.docs.activeReservations === null ? 'unbekannt' : s.docs.activeReservations}`);
  out.push(`Manager: ${s.manager.running ? 'läuft' : 'läuft nicht'}${s.manager.resumed ? ', Fortsetzung des Gesprächs angefordert' : ''}`);
  return out.join('\n');
}

function formatChanges(r) {
  const out = [];
  const c = r.changes;
  out.push(c && c.ok
    ? `Projektordner (${c.branch || 'Branch unbekannt'}): ${c.staged} vorgemerkt, ${c.unstaged} geändert, ${c.untracked} neu`
    : `Projektordner: nicht lesbar (${(c && c.error) || 'unbekannt'})`);
  for (const w of r.worktrees || []) {
    const n = w.missing ? 'Ordner fehlt' : (w.changedFiles === null ? 'unbekannt' : `${w.changedFiles} geänderte Dateien`);
    out.push(`Arbeitskopie ${w.branch || w.workspaceId}: ${n}`);
  }
  return out.join('\n');
}

function formatPorts(r) {
  if (!r.ports.length) return 'Keine lauschenden Ports im Projekt.';
  return r.ports.map((p) => `${p.port}${p.url ? ' ' + p.url : ''}${p.terminalId ? ` (Kachel ${p.terminalId})` : ' (Kachel unbekannt)'}`).join('\n');
}

function section(title, text) {
  return `=== ${title} ===\n${text === null || text === undefined ? '(nicht vorhanden)' : String(text).replace(/\s+$/, '')}`;
}

function formatDocs(r) {
  return [
    section('PROJECT_STATUS.md', r.projectStatus),
    section('WORK_IN_PROGRESS.md', r.workInProgress),
    section('PROGRESS.md', r.progress),
    section('git log --all --oneline -n 40', r.gitLog),
    section('git branch -a', r.gitBranches),
  ].join('\n\n');
}

// Antwort der Brücke -> { out } | { error }
function formatResponse(parsed, response) {
  if (!response || typeof response !== 'object') return { error: 'Ungültige Antwort der App.' };
  if (!response.ok) return { error: String(response.error || 'Unbekannter Fehler.') };
  const r = response.result;
  if (parsed.json) return { out: JSON.stringify(r, null, 2) };
  switch (parsed.cmd) {
    case 'status': return { out: formatStatus(r) };
    case 'output': return { out: (r.lines || []).join('\n') };
    case 'changes': return { out: formatChanges(r) };
    case 'ports': return { out: formatPorts(r) };
    case 'docs': return { out: formatDocs(r) };
    default: return { out: String(r ?? 'OK') };
  }
}

function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// Inhalt des kleinen sh-Skripts `mt-pm` im bin-Ordner (gleiche Art wie mt-browser).
function wrapperScript({ execPath, scriptPath }) {
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(execPath)} ${shellQuote(scriptPath)} "$@"\n`;
}

function send(sock, line, timeoutMs) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(sock);
    let data = '';
    const timer = setTimeout(() => { conn.destroy(); reject(new Error('Keine Antwort von Multiterminal (Zeitüberschreitung).')); }, timeoutMs);
    conn.on('connect', () => conn.write(line + '\n'));
    conn.on('data', (c) => { data += c; });
    conn.on('error', (e) => { clearTimeout(timer); reject(new Error('Keine Verbindung zu Multiterminal: ' + e.message)); });
    conn.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data.split('\n')[0])); } catch (_) { reject(new Error('Ungültige Antwort der App.')); }
    });
  });
}

// Gibt den Exit-Code zurück: 0 ok, 1 Fehler, 2 Benutzungsfehler.
async function run(argv, env, io = {}, timeoutMs) {
  const out = io.stdout || process.stdout;
  const err = io.stderr || process.stderr;
  const parsed = parseArgs(argv);
  if (parsed.help) { out.write(HELP); return 0; }
  if (parsed.error) { err.write(parsed.error + '\n'); return 2; }
  const req = buildRequest(env, parsed);
  if (req.error) { err.write(req.error + '\n'); return 2; }
  let response;
  try {
    response = await send(req.sock, req.line, timeoutMs || TIMEOUT_MS);
  } catch (e) {
    err.write(e.message + '\n');
    return 1;
  }
  const f = formatResponse(parsed, response);
  if (f.error) { err.write(f.error + '\n'); return 1; }
  if (f.out !== '') out.write(f.out + '\n');
  return 0;
}

module.exports = { HELP, parseArgs, buildRequest, formatResponse, formatStatus, wrapperScript, shellQuote, run };

if (require.main === module) {
  run(process.argv.slice(2), process.env, {}).then((code) => { process.exitCode = code; });
}
