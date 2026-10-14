'use strict';

// Pure logic for the mini browser of a tile: finding local addresses in
// terminal output, deciding when to open them automatically, and the view modes.
// Loaded by the browser via <script> and required from Node tests.
// Wrapped in a function so no global names clash with the other scripts.
(function () {
  const MODES = ['split', 'terminal', 'browser'];
  const MAX_TAIL = 2000;

  const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
  const LOCAL = /(https?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?![\w-]|\.\w)(:\d{1,5})?([/?#][^\s<>"'`]*)?/gi;

  function stripAnsi(text) {
    return String(text).replace(ANSI, '');
  }

  // Cuts trailing sentence punctuation and unbalanced closing brackets.
  function trimRest(rest) {
    let s = rest || '';
    for (;;) {
      const last = s.slice(-1);
      if (!last) break;
      if (/[.,;:!?'"]/.test(last)) { s = s.slice(0, -1); continue; }
      const open = { ')': '(', ']': '[', '}': '{' }[last];
      if (open && s.split(last).length > s.split(open).length) { s = s.slice(0, -1); continue; }
      break;
    }
    return s;
  }

  // Local addresses in a piece of terminal output, in order, without duplicates.
  // Hosts 127.0.0.1, 0.0.0.0 and [::1] come back as localhost.
  function findLocalUrls(text) {
    const found = [];
    const clean = stripAnsi(text);
    let m;
    LOCAL.lastIndex = 0;
    while ((m = LOCAL.exec(clean))) {
      const url = m[1].toLowerCase() + '://localhost' + (m[2] || '') + trimRest(m[3]);
      if (!found.includes(url)) found.push(url);
    }
    return found;
  }

  const keyOf = (url) => url.replace(/\/$/, '');

  // One per tile. feed(chunk) returns the address to open now, or null.
  function createAutoOpen() {
    const seen = new Set();
    let tail = '';
    let closed = false;
    let current = null;

    function scan(text) {
      const fresh = findLocalUrls(text).filter((u) => !seen.has(keyOf(u)));
      fresh.forEach((u) => seen.add(keyOf(u)));
      if (!fresh.length) return null;
      closed = false; // a new address ends the user's "closed" decision
      if (current && keyOf(current) === keyOf(fresh[0])) return null;
      return fresh[0];
    }

    return {
      // Only complete lines are scanned; the unfinished last line waits for more output.
      feed(chunk) {
        const text = tail + stripAnsi(chunk);
        const cut = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'));
        tail = (cut < 0 ? text : text.slice(cut + 1)).slice(-MAX_TAIL);
        if (cut < 0) return null;
        return scan(text.slice(0, cut + 1));
      },
      // Scans the unfinished line, e.g. when the process ends.
      flush() {
        const text = tail;
        tail = '';
        return text ? scan(text) : null;
      },
      // The address the tile shows now (restored or typed by hand): never auto-opened again.
      setCurrent(url) {
        current = url || null;
        if (url) seen.add(keyOf(url));
      },
      // The user closed the browser on purpose.
      userClosed() { closed = true; },
      isClosed() { return closed; },
    };
  }

  function normalizeMode(mode) {
    return MODES.includes(mode) ? mode : 'split';
  }

  function nextMode(current) {
    return MODES[(MODES.indexOf(normalizeMode(current)) + 1) % MODES.length];
  }

  // What to show for a mode; without an open browser the terminal fills the tile.
  function viewFor(mode, browserOpen) {
    const m = normalizeMode(mode);
    if (!browserOpen) return { mode: m, showTerminal: true, showBrowser: false, classes: [] };
    if (m === 'terminal') return { mode: m, showTerminal: true, showBrowser: false, classes: ['mode-terminal'] };
    if (m === 'browser') return { mode: m, showTerminal: false, showBrowser: true, classes: ['with-browser', 'mode-browser'] };
    return { mode: m, showTerminal: true, showBrowser: true, classes: ['with-browser'] };
  }

  const api = { MODES, normalizeMode, stripAnsi, findLocalUrls, createAutoOpen, nextMode, viewFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckBrowserView = api;
})();
