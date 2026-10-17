'use strict';
/* F09: editierbare Übergabe an eine bewusst gewählte andere Kachel. Eingefügt wird ausschließlich über die Promptvorschau (F06). */
(function () {
  // „?“-Link zur Hilfe; ohne Hilfe-Panel (Tests, Node) bleibt er weg.
  const helpLink = (key) => (typeof window !== 'undefined' && window.DeckApp && window.DeckApp.help && window.DeckApp.help.link ? window.DeckApp.help.link(key) : null);
  const EXCERPT_LINES = 60;
  const EXCERPT_MAX = 4000;
  // Steuerzeichen außer Zeilenumbruch würde die Promptvorschau ablehnen; sie werden hier entfernt.
  const UNSAFE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029]/g;

  function clean(value) {
    const text = Array.isArray(value) ? value.join('\n') : value == null ? '' : String(value);
    return text.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(UNSAFE, '').trim();
  }

  function buildHandoffText({ sourceTitle, goal, results, files, questions, nextStep, progressExcerpt } = {}) {
    const blocks = ['Übergabe von ' + (clean(sourceTitle) || 'diesem Terminal')];
    const fields = [
      ['Ziel:', goal],
      ['Geprüfte Ergebnisse:', results],
      ['Relevante Dateien:', files],
      ['Offene Fragen:', questions],
      ['Genau ein nächster Schritt:', nextStep],
    ];
    for (const [label, value] of fields) {
      const body = clean(value);
      if (body) blocks.push(label + '\n' + body);
    }
    let excerpt = clean(progressExcerpt);
    if (excerpt.length > EXCERPT_MAX) excerpt = excerpt.slice(0, EXCERPT_MAX).trimEnd() + '\n(gekürzt)';
    if (excerpt) blocks.push('Auszug aus PROGRESS.md:\n' + excerpt);
    return blocks.join('\n\n');
  }

  // Laufende Kacheln außer der Quelle; beendete oder entsorgte bleiben draußen.
  function listTargets(panes, sourceId) {
    return (Array.isArray(panes) ? panes : []).filter(p => p && p.id !== sourceId && p.status === 'running' && !p.disposed);
  }

  // Erste ~60 Zeilen des Abschnitts „Aktueller Stand“; leer, wenn der Abschnitt fehlt.
  function progressExcerpt(content) {
    const lines = String(content == null ? '' : content).replace(/\r\n?/g, '\n').split('\n');
    const start = lines.findIndex(line => /^#{1,6}\s+Aktueller Stand\s*$/.test(line));
    if (start < 0) return '';
    const level = lines[start].match(/^#+/)[0].length;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const heading = lines[i].match(/^(#{1,6})\s/);
      if (heading && heading[1].length <= level) { end = i; break; }
    }
    return lines.slice(start, Math.min(end, start + EXCERPT_LINES)).join('\n').trimEnd();
  }

  function targetLabel(pane) {
    return [pane.project && pane.project.name, (pane.desc && pane.desc.title) || pane.id].filter(Boolean).join(' · ');
  }

  // UI: Dialog mit sichtbarer Quelle, Zielauswahl und editierbaren Feldern. Schreibt nie selbst ins Terminal.
  function createHandoffDialog({ document: doc, h, getSource, getTargets, getProjectId, readProgress, promptDraft, notify }) {
    let source = null, targets = [], openToken = 0;

    const title = h('h2', { id: 'handoff-title', text: 'Übergabe an anderes Terminal' }, ...[helpLink('uebergaben-und-anhaenge')].filter(Boolean));
    const sourceEl = h('p', { class: 'handoff-source' });
    const select = h('select', { id: 'handoff-target' });
    const noTargets = h('p', { class: 'handoff-note', hidden: true, text: 'Keine andere laufende Kachel in diesem Projekt.' });
    const field = (label, id, rows) => {
      const area = h('textarea', { id, rows });
      return { area, node: h('div', { class: 'handoff-field' }, h('label', { for: id, text: label }), area) };
    };
    const goal = field('Ziel der Übergabe', 'handoff-goal', 2);
    const results = field('Geprüfte Ergebnisse', 'handoff-results', 3);
    const files = field('Relevante Dateien', 'handoff-files', 2);
    const questions = field('Offene Fragen', 'handoff-questions', 2);
    const next = field('Genau ein nächster Schritt', 'handoff-next', 2);
    const progressBox = h('input', { type: 'checkbox', id: 'handoff-progress-on' });
    const progressLabel = h('label', { class: 'handoff-check', for: 'handoff-progress-on' }, progressBox, ' Auszug aus PROGRESS.md anhängen');
    const progressNote = h('p', { class: 'handoff-note', hidden: true });
    const progressText = h('textarea', { id: 'handoff-progress', rows: 6, hidden: true });
    const error = h('p', { class: 'handoff-error', role: 'alert', hidden: true });
    const cancel = h('button', { type: 'button', class: 'btn-small', text: 'Abbrechen', onclick: () => dialog.close() });
    const submit = h('button', { type: 'button', id: 'handoff-submit', class: 'btn-primary', text: 'In Promptvorschau', onclick: submitHandoff });
    const dialog = h('dialog', { id: 'handoff-dialog', class: 'handoff', 'aria-labelledby': 'handoff-title' },
      title, sourceEl,
      h('div', { class: 'handoff-field' }, h('label', { for: 'handoff-target', text: 'Ziel-Kachel' }), select),
      noTargets, goal.node, results.node, files.node, questions.node, next.node,
      progressLabel, progressNote, progressText, error,
      h('div', { class: 'handoff-actions' }, cancel, submit));
    doc.body.append(dialog);

    progressBox.addEventListener('change', () => { progressText.hidden = !progressBox.checked; });
    dialog.addEventListener('keydown', e => { e.stopPropagation(); });

    function showError(message) { error.textContent = message; error.hidden = false; }

    function fillTargets() {
      targets = listTargets(getTargets(), source.id);
      select.replaceChildren(...targets.map(p => h('option', { value: p.id, text: targetLabel(p) })));
      noTargets.hidden = targets.length > 0;
      select.disabled = targets.length === 0;
      submit.disabled = targets.length === 0;
    }

    // Markierter Text der Quellkachel ist nur ein Startwert und bleibt editierbar.
    function selectionOf(pane) {
      try { const t = pane.term; return t && t.hasSelection && t.hasSelection() ? t.getSelection() : ''; } catch (_) { return ''; }
    }

    async function loadProgress() {
      const my = openToken;
      let content = null;
      try {
        const r = await readProgress(getProjectId());
        content = r && typeof r.content === 'string' ? r.content : null;
      } catch (_) { content = null; }
      if (my !== openToken) return;
      const excerpt = content == null ? '' : progressExcerpt(content);
      progressBox.checked = false;
      progressText.value = excerpt;
      progressText.hidden = true;
      progressBox.disabled = !excerpt;
      progressNote.hidden = Boolean(excerpt);
      progressNote.textContent = content == null ? 'Keine PROGRESS.md gefunden.' : 'Kein Abschnitt „Aktueller Stand“ in PROGRESS.md gefunden.';
    }

    async function open() {
      const pane = getSource();
      if (!pane) { notify('Kein aktives Terminal.'); return false; }
      if (dialog.open) return false;
      source = pane;
      openToken++;
      sourceEl.textContent = 'Quelle: ' + targetLabel(pane);
      fillTargets();
      for (const f of [goal, results, files, questions, next]) f.area.value = '';
      results.area.value = selectionOf(pane);
      error.hidden = true; error.textContent = '';
      dialog.showModal();
      goal.area.focus();
      await loadProgress();
      return true;
    }

    function submitHandoff() {
      error.hidden = true;
      const target = listTargets(getTargets(), source && source.id).find(p => p.id === select.value);
      if (!target) { showError('Das Ziel ist nicht mehr verfügbar. Bitte eine andere Kachel wählen.'); return; }
      const text = buildHandoffText({
        sourceTitle: source.desc && source.desc.title,
        goal: goal.area.value,
        results: results.area.value,
        files: files.area.value,
        questions: questions.area.value,
        nextStep: next.area.value,
        progressExcerpt: progressBox.checked ? progressText.value : '',
      });
      let opened = false;
      try { opened = promptDraft.open({ terminalId: target.id, text }) === true; } catch (e) { opened = false; }
      // Die Promptvorschau meldet den Grund bereits über notify; hier bleibt der Dialog offen.
      if (!opened) { showError('Die Übergabe konnte nicht vorbereitet werden.'); return; }
      dialog.close();
    }

    return { open, close: () => dialog.close(), element: dialog };
  }

  const api = { buildHandoffText, listTargets, progressExcerpt, createHandoffDialog };
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildHandoffText, listTargets, progressExcerpt };
  if (typeof window !== 'undefined') window.DeckHandoff = api;
})();
