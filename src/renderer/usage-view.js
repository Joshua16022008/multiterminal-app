'use strict';

// One account row of the usage overview: a bar per quota window.
// Loaded by the browser via <script> and required from Node tests (formatting only).

// Wrapped in a function: classic scripts share one global scope, so top-level names would clash
// with other scripts (layout.js also declares `api`).
(function () {
  const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const DAY_MS = 24 * 60 * 60 * 1000;

  function formatPercent(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '–';
    return `${Math.round(Math.min(100, Math.max(0, value)))} %`;
  }

  // Within a day "in 2 Std. 10 Min.", later "Mo 14:00" (local time).
  function formatReset(resetsAt, now) {
    if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return '';
    const diff = resetsAt - now;
    if (diff <= 0) return 'jetzt';
    if (diff >= DAY_MS) {
      const d = new Date(resetsAt);
      const pad = (n) => String(n).padStart(2, '0');
      return `${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    const minutes = Math.max(1, Math.round(diff / 60000));
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours === 0) return `in ${rest} Min.`;
    return rest === 0 ? `in ${hours} Std.` : `in ${hours} Std. ${rest} Min.`;
  }

  // Bar level for the colour: "ok" up to 70 %, "warn" up to 90 %, then "high".
  function levelOf(percent) {
    if (percent >= 90) return 'high';
    if (percent >= 70) return 'warn';
    return 'ok';
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // result: output of usageService.forAccount; title: account label to show (null when the caller shows it already).
  function buildAccountRow(result, title, now = Date.now()) {
    const row = el('div', result.stale ? 'usage-row usage-stale' : 'usage-row');
    if (title || result.plan) {
      const head = el('div', 'usage-head');
      head.append(el('span', 'usage-title', title || ''));
      if (result.plan) head.append(el('span', 'usage-plan', result.plan));
      row.append(head);
    }
    if (result.windows.length === 0) {
      row.append(el('div', 'usage-note', result.note || ''));
      return row;
    }
    for (const w of result.windows) {
      const line = el('div', 'usage-window');
      line.append(el('span', 'usage-label', w.label));
      const bar = el('div', `usage-bar usage-${levelOf(w.usedPercent)}`);
      const fill = el('div', 'usage-fill');
      fill.style.width = `${Math.min(100, Math.max(0, w.usedPercent))}%`;
      bar.append(fill);
      line.append(bar);
      line.append(el('span', 'usage-percent', formatPercent(w.usedPercent)));
      const reset = formatReset(w.resetsAt, now);
      line.append(el('span', 'usage-reset', reset ? `Reset ${reset}` : ''));
      row.append(line);
    }
    if (result.stale) row.append(el('div', 'usage-note', 'Veralteter Stand'));
    return row;
  }

  const api = { formatPercent, formatReset, levelOf, buildAccountRow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckUsage = api;
})();
