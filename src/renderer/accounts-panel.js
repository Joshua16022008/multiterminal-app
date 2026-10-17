/* Seitenpanel für die Konten je KI-Anbieter: aktivieren, hinzufügen, umbenennen, entfernen, anmelden. */
(function () {
  'use strict';
  // „?“-Link zur Hilfe (gemeinsamer Zugang in help-panel.js); ohne Hilfe-Panel bleibt er weg.
  const helpLink = (key, opts) => (typeof window !== 'undefined' && window.DeckHelp && window.DeckHelp.linkFor ? window.DeckHelp.linkFor(key, opts) : null);
  const D = (window.DeckApp = window.DeckApp || {});
  const h = D.h;

  const USAGE_REFRESH_MS = 60000;
  let root, body, opts;
  let open = false, token = 0;
  let providers = [];
  let error = '';
  let renaming = null;       // Konto-id im Umbenennen-Modus
  let removing = null;       // Konto-id mit offener Rückfrage
  let usage = {};            // Konto-id -> Ergebnis der Verbrauchsabfrage
  let claudeState = null;    // 'aktiv' | 'aus' | 'fremd' | 'veraltet'
  let timer = null;
  let usageToken = 0;
  const drafts = {};         // Anbieter -> Text im Feld „Konto hinzufügen“

  /* Ruft die API auf; Fehler erscheinen im Panel statt als Hinweis. */
  async function run(fn) {
    try {
      const r = await fn();
      error = '';
      return r === undefined ? true : r;
    } catch (e) {
      error = D.errText(e);
      render();
      return null;
    }
  }

  /* Verbrauch und Zustand der Claude-Statuszeile laden; ein Fehler dabei zeigt nur den Hinweis im Panel. */
  async function loadUsage() {
    const my = ++usageToken;
    try {
      const [list, status] = await Promise.all([window.deck.usage.list(), window.deck.usage.claudeStatus()]);
      if (my !== usageToken) return;
      usage = {};
      for (const r of list) usage[r.accountId] = r;
      claudeState = status && status.state;
    } catch (e) {
      error = D.errText(e);
    }
    if (renaming === null) render(); // ein offenes Umbenennen-Feld bleibt unangetastet
  }

  async function toggleStatusline(enable) {
    const r = await run(() => (enable ? window.deck.usage.claudeEnable() : window.deck.usage.claudeDisable()));
    if (r) loadUsage();
  }

  async function reload() {
    loadUsage();
    const my = ++token;
    try {
      const list = await window.deck.accounts.list();
      if (my !== token) return;
      providers = list;
    } catch (e) {
      error = D.errText(e);
    }
    render();
    opts.onChange(providers);
  }

  async function setActive(provider, id) {
    if (await run(() => window.deck.accounts.setActive(provider, id))) reload();
  }

  async function add(provider, input) {
    const label = input.value.trim();
    if (!label) return;
    if (await run(() => window.deck.accounts.add(provider, label))) { drafts[provider] = ''; reload(); }
  }

  async function rename(acc, value) {
    renaming = null;
    const label = value.trim();
    if (label && label !== acc.label) await run(() => window.deck.accounts.rename(acc.id, label));
    reload();
  }

  async function remove(acc) {
    removing = null;
    if (await run(() => window.deck.accounts.remove(acc.id))) reload();
  }

  function login(p, acc) {
    const r = opts.onLogin(p.provider, acc, p.loginCommand);
    error = r === true ? '' : r;
    render();
  }

  function row(p, acc) {
    const radio = h('input', { type: 'radio', name: 'acct-' + p.provider, checked: acc.active, title: 'Für neue Terminals verwenden' });
    radio.addEventListener('change', () => setActive(p.provider, acc.id));
    let nameEl;
    if (renaming === acc.id) {
      nameEl = h('input', { class: 'proj-edit acct-edit', value: acc.label });
      nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') rename(acc, nameEl.value);
        else if (e.key === 'Escape') { renaming = null; render(); }
      });
      nameEl.addEventListener('blur', () => { if (renaming === acc.id) rename(acc, nameEl.value); });
    } else {
      nameEl = h('span', { class: 'acct-name', text: acc.label });
    }
    const line = h('div', { class: 'acct-line' }, radio, nameEl,
      acc.active ? h('span', { class: 'gh-tag local', text: 'aktiv' }) : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'ib', title: 'In einem neuen Terminal anmelden (' + p.loginCommand + ')', text: 'Anmelden', onclick: () => login(p, acc) }),
      h('button', { class: 'ib', title: 'Umbenennen', text: '✎', onclick: () => { renaming = acc.id; render(); } }),
      acc.builtin ? null : h('button', { class: 'ib close', title: 'Entfernen', text: '✕', onclick: () => { removing = acc.id; render(); } }));
    const box = h('div', { class: 'acct-row' + (acc.active ? ' active' : '') }, line);
    if (usage[acc.id] && window.DeckUsage) box.append(window.DeckUsage.buildAccountRow(usage[acc.id], null));
    if (removing === acc.id) {
      box.append(h('div', { class: 'acct-confirm' },
        h('p', { text: `„${acc.label}“ entfernen? Der Kontoordner wandert in den Papierkorb, laufende Terminals mit diesem Konto verlieren ihre Anmeldung.` }),
        h('div', { class: 'row' },
          h('button', { class: 'btn-small', text: 'Abbrechen', onclick: () => { removing = null; render(); } }),
          h('button', { class: 'btn-small acct-danger', text: 'Entfernen', onclick: () => remove(acc) }))));
    }
    return box;
  }

  /* Schalter für die Claude-Statuszeile: wird nur auf Klick eingetragen. */
  function claudeSetup() {
    if (claudeState === 'fremd') {
      return h('p', { class: 'gh-note', text: 'In den Claude-Einstellungen ist schon eine eigene Statuszeile gesetzt. Sie bleibt unverändert, daher gibt es keinen Claude-Verbrauch.' });
    }
    if (claudeState === 'aktiv') {
      return h('div', { class: 'usage-setup' },
        h('button', { class: 'ib', title: 'Entfernt die Statuszeile aus ~/.claude/settings.json', text: 'Claude-Verbrauch deaktivieren', onclick: () => toggleStatusline(false) }));
    }
    if (claudeState === 'aus' || claudeState === 'veraltet') {
      return h('div', { class: 'usage-setup' },
        h('p', { class: 'gh-note', text: 'Trägt eine Statuszeile in ~/.claude/settings.json ein; gilt für alle Claude-Konten.' }),
        h('button', { class: 'btn-small', text: claudeState === 'veraltet' ? 'Claude-Verbrauch erneuern' : 'Claude-Verbrauch aktivieren', onclick: () => toggleStatusline(true) }));
    }
    return null;
  }

  function section(p) {
    const input = h('input', { class: 'acct-new', placeholder: 'Name, z. B. privat', value: drafts[p.provider] || '' });
    input.addEventListener('input', () => { drafts[p.provider] = input.value; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(p.provider, input); });
    return h('section', { class: 'acct-section' },
      h('h3', { text: p.name }),
      ...p.accounts.map((a) => row(p, a)),
      p.provider === 'claude' ? claudeSetup() : null,
      h('div', { class: 'acct-add' }, input,
        h('button', { class: 'btn-small', text: 'Konto hinzufügen', onclick: () => add(p.provider, input) })));
  }

  function render() {
    if (!body) return;
    // Ein offenes Umbenennen-Feld nicht durch fremde Neuzeichnungen zerstören
    body.replaceChildren(
      h('p', { class: 'gh-note', text: 'Umschalten gilt für neue Terminals; laufende behalten ihr Konto.' }),
      ...(error ? [h('p', { class: 'gh-note err', text: error })] : []),
      ...providers.map(section));
    const edit = body.querySelector('.acct-edit');
    if (edit) { edit.focus(); edit.select(); }
  }

  D.accountsPanel = {
    /* opts: onClose(), onChange(providers), onLogin(provider, konto, befehl) -> true | Hinweistext */
    init(o) {
      opts = o;
      root = document.getElementById('accounts-panel');
      body = h('div', { class: 'acct-body' });
      root.append(
        h('div', { class: 'pp-head' },
          h('strong', { text: 'Konten' }),
          helpLink('einstellungen'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'ib', title: 'Neu laden und Verbrauch aktualisieren', text: '⟳', onclick: reload }),
          h('button', { class: 'ib', title: 'Schließen', text: '✕', onclick: () => opts.onClose() })),
        body);
    },
    isOpen: () => open,
    toggle(force) {
      open = force === undefined ? !open : !!force;
      root.hidden = !open;
      clearInterval(timer);
      timer = null;
      if (open) {
        error = ''; renaming = null; removing = null; reload();
        timer = setInterval(loadUsage, USAGE_REFRESH_MS);
      }
      return open;
    },
    /* Hinweis von außen, z. B. wenn kein Projekt offen ist */
    setError(msg) { error = msg || ''; render(); },
  };
})();
