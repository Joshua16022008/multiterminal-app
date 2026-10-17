'use strict';

// App-owned task orchestration. Tasks are data; only prepared first prompts start
// workers. Nothing here writes messages into a running terminal's input buffer.
const { createAgentTaskService } = require('./agent-task-service');
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

function createAgentTaskMain({ dataDir, getTerminal, listTerminals, getProject, worktrees, launchContext, sendToWindow,
  onChanged = () => {}, serviceFactory = createAgentTaskService, launchTimeoutMs = 30000 } = {}) {
  const prepared = new Map();
  const restrictedTargets = new Set();
  const revokedSources = new Set();
  const sourceKey = (projectId, terminalId) => JSON.stringify([projectId, terminalId]);
  let scheduled = false, draining = false, disposed = false;
  let service;
  try {
    service = serviceFactory({ dataDir, getTerminal, listTerminals,
      isGrantRevoked: (projectId, terminalId) => revokedSources.has(sourceKey(projectId, terminalId)),
      onChanged(projectId) {
        onChanged(projectId);
        sendToWindow('agentTasks:changed', { projectId });
        schedule();
      },
    });
  } catch (error) {
    // A damaged task file must not prevent ordinary terminals from opening.
    // Keep the original file intact; task commands and the panel explain failure.
    const unavailable = () => { throw new Error('Agentenaufgaben nicht verfügbar: ' + error.message); };
    return { service: null, handleCli: unavailable, snapshot: unavailable, grant: unavailable, cancel: unavailable,
      validateStart: () => null, started() {}, startFailed() {}, terminalEnded() {}, launchResult: unavailable, dispose() {}, drain: async () => {} };
  }
  function actor(terminalId) {
    const meta = getTerminal(String(terminalId));
    if (!meta || meta.manager || meta.isManager || !meta.projectId) throw new Error('Aufgaben-Terminal unbekannt oder kein Arbeitsagent.');
    return { terminalId: String(terminalId), projectId: meta.projectId,
      ...(meta.provider ? { provider: meta.provider } : {}), ...(meta.cwd ? { cwd: meta.cwd } : {}),
      ...(meta.workspaceId ? { workspaceId: meta.workspaceId } : {}) };
  }
  function fail(id, message) {
    const entry = prepared.get(id);
    if (entry) { clearTimeout(entry.timer); prepared.delete(id); }
    try { service.setDelivery(id, { state: 'failed', error: message }); } catch (_) { /* Already terminal/cancelled. */ }
  }
  function schedule() {
    if (scheduled || disposed) return;
    scheduled = true;
    setImmediate(() => { scheduled = false; drain().catch(() => {}); });
  }
  async function drain() {
    if (draining || disposed) return;
    draining = true;
    try {
      for (const task of service.pendingLaunches()) {
        if (disposed) break;
        restrictedTargets.add(task.targetTerminalId);
        try {
          if (!service.canLaunch(task.id)) continue;
          const source = actor(task.sourceTerminalId);
          if (source.projectId !== task.projectId) throw new Error('Auftraggeber gehört nicht mehr zum Projekt.');
          const project = getProject(task.projectId);
          if (!project) throw new Error('Projekt nicht mehr verfügbar.');
          service.setDelivery(task.id, { state: 'preparing' });
          const workspace = await worktrees.create({ project, branch: 'agent-task/' + task.id.slice(0, 24), baseRef: 'HEAD' });
          const workspaceId = workspace && workspace.worktree && workspace.worktree.workspaceId;
          if (!workspace || !workspace.ok || !workspaceId) throw new Error(workspace && workspace.error || 'Eigene Arbeitskopie konnte nicht angelegt werden.');
          if (!service.canLaunch(task.id)) throw new Error('Auftrag oder Freigabe wurde während der Vorbereitung zurückgenommen.');
          const bootstrap = `Delegierter Auftrag ${task.id}: ${task.title}\n\n${task.text}\n\n` +
            `Arbeite nur im beschriebenen Umfang. Lies AGENTS.md und koordiniere Dateien in WORK_IN_PROGRESS.md. ` +
            `Nimm den Auftrag zuerst mit mt-agent accept ${task.id} an. ` +
            `Melde danach das tatsächliche Ergebnis und die Prüfungen mit mt-agent reply ${task.id} --status completed --text 'Ergebnis und Nachweise' ` +
            `(oder --status failed). Eigene Unteragenten dürfen helfen; sie handeln mit der Identität dieser Kachel. ` +
            `Weitere Teilaufträge nur innerhalb der gespeicherten Freigabe mit --parent ${task.id}. ` +
            `Native Terminalausgabe gilt nicht als Ergebnisrückmeldung.`;
          const preview = await launchContext.preview({ project, workspaceId, task: bootstrap,
            scope: 'Nur der delegierte Auftrag. Fremde Änderungen erhalten, Reservierungen beachten. Keine automatische Integration oder Veröffentlichung.',
            acceptance: 'Auftragsergebnis und tatsächlich ausgeführte Prüfungen mit mt-agent reply zurückmelden.' });
          if (!preview || !preview.ok) throw new Error(preview && preview.error || 'Auftragskontext konnte nicht erstellt werden.');
          const start = await launchContext.prepare({ project, workspaceId, provider: task.targetProvider,
            text: preview.text, expectedHead: preview.head, expectedCwd: preview.cwd, expectedBranch: preview.branch });
          if (!start || !start.ok) throw new Error(start && start.error || 'Agentenstart konnte nicht vorbereitet werden.');
          if (disposed || !service.canLaunch(task.id)) throw new Error('Auftrag oder Freigabe ist nicht mehr aktiv.');
          const entry = { taskId: task.id, projectId: task.projectId, terminalId: task.targetTerminalId,
            provider: task.targetProvider, command: start.command, workspaceId };
          entry.timer = setTimeout(() => fail(task.id, 'Die neue Kachel hat ihren Start nicht rechtzeitig bestätigt.'), launchTimeoutMs);
          entry.timer.unref?.();
          prepared.set(task.id, entry);
          const delivered = sendToWindow('agentTasks:launch', { ...entry, timer: undefined, title: task.title, prepared: start });
          if (delivered === false) throw new Error('Das Hauptfenster ist für den Agentenstart nicht verfügbar.');
        } catch (error) { fail(task.id, error.message || String(error)); }
      }
    } finally {
      draining = false;
      if (!disposed && service.pendingLaunches().length) schedule();
    }
  }
  function validateStart({ id, projectId, command, workspaceId, launch }) {
    const entry = [...prepared.values()].find(item => item.terminalId === id);
    if (entry) {
      if (launch != null || entry.projectId !== projectId || entry.command !== command || entry.workspaceId !== workspaceId || !service.canLaunch(entry.taskId)) {
        throw new Error('Vorbereiteter Auftragsstart stimmt nicht mehr mit Kachel, Projekt oder Freigabe überein.');
      }
      return { ...entry };
    }
    let restricted = restrictedTargets.has(id);
    try {
      const existing = service.snapshot(projectId).tasks.find(task => task.newWorker && task.targetTerminalId === id);
      if (existing) { restrictedTargets.add(id); restricted = true; }
    } catch (_) { /* Optional task storage must not block ordinary terminal creation. */ }
    if (restricted && (command || launch != null)) throw new Error('Dieser Auftragsstart ist nicht mehr freigegeben. Auftrag erneut planen.');
    return null; // A restored pane may create an empty shell; it never replays tasks.
  }
  function started(terminalId) {
    const entry = [...prepared.values()].find(item => item.terminalId === terminalId);
    if (!entry) return;
    clearTimeout(entry.timer); prepared.delete(entry.taskId);
    service.setDelivery(entry.taskId, { state: 'launched', workspaceId: entry.workspaceId });
  }
  function startFailed(terminalId, message) {
    const entry = [...prepared.values()].find(item => item.terminalId === terminalId);
    if (entry) fail(entry.taskId, message || 'Terminal konnte nicht gestartet werden.');
  }
  function terminalEnded(terminalId) {
    const meta = getTerminal(terminalId);
    if (!meta) return;
    // Keep revocation effective even if disk damage prevents persisting it.
    revokedSources.add(sourceKey(meta.projectId, terminalId));
    try {
      const current = service.snapshot(meta.projectId);
      if (current.grants[terminalId]?.enabled) service.setGrant(meta.projectId, terminalId, { enabled: false });
      for (const task of current.tasks) {
        if (task.targetTerminalId === terminalId && !TERMINAL.has(task.status)) service.interrupt(task.id, 'Die Empfängerkachel wurde beendet; keine Ergebnisrückmeldung.');
      }
    } catch (_) { /* Cleanup/kill must complete even when task persistence is unavailable. Task actions still expose the error. */ }
  }
  function launchResult(input) {
    if (!input || Object.keys(input).some(key => !['taskId', 'terminalId', 'ok', 'error'].includes(key))) throw new Error('Ungültige Startantwort.');
    const entry = prepared.get(input.taskId);
    if (!entry || entry.terminalId !== input.terminalId) return false;
    if (input.ok !== true) fail(input.taskId, String(input.error || 'Kachel konnte nicht angelegt werden.').slice(0, 1000));
    return true; // Renderer receipt is not task acceptance or even a confirmed PTY start.
  }
  function handleCli(terminalId, operation, input = {}) {
    const who = actor(terminalId);
    switch (operation) {
      case 'peers': return service.peers(who);
      case 'list': return service.list(who, input);
      case 'get': return service.get(who, input.id);
      case 'send': return service.send(who, input);
      case 'accept': return service.accept(who, input.id);
      case 'reply': return service.reply(who, input.id, { status: input.status, text: input.text });
      case 'cancel': return service.cancel(who, input.id);
      default: throw new Error('Unbekannte Agentenaufgabe-Aktion.');
    }
  }
  function dispose() { disposed = true; for (const entry of prepared.values()) clearTimeout(entry.timer); prepared.clear(); }
  function snapshot(projectId) {
    const current = service.snapshot(projectId);
    for (const [terminalId, grant] of Object.entries(current.grants)) {
      if (revokedSources.has(sourceKey(projectId, terminalId))) grant.enabled = false;
    }
    return current;
  }
  function grant(projectId, terminalId, patch) {
    const result = service.setGrant(projectId, terminalId, patch);
    if (patch.enabled === true) revokedSources.delete(sourceKey(projectId, terminalId));
    return result;
  }
  return { service, handleCli, snapshot, grant,
    cancel: (pid, id) => service.cancelByUser(pid, id),
    validateStart, started, startFailed, terminalEnded, launchResult, dispose, drain };
}
module.exports = { createAgentTaskMain };
