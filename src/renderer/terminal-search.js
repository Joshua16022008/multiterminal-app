'use strict';

/* F03: Suche im Verlauf einer Kachel. Durchsucht ausschließlich den xterm-Puffer
   (geladener Verlauf), nie Projektdateien. Die Suchleiste ist ein eigenes Eingabefeld;
   nichts davon gelangt ins PTY. Reine Logik (ohne DOM) oben, Oberfläche unten. */
(function () {
  const MAX_MATCHES = 5000;

  /* Puffer -> logische Zeilen. Umgebrochene Zeilen (isWrapped) werden zu einer
     logischen Zeile verbunden, damit ein Treffer über den Umbruch hinweg gefunden wird.
     Je UTF-16-Einheit merken wir Start- und Endzelle (absolut: Zeile * Spalten + Spalte),
     weil breite Zeichen zwei Zellen belegen und Text-Index != Spalte ist. */
  function logicalLines(buffer, cols) {
    const result = [];
    let current = null;
    const flush = () => {
      if (!current) return;
      // Nachlaufende Leerzeichen der letzten Zeile sind nur Zellfüllung.
      while (current.text.endsWith(' ') && current.pad[current.text.length - 1]) {
        current.text = current.text.slice(0, -1); current.start.pop(); current.end.pop(); current.pad.pop();
      }
      result.push(current);
      current = null;
    };
    for (let row = 0; row < buffer.length; row++) {
      const line = buffer.getLine(row);
      if (!line) continue;
      if (!current || !line.isWrapped) { flush(); current = { text: '', start: [], end: [], pad: [] }; }
      const limit = typeof line.length === 'number' ? line.length : cols;
      for (let x = 0; x < limit; x++) {
        const cell = line.getCell(x);
        if (!cell) continue;
        const width = cell.getWidth();
        if (width === 0) continue; // zweite Hälfte eines breiten Zeichens
        const chars = cell.getChars();
        const text = chars === '' ? ' ' : chars;
        for (let k = 0; k < text.length; k++) {
          current.text += text[k];
          current.start.push(row * cols + x);
          current.end.push(row * cols + x + Math.max(1, width));
          current.pad.push(chars === '');
        }
      }
    }
    flush();
    return result;
  }

  /* Kleinschreibung je Zeichen, mit Rückverweis auf die Ursprungseinheit
     (z. B. „İ“ wird beim Kleinschreiben länger). */
  function fold(text) {
    let out = '';
    const back = [];
    let i = 0;
    for (const ch of text) {
      const lower = ch.toLowerCase();
      for (let k = 0; k < lower.length; k++) back.push(i);
      out += lower;
      i += ch.length;
    }
    return { text: out, back };
  }

  /* Alle Treffer (nicht überlappend), in Pufferreihenfolge. { row, col, length } in Zellen. */
  function findMatches(lines, query, cols, max = MAX_MATCHES) {
    const needle = fold(String(query || '').normalize('NFC')).text;
    if (!needle) return { matches: [], truncated: false };
    const matches = [];
    for (const line of lines) {
      const hay = fold(line.text);
      let from = 0;
      for (;;) {
        const at = hay.text.indexOf(needle, from);
        if (at < 0) break;
        const first = hay.back[at];
        const last = hay.back[at + needle.length - 1];
        const start = line.start[first];
        const length = line.end[last] - start;
        matches.push({ row: Math.floor(start / cols), col: start % cols, length });
        if (matches.length >= max) return { matches, truncated: true };
        from = at + needle.length;
      }
    }
    return { matches, truncated: false };
  }

  function nextIndex(current, count, step) {
    if (count <= 0) return -1;
    if (current < 0) return step < 0 ? count - 1 : 0;
    return (current + step + count) % count;
  }

  function summary(count, index, truncated) {
    if (count === 0) return 'Keine Treffer';
    return (index + 1) + '/' + count + (truncated ? '+' : '');
  }

  function scopeText(lines, max) {
    return 'Durchsucht den geladenen Verlauf dieser Kachel (aktuell ' + lines + ' Zeilen, max. ' + max + ').';
  }

  const api = { MAX_MATCHES, logicalLines, fold, findMatches, nextIndex, summary, scopeText };

  /* ---------- Oberfläche ---------- */
  function create({ document, getPane }) {
    const bars = new Map(); // paneId -> Bar

    function build(pane) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'tsearch-input';
      input.placeholder = 'Im Verlauf suchen …';
      input.setAttribute('aria-label', 'Im Terminalverlauf suchen');
      input.spellcheck = false;
      input.autocomplete = 'off';
      const count = document.createElement('span');
      count.className = 'tsearch-count';
      count.setAttribute('aria-live', 'polite');
      const mk = (text, title, onclick) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'tsearch-btn'; b.textContent = text; b.title = title;
        b.setAttribute('aria-label', title); b.onclick = onclick;
        return b;
      };
      const prev = mk('↑', 'Voriger Treffer (Umschalt+Eingabe)', () => step(-1));
      const next = mk('↓', 'Nächster Treffer (Eingabe)', () => step(1));
      const close = mk('✕', 'Suche schließen (Esc)', () => hide());
      const scope = document.createElement('div');
      scope.className = 'tsearch-scope';
      const row = document.createElement('div');
      row.className = 'tsearch-row';
      row.append(input, count, prev, next, close);
      const el = document.createElement('div');
      el.className = 'tsearch';
      el.setAttribute('role', 'search');
      el.hidden = true;
      el.append(row, scope);
      pane.el.append(el);

      const state = { pane, el, input, count, scope, matches: [], index: -1, truncated: false };

      function scan() {
        const term = pane.term;
        const buffer = term.buffer.active;
        const lines = logicalLines(buffer, term.cols);
        const max = (term.options && term.options.scrollback) || 0;
        scope.textContent = scopeText(buffer.length, max + term.rows);
        const found = findMatches(lines, input.value, term.cols);
        state.matches = found.matches; state.truncated = found.truncated;
      }
      function show() {
        const m = state.matches[state.index];
        if (!m) { try { pane.term.clearSelection(); } catch (_) { /* Terminal evtl. schon entsorgt */ } return; }
        const term = pane.term;
        term.select(m.col, m.row, m.length);
        // Treffer in die Mitte holen, wenn er außerhalb des sichtbaren Bereichs liegt.
        const top = term.buffer.active.viewportY;
        if (m.row < top || m.row >= top + term.rows) term.scrollToLine(Math.max(0, m.row - Math.floor(term.rows / 2)));
      }
      function render() {
        count.textContent = input.value ? summary(state.matches.length, state.index, state.truncated) : '';
        count.classList.toggle('none', !!input.value && state.matches.length === 0);
        prev.disabled = next.disabled = state.matches.length === 0;
      }
      function update() {
        scan();
        state.index = state.matches.length ? 0 : -1;
        // Ab der aktuellen Ansicht beginnen statt immer ganz oben im Verlauf.
        if (state.matches.length) {
          const top = pane.term.buffer.active.viewportY;
          const i = state.matches.findIndex((m) => m.row >= top);
          if (i >= 0) state.index = i;
        }
        render(); show();
      }
      function step(dir) {
        if (!input.value) return;
        // Der Puffer kann sich seit der letzten Suche verändert haben: neu lesen, Position behalten.
        const old = state.matches[state.index];
        scan();
        let idx = old ? state.matches.findIndex((m) => m.row === old.row && m.col === old.col) : -1;
        if (idx < 0 && old) idx = Math.min(state.index, state.matches.length - 1);
        state.index = nextIndex(idx, state.matches.length, dir);
        render(); show();
      }
      function hide() {
        el.hidden = true;
        try { pane.term.clearSelection(); } catch (_) { /* ignorieren */ }
        pane.focus();
      }
      input.addEventListener('input', update);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
        else if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
      });
      state.hide = hide; state.update = update; state.step = step;
      return state;
    }

    function open(pane) {
      if (!pane || !pane.el || !pane.term) return false;
      let bar = bars.get(pane.id);
      if (!bar || bar.pane !== pane) { bar = build(pane); bars.set(pane.id, bar); }
      bar.el.hidden = false;
      bar.update(); // zeigt auch den Suchumfang
      bar.input.focus();
      bar.input.select();
      return true;
    }
    function close(paneId) {
      const bar = bars.get(paneId);
      if (bar && !bar.el.hidden) bar.hide();
    }
    function forget(paneId) { bars.delete(paneId); }
    function isOpen(paneId) { const bar = bars.get(paneId); return !!bar && !bar.el.hidden; }
    return { open, close, forget, isOpen, getPane };
  }

  api.create = create;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckTerminalSearch = api;
})();
