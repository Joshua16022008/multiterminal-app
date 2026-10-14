/* Agent status and attention list. Pure logic (labels, time, order) plus small DOM builders.
   "Antwort fertig" only says the agent stopped; it is no acceptance of the work. All text via textContent. */
(function () {
  'use strict';

  const ERROR_LABELS = {
    rate_limit: 'Kontingent erreicht',
    overloaded: 'Dienst überlastet',
    authentication_failed: 'Anmeldung fehlgeschlagen',
    oauth_org_not_allowed: 'Organisation nicht erlaubt',
    account_on_hold: 'Konto gesperrt',
    billing_error: 'Abrechnungsproblem',
    invalid_request: 'Ungültige Anfrage',
    model_not_found: 'Modell nicht gefunden',
    server_error: 'Serverfehler',
    max_output_tokens: 'Ausgabegrenze erreicht',
    cloud_credential_error: 'Cloud-Zugangsdaten fehlen',
    unknown: 'Unbekannter Fehler',
  };
  const PROVIDER_LABELS = { claude: 'Claude', codex: 'Codex' };
  const STATE_COLORS = {
    working: 'var(--accent)', 'needs-input': 'var(--warn)', 'turn-complete': 'var(--ok)', error: 'var(--err)', unknown: 'var(--dim)',
  };
  const SETTINGS_HELP = 'Fügt neu gestarteten Claude-Sitzungen in Multiterminal Status-Hooks hinzu; deine Claude-Einstellungen bleiben unverändert.';
  const CODEX_NOTE = 'Codex: Status noch nicht unterstützt';

  function errorLabel(type) {
    return ERROR_LABELS[type] || ERROR_LABELS.unknown;
  }

  function providerLabel(provider) {
    return PROVIDER_LABELS[provider] || String(provider || 'Agent');
  }

  function stateLabel(entry) {
    if (!entry) return 'Status unbekannt';
    switch (entry.state) {
      case 'working': return 'arbeitet';
      case 'needs-input': return 'wartet auf dich';
      case 'turn-complete': return 'Antwort fertig';
      case 'error': return 'Fehler: ' + errorLabel(entry.errorType);
      default: return entry.source === 'claude-hook:SessionStart' ? 'bereit' : 'Status unbekannt';
    }
  }

  function stateColor(state) {
    return STATE_COLORS[state] || STATE_COLORS.unknown;
  }

  function relativeTime(then, now) {
    if (!Number.isFinite(then)) return '';
    const s = Math.max(0, Math.round(((Number.isFinite(now) ? now : Date.now()) - then) / 1000));
    if (s < 10) return 'gerade eben';
    if (s < 60) return 'vor ' + s + ' s';
    const m = Math.floor(s / 60);
    if (m < 60) return 'vor ' + m + ' Min.';
    const hrs = Math.floor(m / 60);
    if (hrs < 24) return 'vor ' + hrs + ' Std.';
    return 'vor ' + Math.floor(hrs / 24) + ' T.';
  }

  // Unread first, then newest first. Does not change the input.
  function sortEntries(entries) {
    return [...entries].sort((a, b) => (Number(Boolean(b.unread)) - Number(Boolean(a.unread))) || (b.observedAt - a.observedAt));
  }

  // Title text for a status dot; null entry = no agent known for the tile.
  function dotInfo(entry) {
    if (!entry) return null;
    const label = stateLabel(entry);
    return { state: entry.state, color: stateColor(entry.state), unread: Boolean(entry.unread), label, title: providerLabel(entry.provider) + ': ' + label };
  }

  // Dot for the tile header. update(entry|null) shows, changes or hides it.
  function createStatusDot({ h }) {
    const el = h('span', { class: 'attn-dot', hidden: true, role: 'img' });
    function update(entry) {
      const info = dotInfo(entry);
      el.hidden = !info;
      if (!info) { el.removeAttribute('data-state'); el.removeAttribute('title'); return; }
      el.setAttribute('data-state', info.state);
      el.classList.toggle('unread', info.unread);
      el.style.setProperty('--attn-color', info.color);
      el.setAttribute('title', info.title);
      el.setAttribute('aria-label', info.title);
    }
    return { el, update };
  }

  // opts: root, h, getLabel(entry) -> { project, number, name } | null,
  //       onJump(entry), onMarkAllRead(), onSettings(patch), now()
  function createAttentionPanel({ root, h, getLabel, onJump, onMarkAllRead, onSettings, now = Date.now }) {
    let entries = [];
    let settings = { statusEnabled: false, desktopNotification: false, sound: false };

    function tileText(entry) {
      const l = getLabel ? getLabel(entry) : null;
      if (!l) return 'Terminal nicht mehr geöffnet';
      const tile = (l.number ? 'Kachel ' + l.number : 'Kachel') + (l.name ? ' · ' + l.name : '');
      return (l.project ? l.project + ' · ' : '') + tile;
    }

    function toggle(label, key, disabled) {
      const input = h('input', { type: 'checkbox', checked: Boolean(settings[key]), disabled, onchange: (e) => onSettings && onSettings({ [key]: e.target.checked }) });
      return h('label', { class: 'attn-toggle' }, input, h('span', { text: label }));
    }

    function entryRow(entry) {
      const known = Boolean(getLabel && getLabel(entry));
      const info = dotInfo(entry);
      const dot = h('span', { class: 'attn-dot' + (entry.unread ? ' unread' : ''), 'data-state': info.state });
      dot.style.setProperty('--attn-color', info.color);
      return h('button', {
        class: 'attn-entry' + (entry.unread ? ' unread' : ''), type: 'button', disabled: !known,
        'data-terminal-id': entry.terminalId, title: known ? 'Zur Kachel springen' : 'Dieses Terminal ist nicht mehr geöffnet',
        onclick: () => onJump && onJump(entry),
      },
      dot,
      h('span', { class: 'attn-main' },
        h('span', { class: 'attn-where', text: tileText(entry) }),
        h('span', { class: 'attn-what', text: providerLabel(entry.provider) + ' · ' + info.label })),
      h('span', { class: 'attn-time', text: relativeTime(entry.observedAt, now()) }));
    }

    function render() {
      const sorted = sortEntries(entries);
      const unread = sorted.filter((e) => e.unread).length;
      const list = h('div', { class: 'attn-list' });
      if (!sorted.length) {
        list.append(h('p', { class: 'attn-empty', text: settings.statusEnabled
          ? 'Noch keine Agentensitzung gemeldet. Neu gestartete Claude-Sitzungen erscheinen hier.'
          : 'Der Agentenstatus ist ausgeschaltet.' }));
      }
      for (const e of sorted) list.append(entryRow(e));
      root.replaceChildren(
        h('div', { class: 'attn-head' },
          h('strong', { text: 'Agenten' }),
          h('span', { class: 'attn-count', text: unread ? unread + ' ungelesen' : '' }),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn-small', type: 'button', text: 'Alle gelesen', disabled: !unread, onclick: () => onMarkAllRead && onMarkAllRead() })),
        list,
        h('div', { class: 'attn-settings' },
          toggle('Agentenstatus anzeigen (Claude)', 'statusEnabled', false),
          h('p', { class: 'attn-help', text: SETTINGS_HELP }),
          toggle('Desktopmeldung', 'desktopNotification', !settings.statusEnabled),
          toggle('Ton', 'sound', !settings.statusEnabled),
          h('p', { class: 'attn-help', text: CODEX_NOTE })));
    }

    return {
      update(nextEntries, nextSettings) {
        entries = Array.isArray(nextEntries) ? nextEntries : [];
        if (nextSettings) settings = { ...settings, ...nextSettings };
        render();
      },
      render,
    };
  }

  const api = {
    ERROR_LABELS, SETTINGS_HELP, CODEX_NOTE, errorLabel, providerLabel, stateLabel, stateColor,
    relativeTime, sortEntries, dotInfo, createStatusDot, createAttentionPanel,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckAttention = api;
})();
