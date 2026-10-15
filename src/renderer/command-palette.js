'use strict';

/* F03: Befehlspalette. Sucht in Projekten, Kacheln und vorhandenen Aktionen.
   Reine Logik (Einträge bauen, filtern, ordnen) ist ohne DOM testbar. */
(function () {
  const MAX_RESULTS = 50;

  // Kleinschreibung ohne Akzente: „über“ findet „uber“, „Über“ findet „über“.
  function normalize(text) {
    return String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss');
  }

  function subsequence(hay, token) {
    let at = 0;
    for (const ch of token) {
      at = hay.indexOf(ch, at);
      if (at < 0) return false;
      at++;
    }
    return true;
  }

  /* Punktzahl eines Suchworts für einen Eintrag; null = passt nicht. */
  function scoreToken(entry, token) {
    const title = entry.titleN, hay = entry.hayN;
    if (title === token) return 100;
    if (title.startsWith(token)) return 80;
    if (title.split(/[\s·:/_-]+/).some((w) => w.startsWith(token))) return 60;
    if (title.includes(token)) return 45;
    if (hay.split(/[\s·:/_-]+/).some((w) => w.startsWith(token))) return 30;
    if (hay.includes(token)) return 20;
    if (token.length >= 2 && subsequence(title, token)) return 8;
    if (token.length >= 3 && subsequence(hay, token)) return 3;
    return null;
  }

  /* entries: { id, kind, title, subtitle?, keywords? }. Leere Suche: alle in Ursprungsreihenfolge. */
  function rank(entries, query, limit = MAX_RESULTS) {
    const prepared = entries.map((entry, order) => ({
      entry, order,
      titleN: normalize(entry.title),
      hayN: normalize([entry.title, entry.subtitle, entry.keywords].filter(Boolean).join(' ')),
    }));
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return prepared.slice(0, limit).map((p) => p.entry);
    const scored = [];
    for (const p of prepared) {
      let total = 0;
      let ok = true;
      for (const token of tokens) {
        const s = scoreToken(p, token);
        if (s === null) { ok = false; break; }
        total += s;
      }
      if (ok) scored.push({ p, total });
    }
    scored.sort((a, b) => b.total - a.total || a.p.order - b.p.order);
    return scored.slice(0, limit).map((s) => s.p.entry);
  }

  /* Einträge aus dem Live-Zustand; geschlossene Kacheln sind hier schon nicht mehr enthalten. */
  function buildEntries({ projects, panesOf, activeId, actions, presetLabel }) {
    const entries = [];
    for (const action of actions || []) {
      entries.push({ id: 'action:' + action.id, kind: 'action', title: action.label, subtitle: 'Aktion', hotkey: action.hotkey || '', actionId: action.id });
    }
    for (const project of projects || []) {
      const panes = panesOf(project.id) || [];
      entries.push({
        id: 'project:' + project.id, kind: 'project', title: project.name,
        subtitle: 'Projekt · ' + panes.length + (panes.length === 1 ? ' Terminal' : ' Terminals') + (project.id === activeId ? ' · aktiv' : ''),
        keywords: project.path || '', projectId: project.id,
      });
    }
    for (const project of projects || []) {
      (panesOf(project.id) || []).forEach((pane, i) => {
        const preset = presetLabel ? presetLabel(pane.desc) : '';
        entries.push({
          id: 'pane:' + pane.id, kind: 'pane', title: pane.desc.title,
          subtitle: project.name + ' · Terminal ' + (i + 1) + (preset ? ' · ' + preset : ''),
          keywords: preset || '', projectId: project.id, paneId: pane.id,
        });
      });
    }
    return entries;
  }

  const KIND_LABEL = { action: 'Aktion', project: 'Projekt', pane: 'Kachel' };
  const api = { MAX_RESULTS, normalize, rank, buildEntries, KIND_LABEL };

  /* ---------- Oberfläche ---------- */
  /* deps: document, getEntries(), run(entry), restoreFocus() */
  function create({ document, getEntries, run, restoreFocus }) {
    let root = null, input, list, entries = [], results = [], sel = 0;

    function ensure() {
      if (root) return;
      root = document.createElement('div');
      root.className = 'palette-overlay';
      root.hidden = true;
      const box = document.createElement('div');
      box.className = 'palette';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Befehlspalette');
      input = document.createElement('input');
      input.type = 'text'; input.className = 'palette-input';
      input.placeholder = 'Projekt, Kachel oder Aktion suchen …';
      input.setAttribute('aria-label', 'Befehlspalette durchsuchen');
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-controls', 'palette-list');
      input.autocomplete = 'off'; input.spellcheck = false;
      list = document.createElement('ul');
      list.className = 'palette-list'; list.id = 'palette-list'; list.setAttribute('role', 'listbox');
      const hint = document.createElement('div');
      hint.className = 'palette-hint';
      hint.textContent = '↑↓ wählen · Eingabe öffnen · Esc schließen';
      box.append(input, list, hint);
      root.append(box);
      document.body.append(root);
      input.addEventListener('input', () => { sel = 0; refresh(); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      });
      root.addEventListener('mousedown', (e) => { if (e.target === root) { e.preventDefault(); close(true); } });
    }

    function refresh() {
      results = rank(entries, input.value);
      list.textContent = '';
      if (!results.length) {
        const li = document.createElement('li');
        li.className = 'palette-empty'; li.textContent = 'Nichts gefunden.';
        list.append(li);
        input.removeAttribute('aria-activedescendant');
        return;
      }
      results.forEach((entry, i) => {
        const li = document.createElement('li');
        li.className = 'palette-item' + (i === sel ? ' sel' : '');
        li.id = 'palette-item-' + i;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === sel));
        li.dataset.kind = entry.kind;
        const kind = document.createElement('span'); kind.className = 'palette-kind'; kind.textContent = KIND_LABEL[entry.kind] || '';
        const main = document.createElement('span'); main.className = 'palette-main';
        const t = document.createElement('span'); t.className = 'palette-title'; t.textContent = entry.title;
        const s = document.createElement('span'); s.className = 'palette-sub'; s.textContent = entry.subtitle || '';
        main.append(t, s);
        li.append(kind, main);
        if (entry.hotkey) { const k = document.createElement('span'); k.className = 'palette-key'; k.textContent = entry.hotkey; li.append(k); }
        li.addEventListener('mousemove', () => { if (sel !== i) { sel = i; mark(); } });
        li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
        list.append(li);
      });
      input.setAttribute('aria-activedescendant', 'palette-item-' + sel);
    }
    function mark() {
      [...list.children].forEach((li, i) => {
        li.classList.toggle('sel', i === sel);
        li.setAttribute('aria-selected', String(i === sel));
      });
      input.setAttribute('aria-activedescendant', 'palette-item-' + sel);
      const cur = list.children[sel];
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }
    function move(step) {
      if (!results.length) return;
      sel = (sel + step + results.length) % results.length;
      mark();
    }
    function choose(i) {
      const entry = results[i];
      if (!entry) return;
      close(false);
      run(entry);
    }
    function isOpen() { return !!root && !root.hidden; }
    function open() {
      ensure();
      entries = getEntries();
      input.value = ''; sel = 0;
      root.hidden = false;
      refresh();
      input.focus();
    }
    function close(restore) {
      if (!isOpen()) return;
      root.hidden = true;
      if (restore && restoreFocus) restoreFocus();
    }
    function toggle() { if (isOpen()) close(true); else open(); }
    return { open, close, toggle, isOpen };
  }

  api.create = create;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckCommandPalette = api;
})();
