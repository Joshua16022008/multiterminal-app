'use strict';

// Verwaltung des Manager-Terminals (ein Claude-Code-Agent je Projekt). Das Terminal läuft im
// Projektordner (nie in einer Arbeitskopie) mit dem Rollen-Prompt und, wenn eine echte
// Gesprächs-ID belegt ist, mit `--resume <id>` – niemals mit `--continue`.

const fs = require('fs');
const path = require('path');
const { shellQuote } = require('./agent-profile');
const { managerIdFor, isValidManagerProject } = require('./pm-service');

function createPmManager({ dataDir, roleSource, ptys, getProject, sessions, outputBuffer, pmBridge, makeEnv } = {}) {
  if (typeof dataDir !== 'string' || !dataDir) throw new Error('dataDir fehlt.');
  const resumed = new Map(); // projectId -> bool
  const sizes = new Map(); // projectId -> { cols, rows }
  const expectedExit = new Set(); // Neustart: das Ende des alten Prozesses darf den neuen nicht berühren

  function roleFile() {
    const target = path.join(dataDir, 'pm', 'pm-role.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(roleSource, target);
    return target;
  }

  function isRunning(projectId) {
    const id = managerIdFor(projectId);
    return ptys.snapshot().some((t) => t.terminalId === id);
  }

  function commandFor(projectId, rolePath) {
    const nativeId = sessions.get(projectId);
    let command = `claude --append-system-prompt "$(cat ${shellQuote(rolePath)})"`;
    if (nativeId) command += ` --resume=${shellQuote(nativeId)}`;
    return { command, resumed: Boolean(nativeId) };
  }

  // Idempotent: läuft der Manager schon, entsteht kein zweiter Prozess; replay = Rohpuffer.
  async function start(projectId, cols, rows) {
    if (!isValidManagerProject(projectId)) return { ok: false, error: 'Ungültige Projekt-ID für den Projektmanager.' };
    const project = getProject(projectId);
    if (!project) return { ok: false, error: 'Projekt nicht gefunden.' };
    const id = managerIdFor(projectId);
    if (Number.isFinite(cols) && Number.isFinite(rows)) sizes.set(projectId, { cols, rows });
    if (isRunning(projectId)) {
      return { ok: true, terminalId: id, resumed: resumed.get(projectId) === true, replay: outputBuffer.raw(id) };
    }
    let rolePath;
    try { rolePath = roleFile(); } catch (err) { return { ok: false, error: 'Rollen-Prompt nicht bereitgestellt: ' + err.message }; }
    const plan = commandFor(projectId, rolePath);
    const token = pmBridge ? pmBridge.register(projectId) : null;
    let extraEnv;
    try {
      extraEnv = await makeEnv(id, projectId, token ? pmBridge.envFor(projectId) : {});
    } catch (err) {
      if (pmBridge) pmBridge.unregister(projectId);
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
    const size = sizes.get(projectId) || {};
    outputBuffer.forget(id);
    const result = ptys.create({ id, projectId: project.id, cwd: project.path, cols: size.cols, rows: size.rows, command: plan.command, extraEnv });
    if (!result.ok) {
      if (pmBridge) pmBridge.unregister(projectId);
      return result;
    }
    resumed.set(projectId, plan.resumed);
    return { ok: true, terminalId: id, resumed: plan.resumed, replay: '' };
  }

  function write(projectId, data) {
    if (typeof data === 'string' && isRunning(projectId)) ptys.write(managerIdFor(projectId), data);
  }

  function resize(projectId, cols, rows) {
    if (Number.isFinite(cols) && Number.isFinite(rows)) sizes.set(projectId, { cols, rows });
    if (isRunning(projectId)) ptys.resize(managerIdFor(projectId), cols, rows);
  }

  async function restart(projectId, { fresh = false } = {}) {
    if (fresh) sessions.forget(projectId); // neues Gespräch: gespeicherte ID verwerfen
    const id = managerIdFor(projectId);
    if (isRunning(projectId)) expectedExit.add(projectId);
    ptys.kill(id);
    outputBuffer.forget(id);
    const r = await start(projectId);
    return r.ok ? { ok: true, resumed: r.resumed } : r;
  }

  // Manager-Prozess beendet (vom Aufrufer gemeldet): Token widerrufen.
  // false = Ende eines beim Neustart beendeten alten Prozesses; nichts melden, nichts widerrufen.
  function exited(projectId) {
    if (expectedExit.delete(projectId)) return false;
    if (pmBridge) pmBridge.unregister(projectId);
    resumed.delete(projectId);
    return true;
  }

  // Projekt entfernt: Prozess beenden, Token widerrufen, Gespräch vergessen.
  function remove(projectId) {
    const id = managerIdFor(projectId);
    expectedExit.delete(projectId);
    ptys.kill(id);
    outputBuffer.forget(id);
    if (pmBridge) pmBridge.unregister(projectId);
    sessions.forget(projectId);
    resumed.delete(projectId);
    sizes.delete(projectId);
  }

  return { start, write, resize, restart, exited, remove, isRunning, wasResumed: (projectId) => resumed.get(projectId) === true };
}

module.exports = { createPmManager };
