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
  let hotkeyBindings = window.DeckHotkeys.defaults();
  const hotkeyLabel = action => (hotkeyBindings[action] || []).map(window.DeckHotkeys.format).join(' / ');
  function applyHotkeys(bindings) {
    window.DeckHotkeys.setBindings(bindings); hotkeyBindings = bindings;
    for (const pid of S.panes.keys()) syncGrid(pid);
    renderHeader();
    $('btn-attention').title = 'Rückmeldungen der Agenten' + (hotkeyLabel('next-attention') ? ': ' + hotkeyLabel('next-attention') + ' springt zur nächsten' : '');
  }

  /* ---------- Agentenstatus (F01): Zustand kommt gepusht aus dem Hauptprozess ---------- */
  const A = (D.attention = {
    entries: new Map(), lastInput: 0,
    entryFor: (id) => A.entries.get(id) || null,
    // Nur wenn der Agent wartet; gedrosselt, damit nicht jeder Tastendruck einen IPC-Aufruf auslöst.
    userInput(id) {
      const e = A.entries.get(id);
      const now = Date.now();
      if (!e || e.state !== 'needs-input' || now - A.lastInput < 300) return;
      A.lastInput = now;
      api.agents.userInput(id);
    },
  });
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
    // Reihenfolge nur per CSS-Platz: Knoten bleiben im DOM stehen (webview lädt sonst neu).
    list.forEach((p, i) => {
      p.el.style.order = i; p.setNumber(window.DeckHotkeys.keyForIndex(i));
      const badge = p.el.querySelector('.tile-num'), label = hotkeyLabel(window.DeckHotkeys.actionFor(i));
      if (badge) badge.title = label ? 'Zum Terminal springen: ' + label : 'Kein Hotkey zugewiesen';
    });
    if (pid === S.activeId) renderHeader();
    renderSidebar();
  }

  function addPane(project, desc, opts) {
    if (!Number.isInteger(desc.color)) desc.color = nextColor(project.id);
    const pane = D.createPane(desc, project, hooks, opts);
    if (!S.panes.has(project.id)) S.panes.set(project.id, []);
    S.panes.get(project.id).push(pane);
    pane.mount(gridFor(project.id));
    wireDrag(pane);
    if (D.promptDraft) D.promptDraft.bindPane(pane);
    syncGrid(project.id);
    return pane;
  }

  /* ---------- Tauschen per Ziehen (HTML5-DnD: im Electron-Fenster zuverlässig, Esc bricht von selbst ab) ---------- */
  const drag = { src: null, over: null, timer: 0, y: 0 };
  // Zeigerhöhe fürs Auto-Scrollen und Markierung löschen, sobald der Zeiger keine Kachel mehr trifft (Zwischenraum, Leiste)
  function onDocDragOver(e) {
    drag.y = e.clientY;
    if (!(e.target.closest && e.target.closest('.tile'))) setOver(null);
  }
  // Sicherheitsnetz, falls ein dragend ausbleibt: sonst bliebe pointer-events der Terminals aus
  function onDragAbort(e) { if (e.type === 'mousedown' || e.key === 'Escape') dragEnd(); }
  function dragEnd() {
    clearInterval(drag.timer);
    document.removeEventListener('dragover', onDocDragOver);
    document.removeEventListener('mousedown', onDragAbort, true);
    document.removeEventListener('keydown', onDragAbort, true);
    if (drag.src) drag.src.el.classList.remove('drag-src');
    if (drag.over) drag.over.el.classList.remove('drop-target');
    if (drag.src) gridFor(drag.src.project.id).classList.remove('dnd');
    drag.src = drag.over = null;
  }
  function setOver(pane) {
    if (drag.over === pane) return;
    if (drag.over) drag.over.el.classList.remove('drop-target');
    drag.over = pane;
    if (pane) pane.el.classList.add('drop-target');
  }
  function dropSwap(target) {
    const src = drag.src;
    const pid = src.project.id;
    const list = panesOf(pid);
    const keep = activePane();
    if (!window.DeckReorder.swapInPlace(list, list.indexOf(src), list.indexOf(target))) return;
    syncGrid(pid);
    if (keep) setActive(keep, true);
    requestAnimationFrame(() => list.forEach((p) => p.refit()));
    scheduleSave();
  }
  function wireDrag(pane) {
    const head = pane.head;
    head.draggable = true;
    head.addEventListener('dragstart', (e) => {
      // Beim Umbenennen gehört die Maus dem Eingabefeld
      if (head.querySelector('input') || panesOf(pane.project.id).length < 2 || pane.maxed) { e.preventDefault(); return; }
      drag.src = pane;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', pane.desc.title);
      e.dataTransfer.setDragImage(head, 20, 13);
      // Klasse erst nach dem Start setzen, sonst wird das Ziehbild schon gedimmt
      setTimeout(() => { if (drag.src === pane) { pane.el.classList.add('drag-src'); gridFor(pane.project.id).classList.add('dnd'); } }, 0);
      // Auto-Scroll am oberen/unteren Rand (der Browser scrollt beim Ziehen nicht zuverlässig)
      clearInterval(drag.timer);
      document.addEventListener('dragover', onDocDragOver);
      document.addEventListener('mousedown', onDragAbort, true);
      document.addEventListener('keydown', onDragAbort, true);
      const g = gridFor(pane.project.id);
      drag.timer = setInterval(() => {
        const r = g.getBoundingClientRect();
        if (drag.y < r.top + 50) g.scrollTop -= 14;
        else if (drag.y > r.bottom - 50) g.scrollTop += 14;
      }, 30);
    });
    head.addEventListener('dragend', dragEnd);
    pane.el.addEventListener('dragover', (e) => {
      if (!drag.src || drag.src.project.id !== pane.project.id) return;
      drag.y = e.clientY;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOver(pane === drag.src ? null : pane);
    });
    pane.el.addEventListener('drop', (e) => {
      if (!drag.src || drag.src.project.id !== pane.project.id) return;
      e.preventDefault();
      if (pane !== drag.src) dropSwap(pane);
      dragEnd();
    });
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

  function newTerminal(pid, preset, accounts, workspace) {
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
      workspaceId: workspace ? workspace.workspaceId : undefined,
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
    reportVisible();
  }

  /* Meldet dem Hauptprozess, welche Kachel man gerade sieht (aktives Projekt, aktive Kachel, kein Einstellungsbereich). */
  let lastVisibleId;
  function reportVisible() {
    const settingsOpen = !$('settings-panel').hidden;
    const pane = S.activeId && !settingsOpen ? activePane() : null;
    const id = pane ? pane.id : null;
    if (id === lastVisibleId && id === null) return;
    lastVisibleId = id;
    api.agents.reportVisible(id);
  }

  // Ctrl/Cmd+1..0 from the menu: focus that tile and scroll it into view.
  // Also fine while a dialog or rename field is open; the jump just moves focus.
  function focusTerminalAt(action) {
    const list = panesOf(S.activeId);
    const i = window.DeckHotkeys.targetFor(action, list.length);
    if (i < 0) return;
    const pane = list[i];
    for (const p of list) if (p.maxed && p !== pane) { p.setMax(false); }
    syncGrid(S.activeId);
    setActive(pane, true);
    pane.el.scrollIntoView({ block: 'nearest' });
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
    reportVisible();
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

  /* Neues Projekt planen: Ordner mit git init und Planungsdateien, darin ein Agent-Terminal zum Besprechen. */
  function openPlanForm() {
    const modal = $('modal');
    const name = h('input', { placeholder: 'z. B. Mein-neues-Projekt', required: true });
    const agent = h('select', null, ...S.presets.map((p) => h('option', { value: p.id, text: p.label })));
    const close = () => { modal.hidden = true; modal.replaceChildren(); };
    const form = h('form', null,
      h('h2', { text: 'Neues Projekt planen' }),
      h('p', { class: 'hint', text: 'Legt einen Git-Ordner an und öffnet einen Chat mit dem Agenten, in dem ihr das Projekt besprecht. Auf GitHub veröffentlichst du es später über „+ Projekt“.' }),
      h('label', { text: 'Projektname' }, name),
      h('label', { text: 'Agent' }, agent),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn-small', text: 'Abbrechen', onclick: close }),
        h('button', { type: 'submit', class: 'btn-primary', text: 'Planen' })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = name.value.trim();
      if (!v) return;
      const created = await guard(() => api.projects.createDraft(v));
      if (!created || !created.project) return;
      close();
      if (created.message) notify(created.message);
      const p = created.project;
      if (!S.projects.some((x) => x.id === p.id)) S.projects.push(p);
      const preset = S.presets.find((x) => x.id === agent.value);
      if (preset) {
        // Only the built-in agents take the opening sentence; the plan itself is in CLAUDE.md / AGENTS.md.
        const command = preset.builtin ? `${preset.command} "Starte die Projektplanung wie in CLAUDE.md beschrieben."` : preset.command;
        newTerminal(p.id, { ...preset, command });
      }
      selectProject(p.id);
    });
    modal.onmousedown = (e) => { if (e.target === modal) close(); };
    modal.onkeydown = (e) => { if (e.key === 'Escape') close(); };
    modal.replaceChildren(form);
    modal.hidden = false;
    name.focus();
  }

  async function publishActiveProject() {
    const project = activeProject();
    if (!project) return;
    const r = await guard(() => api.projects.publish(project.id));
    if (r) notify(`GitHub-Repo angelegt: ${r.repo}`, 'ok');
    D.git.onSelect(project);
  }

  /* Kleines Menü unter einem Knopf: Ordner wählen, von GitHub, neu planen oder veröffentlichen. */
  function openAddMenu(btn) {
    const m = $('menu');
    if (!m.hidden && m.dataset.owner === btn.id) { closeMenu(); return; }
    const items = [
      h('div', { class: 'menu-item', text: 'Neues Projekt planen…', onclick: () => { closeMenu(); openPlanForm(); } }),
      h('div', { class: 'menu-item', text: 'Ordner wählen…', onclick: () => { closeMenu(); addProject(); } }),
      h('div', { class: 'menu-item', text: 'Von GitHub…', onclick: () => { closeMenu(); addFromGithub(); } }),
    ];
    if (activeProject()) {
      items.push(h('hr'),
        h('div', { class: 'menu-item', text: 'Aktives Projekt auf GitHub anlegen…', onclick: () => { closeMenu(); publishActiveProject(); } }));
    }
    m.replaceChildren(...items);
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
    $('btn-plus').title = full ? tip : 'Neues Terminal' + (hotkeyLabel('new-terminal') ? ' (' + hotkeyLabel('new-terminal') + ')' : '');
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
    if (D.worktreePicker && api.worktrees) {
      m.append(h('div', {
        class: 'menu-item', text: 'Terminal in Arbeitskopie…', title: 'Eigener Git-Worktree mit eigenem Branch',
        onclick: () => {
          closeMenu();
          const project = activeProject();
          if (!project) { notify('Zuerst ein Projekt auswählen.'); return; }
          D.worktreePicker.open({ project, onChoose: (ws) => newTerminal(project.id, null, undefined, ws || undefined) });
        },
      }));
    }
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
      browserMode: d.browserMode === 'terminal' || d.browserMode === 'browser' ? d.browserMode : undefined,
      accounts: d.accounts && typeof d.accounts === 'object' ? d.accounts : undefined,
      workspaceId: typeof d.workspaceId === 'string' && d.workspaceId ? d.workspaceId : undefined,
      color: Number.isInteger(d.color) ? d.color : undefined,
      titleLocked: d.titleLocked === true ? true : undefined,
      nativeSession: d.nativeSession && typeof d.nativeSession === 'object' ? d.nativeSession : undefined, // F02
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
    function showPorts(force) {
      const open = D.portsPanel.toggle(force);
      $('btn-ports').classList.toggle('on', open);
      $('btn-ports').setAttribute('aria-expanded', String(open));
      if (open) {
        showAttention(false);
        $('btn-accounts').classList.toggle('on', D.accountsPanel.toggle(false));
        $('btn-progress').classList.toggle('on', D.progressPanel.toggle(false));
      }
      return open;
    }
    function showSettings(force) {
      const open = D.settingsPanel.toggle(force);
      if (open) { showPorts(false); showAttention(false); }
      $('btn-settings').classList.toggle('on', open);
      $('btn-settings').setAttribute('aria-expanded', String(open));
      $('sidebar').inert = open;
      for (const id of ['grids', 'empty-main', 'progress-panel', 'accounts-panel', 'ws-actions']) $(id).inert = open;
      if (!open) requestAnimationFrame(() => panesOf(S.activeId).forEach((p) => p.refit()));
      reportVisible();
      return open;
    }
    D.settingsPanel.init({
      projectId: () => S.activeId,
      onClose: () => showSettings(false),
      onAccounts: () => {
        if (showSettings(false)) return;
        $('btn-accounts').classList.toggle('on', D.accountsPanel.toggle(true));
      },
    });
    $('btn-settings').onclick = () => { closeMenu(); showSettings(); };
    $('btn-ports').onclick = () => { closeMenu(); showSettings(false); showPorts(); };
    $('btn-accounts').onclick = () => { $('btn-accounts').classList.toggle('on', D.accountsPanel.toggle()); };
    $('btn-plus').onclick = () => newTerminal(S.activeId, null);
    $('btn-menu').onclick = (e) => { e.stopPropagation(); openMenu(); };
    $('btn-progress').onclick = () => { $('btn-progress').classList.toggle('on', D.progressPanel.toggle()); };
    // F09: Übergabe-Dialog für die aktive Kachel (Einfügen nur über die Promptvorschau)
    $('btn-handoff').onclick = () => { closeMenu(); D.handoff.open(); };
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu, #btn-menu, #add-project, #empty-add')) closeMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

    /* Globale Terminal-Ereignisse, Zuordnung per id */
    const byId = (id) => { for (const l of S.panes.values()) for (const p of l) if (p.id === id) return p; return null; };
    function focusPort(entry, focus) {
      const pane = byId(entry.terminalId);
      if (!pane || pane.project.id !== entry.projectId || pane.status !== 'running') throw new Error('Die Zielkachel läuft nicht mehr. Bitte aktualisieren.');
      S.activeByProject[pane.project.id] = pane.id;
      if (S.activeId !== pane.project.id) selectProject(pane.project.id);
      for (const p of panesOf(pane.project.id)) if (p.maxed && p !== pane) p.setMax(false);
      syncGrid(pane.project.id);
      setActive(pane, focus);
      pane.el.scrollIntoView({ block: 'nearest' });
      return pane;
    }
    D.portsPanel.init({
      getLabel: entry => {
        const pane = byId(entry.terminalId);
        return pane && pane.project.id === entry.projectId && pane.status === 'running'
          ? pane.project.name + ' · ' + pane.desc.title : null;
      },
      onClose: () => showPorts(false),
      onJump: entry => { focusPort(entry, true); },
      onBrowser: async entry => {
        if (!entry.url) throw new Error('Für diesen Port ist keine HTTP-Adresse verfügbar.');
        const pane = focusPort(entry, false);
        const result = await pane.browserApi.open(entry.url);
        if (result && result.ok === false) throw new Error(result.error || 'HTTP-Adresse konnte nicht geöffnet werden.');
      },
    });
    /* Rückmeldungen der Agenten: Liste, Zähler am Knopf, Sprung zur Kachel */
    let attSettings = { statusEnabled: false, desktopNotification: false, sound: false };
    let attList = [];
    function jumpToPane(pane) {
      if (!$('settings-panel').hidden) showSettings(false);
      S.activeByProject[pane.project.id] = pane.id;
      if (S.activeId !== pane.project.id) selectProject(pane.project.id);
      for (const p of panesOf(pane.project.id)) if (p.maxed && p !== pane) p.setMax(false);
      syncGrid(pane.project.id);
      setActive(pane, true);
      pane.el.scrollIntoView({ block: 'nearest' });
    }
    const attPanel = window.DeckAttention.createAttentionPanel({
      root: $('attention-panel'), h,
      getLabel: (entry) => {
        const pane = byId(entry.terminalId);
        if (!pane) return null;
        return { project: pane.project.name, number: panesOf(pane.project.id).indexOf(pane) + 1, name: pane.desc.title };
      },
      onJump: (entry) => { const pane = byId(entry.terminalId); if (pane) jumpToPane(pane); },
      onMarkAllRead: () => { guard(() => api.agents.markAllRead()); },
      onSettings: async (patch) => {
        const next = await guard(() => api.agents.setSettings(patch));
        if (next) { attSettings = next; attPanel.update(attList, attSettings); }
      },
    });
    function applyAgentList(list) {
      attList = Array.isArray(list) ? list : [];
      A.entries = new Map(attList.map((e) => [e.terminalId, e]));
      for (const l of S.panes.values()) for (const p of l) p.setAgentEntry(A.entries.get(p.id) || null);
      const unread = attList.filter((e) => e.unread).length;
      const badge = $('attention-count');
      badge.textContent = String(unread);
      badge.hidden = unread === 0;
      attPanel.update(attList, attSettings);
    }
    function showAttention(force) {
      const panel = $('attention-panel');
      const open = force === undefined ? panel.hidden : Boolean(force);
      panel.hidden = !open;
      $('btn-attention').classList.toggle('on', open);
      $('btn-attention').setAttribute('aria-expanded', String(open));
      if (open) {
        showPorts(false);
        attPanel.update(attList, attSettings);
      }
      requestAnimationFrame(() => panesOf(S.activeId).forEach((p) => p.refit()));
      return open;
    }
    $('btn-attention').onclick = () => { closeMenu(); showSettings(false); showAttention(); };
    function jumpToNextAttention() {
      const entry = attList.find((e) => e.unread && byId(e.terminalId));
      if (!entry) { notify('Keine ungelesene Rückmeldung.', 'ok'); return; }
      jumpToPane(byId(entry.terminalId));
    }
    api.agents.onChange(applyAgentList);
    // F02: a reported conversation ID is stored with the tile (saved with the session)
    api.agents.onSession((id, rec) => { const pane = byId(id); if (pane) pane.setNativeSession(rec); });
    api.agents.onJump((id) => { const pane = byId(id); if (pane) jumpToPane(pane); });
    setInterval(() => { if (!$('attention-panel').hidden) attPanel.update(attList, attSettings); }, 30000);

    D.promptDraft = window.DeckPromptDraft.createPromptDraft({
      document, getPane: byId, host: api.attachments, notify,
      activatePane: pane => {
        if (S.activeId !== pane.project.id) selectProject(pane.project.id);
        for (const p of panesOf(pane.project.id)) if (p.maxed && p !== pane) p.setMax(false);
        syncGrid(pane.project.id);
        setActive(pane, false);
        pane.el.scrollIntoView({ block: 'nearest' });
      },
    });
    // F09: Übergabe nutzt die Promptvorschau (F06) und zeigt Quelle sowie Ziel der aktiven Projektkacheln.
    D.handoff = window.DeckHandoff.createHandoffDialog({
      document, h: D.h, promptDraft: D.promptDraft, notify,
      getSource: activePane, getTargets: () => panesOf(S.activeId), getProjectId: () => S.activeId,
      readProgress: (pid) => api.progress.read(pid),
    });
    api.terminals.onData((id, data) => { const p = byId(id); if (p) p.write(data); });
    api.terminals.onExit((id, code) => { const p = byId(id); if (p) p.handleExit(code); });
    // Requests of mt-browser from the main process: find the tile by terminal id (any project) and ask its browser API.
    const BROWSER_OPS = new Set(['open', 'show', 'hide', 'isOpen', 'webContentsId', 'mode', 'visible']);
    api.browser.onRequest(async ({ reqId, terminalId, op, arg }) => {
      try {
        const pane = byId(terminalId);
        if (!pane || !pane.browserApi) throw new Error('Dieses Terminal gibt es nicht mehr.');
        if (!BROWSER_OPS.has(op)) throw new Error('Unbekannte Anfrage.');
        api.browser.respond(reqId, { ok: true, result: await pane.browserApi[op](arg) });
      } catch (e) {
        api.browser.respond(reqId, { ok: false, error: D.errText(e) });
      }
    });
    api.onMenu((action) => {
      if (D.settingsPanel.isOpen() && action !== 'settings') return;
      if (action === 'settings') showSettings(true);
      else if (action === 'new-terminal') newTerminal(S.activeId, null);
      else if (action === 'close-terminal') { const a = activePane(); if (a) closePane(a); }
      else if (action === 'next-attention') jumpToNextAttention();
      else focusTerminalAt(action);
    });
    api.hotkeys.onChange(applyHotkeys);
    api.onBeforeQuit(async () => {
      D.portsPanel.dispose();
      try { await saveSessionNow(); await saveAllScrollback(); } finally { api.quitReady(); }
    });
    window.addEventListener('resize', () => panesOf(S.activeId).forEach((p) => p.refit()));
    setInterval(saveAllScrollback, 30000);

    const hotkeySettings = await api.hotkeys.get();
    applyHotkeys(hotkeySettings.bindings);
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
    attSettings = (await guard(() => api.agents.getSettings(), attSettings)) || attSettings;
    applyAgentList(await guard(() => api.agents.list(), []));
    D.git.start();
  }

  init().catch((e) => notify('Start fehlgeschlagen: ' + D.errText(e)));
})();
