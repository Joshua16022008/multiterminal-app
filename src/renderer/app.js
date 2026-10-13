/* App: Zustand, Sidebar, Projektwechsel, Plus-Menü, Session speichern/wiederherstellen. */
(function () {
  'use strict';
  const D = (window.DeckApp = window.DeckApp || {});
  const { h, guard, notify } = D;
  const api = window.deck;
  const MAX = (window.DeckLayout && window.DeckLayout.MAX_TERMINALS) || 10;

  const S = (D.state = {
    projects: [], presets: [], activeId: null,
    panes: new Map(),       // projectId -> Pane[]
    grids: new Map(),       // projectId -> grid element
    activeByProject: {},    // projectId -> paneId
    editing: false,
    accounts: [],           // Anbieter mit Konten (accounts.list)
  });
  const $ = (id) => document.getElementById(id);
  const panesOf = (pid) => S.panes.get(pid) || [];
  const activeProject = () => S.projects.find((p) => p.id === S.activeId) || null;
  const activePane = () => {
    const list = panesOf(S.activeId);
    return list.find((p) => p.id === S.activeByProject[S.activeId]) || list[0] || null;
  };

  /* ---------- Session ---------- */
  let saveTimer;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveSessionNow, 400); }
  function buildSession() {
    const projects = {};
    for (const p of S.projects) projects[p.id] = { terminals: panesOf(p.id).map((x) => ({ ...x.desc })) };
    return { version: 1, activeProjectId: S.activeId, projects };
  }
  function saveSessionNow() { clearTimeout(saveTimer); return guard(() => api.session.save(buildSession())); }
  function saveAllScrollback() {
    const jobs = [];
    for (const list of S.panes.values()) {
      for (const p of list) {
        if (!p.ready) continue;
        jobs.push(guard(() => api.session.saveScrollback(p.id, p.serialize())));
      }
    }
    return Promise.all(jobs);
  }

  /* ---------- Kacheln ---------- */
  const hooks = {
    onChange: scheduleSave,
    onActivate: (pane, focus) => setActive(pane, focus),
    onClose: closePane,
    onMaximize: (pane) => {
      const list = panesOf(pane.project.id);
      if (pane.maxed) list.forEach((p) => p !== pane && p.maxed && p.setMax(false));
      syncGrid(pane.project.id);
    },
    onStatus: () => { renderSidebar(); },
    accountLabel: (desc) => accountLabel(desc),
    presetLabel: (desc) => { const p = S.presets.find((x) => x.id === desc.presetId); return p ? p.label : desc.command || ''; },
  };

  /* ---------- Konten ---------- */
  const PRESET_PROVIDER = { claude: 'claude', codex: 'codex' };
  const providerOf = (key) => S.accounts.find((p) => p.provider === key) || null;
  /* Zeigt sich nur, wenn der Anbieter mehr als das Standardkonto kennt. */
  const multi = (p) => !!p && (p.accounts.length > 1 || p.accounts.some((a) => !a.builtin));
  function accountLabel(desc) {
    const p = providerOf(PRESET_PROVIDER[desc.presetId]);
    if (!multi(p)) return null;
    const id = desc.accounts && desc.accounts[p.provider];
    const acc = id && p.accounts.find((a) => a.id === id);
    return acc ? acc.label : null;
  }
  function activeAccount(presetId) {
    const p = providerOf(PRESET_PROVIDER[presetId]);
    return multi(p) ? p.accounts.find((a) => a.active) || null : null;
  }
  function onAccountsChanged(list) {
    S.accounts = list || [];
    for (const l of S.panes.values()) for (const p of l) p.refreshAccount();
  }
  async function loadAccounts() { onAccountsChanged(await guard(() => api.accounts.list(), [])); }
  /* Anmelde-Terminal im aktuellen Projekt, fest an das gewählte Konto gebunden. */
  function openLogin(provider, acc, command) {
    if (!activeProject()) return 'Zum Anmelden zuerst ein Projekt öffnen.';
    const pane = newTerminal(S.activeId, { id: null, label: `Anmeldung: ${acc.label}`, command }, { [provider]: acc.id });
    return pane ? true : 'Das Terminal konnte nicht geöffnet werden (Obergrenze erreicht?).';
  }

  function gridFor(pid) {
    let g = S.grids.get(pid);
    if (!g) {
      g = h('div', { class: 'grid' });
      g.hidden = true;
      $('grids').append(g);
      S.grids.set(pid, g);
    }
    return g;
  }
  function syncGrid(pid) {
    const g = gridFor(pid);
    const list = panesOf(pid);
    if (list.length) {
      const { cols, visibleRows } = window.DeckLayout.gridFor(list.length);
      g.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      // Sichtbare Reihen teilen sich die Höhe; weitere Reihen erreicht man durch Scrollen.
      g.style.gridAutoRows = `calc((100% - ${(visibleRows - 1) * 6}px) / ${visibleRows})`;
    }
    g.classList.toggle('has-max', list.some((p) => p.maxed));
    if (pid === S.activeId) renderHeader();
    renderSidebar();
  }

  function addPane(project, desc, opts) {
    if (!Number.isInteger(desc.color)) desc.color = nextColor(project.id);
    const pane = D.createPane(desc, project, hooks, opts);
    if (!S.panes.has(project.id)) S.panes.set(project.id, []);
    S.panes.get(project.id).push(pane);
    pane.mount(gridFor(project.id));
    syncGrid(project.id);
    return pane;
  }

  // Kleinste Farbe, die im Projekt noch nicht vergeben ist; sind alle vergeben, reihum.
  function nextColor(pid) {
    const n = D.TILE_HUES.length;
    const used = new Map();
    for (const p of panesOf(pid)) used.set(p.desc.color % n, (used.get(p.desc.color % n) || 0) + 1);
    let best = 0;
    for (let i = 0; i < n; i++) if ((used.get(i) || 0) < (used.get(best) || 0)) best = i;
    return best;
  }

  function nextTitle(pid) {
    const used = new Set(panesOf(pid).map((p) => p.desc.title));
    for (let i = 1; ; i++) if (!used.has('Terminal ' + i)) return 'Terminal ' + i;
  }

  function newTerminal(pid, preset, accounts) {
    const project = S.projects.find((p) => p.id === pid);
    if (!project) { notify('Zuerst ein Projekt auswählen.'); return null; }
    if (panesOf(pid).length >= MAX) { notify(`Maximal ${MAX} Terminals pro Projekt.`); return null; }
    const desc = {
      id: crypto.randomUUID(),
      title: preset ? preset.label : nextTitle(pid),
      presetId: preset ? preset.id : null,
      command: preset ? preset.command : null,
      resumeCommand: preset ? preset.resumeCommand || null : null,
      browserUrl: null, browserOpen: false,
      accounts: accounts || undefined,
      // Anmelde-Terminals (Vorgabe ohne id) behalten ihren Namen
      titleLocked: preset && !preset.id ? true : undefined,
    };
    const pane = addPane(project, desc, { restored: false, runCommand: !!preset });
    setActive(pane, false);
    if (pid === S.activeId) requestAnimationFrame(() => { pane.ensureStarted(); pane.focus(); });
    scheduleSave();
    return pane;
  }

  function setActive(pane, focus) {
    const pid = pane.project.id;
    S.activeByProject[pid] = pane.id;
    for (const p of panesOf(pid)) p.setActive(p === pane, p === pane && focus !== false);
  }

  function closePane(pane) {
    const pid = pane.project.id;
    const list = panesOf(pid);
    const i = list.indexOf(pane);
    if (i < 0) return;
    list.splice(i, 1);
    const wasActive = S.activeByProject[pid] === pane.id;
    pane.dispose();
    if (wasActive) {
      const next = list[Math.min(i, list.length - 1)];
      if (next) setActive(next, pid === S.activeId); else delete S.activeByProject[pid];
    }
    syncGrid(pid);
    scheduleSave();
  }

  /* ---------- Projekte ---------- */
  function selectProject(id) {
    S.activeId = id;
    for (const [pid, g] of S.grids) g.hidden = pid !== id;
    const project = activeProject();
    $('empty-main').hidden = !!project;
    if (project) {
      if (!panesOf(id).length) newTerminal(id, null);
      const g = gridFor(id);
      g.hidden = false;
      requestAnimationFrame(() => {
        const list = panesOf(id);
        list.forEach((p) => { p.refit(); p.ensureStarted(); });
        if (!list.some((p) => p.id === S.activeByProject[id]) && list[0]) S.activeByProject[id] = list[0].id;
        const a = activePane();
        if (a) setActive(a, true);
      });
    }
    renderHeader();
    renderSidebar();
    D.progressPanel.refresh();
    scheduleSave();
    if (project) D.git.onSelect(project);
  }

  function adoptProject(p) {
    if (!p) return;
    if (!S.projects.some((x) => x.id === p.id)) S.projects.push(p);
    selectProject(p.id);
  }

  async function addProject() { adoptProject(await guard(() => api.projects.add())); }

  function addFromGithub() { D.openGithubPicker({ projects: () => S.projects, onPicked: adoptProject }); }

  /* Kleines Menü unter einem Knopf: Ordner wählen oder von GitHub. */
  function openAddMenu(btn) {
    const m = $('menu');
    if (!m.hidden && m.dataset.owner === btn.id) { closeMenu(); return; }
    m.replaceChildren(
      h('div', { class: 'menu-item', text: 'Ordner wählen…', onclick: () => { closeMenu(); addProject(); } }),
      h('div', { class: 'menu-item', text: 'Von GitHub…', onclick: () => { closeMenu(); addFromGithub(); } }));
    m.dataset.owner = btn.id;
    const r = btn.getBoundingClientRect();
    m.hidden = false;
    m.style.top = r.bottom + 4 + 'px';
    m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
  }

  async function removeProject(p) {
    const ok = await guard(() => api.projects.remove(p.id));
    if (!ok) return;
    D.git.forget(p.id);
    for (const pane of panesOf(p.id)) pane.disposeQuiet();
    S.panes.delete(p.id);
    const g = S.grids.get(p.id);
    if (g) g.remove();
    S.grids.delete(p.id);
    S.projects = S.projects.filter((x) => x.id !== p.id);
    if (S.activeId === p.id) selectProject(S.projects[0] ? S.projects[0].id : null);
    else { renderSidebar(); scheduleSave(); }
  }

  function startRename(p, nameEl) {
    S.editing = true;
    const input = h('input', { class: 'proj-edit', value: p.name });
    input.addEventListener('click', (e) => e.stopPropagation());
    nameEl.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = async (ok) => {
      if (done) return;
      done = true;
      S.editing = false;
      const v = input.value.trim();
      if (ok && v && v !== p.name) {
        const r = await guard(() => api.projects.rename(p.id, v));
        if (r && r.name) p.name = r.name;
      }
      renderSidebar();
      renderHeader();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }

  function renderSidebar() {
    if (S.editing) return;
    const ul = $('project-list');
    ul.replaceChildren();
    $('side-empty').hidden = S.projects.length > 0;
    for (const p of S.projects) {
      const running = panesOf(p.id).filter((x) => x.status === 'running').length;
      const nameEl = h('span', { class: 'proj-name', text: p.name, title: p.path + '\nDoppelklick zum Umbenennen' });
      nameEl.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(p, nameEl); });
      const li = h('li', { class: 'proj' + (p.id === S.activeId ? ' active' : ''), onclick: () => p.id !== S.activeId && selectProject(p.id) },
        nameEl,
        h('span', { class: 'proj-count' + (running ? ' live' : ''), text: String(running), title: `${running} laufende Terminals` }),
        h('button', { class: 'proj-x', text: '✕', title: 'Projekt entfernen', onclick: (e) => { e.stopPropagation(); removeProject(p); } }));
      const gitLine = D.git.line(p);
      if (gitLine) li.append(gitLine);
      ul.append(li);
    }
  }

  function renderHeader() {
    const p = activeProject();
    const n = p ? panesOf(p.id).length : 0;
    $('ws-title').textContent = p ? p.name : '';
    $('counter').textContent = p ? `${n} / ${MAX}` : '';
    $('ws-actions').hidden = !p;
    const full = n >= MAX;
    const tip = full ? `Maximal ${MAX} Terminals pro Projekt erreicht. Schließe eines, um ein neues zu öffnen.` : '';
    $('btn-plus').disabled = full;
    $('btn-menu').disabled = full;
    $('btn-plus').title = full ? tip : 'Neues Terminal (⌘T)';
    $('btn-menu').title = full ? tip : 'Schnellstart-Menü';
  }

  /* ---------- Plus-Menü ---------- */
  function closeMenu() { $('menu').hidden = true; }
  function openMenu() {
    const m = $('menu');
    if (!m.hidden && m.dataset.owner === 'btn-menu') { closeMenu(); return; }
    m.dataset.owner = 'btn-menu';
    m.replaceChildren();
    for (const pr of S.presets) {
      const row = h('div', { class: 'menu-item', title: pr.command },
        h('span', { class: 'grow', text: pr.label }),
        activeAccount(pr.id) ? h('span', { class: 'acct-chip', title: 'Aktives Konto', text: activeAccount(pr.id).label }) : null,
        h('small', { text: pr.command }));
      row.addEventListener('click', () => { closeMenu(); newTerminal(S.activeId, pr); });
      if (!pr.builtin) {
        row.append(h('button', {
          class: 'menu-x', text: '✕', title: 'Schnellstart entfernen',
          onclick: async (e) => {
            e.stopPropagation();
            const ok = await guard(() => api.presets.remove(pr.id));
            if (ok) { S.presets = S.presets.filter((x) => x.id !== pr.id); closeMenu(); openMenu(); }
          },
        }));
      }
      m.append(row);
    }
    if (S.presets.length) m.append(h('hr'));
    m.append(h('div', { class: 'menu-item', text: 'Eigenen Befehl hinzufügen…', onclick: () => { closeMenu(); openCustomForm(); } }));
    const r = $('btn-menu').getBoundingClientRect();
    m.hidden = false;
    m.style.top = r.bottom + 4 + 'px';
    m.style.left = Math.max(8, r.right - m.offsetWidth) + 'px';
  }

  function openCustomForm() {
    const modal = $('modal');
    const label = h('input', { placeholder: 'z. B. Codex', required: true });
    const cmd = h('input', { placeholder: 'z. B. codex', required: true });
    const resume = h('input', { placeholder: 'z. B. codex resume --last' });
    const close = () => { modal.hidden = true; modal.replaceChildren(); };
    const form = h('form', null,
      h('h2', { text: 'Eigenen Schnellstart hinzufügen' }),
      h('label', { text: 'Name' }, label),
      h('label', { text: 'Befehl' }, cmd),
      h('label', { text: 'Fortsetzen-Befehl (optional)' }, resume),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn-small', text: 'Abbrechen', onclick: close }),
        h('button', { type: 'submit', class: 'btn-primary', text: 'Hinzufügen' })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const l = label.value.trim(), c = cmd.value.trim(), r = resume.value.trim();
      if (!l || !c) return;
      const pr = await guard(() => api.presets.add({ label: l, command: c, resumeCommand: r || null }));
      if (pr) { S.presets.push(pr); notify(`Schnellstart „${pr.label}“ hinzugefügt.`, 'ok'); close(); }
    });
    modal.onmousedown = (e) => { if (e.target === modal) close(); };
    modal.onkeydown = (e) => { if (e.key === 'Escape') close(); };
    modal.replaceChildren(form);
    modal.hidden = false;
    label.focus();
  }

  /* ---------- Start ---------- */
  function cleanDesc(d) {
    return {
      id: typeof d.id === 'string' && d.id ? d.id : crypto.randomUUID(),
      title: typeof d.title === 'string' && d.title ? d.title : 'Terminal',
      presetId: d.presetId || null, command: d.command || null, resumeCommand: d.resumeCommand || null,
      browserUrl: d.browserUrl || null, browserOpen: !!d.browserOpen,
      accounts: d.accounts && typeof d.accounts === 'object' ? d.accounts : undefined,
      color: Number.isInteger(d.color) ? d.color : undefined,
      titleLocked: d.titleLocked === true ? true : undefined,
    };
  }

  async function init() {
    D.progressPanel.init({
      getProjectId: () => S.activeId,
      getActivePane: activePane,
      onClose: () => { $('btn-progress').classList.toggle('on', D.progressPanel.toggle(false)); },
    });
    $('add-project').onclick = (e) => { e.stopPropagation(); openAddMenu($('add-project')); };
    $('empty-add').onclick = (e) => { e.stopPropagation(); openAddMenu($('empty-add')); };
    D.git.init({ projects: () => S.projects, activeId: () => S.activeId, render: renderSidebar });
    D.accountsPanel.init({
      onClose: () => { $('btn-accounts').classList.toggle('on', D.accountsPanel.toggle(false)); },
      onChange: onAccountsChanged,
      onLogin: openLogin,
    });
    $('btn-accounts').onclick = () => { $('btn-accounts').classList.toggle('on', D.accountsPanel.toggle()); };
    $('btn-plus').onclick = () => newTerminal(S.activeId, null);
    $('btn-menu').onclick = (e) => { e.stopPropagation(); openMenu(); };
    $('btn-progress').onclick = () => { $('btn-progress').classList.toggle('on', D.progressPanel.toggle()); };
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu, #btn-menu, #add-project, #empty-add')) closeMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

    /* Globale Terminal-Ereignisse, Zuordnung per id */
    const byId = (id) => { for (const l of S.panes.values()) for (const p of l) if (p.id === id) return p; return null; };
    api.terminals.onData((id, data) => { const p = byId(id); if (p) p.write(data); });
    api.terminals.onExit((id, code) => { const p = byId(id); if (p) p.handleExit(code); });
    api.onMenu((action) => {
      if (action === 'new-terminal') newTerminal(S.activeId, null);
      else if (action === 'close-terminal') { const a = activePane(); if (a) closePane(a); }
    });
    api.onBeforeQuit(async () => {
      try { await saveSessionNow(); await saveAllScrollback(); } finally { api.quitReady(); }
    });
    window.addEventListener('resize', () => panesOf(S.activeId).forEach((p) => p.refit()));
    setInterval(saveAllScrollback, 30000);

    const [projects, presets, session] = await Promise.all([
      guard(() => api.projects.list(), []),
      guard(() => api.presets.list(), []),
      guard(() => api.session.load(), null),
    ]);
    S.projects = projects || [];
    S.presets = presets || [];
    await loadAccounts();
    const saved = (session && session.projects) || {};
    for (const p of S.projects) {
      const terms = (saved[p.id] && Array.isArray(saved[p.id].terminals)) ? saved[p.id].terminals.slice(0, MAX) : [];
      for (const d of terms) if (d && typeof d === 'object') addPane(p, cleanDesc(d), { restored: true });
    }
    const wanted = session && session.activeProjectId;
    const first = S.projects.some((p) => p.id === wanted) ? wanted : (S.projects[0] ? S.projects[0].id : null);
    selectProject(first);
    renderSidebar();
    D.git.start();
  }

  init().catch((e) => notify('Start fehlgeschlagen: ' + D.errText(e)));
})();
