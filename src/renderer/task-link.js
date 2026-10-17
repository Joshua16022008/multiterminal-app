/* F10 (Variante A): Kachel-Chip mit verknüpfter Second-Brain-Aufgabe. Nur Lesen; gespeichert wird allein die ID. */
(function () {
  'use strict';

  const STATUS_TEXT = {
    open: 'offen', overdue: 'überfällig', today: 'heute fällig', done: 'erledigt',
    missing: 'nicht mehr offen oder entfernt', offline: 'Second Brain nicht erreichbar', loading: 'lädt …', error: 'Fehler',
  };
  const TYPE_TEXT = { todo: 'Aufgabe', goal: 'Ziel' };

  // Zustand einer Verknüpfung aus der Antwort von secondBrain:getTask.
  function statusOf(result) {
    if (!result) return 'loading';
    if (!result.ok) return result.offline ? 'offline' : 'error';
    if (result.missing) return 'missing';
    const t = result.task;
    if (t.done) return 'done';
    if (t.overdue) return 'overdue';
    if (t.dueToday) return 'today';
    return 'open';
  }

  function shorten(text, max = 28) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  function chipText(id, result) {
    if (!id) return '+ Aufgabe';
    if (result && result.ok && result.task) return shorten(result.task.title);
    const st = statusOf(result);
    if (st === 'missing') return 'Aufgabe fehlt';
    if (st === 'offline') return 'Aufgabe (offline)';
    if (st === 'loading') return 'Aufgabe …';
    return 'Aufgabe ?';
  }

  function dueText(task) {
    return task && task.dueDate ? task.dueDate.split('-').reverse().join('.') : 'keine';
  }

  // Auswahlliste im Popover: nur offene Aufgaben, Bereichsfilter und Textsuche.
  function filterTasks(tasks, { space = '', query = '' } = {}) {
    const q = String(query).trim().toLowerCase();
    return (Array.isArray(tasks) ? tasks : []).filter((t) => !t.done
      && (!space || t.space === space)
      && (!q || t.title.toLowerCase().includes(q)));
  }

  function createTaskLink({ desc, api, h, onChange, focusTerminal, doc = document }) {
    let result = null;     // letzte Antwort von getTask
    let list = null;       // letzte Antwort von listTasks
    let pop = null, space = '', query = '', busy = false;

    const chip = h('button', { class: 'task-chip empty', type: 'button', title: 'Second-Brain-Aufgabe verknüpfen' });
    const dot = h('span', { class: 'task-dot' });
    const label = h('span', { class: 'task-label' });
    chip.append(dot, label);

    function paintChip() {
      const id = desc.secondBrainTodoId;
      const st = id ? statusOf(result) : 'none';
      chip.classList.toggle('empty', !id);
      chip.dataset.status = st;
      dot.hidden = !id;
      label.textContent = chipText(id, result);
      chip.title = id
        ? (result && result.task ? result.task.title + ' – ' : '') + STATUS_TEXT[st] + ' (Klick für Details)'
        : 'Second-Brain-Aufgabe verknüpfen';
    }

    async function load() {
      const id = desc.secondBrainTodoId;
      if (!id) { result = null; paintChip(); renderPop(); return; }
      result = null; paintChip(); renderPop();
      try { result = await api.secondBrain.getTask(id); } catch (_) { result = { ok: false, offline: true, error: 'Second Brain nicht erreichbar.' }; }
      if (desc.secondBrainTodoId !== id) return;
      paintChip(); renderPop();
    }

    async function loadList() {
      busy = true; renderPop();
      try { list = await api.secondBrain.listTasks(); } catch (_) { list = { ok: false, offline: true, error: 'Second Brain nicht erreichbar.' }; }
      busy = false; renderPop();
    }

    function link(task) {
      desc.secondBrainTodoId = task.id;
      result = { ok: true, task };
      onChange();
      paintChip(); renderPop();
      focusFirst();
    }
    function unlink() {
      delete desc.secondBrainTodoId;
      result = null;
      onChange();
      paintChip(); renderPop();
      const s = pop && pop.querySelector('.task-search'); if (s) s.focus();
    }

    function place() {
      if (!pop) return;
      const r = chip.getBoundingClientRect();
      pop.style.top = Math.round(r.bottom + 4) + 'px';
      pop.style.left = Math.max(8, Math.min(Math.round(r.left), window.innerWidth - 340)) + 'px';
    }

    function renderPop() {
      if (!pop) return;
      const keepSearch = pop.querySelector('.task-search') === doc.activeElement;
      pop.replaceChildren();
      const id = desc.secondBrainTodoId;
      pop.append(h('div', { class: 'task-pop-head' }, h('strong', { text: 'Second-Brain-Aufgabe' }), h('span', { class: 'spacer' }),
        h('button', { class: 'ib', type: 'button', text: '✕', title: 'Schließen (Esc)', onclick: () => close(true) })));
      if (id) renderLinked(id); else renderPicker();
      if (keepSearch) { const s = pop.querySelector('.task-search'); if (s) s.focus(); }
      place();
    }

    function renderLinked(id) {
      const st = statusOf(result);
      const box = h('div', { class: 'task-detail' });
      if (result && result.ok && result.task) {
        const t = result.task;
        box.append(h('p', { class: 'task-title', text: t.title }),
          h('p', { class: 'task-meta', text: `${TYPE_TEXT[t.type] || t.type} · ${t.space || 'ohne Bereich'} · fällig: ${dueText(t)}` }));
      }
      box.append(h('p', { class: 'task-status', 'data-status': st, role: 'status', text: 'Status: ' + STATUS_TEXT[st] }));
      if (st === 'offline') box.append(h('p', { class: 'task-note', text: 'Second Brain nicht erreichbar – Verknüpfung bleibt gespeichert (ID ' + id + '). Das Terminal ist unberührt.' }));
      else if (st === 'error') box.append(h('p', { class: 'task-note', text: (result && result.error) || 'Unbekannter Fehler.' }));
      else if (st === 'missing') box.append(h('p', { class: 'task-note', text: 'Die Aufgabe (ID ' + id + ') ist nicht mehr offen oder wurde entfernt. Die Verknüpfung bleibt, bis du sie löst.' }));
      box.append(h('div', { class: 'task-actions' },
        h('button', { class: 'btn-small', type: 'button', text: 'Aktualisieren', disabled: st === 'loading', onclick: load }),
        h('button', { class: 'btn-small', type: 'button', text: 'Verknüpfung lösen', onclick: unlink })));
      pop.append(box);
    }

    function renderPicker() {
      const search = h('input', { class: 'task-search', type: 'search', placeholder: 'Aufgabe suchen …', value: query, 'aria-label': 'Aufgabe suchen' });
      search.addEventListener('input', () => { query = search.value; renderPop(); });
      const spaces = h('div', { class: 'task-spaces' }, ...['', 'Arbeit', 'Privat', 'Schule'].map((s) =>
        h('button', { class: 'btn-small' + (space === s ? ' on' : ''), type: 'button', text: s || 'Alle', onclick: () => { space = s; renderPop(); } })));
      pop.append(search, spaces);
      const body = h('div', { class: 'task-list' });
      if (busy && !list) body.append(h('p', { class: 'task-note', text: 'Lade Aufgaben …' }));
      else if (!list || !list.ok) body.append(h('p', { class: 'task-note', role: 'alert', text: (list && list.error) || 'Aufgaben konnten nicht geladen werden.' }));
      else {
        const items = filterTasks(list.tasks, { space, query });
        if (!items.length) body.append(h('p', { class: 'task-note', text: 'Keine offene Aufgabe gefunden.' }));
        for (const t of items.slice(0, 60)) {
          body.append(h('button', { class: 'task-item', type: 'button', 'data-task-id': t.id, onclick: () => link(t) },
            h('span', { class: 'task-item-title', text: t.title }),
            h('span', { class: 'task-item-meta', text: `${TYPE_TEXT[t.type]} · ${t.space || '–'}${t.dueDate ? ' · ' + dueText(t) : ''}` })));
        }
      }
      pop.append(body, h('div', { class: 'task-actions' },
        h('button', { class: 'btn-small', type: 'button', text: 'Liste aktualisieren', disabled: busy, onclick: loadList })));
    }

    function focusFirst() { const b = pop && pop.querySelector('.task-actions button'); if (b) b.focus(); }
    // Esc gilt auch, wenn der Fokus gerade nirgends im Popover liegt (z. B. nach dem Neuzeichnen).
    function onDocKey(e) { if (pop && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); } }
    function onDocDown(e) { if (pop && !pop.contains(e.target) && !chip.contains(e.target)) close(false); }

    function open() {
      if (pop) { close(false); return; }
      pop = h('div', { class: 'task-pop', role: 'dialog', 'aria-label': 'Second-Brain-Aufgabe' });
      // Kein Tastendruck aus dem Popover erreicht das Terminal oder globale Kürzel.
      pop.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); close(true); }
      });
      pop.addEventListener('keyup', (e) => e.stopPropagation());
      pop.addEventListener('keypress', (e) => e.stopPropagation());
      doc.body.append(pop);
      doc.addEventListener('mousedown', onDocDown, true);
      doc.addEventListener('keydown', onDocKey, true);
      window.addEventListener('resize', place);
      renderPop();
      if (!desc.secondBrainTodoId) {
        if (!list) loadList();
        const s = pop.querySelector('.task-search'); if (s) s.focus();
      } else {
        focusFirst();
      }
    }

    function close(refocus) {
      if (!pop) return;
      pop.remove(); pop = null;
      doc.removeEventListener('mousedown', onDocDown, true);
      doc.removeEventListener('keydown', onDocKey, true);
      window.removeEventListener('resize', place);
      if (refocus && focusTerminal) focusTerminal();
    }

    chip.addEventListener('click', (e) => { e.stopPropagation(); open(); });
    paintChip();
    if (desc.secondBrainTodoId) load();

    return { el: chip, close, refresh: load, isOpen: () => !!pop };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { statusOf, chipText, filterTasks, shorten, dueText, createTaskLink, STATUS_TEXT };
  if (typeof window !== 'undefined') {
    // Nur Entwicklerversion: diese Datei bringt auch ihre Texte für Komfort, Hotkeys und Menüknopf mit.
    const QOL_ITEM = ['taskChip', '„+ Aufgabe“ im Kachelkopf', 'Verknüpfung mit Second-Brain-Aufgaben'];
    window.DeckTaskLink = { createTaskLink, statusOf, chipText, filterTasks, QOL_ITEM };
    if (window.DeckHotkeys && window.DeckHotkeys.setLabel) window.DeckHotkeys.setLabel('task-link', 'Second-Brain-Aufgabe der Kachel');
    const qolButton = typeof document !== 'undefined' && window.deck && window.deck.secondBrain ? document.getElementById('btn-qol') : null;
    if (qolButton) qolButton.title = 'Komfort: Markierungen, Animationen, Sortierung und Aufgaben-Chip ein- und ausschalten';
  }
})();
