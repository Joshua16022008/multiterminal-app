'use strict';

// PM: Projektmanager-Fenster. Links der Manager-Agent (xterm), rechts das Lagebild.
(function () {
  const pm = window.pm;
  const View = window.DeckPmView;
  const $ = id => document.getElementById(id);
  const REFRESH_MS = 10000;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function section(title) {
    const s = el('section', 'pm-sec');
    s.append(el('h2', '', title));
    return s;
  }
  function row(...kids) { const r = el('div', 'pm-row'); r.append(...kids); return r; }

  function renderSituation(state) {
    const root = $('pm-situation');
    root.replaceChildren();
    const m = View.describe(state, Date.now());
    if (!m.ok) {
      const s = section('Lagebild');
      s.append(el('p', 'pm-err', m.error));
      root.append(s);
      return;
    }
    if (m.projectName) $('pm-title').textContent = 'Projektmanager · ' + m.projectName;

    const t = section('Kacheln (' + m.terminals.length + ')');
    if (!m.terminals.length) t.append(el('p', 'pm-empty', 'Keine Kacheln in diesem Projekt.'));
    for (const x of m.terminals) {
      const sub = [x.provider, x.since, x.branch && 'Branch ' + x.branch].filter(Boolean).join(' · ');
      const name = el('div', 'pm-name', x.title);
      name.title = x.id + (sub ? '\n' + sub : '');
      const left = el('span', 'pm-dot ' + x.kind);
      t.append(row(left, name, el('span', 'pm-state ' + x.kind, x.stateText)));
    }
    root.append(t);

    const w = section('Arbeitskopien (' + m.worktrees.length + ')');
    if (!m.worktrees.length) w.append(el('p', 'pm-empty', 'Keine zusätzlichen Arbeitskopien.'));
    for (const x of m.worktrees) {
      w.append(row(el('span', 'pm-name pm-mono', x.branch + (x.missing ? ' (fehlt)' : '')), el('span', 'pm-meta' + (x.missing ? ' pm-missing' : ''), x.missing ? 'Ordner fehlt' : x.changed)));
    }
    root.append(w);

    const c = section('Änderungen');
    if (!m.changes.ok) c.append(el('p', 'pm-err', m.changes.text));
    else {
      if (m.changes.branch) c.append(el('p', 'pm-note pm-mono', 'Branch ' + m.changes.branch));
      c.append(el('p', 'pm-next', m.changes.text));
    }
    root.append(c);

    const p = section('Ports (' + m.ports.length + ')');
    if (!m.ports.length) p.append(el('p', 'pm-empty', 'Keine lauschenden Ports.'));
    for (const x of m.ports) {
      p.append(row(el('span', 'pm-name pm-mono', ':' + x.port), el('span', 'pm-meta', x.terminalId ? 'Kachel ' + ((m.terminals.find(t => t.id === x.terminalId) || {}).title || x.terminalId) : 'keiner Kachel zugeordnet')));
    }
    root.append(p);

    const n = section('Nächster Schritt');
    n.append(el('p', m.nextStep ? 'pm-next' : 'pm-empty', m.nextStep || 'unbekannt (nicht in PROJECT_STATUS.md gefunden)'));
    n.append(el('p', 'pm-meta', 'Aktive Reservierungen: ' + (m.reservations === null ? 'unbekannt' : m.reservations)));
    root.append(n);

    root.append(el('p', 'pm-foot', 'Stand ' + m.capturedAt + (m.manager.running ? ' · Manager läuft' + (m.manager.resumed ? ' (Fortsetzung angefordert)' : '') : ' · Manager beendet')));
  }

  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try { renderSituation(await pm.state()); }
    catch (e) { renderSituation({ ok: false, error: (e && e.message) || String(e) }); }
    finally { refreshing = false; }
  }

  /* xterm */
  const term = new Terminal({
    fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
    fontSize: 12.5, lineHeight: 1.12, cursorBlink: true, scrollback: 5000, allowProposedApi: true,
    theme: { background: '#12101a', foreground: '#dcd7e6', cursor: '#e0a458', cursorAccent: '#12101a', selectionBackground: '#4a3d66' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($('pm-term'));
  window.__pmTerm = term; // für QA-Skripte

  function safeFit() { try { fit.fit(); } catch { /* Fenster noch ohne Größe */ } }
  // Während des Replays antwortet xterm auf alte Terminalabfragen (DA, DSR, Farben);
  // diese Antworten dürfen nicht als Eingabe beim Manager landen. Live-Ausgabe, die
  // vor dem Replay eintrifft, wird zurückgehalten, damit die Reihenfolge stimmt.
  let replaying = false, held = [];
  term.onData(d => { if (!replaying) pm.write(d); });
  term.onResize(({ cols, rows }) => pm.resize(cols, rows));
  pm.onData(d => { if (replaying) held.push(d); else term.write(d); });
  function writeReplay(text) {
    return new Promise(resolve => term.write(text, () => {
      const rest = held; held = []; replaying = false;
      for (const d of rest) term.write(d);
      resolve();
    }));
  }
  pm.onExit(() => { $('pm-exit').hidden = false; });

  async function startManager(restart, fresh) {
    $('pm-exit').hidden = true;
    safeFit();
    if (restart) term.reset(); // vor dem Neustart leeren, damit frühe Ausgabe des neuen Prozesses bleibt
    let res;
    if (!restart) replaying = true; // bis das Replay geschrieben ist
    try { res = restart ? await pm.restart(fresh === true) : await pm.start(term.cols, term.rows); }
    catch (e) { res = { ok: false, error: (e && e.message) || String(e) }; }
    if (!restart && !(res && res.ok !== false && res.replay)) { // kein Replay: Zurückgehaltenes sofort zeigen
      replaying = false; const rest = held; held = []; for (const d of rest) term.write(d);
    }
    if (!res || res.ok === false) {
      term.write('\r\n\x1b[31mManager konnte nicht gestartet werden: ' + ((res && res.error) || 'unbekannter Fehler') + '\x1b[0m\r\n');
      $('pm-exit').hidden = false;
      return;
    }
    if (!restart && res.replay) await writeReplay(res.replay);
    if (restart) { safeFit(); pm.resize(term.cols, term.rows); }
    refresh();
  }

  $('pm-refresh').onclick = refresh;
  $('pm-restart').onclick = () => startManager(true);
  $('pm-exit-restart').onclick = () => startManager(true);
  $('pm-fresh').onclick = () => startManager(true, true);
  $('pm-exit-fresh').onclick = () => startManager(true, true);

  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(safeFit, 60); });

  // Automatisch alle 10 s, aber nur solange das Fenster sichtbar ist.
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

  requestAnimationFrame(() => startManager(false));
})();
