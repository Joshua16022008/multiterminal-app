/* Read-only listening ports. Only a freshly verified owner can receive a jump or browser action. */
(function () {
  'use strict';
  const POLL_MS = 3000;
  // „?“-Link zur Hilfe; ohne Hilfe-Panel (Tests, alte Seite) bleibt er weg.
  const helpLink = (key) => (typeof window !== 'undefined' && window.DeckApp && window.DeckApp.help && window.DeckApp.help.link ? window.DeckApp.help.link(key) : null);

  function createPortsPanel({ root, h, api, getLabel, onJump, onBrowser, onClose,
    schedule = setTimeout, cancel = clearTimeout, pollMs = POLL_MS }) {
    let open = false, epoch = 0, request = 0, timer = null;
    let entries = [], error = '', warning = '', capturedAt = null, loading = false, busy = false;
    const stopTimer = () => { if (timer !== null) cancel(timer); timer = null; };
    const message = e => e && e.message ? e.message : String(e);

    function render() {
      root.replaceChildren(h('div', { class: 'ports-head' },
        h('strong', { text: 'Devserver & Ports' }), helpLink('ports'), h('span', { class: 'spacer' }),
        h('button', { class: 'ib', text: '⟳', title: 'Ports aktualisieren', disabled: loading, onclick: refresh }),
        h('button', { class: 'ib', text: '✕', title: 'Portübersicht schließen', onclick: onClose })));
      const body = h('div', { class: 'ports-body' });
      root.append(body);
      body.append(h('p', { class: 'ports-note', text: 'Lokale TCP-Ports aller Projekte. HTTP im Browser öffnet die Adresse; der Port allein belegt keinen Webserver.' }));
      if (loading && !capturedAt) body.append(h('p', { text: 'Lese lauschende Ports …' }));
      if (error) body.append(h('p', { class: 'ports-error', role: 'alert', text: error }));
      if (warning) body.append(h('p', { class: 'ports-note', text: warning }));
      if (capturedAt) body.append(h('p', { class: 'ports-updated', text: 'Stand: ' + new Date(capturedAt).toLocaleTimeString() + ' · aktualisiert alle ' + (pollMs / 1000) + ' Sekunden' }));
      if (!loading && !error && !entries.length) body.append(h('p', { class: 'ports-empty', text: 'Keine sichtbaren lauschenden TCP-Ports.' }));
      // App-owned servers first; unrelated system listeners remain inspectable below them.
      const displayed = [...entries].sort((a, b) => Number(Boolean(b.terminalId && getLabel(b))) - Number(Boolean(a.terminalId && getLabel(a))) || a.port - b.port);
      for (const entry of displayed) {
        const owner = entry.terminalId && getLabel(entry);
        const assigned = Boolean(owner);
        const box = h('section', { class: 'ports-entry', 'data-port-id': entry.id });
        box.append(h('div', { class: 'ports-line' }, h('strong', { text: ':' + entry.port }),
          h('span', { class: 'ports-process', text: entry.process + ' · PID ' + entry.pid })),
        h('code', { class: 'ports-address', text: entry.host + ':' + entry.port }),
        h('p', { class: 'ports-owner', text: assigned ? owner : 'Nicht zugeordnet' }));
        if (assigned && entry.cwd) box.append(h('p', { class: 'ports-cwd', text: entry.cwd, title: entry.cwd }));
        box.append(h('div', { class: 'ports-actions' },
          h('button', { class: 'btn-small', text: 'Zum Terminal', disabled: !assigned || busy,
            title: assigned ? 'Zum zugeordneten Terminal springen' : 'Keine belegte Terminal-Zuordnung', onclick: () => act(entry, onJump) }),
          h('button', { class: 'btn-small', text: 'HTTP im Browser', disabled: !assigned || !entry.url || busy,
            title: assigned ? entry.url || 'Für diese Adresse ist keine Browser-URL verfügbar' : 'Keine belegte Zielkachel', onclick: () => act(entry, onBrowser) })));
        if (!assigned) box.append(h('p', { class: 'ports-note', text: 'Der Prozess gehört zu keiner nachgewiesenen laufenden Kachel.' }));
        body.append(box);
      }
    }

    async function refresh() {
      if (!open) return;
      stopTimer();
      const my = ++request, generation = epoch;
      loading = true;
      render();
      try {
        const result = await api.list();
        if (!open || epoch !== generation || my !== request) return;
        entries = result && result.ok ? result.entries || [] : [];
        warning = result && result.ok ? result.warning || '' : '';
        error = result && result.ok ? '' : (result && result.error || 'Ports konnten nicht gelesen werden.');
        capturedAt = result && result.ok ? result.capturedAt : null;
      } catch (e) {
        if (!open || epoch !== generation || my !== request) return;
        entries = []; capturedAt = null; warning = ''; error = message(e);
      } finally {
        if (open && epoch === generation && my === request) {
          loading = false; render(); timer = schedule(refresh, pollMs);
        }
      }
    }

    async function act(entry, callback) {
      if (!open || busy || !entry.terminalId) return;
      const generation = epoch;
      busy = true; error = ''; render();
      try {
        const result = await api.resolve(entry.id);
        if (!open || generation !== epoch) return;
        if (!result || !result.ok) throw new Error(result && result.error || 'Dieser Port ist nicht mehr verfügbar.');
        const current = result.entry;
        if (!current || current.terminalId !== entry.terminalId || current.projectId !== entry.projectId || !getLabel(current)) {
          throw new Error('Die Terminal-Zuordnung hat sich geändert. Bitte aktualisieren.');
        }
        await callback(current);
      } catch (e) {
        if (open && generation === epoch) error = message(e);
      } finally {
        if (open && generation === epoch) { busy = false; render(); }
      }
    }

    return {
      toggle(force) {
        const next = force === undefined ? !open : Boolean(force);
        if (next === open) return open;
        open = next; epoch++; request++; stopTimer();
        root.hidden = !open;
        busy = false; loading = false; entries = []; capturedAt = null; error = ''; warning = '';
        if (open) refresh();
        return open;
      },
      refresh,
      isOpen: () => open,
      dispose() { open = false; epoch++; request++; stopTimer(); root.hidden = true; },
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createPortsPanel, POLL_MS };
  if (typeof window !== 'undefined') {
    const D = (window.DeckApp = window.DeckApp || {});
    let panel;
    D.portsPanel = {
      init(opts) { panel = createPortsPanel({ ...opts, root: document.getElementById('ports-panel'), h: D.h, api: window.deck.ports }); },
      toggle: force => panel.toggle(force),
      refresh: () => panel.refresh(),
      isOpen: () => panel.isOpen(),
      dispose: () => panel.dispose(),
    };
  }
})();
