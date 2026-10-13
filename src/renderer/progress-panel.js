/* Seitenpanel mit PROGRESS.md des aktiven Projekts. */
(function () {
  'use strict';
  const D = (window.DeckApp = window.DeckApp || {});
  const h = D.h;
  const PROMPT = 'Lies PROGRESS.md in diesem Ordner, mach dort weiter und aktualisiere die Datei nach jedem erledigten Schritt.';

  let root, pathEl, textEl, getProjectId, getActivePane;
  let open = false, token = 0, loadedFor = null;

  async function load(useOpen) {
    const pid = getProjectId();
    const my = ++token;
    if (!pid) { pathEl.textContent = ''; textEl.textContent = ''; return; }
    const api = window.deck;
    textEl.textContent = 'Lade …';
    const r = await D.guard(async () => {
      if (!useOpen) {
        const rd = await api.progress.read(pid);
        if (rd) return rd;
      }
      return api.progress.open(pid);
    });
    if (my !== token) return;
    if (!r) { textEl.textContent = 'PROGRESS.md konnte nicht geladen werden.'; return; }
    loadedFor = pid;
    pathEl.textContent = r.path || '';
    pathEl.title = r.path || '';
    textEl.textContent = r.content || '(Datei ist leer)';
  }

  function sendPrompt() {
    const pane = getActivePane();
    if (!pane) { D.notify('Kein aktives Terminal.'); return; }
    if (pane.type(PROMPT)) pane.focus();
  }

  D.progressPanel = {
    init(opts) {
      getProjectId = opts.getProjectId;
      getActivePane = opts.getActivePane;
      root = document.getElementById('progress-panel');
      pathEl = h('div', { class: 'pp-path' });
      textEl = h('pre', { class: 'pp-text' });
      root.append(
        h('div', { class: 'pp-head' },
          h('strong', { text: 'Fortschritt' }),
          h('span', { class: 'spacer' }),
          h('button', { class: 'ib', title: 'Neu laden', text: '⟳', onclick: () => load(false) }),
          h('button', { class: 'ib', title: 'Schließen', text: '✕', onclick: () => opts.onClose() })),
        pathEl,
        textEl,
        h('button', { class: 'btn-primary pp-send', text: 'Auftrag ins aktive Terminal', onclick: sendPrompt }));
    },
    isOpen: () => open,
    toggle(force) {
      open = force === undefined ? !open : !!force;
      root.hidden = !open;
      if (open) load(true);
      return open;
    },
    /* Projektwechsel */
    refresh() {
      if (open && getProjectId() !== loadedFor) load(true);
    },
  };
})();
