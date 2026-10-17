/* Diktat: gemeinsamer Zustand (welches Terminal, welche Phase), eine einzige Event-Anmeldung,
   Kacheln melden sich an und bekommen ihre Phase gespiegelt. Text tippt der Main-Prozess, nie die UI. */
(function () {
  'use strict';
  const D = (window.DeckApp = window.DeckApp || {});
  const api = window.deck && window.deck.dictation;
  const LIVE_KEY = 'multiterminal.liveDictation';

  /* phase: idle | starting | loading | recording | processing */
  const st = { phase: 'idle', terminalId: null, live: false };
  const tiles = new Map(); // terminalId -> { title(): string, update(phase) }
  const ACTIVE = ['starting', 'loading', 'recording'];

  function paint() {
    for (const [id, t] of tiles) {
      try { t.update(id === st.terminalId ? st.phase : 'idle'); } catch (_) {}
    }
  }
  function set(phase, terminalId) {
    st.phase = phase;
    st.terminalId = phase === 'idle' ? null : terminalId;
    paint();
  }
  const note = (msg, kind) => D.notify && D.notify(msg, kind);

  function readLive() {
    try { return localStorage.getItem(LIVE_KEY) === '1'; } catch (_) { return false; }
  }
  function writeLive(v) {
    try { localStorage.setItem(LIVE_KEY, v ? '1' : '0'); } catch (_) {}
  }

  async function begin(id) {
    set('starting', id);
    let r;
    try { r = await api.start(id, st.live); } catch (e) { r = { ok: false, error: D.errText ? D.errText(e) : String(e) }; }
    if (st.terminalId !== id) return; // inzwischen per Event beendet
    if (!r || !r.ok) {
      set('idle');
      note((r && r.error) || 'Diktat konnte nicht gestartet werden.', 'warn');
    } else if (st.phase === 'starting') {
      set('recording', id);
    }
  }

  async function end(fn, nextPhase) {
    const id = st.terminalId;
    try {
      await fn();
      if (nextPhase && st.terminalId === id && ACTIVE.includes(st.phase)) set(nextPhase, id);
    } catch (e) {
      set('idle');
      note(D.errText ? D.errText(e) : String(e), 'warn');
    }
  }

  const dict = (D.dictation = {
    available: !!api,
    label: 'Diktieren (Flüsterflow)', // Tooltip des Mikrofons im Kachelkopf

    /* Kachel anmelden; gibt die Abmeldefunktion zurück. */
    register(id, tile) {
      tiles.set(id, tile);
      tile.update(id === st.terminalId ? st.phase : 'idle');
      return () => {
        tiles.delete(id);
        if (st.terminalId === id && st.phase !== 'idle') set('idle'); // Main bricht beim Schließen selbst ab
      };
    },

    /* Klick auf das Mikrofon einer Kachel. */
    click(id) {
      if (!api) return;
      if (st.phase === 'idle') { begin(id); return; }
      if (st.terminalId === id) {
        if (st.phase === 'loading' || st.phase === 'recording') end(() => api.stop(), 'processing');
        return; // starting/processing: ignorieren
      }
      const t = tiles.get(st.terminalId);
      note(`Diktat läuft bereits in „${t ? t.title() : 'einem anderen Terminal'}“.`, 'info');
    },

    cancel() {
      if (!api || !ACTIVE.includes(st.phase)) return;
      end(() => api.cancel(), 'idle');
    },
  });

  /* Ereignisse des Main-Prozesses */
  function onEvent(ev) {
    if (!ev || !ev.state) return;
    const id = ev.terminalId || st.terminalId;
    switch (ev.state) {
      case 'loading':
        set('loading', id);
        note('Sprachmodell wird geladen – du kannst schon sprechen', 'info');
        break;
      case 'recording': set('recording', id); break;
      case 'processing': set('processing', id); break;
      case 'idle':
        set('idle');
        if (ev.empty && !ev.cancelled) note('Nichts erkannt', 'info');
        break;
      case 'error':
        set('idle');
        note(ev.message || 'Diktat fehlgeschlagen.', 'warn');
        break;
      default: break;
    }
  }

  /* Schalter „Live-Diktat“ im Menü: gehört zu dieser (nur in der Entwicklerversion vorhandenen) Datei. */
  function liveButton() {
    const existing = document.getElementById('btn-live');
    if (existing || !api) return existing;
    const group = document.getElementById('project-options');
    if (!group) return null;
    const btn = document.createElement('button');
    btn.id = 'btn-live';
    btn.className = 'btn-small';
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Live-Diktat: an – Text erscheint schon beim Sprechen; aus – Text erscheint nach dem Stoppen am Stück';
    btn.textContent = 'Live-Diktat';
    group.prepend(btn);
    return btn;
  }

  function init() {
    st.live = readLive();
    const btn = liveButton();
    if (btn) {
      btn.classList.toggle('on', st.live);
      btn.setAttribute('aria-pressed', String(st.live));
      btn.addEventListener('click', () => {
        st.live = !st.live;
        writeLive(st.live);
        btn.classList.toggle('on', st.live);
        btn.setAttribute('aria-pressed', String(st.live));
      });
      if (!api) btn.hidden = true;
    }
    if (!api) return;
    api.onEvent(onEvent);
    /* Escape bricht nur ab, wenn der Fokus weder im Terminal noch in einem Eingabefeld liegt. */
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !ACTIVE.includes(st.phase)) return;
      const t = e.target;
      if (t && t.closest && t.closest('.xterm, input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      dict.cancel();
    });
  }
  init();
})();
