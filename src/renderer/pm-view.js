'use strict';

// PM: Reine Darstellungslogik des Projektmanager-Lagebilds (ohne DOM, testbar).
(function () {
  const STATE_TEXT = {
    working: ['working', 'arbeitet'],
    'needs-input': ['needs-input', 'wartet auf dich'],
    'turn-complete': ['turn-complete', 'Antwort fertig'],
    error: ['error', 'Fehler'],
    unknown: ['unknown', 'unbekannt'],
  };

  function num(v) { return Number.isFinite(v) ? v : null; }

  function terminalState(t, statusEnabled) {
    if (!t.running) return { kind: 'ended', text: 'beendet' };
    if (!t.agent) {
      // Ohne eingeschalteten Agentenstatus kommen keine Ereignisse: dann ist der Zustand unbekannt, nicht "kein Agent".
      if (statusEnabled === false) return { kind: 'unknown', text: 'Agentenzustand unbekannt (Agentenstatus aus)' };
      return { kind: 'none', text: 'kein Agentenereignis' };
    }
    const entry = STATE_TEXT[t.agent.state] || STATE_TEXT.unknown;
    return { kind: entry[0], text: entry[1] };
  }

  function formatTime(ms, locale) {
    if (!Number.isFinite(ms)) return '–';
    try { return new Date(ms).toLocaleTimeString(locale || 'de-DE'); } catch { return '–'; }
  }

  function formatSince(since, now) {
    if (!Number.isFinite(since) || !Number.isFinite(now)) return null;
    const s = Math.max(0, Math.round((now - since) / 1000));
    if (s < 60) return 'seit ' + s + ' s';
    if (s < 3600) return 'seit ' + Math.floor(s / 60) + ' min';
    return 'seit ' + Math.floor(s / 3600) + ' h';
  }

  function describeChanges(c) {
    if (!c) return { ok: false, text: 'unbekannt' };
    if (c.ok === false) return { ok: false, text: 'nicht lesbar: ' + (c.error || 'unbekannter Fehler') };
    const staged = num(c.staged), unstaged = num(c.unstaged), untracked = num(c.untracked);
    const parts = [];
    parts.push((staged === null ? '?' : staged) + ' vorgemerkt');
    parts.push((unstaged === null ? '?' : unstaged) + ' geändert');
    parts.push((untracked === null ? '?' : untracked) + ' neu');
    const clean = staged === 0 && unstaged === 0 && untracked === 0;
    return { ok: true, branch: c.branch || null, clean, text: clean ? 'sauber' : parts.join(' · ') };
  }

  // Wandelt ein Lagebild in eine flache Struktur für die Anzeige. Unbekanntes bleibt ehrlich "unbekannt".
  function describe(state, now) {
    if (!state || state.ok === false) {
      return { ok: false, error: (state && state.error) || 'Lagebild nicht verfügbar.' };
    }
    const terminals = (Array.isArray(state.terminals) ? state.terminals : []).map(t => {
      const st = terminalState(t, state.agentStatusEnabled);
      const ws = t.workspace ? (t.workspace.branch || t.workspace.workspaceId || null) : null;
      return {
        id: t.id,
        title: t.title || t.id,
        preset: t.preset || null,
        kind: st.kind,
        stateText: st.text,
        since: t.running && t.agent ? formatSince(t.agent.since, now) : null,
        provider: t.agent && t.agent.provider || null,
        branch: ws,
      };
    });
    const worktrees = (Array.isArray(state.worktrees) ? state.worktrees : []).map(w => ({
      workspaceId: w.workspaceId,
      branch: w.branch || '(ohne Branch)',
      missing: !!w.missing,
      changed: num(w.changedFiles) === null ? 'unbekannt' : w.changedFiles + (w.changedFiles === 1 ? ' Datei' : ' Dateien'),
    }));
    const ports = (Array.isArray(state.ports) ? state.ports : []).map(p => ({
      port: p.port, url: p.url || null, terminalId: p.terminalId || null,
    }));
    const docs = state.docs || {};
    return {
      ok: true,
      projectName: state.project && state.project.name || '',
      capturedAt: formatTime(state.capturedAt),
      terminals,
      worktrees,
      changes: describeChanges(state.changes),
      ports,
      nextStep: docs.nextStep || null,
      reservations: num(docs.activeReservations),
      manager: { running: !!(state.manager && state.manager.running), resumed: !!(state.manager && state.manager.resumed) },
    };
  }

  const api = { describe, terminalState, formatSince, formatTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckPmView = api;
})();
