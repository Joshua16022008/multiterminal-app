/* Eine Terminal-Kachel: Kopfzeile, xterm, Mini-Browser. Gemeinsame Helfer (h, notify, guard) leben hier. */
(function () {
  'use strict';
  const D = (window.DeckApp = window.DeckApp || {});

  /* ---------- Helfer ---------- */
  D.h = function (tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null) el.append(c);
    return el;
  };
  const h = D.h;

  D.errText = function (e) {
    const m = e && e.message ? e.message : String(e);
    return m.replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
  };

  D.notify = function (msg, kind, ms) {
    kind = kind || 'error';
    const box = document.getElementById('notices');
    if (!box) return;
    const n = h('div', { class: 'notice ' + kind, text: msg, onclick: () => n.remove() });
    box.append(n);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => n.remove(), ms || (kind === 'error' ? 8000 : 3500));
  };

  /* Führt fn aus; Fehler werden angezeigt, nie verschluckt. */
  D.guard = async function (fn, fallback) {
    try {
      return await fn();
    } catch (e) {
      D.notify(D.errText(e));
      return fallback;
    }
  };

  D.normalizeUrl = function (raw) {
    let s = String(raw || '').trim();
    if (!s) return null;
    if (/^(javascript|data|file|about|blob|chrome|view-source|vbscript):/i.test(s)) return null;
    if (/^(localhost|127\.0\.0\.1|\[::1\])(?=[:/?#]|$)/i.test(s)) s = 'http://' + s;
    else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.href;
    } catch (_) {
      return null;
    }
  };

  D.xtermTheme = {
    background: '#14161a', foreground: '#d4d7dd', cursor: '#d4d7dd', cursorAccent: '#14161a',
    selectionBackground: '#33425e',
    black: '#1c1f26', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#ef7f88', brightGreen: '#a9d48a', brightYellow: '#efd08e',
    brightBlue: '#78bdf8', brightMagenta: '#d68ae9', brightCyan: '#6bc7d3', brightWhite: '#e6e9ef',
  };

  /* Matte, dunkle Kachelfarben: gleiche Helligkeit und Sättigung, nur der Farbton wechselt.
     Reihenfolge so gewählt, dass benachbarte Kacheln gut unterscheidbar sind. */
  function hsl(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }
  D.TILE_HUES = [215, 150, 285, 35, 180, 345, 75, 250, 15, 120, 315, 200];
  D.tileColor = function (index) {
    const hue = D.TILE_HUES[((index % D.TILE_HUES.length) + D.TILE_HUES.length) % D.TILE_HUES.length];
    return { bg: hsl(hue, 26, 13), head: hsl(hue, 24, 18), edge: hsl(hue, 22, 27) };
  };

  /* Kurzer Kachelname aus dem ersten Prompt: Füllwörter weg, höchstens fünf Wörter. */
  const STOP = new Set(('bitte kannst könntest du mir mal doch noch auch ich möchte will würde würdest hätte gerne gern ' +
    'einen eine einem einer eines der die das den dem des ein und oder aber dass damit für von mit zu zum zur im in ist sind ' +
    'wir uns mein meine meinen meinem hier jetzt dann wie was wo kann muss soll sollen machen mach hilf hilfe ' +
    'please can could you me my the a an to of for and or is are with this that it i want would like help').split(' '));
  D.titleFromPrompt = function (raw) {
    let t = String(raw || '').replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '').replace(/[`"'“”„*_#>|│╭╮╰╯─]/g, ' ');
    t = t.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    // Nur der erste Satz zählt
    t = t.split(/(?<=[.!?:])\s/)[0];
    const words = t.split(' ').filter(Boolean);
    const keep = words.filter((w) => !STOP.has(w.toLowerCase().replace(/[.,;:!?]/g, '')));
    const pick = (keep.length >= 2 ? keep : words).slice(0, 5).map((w) => w.replace(/[.,;:!?]+$/, ''));
    let title = pick.join(' ').trim();
    if (title.length < 3) return null;
    if (title.length > 32) {
      const cut = title.slice(0, 31);
      title = (cut.replace(/\s+\S*$/, '') || cut) + '…';
    }
    return title.charAt(0).toUpperCase() + title.slice(1);
  };

  /* ---------- Kachel ---------- */
  /* hooks: onChange, onActivate(pane, focus), onClose, onMaximize, onStatus, presetLabel(desc)
     opts: { restored: bool, runCommand: bool } */
  D.createPane = function (desc, project, hooks, opts) {
    opts = opts || {};
    const api = window.deck;
    const id = desc.id;
    const pane = { id, desc, project, status: 'idle', started: false, ready: false, maxed: false, canResume: !!opts.restored };
    let pendingCommand = opts.runCommand && desc.command ? desc.command : null;
    let lastCols = 0, lastRows = 0, starting = false;
    let wv = null, wvReady = false;
    // Optional module (browser-view.js): without it the tile keeps the old behaviour.
    const BV = window.DeckBrowserView || null;
    const auto = BV ? BV.createAutoOpen() : null;
    if (auto && desc.browserUrl) auto.setCurrent(desc.browserUrl);

    const tint = D.tileColor(typeof desc.color === 'number' ? desc.color : 0);
    const term = new Terminal({
      fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
      fontSize: 12.5, lineHeight: 1.12, cursorBlink: true, scrollback: 5000,
      theme: Object.assign({}, D.xtermTheme, { background: tint.bg, cursorAccent: tint.bg }), allowProposedApi: true,
    });
    const fit = new FitAddon.FitAddon();
    const serializer = new SerializeAddon.SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(serializer);
    // Ctrl/Cmd+digit jumps between tiles via the app menu; keep xterm from also
    // sending a control character (e.g. Ctrl+2 -> NUL) to the shell.
    term.attachCustomKeyEventHandler((e) => !window.DeckHotkeys.isHotkeyEvent(e));
    term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, uri) => openBrowser(uri)));
    pane.term = term;

    /* DOM */
    const numEl = h('span', { class: 'tile-num', title: 'Taste zum Anspringen: Strg/Cmd + diese Ziffer', hidden: true });
    const titleEl = h('span', { class: 'tile-title', title: 'Doppelklick zum Umbenennen', text: desc.title, ondblclick: startRename });
    const acctChip = h('span', { class: 'acct-chip', hidden: true });
    const wtChip = h('span', { class: 'acct-chip wt-chip', hidden: true });
    const resumeBtn = h('button', { class: 'btn-resume', hidden: true, onclick: resume });
    const bMic = h('button', { class: 'ib mic', title: 'Diktieren (Flüsterflow)', text: '🎙', onclick: onMic });
    const bDictCancel = h('button', { class: 'btn-dict-cancel', hidden: true, title: 'Diktat verwerfen', text: 'Abbrechen', onclick: () => { D.dictation.cancel(); term.focus(); } });
    const bBrowser = h('button', { class: 'ib', title: 'Mini-Browser ein/aus', text: '🌐', onclick: () => setBrowserOpen(!desc.browserOpen) });
    // View switch (only while the mini browser is open): terminal only / both / browser only
    const SEG = [['terminal', 'Nur Agent'], ['split', 'Agent und Browser'], ['browser', 'Nur Browser']];
    const segBtns = SEG.map(([mode, tip]) => h('button', { class: 'seg-btn seg-' + mode, title: tip, 'aria-label': tip, onclick: () => setMode(mode) }));
    const seg = h('span', { class: 'view-seg', hidden: true }, ...segBtns);
    const bSnap = h('button', { class: 'ib', title: 'Snapshot: Terminal-Ausgabe als Datei speichern', text: '💾', onclick: snapshot });
    const bMax = h('button', { class: 'ib', title: 'Maximieren / Wiederherstellen', text: '⤢', onclick: () => { pane.setMax(!pane.maxed); hooks.onMaximize(pane); } });
    const bClose = h('button', { class: 'ib close', title: 'Terminal schließen', text: '✕', onclick: () => hooks.onClose(pane) });
    // Agent status dot (F01): shown only while a hook reports a session for this tile.
    const AT = window.DeckAttention || null;
    const statusDot = AT ? AT.createStatusDot({ h }) : null;
    let agentEntry = null;
    if (statusDot) {
      // The head is draggable: a drag must never start from the dot.
      statusDot.el.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
      statusDot.el.addEventListener('mouseenter', () => {
        if (!agentEntry) return;
        const info = AT.dotInfo(agentEntry);
        statusDot.el.title = info.title + ' · ' + AT.relativeTime(agentEntry.observedAt, Date.now());
      });
    }
    pane.setAgentEntry = function (entry) {
      agentEntry = entry || null;
      if (statusDot) statusDot.update(agentEntry);
    };
    // F10: verknüpfte Second-Brain-Aufgabe (nur Lesen; gespeichert wird die ID)
    const taskLink = window.DeckTaskLink && api.secondBrain
      ? window.DeckTaskLink.createTaskLink({ desc, api, h, onChange: () => hooks.onChange(), focusTerminal: () => term.focus() })
      : null;
    const head = h('div', { class: 'tile-head' }, numEl, titleEl, statusDot ? statusDot.el : null, acctChip, wtChip, taskLink ? taskLink.el : null, resumeBtn, h('span', { class: 'spacer' }), bDictCancel, bMic, seg, bBrowser, bSnap, bMax, bClose);

    const termEl = h('div', { class: 'term' });
    const exitMsg = h('span', { text: 'beendet' });
    const exitBar = h('div', { class: 'exit-bar', hidden: true }, exitMsg, h('button', { class: 'btn-small', text: 'Neu starten', onclick: () => restart() }));
    const termWrap = h('div', { class: 'term-wrap' }, termEl, exitBar);
    const body = h('div', { class: 'tile-body' }, termWrap);
    const el = h('div', { class: 'tile' }, head, body);
    el.style.setProperty('--tile-bg', tint.bg);
    el.style.setProperty('--tile-head', tint.head);
    el.style.setProperty('--tile-edge', tint.edge);
    pane.el = el;
    pane.head = head;

    el.addEventListener('mousedown', (e) => hooks.onActivate(pane, !e.target.closest('input, webview, .btn-resume, .exit-bar button')), true);

    /* Größe */
    function fitNow() {
      if (!term.element || termWrap.clientWidth < 30 || termWrap.clientHeight < 20) return;
      try { fit.fit(); } catch (_) { return; }
      if (pane.status === 'running' && (term.cols !== lastCols || term.rows !== lastRows)) {
        lastCols = term.cols; lastRows = term.rows;
        D.guard(() => api.terminals.resize(id, term.cols, term.rows));
      }
    }
    let roTimer;
    const ro = new ResizeObserver(() => { clearTimeout(roTimer); roTimer = setTimeout(fitNow, 70); });
    pane.refit = fitNow;

    function setStatus(s, msg) {
      pane.status = s;
      el.dataset.status = s;
      exitBar.hidden = s !== 'exited';
      if (msg) exitMsg.textContent = msg;
      refreshResume();
      refreshMic();
      hooks.onStatus(pane);
      requestAnimationFrame(fitNow);
    }

    /* Shell */
    let restored = Promise.resolve();
    pane.mount = function (parent) {
      parent.append(el);
      term.open(termEl);
      term.onData((d) => {
        if (pane.status !== 'running') return;
        api.terminals.write(id, d);
        if (!desc.titleLocked && d.indexOf('\r') !== -1) setTimeout(autoTitle, 0);
      });
      // Real key presses only (term.onData would also carry terminal replies): answers a waiting agent.
      term.onKey(() => { if (D.attention) D.attention.userInput(id); });
      ro.observe(termWrap);
      if (opts.restored) {
        restored = D.guard(() => api.session.loadScrollback(id)).then((text) => new Promise((res) => {
          // Alter Verlauf ohne seine Farben und gedimmt, damit er sich von der neuen Shell abhebt.
          if (text) term.write('\x1b[2m' + text.replace(/\x1b\[[0-9;:]*m/g, '') + '\x1b[0m\r\n');
          term.write('\x1b[2m── wiederhergestellt ──\x1b[0m\r\n', res);
        }));
      }
      restored.then(() => { pane.ready = true; });
      if (!opts.restored) pane.ready = true;
    };

    async function start() {
      if (pane.status === 'running' || starting) return false;
      starting = true;
      await restored;
      fitNow();
      const command = pendingCommand;
      pendingCommand = null;
      const r = await D.guard(() => api.terminals.create({ id, projectId: project.id, cols: term.cols, rows: term.rows, command: command || null, accountOverrides: desc.accounts || undefined, workspaceId: desc.workspaceId || undefined }));
      starting = false;
      if (!r || !r.ok) {
        if (r && r.error) D.notify('Terminal konnte nicht gestartet werden: ' + r.error);
        setStatus('exited', 'nicht gestartet');
        return false;
      }
      if (r.accounts) {
        // Die Antwort nennt die tatsächlich geltenden Konten: gesetzte Overrides bleiben,
        // und ein inzwischen entferntes Konto wird durch das aktive ersetzt
        let changed = false;
        desc.accounts = desc.accounts || {};
        for (const a of r.accounts) if (desc.accounts[a.provider] !== a.id) { desc.accounts[a.provider] = a.id; changed = true; }
        if (changed) hooks.onChange();
        pane.refreshAccount();
      }
      lastCols = term.cols; lastRows = term.rows;
      setStatus('running');
      return true;
    }

    async function restart() {
      term.write('\x1b[0m\r\n\x1b[2m── neu gestartet ──\x1b[0m\r\n');
      if (await start()) term.focus();
    }

    pane.ensureStarted = function () {
      if (pane.started) return;
      pane.started = true;
      if (desc.browserOpen) setBrowserOpen(true, null, true);
      start();
    };

    /* Arbeitskopie-Chip (F07): Branch und Ordner der getrennten Arbeitskopie, "fehlt" wenn der Ordner weg ist */
    if (desc.workspaceId && api.worktrees) {
      wtChip.hidden = false;
      wtChip.textContent = '⑂ …';
      D.guard(() => api.worktrees.inspect(desc.workspaceId)).then((i) => {
        if (!i || !i.ok) { wtChip.textContent = '⑂ unbekannt'; wtChip.classList.add('bad'); return; }
        const b = i.worktree ? i.worktree.branch : i.branch;
        wtChip.textContent = '⑂ ' + b + (i.exists ? '' : ' (fehlt)');
        wtChip.title = 'Arbeitskopie: ' + (i.worktree ? i.worktree.cwd : '') + (i.changes ? ` – ${i.changes} Änderungen` : '');
        wtChip.classList.toggle('bad', !i.exists);
      });
    }

    /* Konto-Chip: nur für Schnellstarts claude/codex und nur, wenn der Anbieter mehrere Konten hat */
    pane.refreshAccount = function () {
      const label = hooks.accountLabel ? hooks.accountLabel(desc) : null;
      acctChip.hidden = !label;
      acctChip.textContent = label || '';
      acctChip.title = label ? 'Konto: ' + label : '';
    };
    pane.refreshAccount();

    if (D.attention) pane.setAgentEntry(D.attention.entryFor(id));

    pane.write = (data) => {
      term.write(data);
      // Live output only: restored history is written in mount() and never lands here.
      const url = auto && auto.feed(data);
      if (url) autoOpen(url);
    };
    pane.handleExit = function (code) {
      const last = auto && auto.flush();
      if (last) autoOpen(last);
      term.write('\x1b[0m\r\n\x1b[2m[Prozess beendet]\x1b[0m\r\n');
      setStatus('exited', 'beendet' + (typeof code === 'number' ? ' (Code ' + code + ')' : ''));
    };

    pane.type = function (text) {
      if (pane.status !== 'running') { D.notify('Dieses Terminal läuft nicht.'); return false; }
      api.terminals.write(id, text);
      return true;
    };

    /* Fortsetzen / Neu starten: <Label> */
    // F02: exact conversation per tile. The plan comes from the main process (validated ID, account, project);
    // without a belegte ID the old "letztes Gespräch" command stays, but the button says so.
    const RESUME_PROVIDERS = ['claude', 'codex', 'kimi'];
    let resumeInfo = { exact: false, command: null, reason: '' };
    async function planResume() {
      const provider = RESUME_PROVIDERS.includes(desc.presetId) ? desc.presetId : null;
      if (!provider || !api.agents || !api.agents.resumePlan) { resumeInfo = { exact: false, command: null, reason: '' , provider }; return; }
      const plan = await D.guard(() => api.agents.resumePlan({
        provider, nativeSession: desc.nativeSession || null,
        accountId: desc.accounts ? desc.accounts[provider] : null, projectId: project.id,
      }), null);
      resumeInfo = Object.assign({ exact: false, command: null, reason: '' }, plan || {}, { provider });
    }
    function refreshResume() {
      const cmd = (resumeInfo.exact && resumeInfo.command) || desc.resumeCommand || desc.command;
      const show = pane.canResume && !!cmd;
      resumeBtn.hidden = !show;
      if (show) {
        const generic = !resumeInfo.exact && !!desc.resumeCommand && RESUME_PROVIDERS.includes(resumeInfo.provider);
        resumeBtn.textContent = resumeInfo.exact ? 'Fortsetzen'
          : generic ? 'Fortsetzen: letztes Gespräch'
          : desc.resumeCommand ? 'Fortsetzen' : 'Neu starten: ' + (hooks.presetLabel(desc) || desc.command);
        resumeBtn.title = resumeInfo.exact ? 'Dieses Gespräch (feste Zuordnung): ' + cmd
          : generic ? 'Keine feste Zuordnung (' + (resumeInfo.reason || 'keine Gesprächs-ID') + '): setzt das zuletzt geänderte Gespräch dieses Ordners fort: ' + cmd
          : cmd;
        resumeBtn.classList.toggle('resume-loose', generic);
      }
    }
    pane.setNativeSession = function (rec) {
      desc.nativeSession = rec || undefined;
      planResume().then(refreshResume);
      hooks.onChange();
    };
    async function resume() {
      if (!(resumeInfo.exact && resumeInfo.command) && !desc.resumeCommand && !desc.command) return;
      pane.canResume = false;
      refreshResume();
      if (pane.status !== 'running' && !(await start())) return;
      await planResume(); // after start(): the account the tile really runs with
      const cmd = (resumeInfo.exact && resumeInfo.command) || desc.resumeCommand || desc.command;
      if (!cmd) return;
      // App-own command: the main process may add the profile flag; raw input (pane.type) is never rewritten.
      if (api.terminals.runBuiltin && pane.status === 'running') api.terminals.runBuiltin(id, cmd);
      else pane.type(cmd + '\r');
      term.focus();
    }
    planResume().then(refreshResume);
    refreshResume();

    /* Diktat: Zustand kommt aus D.dictation, die Kachel spiegelt ihn nur */
    let dictPhase = 'idle';
    const MIC_TIPS = {
      idle: 'Diktieren (Flüsterflow)',
      starting: 'Diktat startet …',
      loading: 'Sprachmodell wird geladen – du kannst schon sprechen. Klick zum Stoppen',
      recording: 'Aufnahme läuft – Klick zum Stoppen',
      processing: 'Text wird erzeugt …',
    };
    function refreshMic() {
      const rec = dictPhase === 'starting' || dictPhase === 'loading' || dictPhase === 'recording';
      bMic.classList.toggle('rec', rec);
      bMic.classList.toggle('busy', dictPhase === 'processing');
      bMic.textContent = dictPhase === 'processing' ? '⏳' : '🎙';
      bMic.title = dictPhase === 'idle' && pane.status !== 'running' ? 'Diktieren nicht möglich: Terminal läuft nicht' : MIC_TIPS[dictPhase];
      bMic.disabled = dictPhase === 'idle' && pane.status !== 'running';
      bDictCancel.hidden = !rec;
      el.classList.toggle('dictating', rec);
      el.classList.toggle('dict-busy', dictPhase === 'processing');
    }
    function onMic() {
      if (pane.status !== 'running' && dictPhase === 'idle') return;
      if (dictPhase === 'idle') hooks.onActivate(pane, false);
      D.dictation.click(id);
      term.focus();
    }
    const dictUnregister = D.dictation ? D.dictation.register(id, {
      title: () => desc.title,
      update: (phase) => { dictPhase = phase; refreshMic(); },
    }) : null;
    refreshMic();

    /* Name aus dem ersten Prompt. Gelesen wird die Zeile unter dem Cursor beim Enter, nicht nur
       die Tastatureingabe, damit auch Diktat und Einfügen zählen (die schreibt der Hauptprozess).
       Eine Shell ohne Agent wird ignoriert, bis ein Agent-CLI gestartet wurde. */
    const AGENT_CLI = /^(claude|codex|kimi|gemini|opencode|aider)(\s|$)/i;
    let agentSeen = !!desc.command;
    function cursorLine() {
      const b = term.buffer.active;
      const l = b.getLine(b.baseY + b.cursorY);
      return l ? l.translateToString(true) : '';
    }
    function autoTitle() {
      if (desc.titleLocked || pane.status !== 'running') return;
      // Eingabezeile des Agenten: Rahmen und Prompt-Zeichen vorn entfernen
      let line = cursorLine().replace(/[│┃║]/g, ' ').replace(/^[\s>❯$%#›»]+/, '').trim();
      if (!line || /^\d+[.)]\s/.test(line) || /^(\/|!)/.test(line)) return;
      if (!agentSeen) {
        if (!AGENT_CLI.test(line)) return;
        agentSeen = true;
        line = line.replace(AGENT_CLI, '').replace(/(^|\s)-{1,2}[\w-]+(=\S+)?/g, ' ').trim();
        if (!line) return;
      }
      const t = D.titleFromPrompt(line);
      if (!t) return;
      desc.title = t;
      desc.titleLocked = true;
      titleEl.textContent = t;
      hooks.onChange();
    }

    /* Titel umbenennen */
    function startRename() {
      const input = h('input', { class: 'tile-title-edit', value: desc.title });
      titleEl.replaceWith(input);
      input.focus(); input.select();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (ok && v && v !== desc.title) { desc.title = v; desc.titleLocked = true; titleEl.textContent = v; hooks.onChange(); }
        input.replaceWith(titleEl);
        term.focus();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
      input.addEventListener('blur', () => finish(true));
    }

    pane.setMax = function (v) {
      pane.maxed = v;
      el.classList.toggle('max', v);
      bMax.textContent = v ? '⤡' : '⤢';
    };
    // In "browser only" the terminal is hidden and cannot take the focus.
    function focusMain() {
      if (browserOnly() && wv) { try { wv.focus(); } catch (_) {} } else term.focus();
    }
    pane.setActive = function (v, focus) {
      el.classList.toggle('active', v);
      if (v && focus) focusMain();
    };
    pane.focus = focusMain;
    // Shown for the first ten tiles only; key is '' for the rest.
    pane.setNumber = function (key) {
      numEl.textContent = key;
      numEl.hidden = !key;
    };

    /* Snapshot / Scrollback */
    pane.plainText = function () {
      const b = term.buffer.active;
      const lines = [];
      for (let i = 0; i < b.length; i++) {
        const l = b.getLine(i);
        lines.push(l ? l.translateToString(true).replace(/\s+$/, '') : '');
      }
      return lines.join('\n').replace(/\s+$/, '');
    };
    async function snapshot() {
      const text = pane.plainText();
      if (!text) { D.notify('Das Terminal ist leer, nichts zu speichern.', 'info'); return; }
      const r = await D.guard(() => api.progress.saveSnapshot(project.id, desc.title, text));
      if (r && r.path) D.notify('Snapshot gespeichert: ' + r.path, 'ok', 5000);
    }
    pane.serialize = () => serializer.serialize({ scrollback: 1500 });

    /* Mini-Browser */
    let browser, addr, bBack, bFwd, bToAgent, feedback; // F05: feedback
    const modeOf = () => (BV ? BV.normalizeMode(desc.browserMode) : 'split');
    const browserOnly = () => !!desc.browserOpen && !!browser && modeOf() === 'browser';
    function buildBrowser() {
      bToAgent = h('button', { class: 'btn-small to-agent', hidden: true, title: 'Zurück zum Agenten (Terminal)', text: '← Agent', onclick: () => { setMode('split'); term.focus(); } });
      bBack = h('button', { class: 'ib', title: 'Zurück', text: '←', disabled: true, onclick: () => { try { wv.goBack(); } catch (_) {} } });
      bFwd = h('button', { class: 'ib', title: 'Vor', text: '→', disabled: true, onclick: () => { try { wv.goForward(); } catch (_) {} } });
      const bReload = h('button', { class: 'ib', title: 'Neu laden', text: '⟳', onclick: () => { try { wv.reload(); } catch (_) {} } });
      const bShut = h('button', { class: 'ib', title: 'Mini-Browser schließen', text: '✕', onclick: () => setBrowserOpen(false) });
      addr = h('input', { class: 'addr', type: 'text', spellcheck: false, placeholder: 'Adresse eingeben, z. B. localhost:3000' });
      addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(addr.value); });
      addr.addEventListener('focus', () => addr.select());
      const host = h('div', { class: 'wv-host' });
      // F05: Knopf "Element kommentieren" (nur mit geladenem Modul)
      feedback = D.browserFeedback ? D.browserFeedback.attach({ terminalId: id, getUrl: () => safeUrl(), host: null }) : null;
      browser = h('div', { class: 'browser' }, h('div', { class: 'browser-bar' }, bToAgent, bBack, bFwd, bReload, addr, feedback ? feedback.button : null, bShut), host);
      wv = document.createElement('webview');
      wv.setAttribute('partition', 'persist:minibrowser');
      wv.setAttribute('allowpopups', '');
      if (desc.browserUrl) { wv.setAttribute('src', desc.browserUrl); addr.value = desc.browserUrl; }
      wv.addEventListener('dom-ready', () => { wvReady = true; updateNav(); });
      const onNav = (e) => { if (e.url && (e.isMainFrame === undefined || e.isMainFrame)) setUrl(e.url); };
      wv.addEventListener('did-navigate', onNav);
      wv.addEventListener('did-navigate-in-page', onNav);
      wv.addEventListener('did-fail-load', (e) => {
        if (e.isMainFrame && e.errorCode !== -3) D.notify('Seite konnte nicht geladen werden (' + (e.errorDescription || e.errorCode) + '): ' + e.validatedURL);
      });
      wv.addEventListener('focus', () => hooks.onActivate(pane, false));
      host.append(wv);
      body.append(browser);
      if (feedback) feedback.setHost(browser); // F05
    }
    function updateNav() {
      if (!wvReady) return;
      try { bBack.disabled = !wv.canGoBack(); bFwd.disabled = !wv.canGoForward(); } catch (_) {}
    }
    function setUrl(u) {
      if (addr && document.activeElement !== addr) addr.value = u;
      if (auto) auto.setCurrent(u);
      if (desc.browserUrl !== u) { desc.browserUrl = u; hooks.onChange(); }
      updateNav();
    }
    function navigate(raw) {
      const url = D.normalizeUrl(raw);
      if (!url) { D.notify('Ungültige Adresse. Erlaubt sind nur http- und https-Adressen.'); return; }
      addr.value = url;
      desc.browserUrl = url;
      if (auto) auto.setCurrent(url);
      hooks.onChange();
      if (wvReady) { Promise.resolve(wv.loadURL(url)).catch(() => {}); } else { wv.setAttribute('src', url); }
    }
    // Shows/hides parts of the tile for the stored mode. Nothing is removed from the
    // DOM, so neither the page nor the shell is restarted by a mode change.
    function applyView() {
      const open = !!desc.browserOpen && !!browser;
      const v = BV ? BV.viewFor(desc.browserMode, open)
        : { mode: 'split', showTerminal: true, showBrowser: open, classes: open ? ['with-browser'] : [] };
      for (const c of ['with-browser', 'mode-terminal', 'mode-browser']) body.classList.toggle(c, v.classes.includes(c));
      seg.hidden = !open;
      segBtns.forEach((b, i) => b.classList.toggle('on', open && SEG[i][0] === v.mode));
      if (bToAgent) bToAgent.hidden = !(open && v.mode === 'browser');
      if (v.showTerminal) requestAnimationFrame(fitNow);
    }
    function setMode(mode) {
      if (!BV) return;
      const m = BV.normalizeMode(mode);
      if (desc.browserMode !== m) { desc.browserMode = m; hooks.onChange(); }
      applyView();
      if (m === 'browser') { if (wv) { try { wv.focus(); } catch (_) {} } } else term.focus();
    }
    // opts.agent: opened/closed by a program, not by the user: no focus change, no "closed on purpose"
    function setBrowserOpen(open, url, silent, opts) {
      const byAgent = !!(opts && opts.agent);
      if (open) {
        if (!wv) buildBrowser();
        browser.hidden = false;
        if (opts && opts.mode && BV && desc.browserMode !== opts.mode) { desc.browserMode = opts.mode; hooks.onChange(); }
        if (url) navigate(url);
        else if (!desc.browserUrl && !silent) addr.focus();
      } else {
        if (browser) browser.hidden = true;
        if (auto && !byAgent) auto.userClosed();
        if (!byAgent) term.focus();
      }
      if (desc.browserOpen !== !!open) { desc.browserOpen = !!open; hooks.onChange(); }
      bBrowser.classList.toggle('on', !!open);
      applyView();
    }
    function openBrowser(url) {
      const u = D.normalizeUrl(url);
      if (!u) return;
      setBrowserOpen(true, u);
    }
    // A local address showed up in the live output: show it next to the terminal,
    // without taking the keyboard focus away from the shell.
    function autoOpen(url) {
      if (pane.disposed) return;
      setBrowserOpen(true, url, true, { agent: true, mode: 'split' });
      D.notify('Adresse automatisch im Mini-Browser geöffnet: ' + url, 'info', 3500);
    }
    if (desc.browserOpen) bBrowser.classList.add('on');

    /* Schnittstelle für die Agentensteuerung aus dem Hauptprozess (Teil B2) */
    function whenLoaded(timeoutMs) {
      return new Promise((resolve) => {
        let timer;
        const done = (r) => {
          clearTimeout(timer);
          wv.removeEventListener('did-finish-load', onOk);
          wv.removeEventListener('did-fail-load', onFail);
          resolve(r);
        };
        const onOk = () => done({ ok: true, url: safeUrl() });
        const onFail = (e) => { if (e.isMainFrame && e.errorCode !== -3) done({ ok: false, error: (e.errorDescription || 'Fehler ' + e.errorCode) + ': ' + e.validatedURL }); };
        timer = setTimeout(() => done({ ok: false, error: 'Zeitüberschreitung beim Laden der Seite.' }), timeoutMs);
        wv.addEventListener('did-finish-load', onOk);
        wv.addEventListener('did-fail-load', onFail);
      });
    }
    function safeUrl() { try { return wv.getURL() || desc.browserUrl || ''; } catch (_) { return desc.browserUrl || ''; }}
    pane.browserApi = {
      // Opens (building the browser if needed), navigates and resolves when the load finished or failed.
      async open(raw) {
        const url = D.normalizeUrl(raw);
        if (!url) return { ok: false, error: 'Ungültige Adresse. Erlaubt sind nur http- und https-Adressen.' };
        if (!wv) buildBrowser();
        const loaded = whenLoaded(20000);
        // A hidden browser would be pointless for the user watching: show it, keep a "browser only" choice.
        setBrowserOpen(true, url, true, { agent: true, mode: modeOf() === 'terminal' ? 'split' : undefined });
        return loaded;
      },
      show() {
        setBrowserOpen(true, null, true, { agent: true, mode: modeOf() === 'terminal' ? 'split' : undefined });
        return true;
      },
      hide() {
        setBrowserOpen(false, null, true, { agent: true });
        return true;
      },
      isOpen: () => !!desc.browserOpen,
      // True when the page is actually on screen (open, not hidden by mode, project shown).
      visible: () => !!wv && wv.offsetWidth > 0 && wv.offsetHeight > 0,
      webContentsId() {
        if (!wv || !wvReady) return null;
        try { return wv.getWebContentsId(); } catch (_) { return null; }
      },
      mode: () => modeOf(),
    };

    /* Aufräumen */
    pane.dispose = function () {
      pane.disposed = true;
      if (taskLink) taskLink.close(false); // F10
      if (feedback) feedback.dispose(); // F05
      clearTimeout(roTimer);
      if (dictUnregister) dictUnregister();
      ro.disconnect();
      if (pane.status === 'running' || starting) D.guard(() => api.terminals.kill(id));
      D.guard(() => api.session.deleteScrollback(id));
      try { term.dispose(); } catch (_) {}
      el.remove();
    };
    /* Ohne kill/deleteScrollback (Projekt entfernt: Main beendet Shells selbst) */
    pane.disposeQuiet = function () {
      pane.status = 'exited';
      pane.dispose();
    };

    return pane;
  };
})();
