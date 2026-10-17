/* Komfort-Einstellungen: Aktivitätsmarkierung, Animation, Sortierung und Aufgaben-Chip ein-/ausschalten.
   Gespeichert pro Gerät im Browser-Speicher; ohne Speicher gelten die Standards. */
(function () {
  'use strict';
  const KEY = 'mt.qol';
  const DEFAULTS = Object.freeze({ markWorking: true, markWaiting: true, markIdle: true, animate: true, autoSort: true, taskChip: true });
  const ITEMS = [
    ['markWaiting', 'Markierung „Wartet auf dich“', 'Leiste pulsiert, wenn ein Agent dich braucht'],
    ['markWorking', 'Markierung „Arbeitet“', 'Lichtstreifen, solange ein Agent arbeitet'],
    ['markIdle', 'Markierung „Inaktiv“', 'Dezente Linie bei bereiten Agenten'],
    ['animate', 'Animationen', 'Aus: Markierungen bleiben, bewegen sich aber nicht'],
    ['autoSort', 'Automatisch sortieren', 'Wartet vorne, arbeitet Mitte, inaktiv hinten'],
    ['taskChip', '„+ Aufgabe“ im Kachelkopf', 'Verknüpfung mit Second-Brain-Aufgaben'],
  ];
  // Body-Klassen, die eine ausgeschaltete Option sichtbar umsetzen.
  const OFF_CLASS = { markWorking: 'qol-no-working', markWaiting: 'qol-no-waiting', markIdle: 'qol-no-idle', animate: 'qol-static', taskChip: 'qol-no-taskchip' };

  function normalize(raw) {
    const out = { ...DEFAULTS };
    if (raw && typeof raw === 'object') for (const k of Object.keys(DEFAULTS)) if (typeof raw[k] === 'boolean') out[k] = raw[k];
    return out;
  }
  function bodyClasses(settings) {
    return Object.entries(OFF_CLASS).filter(([k]) => !settings[k]).map(([, c]) => c);
  }
  function load(storage) {
    try {
      const raw = storage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
      const legacy = storage.getItem('mt.autoSort'); // früherer Einzelschalter
      return normalize(legacy === 'off' ? { autoSort: false } : {});
    } catch (_) { return { ...DEFAULTS }; }
  }
  function save(storage, settings) { try { storage.setItem(KEY, JSON.stringify(settings)); } catch (_) { /* nur diese Sitzung */ } }

  // opts: button, root, h, storage, onChange(settings), getStatus() -> bool, setStatus(bool) -> Promise
  function createQolPanel({ button, root, h, storage, onChange, getStatus, setStatus }) {
    let settings = load(storage);
    let open = false;
    function apply() {
      for (const c of Object.values(OFF_CLASS)) document.body.classList.toggle(c, bodyClasses(settings).includes(c));
      onChange(settings);
    }
    function set(key, value) { settings = { ...settings, [key]: Boolean(value) }; save(storage, settings); apply(); render(); }
    function row(label, hint, checked, onToggle, id) {
      const box = h('input', { type: 'checkbox', id, onchange: (e) => onToggle(e.target.checked) });
      box.checked = checked;
      return h('label', { class: 'qol-row', for: id }, box, h('span', { class: 'qol-text' }, h('span', { text: label }), h('small', { text: hint })));
    }
    function render() {
      if (!open) return;
      const status = getStatus();
      root.replaceChildren(
        h('div', { class: 'qol-head' }, h('strong', { text: 'Komfort' }), h('span', { class: 'spacer' }),
          h('button', { class: 'ib', text: '✕', title: 'Schließen', onclick: () => toggle(false) })),
        row('Agentenstatus empfangen', status ? 'Voraussetzung für Markierung und Sortierung. Wirkt ab dem nächsten Claude-Start: laufende Sitzungen einmal beenden (/exit) und fortsetzen.' : 'Aus: keine Markierung und keine Sortierung möglich',
          status, async (v) => { await setStatus(v); render(); }, 'qol-status'),
        ...ITEMS.map(([key, label, hint]) => row(label, hint, settings[key], (v) => set(key, v), 'qol-' + key)),
        h('div', { class: 'qol-foot' }, h('button', { class: 'btn-small', text: 'Standard wiederherstellen', onclick: () => { settings = { ...DEFAULTS }; save(storage, settings); apply(); render(); } })));
    }
    function toggle(force) {
      open = force === undefined ? !open : Boolean(force);
      root.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      button.classList.toggle('on', open);
      if (open) render(); else root.replaceChildren();
      return open;
    }
    document.addEventListener('mousedown', (e) => { if (open && !root.contains(e.target) && e.target !== button) toggle(false); });
    document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') toggle(false); });
    button.addEventListener('click', () => toggle());
    apply();
    return { toggle, get: () => ({ ...settings }), set, render, isOpen: () => open };
  }

  const api = { createQolPanel, normalize, bodyClasses, load, DEFAULTS, ITEMS, KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckQol = api;
})();
