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

    const term = new Terminal({
      fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
      fontSize: 12.5, lineHeight: 1.12, cursorBlink: true, scrollback: 5000,
      theme: D.xtermTheme, allowProposedApi: true,
    });
    const fit = new FitAddon.FitAddon();
    const serializer = new SerializeAddon.SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(serializer);
    term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, uri) => openBrowser(uri)));
    pane.term = term;

    /* DOM */
    const titleEl = h('span', { class: 'tile-title', title: 'Doppelklick zum Umbenennen', text: desc.title, ondblclick: startRename });
    const resumeBtn = h('button', { class: 'btn-resume', hidden: true, onclick: resume });
    const bMic = h('button', { class: 'ib mic', title: 'Diktieren (Flüsterflow)', text: '🎙', onclick: onMic });
    const bDictCancel = h('button', { class: 'btn-dict-cancel', hidden: true, title: 'Diktat verwerfen', text: 'Abbrechen', onclick: () => { D.dictation.cancel(); term.focus(); } });
    const bBrowser = h('button', { class: 'ib', title: 'Mini-Browser ein/aus', text: '🌐', onclick: () => setBrowserOpen(!desc.browserOpen) });
    const bSnap = h('button', { class: 'ib', title: 'Snapshot: Terminal-Ausgabe als Datei speichern', text: '💾', onclick: snapshot });
    const bMax = h('button', { class: 'ib', title: 'Maximieren / Wiederherstellen', text: '⤢', onclick: () => { pane.setMax(!pane.maxed); hooks.onMaximize(pane); } });
    const bClose = h('button', { class: 'ib close', title: 'Terminal schließen', text: '✕', onclick: () => hooks.onClose(pane) });
    const head = h('div', { class: 'tile-head' }, titleEl, resumeBtn, h('span', { class: 'spacer' }), bDictCancel, bMic, bBrowser, bSnap, bMax, bClose);

    const termEl = h('div', { class: 'term' });
    const exitMsg = h('span', { text: 'beendet' });
    const exitBar = h('div', { class: 'exit-bar', hidden: true }, exitMsg, h('button', { class: 'btn-small', text: 'Neu starten', onclick: () => restart() }));
    const termWrap = h('div', { class: 'term-wrap' }, termEl, exitBar);
    const body = h('div', { class: 'tile-body' }, termWrap);
    const el = h('div', { class: 'tile' }, head, body);
    pane.el = el;

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
      term.onData((d) => { if (pane.status === 'running') api.terminals.write(id, d); });
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
      const r = await D.guard(() => api.terminals.create({ id, projectId: project.id, cols: term.cols, rows: term.rows, command: command || null }));
      starting = false;
      if (!r || !r.ok) {
        if (r && r.error) D.notify('Terminal konnte nicht gestartet werden: ' + r.error);
        setStatus('exited', 'nicht gestartet');
        return false;
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

    pane.write = (data) => term.write(data);
    pane.handleExit = function (code) {
      term.write('\x1b[0m\r\n\x1b[2m[Prozess beendet]\x1b[0m\r\n');
      setStatus('exited', 'beendet' + (typeof code === 'number' ? ' (Code ' + code + ')' : ''));
    };

    pane.type = function (text) {
      if (pane.status !== 'running') { D.notify('Dieses Terminal läuft nicht.'); return false; }
      api.terminals.write(id, text);
      return true;
    };

    /* Fortsetzen / Neu starten: <Label> */
    function refreshResume() {
      const cmd = desc.resumeCommand || desc.command;
      const show = pane.canResume && !!cmd;
      resumeBtn.hidden = !show;
      if (show) {
        resumeBtn.textContent = desc.resumeCommand ? 'Fortsetzen' : 'Neu starten: ' + (hooks.presetLabel(desc) || desc.command);
        resumeBtn.title = cmd;
      }
    }
    async function resume() {
      const cmd = desc.resumeCommand || desc.command;
      if (!cmd) return;
      pane.canResume = false;
      refreshResume();
      if (pane.status !== 'running' && !(await start())) return;
      pane.type(cmd + '\r');
      term.focus();
    }
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
        if (ok && v && v !== desc.title) { desc.title = v; titleEl.textContent = v; hooks.onChange(); }
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
    pane.setActive = function (v, focus) {
      el.classList.toggle('active', v);
      if (v && focus) term.focus();
    };
    pane.focus = () => term.focus();

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
    let browser, addr, bBack, bFwd;
    function buildBrowser() {
      bBack = h('button', { class: 'ib', title: 'Zurück', text: '←', disabled: true, onclick: () => { try { wv.goBack(); } catch (_) {} } });
      bFwd = h('button', { class: 'ib', title: 'Vor', text: '→', disabled: true, onclick: () => { try { wv.goForward(); } catch (_) {} } });
      const bReload = h('button', { class: 'ib', title: 'Neu laden', text: '⟳', onclick: () => { try { wv.reload(); } catch (_) {} } });
      const bShut = h('button', { class: 'ib', title: 'Mini-Browser schließen', text: '✕', onclick: () => setBrowserOpen(false) });
      addr = h('input', { class: 'addr', type: 'text', spellcheck: false, placeholder: 'Adresse eingeben, z. B. localhost:3000' });
      addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(addr.value); });
      addr.addEventListener('focus', () => addr.select());
      const host = h('div', { class: 'wv-host' });
      browser = h('div', { class: 'browser' }, h('div', { class: 'browser-bar' }, bBack, bFwd, bReload, addr, bShut), host);
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
    }
    function updateNav() {
      if (!wvReady) return;
      try { bBack.disabled = !wv.canGoBack(); bFwd.disabled = !wv.canGoForward(); } catch (_) {}
    }
    function setUrl(u) {
      if (addr && document.activeElement !== addr) addr.value = u;
      if (desc.browserUrl !== u) { desc.browserUrl = u; hooks.onChange(); }
      updateNav();
    }
    function navigate(raw) {
      const url = D.normalizeUrl(raw);
      if (!url) { D.notify('Ungültige Adresse. Erlaubt sind nur http- und https-Adressen.'); return; }
      addr.value = url;
      desc.browserUrl = url;
      hooks.onChange();
      if (wvReady) { Promise.resolve(wv.loadURL(url)).catch(() => {}); } else { wv.setAttribute('src', url); }
    }
    function setBrowserOpen(open, url, silent) {
      if (open) {
        if (!wv) buildBrowser();
        browser.hidden = false;
        body.classList.add('with-browser');
        if (url) navigate(url);
        else if (!desc.browserUrl && !silent) addr.focus();
      } else {
        if (browser) browser.hidden = true;
        body.classList.remove('with-browser');
        term.focus();
      }
      bBrowser.classList.toggle('on', !!open);
      if (desc.browserOpen !== !!open) { desc.browserOpen = !!open; hooks.onChange(); }
    }
    function openBrowser(url) {
      const u = D.normalizeUrl(url);
      if (!u) return;
      setBrowserOpen(true, u);
    }
    if (desc.browserOpen) bBrowser.classList.add('on');

    /* Aufräumen */
    pane.dispose = function () {
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
