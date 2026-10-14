/* Arbeitskopie wählen (F07): Projektordner, vorhandene Git-Worktrees oder eine neue.
   D.worktreePicker.open({ project, onChoose(workspace | null) }) – null heißt Projektordner. */
(function () {
  'use strict';
  const D = (window.DeckApp = window.DeckApp || {});
  const { h, guard, notify } = D;
  const api = window.deck;

  const baseName = (p) => String(p || '').split('/').filter(Boolean).pop() || p;

  function open({ project, onChoose }) {
    const modal = document.getElementById('modal');
    const close = () => { modal.hidden = true; modal.replaceChildren(); };
    const list = h('div', { class: 'wt-list' });
    const branch = h('input', { placeholder: 'neuer Branch, z. B. feature/suche', spellcheck: 'false' });
    const base = h('input', { placeholder: 'HEAD', spellcheck: 'false' });
    const err = h('div', { class: 'wt-error', hidden: true });
    const note = h('p', { class: 'wt-note', text: 'Eine Arbeitskopie trennt Dateien, nicht Ports oder Datenbanken. Nicht gesicherte Änderungen des Projektordners werden nicht übernommen.' });

    const showError = (t) => { err.textContent = t || ''; err.hidden = !t; };
    const choose = (ws) => { close(); onChoose(ws); };

    function row(title, detail, { onClick, extra } = {}) {
      return h('div', { class: 'wt-row' + (onClick ? ' pick' : ''), onclick: onClick || null },
        h('div', { class: 'wt-main' },
          h('span', { class: 'wt-title', text: title }),
          detail ? h('small', { class: 'wt-detail', text: detail, title: detail }) : null),
        extra || null);
    }

    async function render() {
      list.replaceChildren(row('Projektordner', project.path, { onClick: () => choose(null) }));
      const items = (await guard(() => api.worktrees.list(project.id))) || [];
      for (const ws of items) {
        const state = h('span', { class: 'wt-state', text: '…' });
        const del = h('button', {
          type: 'button', class: 'btn-small', text: 'Entfernen',
          title: 'Entfernt nur eine saubere Arbeitskopie; der Branch bleibt',
          onclick: async (e) => {
            e.stopPropagation();
            const r = await guard(() => api.worktrees.remove(ws.workspaceId));
            if (r && r.ok) { notify(`Arbeitskopie entfernt, Branch „${r.branchKept}“ bleibt.`, 'ok'); render(); }
            else if (r) showError(r.error || 'Entfernen nicht möglich.');
          },
        });
        const el = row(ws.branch, ws.cwd, { extra: h('div', { class: 'wt-side' }, state, del) });
        el.classList.add('pick');
        el.addEventListener('click', () => {
          if (state.dataset.missing === '1') { showError('Diese Arbeitskopie fehlt auf der Platte.'); return; }
          choose(ws);
        });
        list.append(el);
        guard(() => api.worktrees.inspect(ws.workspaceId)).then((i) => {
          if (!i || !i.ok) { state.textContent = '?'; return; }
          if (!i.exists) { state.dataset.missing = '1'; state.textContent = 'fehlt'; state.classList.add('bad'); return; }
          state.textContent = i.unreadable ? 'unklar' : i.changes ? `${i.changes} Änderungen` : 'sauber';
          if (i.changes) state.classList.add('dirty');
        });
      }
    }

    const form = h('form', null,
      h('h2', { text: 'Arbeitskopie für „' + project.name + '“' }),
      list,
      h('h3', { text: 'Neue Arbeitskopie' }),
      h('label', { text: 'Branch (wird neu angelegt)' }, branch),
      h('label', { text: 'Ausgangsbasis (optional)' }, base),
      note, err,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn-small', text: 'Abbrechen', onclick: close }),
        h('button', { type: 'submit', class: 'btn-primary', text: 'Anlegen und Terminal öffnen' })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const name = branch.value.trim();
      if (!name) { showError('Bitte einen Branch-Namen eingeben.'); return; }
      const r = await guard(() => api.worktrees.create(project.id, { branch: name, baseRef: base.value.trim() || undefined }));
      if (!r) return;
      if (!r.ok) { showError(r.error || 'Arbeitskopie konnte nicht angelegt werden.'); return; }
      if (r.projectChanges > 0) notify(`${r.projectChanges} nicht gesicherte Änderungen im Projektordner sind in der neuen Arbeitskopie nicht enthalten.`);
      choose(r.worktree);
    });
    modal.onmousedown = (e) => { if (e.target === modal) close(); };
    modal.onkeydown = (e) => { if (e.key === 'Escape') close(); };
    modal.replaceChildren(form);
    modal.hidden = false;
    render();
    branch.focus();
  }

  D.worktreePicker = { open };
})();
