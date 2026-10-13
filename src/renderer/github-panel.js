/* GitHub: Git-Status/Sync in der Sidebar (D.git) und Repository-Auswahl im Dialog (D.openGithubPicker). */
(function () {
  'use strict';
  const D = (window.DeckApp = window.DeckApp || {});
  const { h, notify, errText } = D;
  const api = window.deck;

  /* ====================== Git-Status in der Sidebar ====================== */
  const states = new Map();   // projectId -> { isRepo, branch, hasUpstream, ahead, behind, changes, busy }
  const inflight = new Set(); // projectId, laufende Status-Abfragen
  const pulled = new Set();   // projectId, bereits beim Öffnen gepullt (in diesem App-Lauf)
  let ctx = { projects: () => [], activeId: () => null, render: () => {} };

  const findProject = (id) => ctx.projects().find((p) => p.id === id) || null;
  const KEYS = ['isRepo', 'branch', 'hasUpstream', 'ahead', 'behind', 'changes', 'busy'];

  /* Übernimmt ein Ergebnis; ignoriert Projekte, die inzwischen entfernt wurden. Gibt den Eintrag oder null zurück. */
  function apply(pid, patch) {
    if (!findProject(pid)) return null;
    const old = states.get(pid) || {};
    const next = { ...old };
    for (const k of KEYS) if (k in patch) next[k] = patch[k];
    states.set(pid, next);
    if (KEYS.some((k) => old[k] !== next[k])) ctx.render();
    return next;
  }
  const fromResult = (r) => ({
    isRepo: !!(r && r.isRepo), branch: r && r.branch || null, hasUpstream: !!(r && r.hasUpstream),
    ahead: Number(r && r.ahead) || 0, behind: Number(r && r.behind) || 0, changes: Number(r && r.changes) || 0,
  });

  async function refresh(pid) {
    if (!pid || inflight.has(pid) || !findProject(pid)) return states.get(pid) || null;
    inflight.add(pid);
    try {
      return apply(pid, fromResult(await api.git.status(pid)));
    } catch (_) {
      return states.get(pid) || null; // lokal und leise: kein Hinweis
    } finally {
      inflight.delete(pid);
    }
  }

  function summary(r) {
    if (r.pulled && r.pushed) return 'Aktualisiert und gepusht';
    if (r.pulled) return 'Aktualisiert';
    if (r.pushed) return 'Gepusht';
    return 'Alles aktuell';
  }

  async function sync(project) {
    const st = states.get(project.id);
    if (!st || !st.isRepo || st.busy) return;
    apply(project.id, { busy: true });
    try {
      const r = await api.git.sync(project.id);
      apply(project.id, { ...fromResult(r), busy: false });
      if (r && r.message) notify(`${project.name}: ${r.message}`, 'warn', 12000);
      else notify(`${project.name}: ${summary(r || {})}`, r && (r.pulled || r.pushed) ? 'ok' : 'info');
    } catch (e) {
      apply(project.id, { busy: false });
      notify(`${project.name}: ${errText(e)}`);
    }
  }

  /* Beim ersten Auswählen in diesem App-Lauf einmal im Hintergrund pullen. */
  async function pullOnce(project) {
    const pid = project.id;
    let st = states.get(pid) || await refresh(pid);
    if (!st || !st.isRepo || st.busy || !findProject(pid)) return;
    apply(pid, { busy: true });
    try {
      const r = await api.git.pull(pid);
      apply(pid, { ...fromResult(r), busy: false });
      const name = (findProject(pid) || project).name;
      if (r && r.pulled) notify(`${name}: neue Änderungen von GitHub geholt`, 'ok');
      if (r && r.message) notify(`${name}: ${r.message}`, 'warn', 12000);
    } catch (e) {
      apply(pid, { busy: false });
      notify(`${(findProject(pid) || project).name}: ${errText(e)}`, 'warn', 10000);
    }
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /* Zweite Zeile unter dem Projektnamen; null, wenn kein Repository. */
  function gitLine(project) {
    const st = states.get(project.id);
    if (!st || !st.isRepo) return null;
    const kids = [h('span', { class: 'git-branch', text: '⎇ ' + (st.branch || 'kein Branch'), title: st.branch ? `Branch: ${st.branch}` : 'Kein Branch ausgewählt (detached HEAD)' })];
    if (st.changes) kids.push(h('span', { class: 'git-ind changes', text: '●' + st.changes, title: plural(st.changes, 'nicht committete Änderung', 'nicht committete Änderungen') }));
    if (st.ahead) kids.push(h('span', { class: 'git-ind ahead', text: '↑' + st.ahead, title: plural(st.ahead, 'Commit', 'Commits') + ' noch nicht auf GitHub (zum Pushen)' }));
    if (st.behind) kids.push(h('span', { class: 'git-ind behind', text: '↓' + st.behind, title: plural(st.behind, 'Commit', 'Commits') + ' auf GitHub, die hier fehlen (zum Pullen)' }));
    kids.push(h('button', {
      class: 'proj-sync' + (st.busy ? ' busy' : ''), text: '⟳',
      title: st.busy ? 'Synchronisiert …' : 'Mit GitHub synchronisieren (pullen, dann pushen)',
      onclick: (e) => { e.stopPropagation(); sync(project); },
    }));
    return h('div', { class: 'proj-git' }, kids);
  }

  D.git = {
    init(c) {
      ctx = c;
      window.addEventListener('focus', () => refresh(ctx.activeId()));
      setInterval(() => { if (!document.hidden) refresh(ctx.activeId()); }, 20000);
    },
    /* Einmaliger, gestaffelter Start-Durchlauf (nur lokaler Status). */
    start() {
      ctx.projects().forEach((p, i) => setTimeout(() => refresh(p.id), 600 + i * 250));
    },
    line: gitLine,
    forget(pid) { states.delete(pid); inflight.delete(pid); pulled.delete(pid); },
    onSelect(project) {
      if (pulled.has(project.id)) { refresh(project.id); return; }
      pulled.add(project.id);
      pullOnce(project);
    },
  };

  /* ====================== Repository-Auswahl ====================== */
  const trimSlash = (s) => String(s || '').replace(/\/+$/, '');

  function fmtDate(iso) {
    const t = iso ? Date.parse(iso) : NaN;
    if (isNaN(t)) return '';
    const min = Math.floor((Date.now() - t) / 60000);
    if (min < 1) return 'gerade eben';
    if (min < 60) return `vor ${min} Min.`;
    if (min < 1440) return `vor ${Math.floor(min / 60)} Std.`;
    if (min < 10080) return `vor ${Math.floor(min / 1440)} Tg.`;
    return new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* opts: { projects: () => Project[], onPicked: (project) => void } */
  D.openGithubPicker = function (opts) {
    const modal = document.getElementById('modal');
    const box = h('div', { class: 'gh-dialog' });
    let closed = false, busy = false, repos = [], shown = [], hi = 0, search = null, listEl = null, statusEl = null, closeBtn = null;

    const close = () => {
      if (closed || busy) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      modal.onmousedown = null;
      modal.hidden = true;
      modal.replaceChildren();
    };
    const setBody = (...kids) => box.replaceChildren(h('h2', { text: 'Von GitHub hinzufügen' }), ...kids);
    const footer = (...btns) => h('div', { class: 'row' }, ...btns, h('button', { type: 'button', class: 'btn-small', text: 'Schließen', onclick: close }));
    const note = (text, kind) => h('p', { class: 'gh-note' + (kind ? ' ' + kind : ''), text });

    /* --- Anmeldung prüfen --- */
    async function checkStatus() {
      setBody(note('GitHub-Anmeldung wird geprüft …'));
      let st;
      try { st = await api.github.status(); } catch (e) { if (!closed) showProblem('GitHub konnte nicht geprüft werden: ' + errText(e)); return; }
      if (closed) return;
      if (!st || !st.installed) showProblem('Das GitHub-Tool „gh“ ist nicht installiert. Installiere es (z. B. mit „brew install gh“) und drücke danach „Erneut prüfen“.');
      else if (!st.loggedIn) showProblem('Du bist bei GitHub nicht angemeldet. Führe in einem beliebigen Terminal (auch in einem Terminal dieser App) „gh auth login --web“ aus und drücke danach „Erneut prüfen“.');
      else showMain(st.user);
    }
    function showProblem(text) {
      const retry = h('button', { type: 'button', class: 'btn-primary', text: 'Erneut prüfen', onclick: checkStatus });
      setBody(note(text), footer(retry));
      retry.focus();
    }

    /* --- Hauptansicht --- */
    function showMain(user) {
      search = h('input', { type: 'search', placeholder: 'Repositories durchsuchen …', autocomplete: 'off', spellcheck: false });
      search.addEventListener('input', () => { hi = 0; renderList(); });
      listEl = h('div', { class: 'gh-list' });
      statusEl = h('p', { class: 'gh-note', hidden: true });
      closeBtn = h('button', { type: 'button', class: 'btn-small', text: 'Schließen', onclick: close });
      setBody(h('p', { class: 'gh-user', text: user ? `Angemeldet als ${user}` : 'Angemeldet' }), search, listEl, statusEl, h('div', { class: 'row' }, closeBtn));
      search.focus();
      loadRepos();
    }
    function setStatus(text, kind) {
      statusEl.hidden = !text;
      statusEl.textContent = text || '';
      statusEl.className = 'gh-note' + (kind ? ' ' + kind : '');
    }

    async function loadRepos() {
      repos = []; shown = [];
      listEl.replaceChildren(h('p', { class: 'gh-note', text: 'Repositories werden geladen …' }));
      let res;
      try { res = await api.github.listRepos(); } catch (e) {
        if (closed) return;
        listEl.replaceChildren(h('p', { class: 'gh-note err', text: 'Repositories konnten nicht geladen werden: ' + errText(e) }),
          h('button', { type: 'button', class: 'btn-small', text: 'Erneut versuchen', onclick: loadRepos }));
        return;
      }
      if (closed) return;
      repos = Array.isArray(res) ? res : [];
      hi = 0;
      renderList();
    }

    function renderList() {
      const q = search.value.trim().toLowerCase();
      shown = repos.filter((r) => !q || (r.nameWithOwner + ' ' + (r.description || '')).toLowerCase().includes(q));
      if (hi >= shown.length) hi = Math.max(0, shown.length - 1);
      if (!shown.length) {
        listEl.replaceChildren(h('p', { class: 'gh-note', text: repos.length ? 'Keine Treffer.' : 'Keine Repositories gefunden.' }));
        return;
      }
      const have = new Set(opts.projects().map((p) => trimSlash(p.path)));
      listEl.replaceChildren(...shown.map((r, i) => {
        const [owner, ...rest] = String(r.nameWithOwner).split('/');
        const name = rest.join('/') || owner;
        const head = h('div', { class: 'gh-line' },
          h('span', { class: 'gh-repo', text: name }),
          rest.length ? h('span', { class: 'gh-owner', text: owner }) : null,
          r.isPrivate ? h('span', { class: 'gh-tag', text: 'privat' }) : null,
          r.localPath ? h('span', { class: 'gh-tag local', text: 'bereits auf diesem Mac', title: r.localPath }) : null,
          r.localPath && have.has(trimSlash(r.localPath)) ? h('span', { class: 'gh-tag proj', text: 'bereits Projekt' }) : null,
          h('span', { class: 'spacer' }),
          h('span', { class: 'gh-date', text: fmtDate(r.updatedAt), title: r.updatedAt ? new Date(r.updatedAt).toLocaleString('de-DE') : '' }));
        const row = h('div', { class: 'gh-row' + (i === hi ? ' hi' : ''), title: r.nameWithOwner }, head,
          r.description ? h('div', { class: 'gh-desc', text: r.description }) : null);
        row.addEventListener('mouseenter', () => setHi(i, false));
        row.addEventListener('click', () => pick(r));
        return row;
      }));
      scrollHi();
    }
    function setHi(i, scroll) {
      if (i === hi || !shown.length) return;
      const rows = listEl.children;
      if (rows[hi]) rows[hi].classList.remove('hi');
      hi = i;
      if (rows[hi]) rows[hi].classList.add('hi');
      if (scroll) scrollHi();
    }
    function scrollHi() { const el = listEl.children[hi]; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }

    /* --- Auswählen --- */
    async function pick(r) {
      if (busy || closed) return;
      busy = true;
      listEl.classList.add('disabled');
      search.readOnly = true;
      closeBtn.disabled = true;
      setStatus(`${r.nameWithOwner} ${r.localPath ? 'wird hinzugefügt …' : 'wird geklont …'}`, 'busy');
      let project;
      try {
        project = await api.github.clone(r.nameWithOwner);
      } catch (e) {
        busy = false;
        if (closed) return;
        listEl.classList.remove('disabled');
        search.readOnly = false;
        closeBtn.disabled = false;
        setStatus(`${r.nameWithOwner}: ${errText(e)}`, 'err');
        search.focus();
        return;
      }
      busy = false;
      close();
      if (project) opts.onPicked(project);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (busy || !listEl || !shown.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(shown.length - 1, hi + 1), true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(0, hi - 1), true); }
      else if (e.key === 'Enter' && shown[hi] && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); pick(shown[hi]); }
    }

    modal.onkeydown = null;
    modal.onmousedown = (e) => { if (e.target === modal) close(); };
    document.addEventListener('keydown', onKey, true);
    modal.replaceChildren(box);
    modal.hidden = false;
    checkStatus();
  };
})();
