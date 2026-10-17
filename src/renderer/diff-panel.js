/* F04: Projektänderungen lesend ansehen; ausgewählte Zeilen mit Kommentar gehen über die Promptvorschau (F06). */
(function () {
  'use strict';
  // „?“-Link zur Hilfe (gemeinsamer Zugang in help-panel.js); ohne Hilfe-Panel bleibt er weg.
  const helpLink = (key, opts) => (typeof window !== 'undefined' && window.DeckHelp && window.DeckHelp.linkFor ? window.DeckHelp.linkFor(key, opts) : null);
  const MAX_EXCERPT_LINES = 40;
  const MAX_EXCERPT_CHARS = 3000;
  const STATUS = { M: 'geändert', A: 'neu', D: 'gelöscht', R: 'umbenannt', C: 'kopiert', T: 'Typ geändert', U: 'Konflikt' };

  // One file can appear twice: once staged, once unstaged.
  function groupFiles(files) {
    const groups = { staged: [], unstaged: [], untracked: [] };
    for (const f of files || []) {
      if (f.untracked) groups.untracked.push({ file: f, mode: 'untracked', status: 'neu' });
      if (f.staged) groups.staged.push({ file: f, mode: 'staged', status: STATUS[f.index] || f.index });
      if (f.unstaged) groups.unstaged.push({ file: f, mode: 'unstaged', status: STATUS[f.worktree] || f.worktree });
    }
    return groups;
  }

  // Selectable lines of a diff in display order; hunk headers and "\ No newline" are not selectable.
  function flatLines(diff) {
    const out = [];
    for (const hunk of (diff && diff.hunks) || []) for (const l of hunk.lines) if (l.type !== '\\') out.push(l);
    return out;
  }

  function nextSelection(sel, index, extend) {
    if (!extend || !sel) return { anchor: index, from: index, to: index };
    return { anchor: sel.anchor, from: Math.min(sel.anchor, index), to: Math.max(sel.anchor, index) };
  }

  function lineRange(lines) {
    const nums = (k) => lines.map((l) => l[k]).filter((n) => n !== null);
    const span = (a) => (a.length ? (a[0] === a[a.length - 1] ? String(a[0]) : a[0] + '–' + a[a.length - 1]) : null);
    const neu = span(nums('newNo')), alt = span(nums('oldNo'));
    if (neu && alt && neu !== alt) return 'Zeilen ' + neu + ' (vorher ' + alt + ')';
    if (neu) return 'Zeilen ' + neu;
    return alt ? 'vorher Zeilen ' + alt + ' (entfernt)' : '';
  }

  // The preview turns newlines into spaces and refuses tabs/control characters,
  // so the excerpt is kept compact on one line with ⏎ between diff lines.
  function clean(s) { return String(s).replace(/\t/g, '  ').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ''); }

  function buildPromptText({ path, compare, scopeLabel, lines, comment }) {
    const picked = lines || [];
    let excerpt = picked.slice(0, MAX_EXCERPT_LINES).map((l) => (l.type === ' ' ? '  ' : l.type + ' ') + l.text).join(' ⏎ ');
    let cut = picked.length > MAX_EXCERPT_LINES;
    if (excerpt.length > MAX_EXCERPT_CHARS) { excerpt = excerpt.slice(0, MAX_EXCERPT_CHARS); cut = true; }
    const where = [scopeLabel, compare].filter(Boolean).join(', ');
    const range = lineRange(picked);
    const head = 'Rückmeldung zu ' + path + (range ? ', ' + range : '') + (where ? ' (' + where + ')' : '');
    const note = comment && comment.trim() ? ': ' + comment.trim().replace(/\s*\n\s*/g, ' ') : '';
    const tail = excerpt ? ' — Ausschnitt: ' + excerpt + (cut ? ' ⏎ … (gekürzt)' : '') : '';
    return clean(head + note + tail);
  }

  function errText(e) { return String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }

  function createDiffPanel({ root, h, api, getContext, getTargets, openDraft, onClose }) {
    let open = false, req = 0;
    let ctx = null, list = null, error = '', loading = false;
    let current = null, diff = null, diffError = '', sel = null, comment = '', target = null;

    function key(item) { return item.mode + ':' + item.file.path; }

    async function refresh() {
      if (!open) return;
      const mine = ++req;
      ctx = getContext();
      loading = true; error = ''; render();
      if (!ctx || !ctx.projectId) { loading = false; list = null; error = 'Kein Projekt ausgewählt.'; render(); return; }
      try {
        const res = await api.list(ctx.projectId, ctx.workspaceId);
        if (mine !== req) return;
        list = res; error = res.ok ? '' : res.error;
      } catch (e) { if (mine !== req) return; list = null; error = errText(e); }
      loading = false;
      // Keep the open file if it still exists in the same mode.
      if (current && !(list && list.ok && Object.values(groupFiles(list.files)).flat().some((i) => key(i) === key(current)))) { current = null; diff = null; sel = null; }
      render();
      if (current) await show(current, true);
    }

    async function show(item, keepSelection) {
      const mine = ++req;
      current = item; diffError = '';
      if (!keepSelection) { diff = null; sel = null; }
      render();
      try {
        const res = await api.file(ctx.projectId, ctx.workspaceId, item.file.path, item.mode);
        if (mine !== req) return;
        if (res.ok) { diff = res; if (sel && sel.to >= flatLines(res).length) sel = null; } else { diff = null; diffError = res.error; }
      } catch (e) { if (mine !== req) return; diff = null; diffError = errText(e); }
      render();
    }

    function send() {
      const lines = flatLines(diff).slice(sel.from, sel.to + 1);
      const text = buildPromptText({ path: diff.path, compare: diff.compare, scopeLabel: list && list.scope && list.scope.kind === 'worktree' ? list.scope.label : '', lines, comment });
      try { openDraft({ terminalId: target, text }); comment = ''; sel = null; render(); } catch (e) { diffError = errText(e); render(); }
    }

    function renderList(body) {
      if (!list || !list.ok) return;
      const groups = groupFiles(list.files);
      const total = groups.staged.length + groups.unstaged.length + groups.untracked.length;
      if (!total) { body.append(h('p', { class: 'diff-empty', text: 'Keine lokalen Änderungen.' })); return; }
      for (const [name, label] of [['staged', 'Gestaged (Index gegen HEAD)'], ['unstaged', 'Nicht gestaged (Arbeitsbaum gegen Index)'], ['untracked', 'Neu, nicht verfolgt']]) {
        if (!groups[name].length) continue;
        const ul = h('ul', { class: 'diff-files' });
        for (const item of groups[name]) {
          const active = current && key(current) === key(item);
          ul.append(h('li', { class: 'diff-file' + (active ? ' on' : ''), title: item.file.oldPath ? item.file.oldPath + ' → ' + item.file.path : item.file.path, onclick: () => show(item) },
            h('span', { class: 'diff-status diff-st-' + item.mode, text: item.status }),
            h('span', { class: 'diff-path', text: item.file.oldPath ? item.file.oldPath + ' → ' + item.file.path : item.file.path })));
        }
        body.append(h('h3', { class: 'diff-group', text: label + ' · ' + groups[name].length }), ul);
      }
      if (list.truncated) body.append(h('p', { class: 'diff-note', text: 'Sehr viele Dateien: Liste wurde begrenzt.' }));
    }

    function renderDiff(body) {
      if (!current) return;
      const box = h('section', { class: 'diff-view' });
      box.append(h('div', { class: 'diff-view-head' }, h('strong', { text: current.file.path }), h('span', { class: 'diff-compare', text: diff ? diff.compare : '' })));
      if (diffError) box.append(h('p', { class: 'diff-error', role: 'alert', text: diffError }));
      else if (!diff) box.append(h('p', { class: 'diff-note', text: 'Lade Unterschiede …' }));
      else if (diff.binary) box.append(h('p', { class: 'diff-note', text: 'Binärdatei geändert – kein Textvergleich.' }));
      else if (diff.empty) box.append(h('p', { class: 'diff-note', text: diff.oldPath ? 'Nur umbenannt, Inhalt unverändert.' : 'Keine inhaltlichen Unterschiede (z. B. nur Dateirechte).' }));
      else {
        const table = h('div', { class: 'diff-lines', role: 'listbox', 'aria-multiselectable': 'true' });
        let i = 0;
        for (const hunk of diff.hunks) {
          table.append(h('div', { class: 'diff-hunk', text: hunk.header }));
          for (const l of hunk.lines) {
            if (l.type === '\\') { table.append(h('div', { class: 'diff-line diff-meta', text: l.text })); continue; }
            const idx = i++;
            const picked = sel && idx >= sel.from && idx <= sel.to;
            table.append(h('div', {
              class: 'diff-line diff-' + (l.type === '+' ? 'add' : l.type === '-' ? 'del' : 'ctx') + (picked ? ' picked' : ''),
              'data-index': String(idx), role: 'option', 'aria-selected': String(Boolean(picked)),
              onclick: (e) => { sel = nextSelection(sel, idx, e.shiftKey); render(); },
            }, h('span', { class: 'diff-no', text: l.oldNo === null ? '' : String(l.oldNo) }),
            h('span', { class: 'diff-no', text: l.newNo === null ? '' : String(l.newNo) }),
            h('span', { class: 'diff-text', text: (l.type === ' ' ? ' ' : l.type) + l.text })));
          }
        }
        box.append(table);
        if (diff.truncated) box.append(h('p', { class: 'diff-note', text: 'Großer Diff: nur der Anfang wird angezeigt.' }));
      }
      body.append(box);
      if (!diff || diff.binary || diff.empty || diffError) return;
      const lines = sel ? flatLines(diff).slice(sel.from, sel.to + 1) : [];
      const targets = getTargets();
      if (!targets.some((t) => t.id === target)) target = (targets.find((t) => t.active) || targets[0] || {}).id || null;
      const area = h('textarea', { class: 'diff-comment', rows: '3', placeholder: 'Kommentar für den Agenten …', oninput: (e) => { comment = e.target.value; } });
      area.value = comment;
      const select = h('select', { class: 'diff-target', 'aria-label': 'Zielkachel', onchange: (e) => { target = e.target.value; } },
        ...targets.map((t) => { const o = h('option', { value: t.id, text: t.label }); if (t.id === target) o.selected = true; return o; }));
      body.append(h('section', { class: 'diff-feedback' },
        h('p', { class: 'diff-note', text: sel ? 'Ausgewählt: ' + (lineRange(lines) || (lines.length + ' Zeilen')) + ' · Umschalt-Klick erweitert' : 'Zeile anklicken, Umschalt-Klick wählt einen Bereich.' }),
        area,
        h('div', { class: 'diff-actions' }, targets.length ? select : h('span', { class: 'diff-note', text: 'Keine laufende Kachel in diesem Projekt.' }),
          h('button', { class: 'btn-small', text: 'In Promptvorschau', disabled: !sel || !target, title: 'Öffnet die Vorschau; eingefügt wird erst dort', onclick: send }))));
    }

    function render() {
      if (!open) return;
      const prev = root.querySelector && root.querySelector('.diff-body');
      const scrollTop = prev ? prev.scrollTop : 0;
      const scope = list && list.scope ? list.scope.label : '';
      root.replaceChildren(h('div', { class: 'diff-head' },
        h('strong', { text: 'Projektänderungen' }),
        helpLink('diff-und-git'),
        h('span', { class: 'diff-scope', text: [ctx && ctx.projectName, scope, list && list.ok && list.branch ? 'Branch ' + list.branch : ''].filter(Boolean).join(' · ') }),
        h('span', { class: 'spacer' }),
        h('button', { class: 'ib', text: '⟳', title: 'Änderungen neu lesen', disabled: loading, onclick: refresh }),
        h('button', { class: 'ib', text: '✕', title: 'Schließen', onclick: onClose })));
      const body = h('div', { class: 'diff-body' });
      body.append(h('p', { class: 'diff-note', text: 'Nur lesend: hier wird nichts gestaged, zurückgesetzt oder committet. Änderungen werden keinem Agenten zugeschrieben.' }));
      if (loading && !list) body.append(h('p', { text: 'Lese Änderungen …' }));
      if (error) body.append(h('p', { class: 'diff-error', role: 'alert', text: error }));
      renderList(body);
      renderDiff(body);
      root.append(body);
      body.scrollTop = scrollTop; // a click on a line must not jump back to the top
    }

    return {
      toggle(force) {
        const next = force === undefined ? !open : Boolean(force);
        if (next === open) return open;
        open = next; root.hidden = !open;
        if (open) refresh(); else { req++; root.replaceChildren(); }
        return open;
      },
      refresh,
      isOpen: () => open,
      state: () => ({ ctx, list, current, diff, sel, target, comment }),
    };
  }

  const api = { createDiffPanel, groupFiles, flatLines, nextSelection, lineRange, buildPromptText, MAX_EXCERPT_LINES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    const D = (window.DeckApp = window.DeckApp || {});
    let panel;
    D.diffPanel = {
      init(opts) { panel = createDiffPanel({ ...opts, root: document.getElementById('diff-panel'), h: D.h, api: window.deck.diff }); },
      toggle: (force) => panel.toggle(force),
      refresh: () => panel.refresh(),
      isOpen: () => Boolean(panel && panel.isOpen()),
      state: () => panel.state(),
    };
  }
})();
