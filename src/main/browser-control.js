'use strict';

// Executes the commands of the browser bridge (mt-browser) for one terminal tile.
// Everything Electron-specific is injected, so the logic is testable without it:
//   callRenderer(terminalId, op, arg)  asks the page about the tile (open/show/hide/...)
//   webContentsFromId(id)              resolves the id reported by the tile's webview
//   isOurWebview(wc)                   true only for webviews hosted by our own window
// Page operations (reload, text, console, screenshot) run on the webview's webContents.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_TEXT_LIMIT = 8000;
const MAX_TEXT_LIMIT = 100000;
const DEFAULT_CONSOLE_LIMIT = 100;
const CONSOLE_BUFFER = 200;
const LOAD_TIMEOUT_MS = 20000;
const NAV_TIMEOUT_MS = 3000;
const PAINT_WAIT_MS = 350;
const CAPTURE_TRIES = 4;
const CAPTURE_TIMEOUT_MS = 3000;
const RENDERER_TIMEOUT_MS = 25000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const NO_BROWSER = 'Kein Mini-Browser offen. Erst `mt-browser open <url>` aufrufen.';

// Electron < 35 passes (event, level, message, line, sourceId); newer versions one details
// object on the event. Levels are numbers (0-3) or names.
const LEVEL_NAMES = ['verbose', 'info', 'warning', 'error'];
function normalizeConsoleEvent(args) {
  const [first, level, message, line, sourceId] = args;
  const d = first && typeof first === 'object' && 'message' in first ? first : { level, message, lineNumber: line, sourceId };
  const lv = typeof d.level === 'number' ? LEVEL_NAMES[d.level] || 'info' : String(d.level || 'info');
  return { level: lv === 'warn' ? 'warning' : lv, message: String(d.message === undefined ? '' : d.message), line: d.lineNumber ?? d.line, source: d.sourceId || d.source || '' };
}

// Ring buffer of console messages per webview webContents id.
function createConsoleStore(max = CONSOLE_BUFFER) {
  const buffers = new Map();
  return {
    add(wcId, args) {
      const entry = normalizeConsoleEvent(args);
      if (entry.message.includes('Electron Security Warning')) return; // dev-mode noise, not from the page
      const list = buffers.get(wcId) || [];
      list.push(entry);
      if (list.length > max) list.splice(0, list.length - max);
      buffers.set(wcId, list);
    },
    get(wcId, limit) {
      const list = buffers.get(wcId) || [];
      return limit ? list.slice(-limit) : list.slice();
    },
    drop(wcId) { buffers.delete(wcId); },
    clear(wcId) { buffers.set(wcId, []); },
  };
}

// Request/response round trip to the page: send() delivers {reqId, terminalId, op, arg}, the page
// answers through resolve(reqId, {ok, result|error}).
function createRendererLink({ send, timeoutMs = RENDERER_TIMEOUT_MS }) {
  let counter = 0;
  const pending = new Map();
  function call(terminalId, op, arg) {
    return new Promise((resolve, reject) => {
      const reqId = ++counter;
      const timer = setTimeout(() => {
        pending.delete(reqId);
        reject(new Error('Keine Antwort aus der Oberfläche (Zeitüberschreitung).'));
      }, timeoutMs);
      pending.set(reqId, { resolve, reject, timer });
      try { send({ reqId, terminalId, op, arg }); } catch (e) { clearTimeout(timer); pending.delete(reqId); reject(e); }
    });
  }
  function respond(reqId, response) {
    const p = pending.get(reqId);
    if (!p) return;
    pending.delete(reqId);
    clearTimeout(p.timer);
    if (response && response.ok) p.resolve(response.result);
    else p.reject(new Error((response && response.error) || 'Unbekannter Fehler.'));
  }
  return { call, respond };
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function isPng(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    return buf.equals(PNG_MAGIC);
  } catch (_) {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// "http://host:1/app/main.js" -> "/app/main.js"; other sources stay as they are.
function shortSource(source) {
  try { const u = new URL(source); return u.pathname + u.search; } catch (_) { return String(source); }
}

function createBrowserControl({ callRenderer, webContentsFromId, isOurWebview, consoleStore, tmpDir, now, sleep, revealWindow }) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const clock = now || (() => new Date());
  const shotDir = path.join(tmpDir || os.tmpdir(), 'multiterminal-screenshots');

  // capturePage right after a navigation or after showing a hidden webview can fail
  // ("UnknownVizError") or never answer: retry a few times with a short timeout each.
  async function capture(wc) {
    let lastError = 'keine Antwort';
    for (let i = 0; i < CAPTURE_TRIES; i++) {
      let timer;
      try {
        const image = await Promise.race([
          wc.capturePage(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('keine Antwort')), CAPTURE_TIMEOUT_MS); }),
        ]);
        if (image && !image.isEmpty()) return image;
        lastError = 'leeres Bild';
      } catch (e) {
        lastError = e.message;
      } finally {
        clearTimeout(timer);
      }
      if (typeof wc.invalidate === 'function') wc.invalidate();
      // A webview of a background window may stop painting: bring the window forward step by step
      // (level 1 without taking the keyboard focus, level 2 with it).
      if (revealWindow && i >= 1) { try { revealWindow(i); } catch (_) { /* best effort */ } }
      await wait(PAINT_WAIT_MS);
    }
    throw new Error('Screenshot fehlgeschlagen (' + lastError + '). Ist das Fenster minimiert oder der Mini-Browser verdeckt?');
  }

  async function pageOf(terminalId) {
    const open = await callRenderer(terminalId, 'isOpen');
    const id = open ? await callRenderer(terminalId, 'webContentsId') : null;
    if (!open || id === null || id === undefined) throw new Error(NO_BROWSER);
    const wc = webContentsFromId(id);
    if (!wc || wc.isDestroyed() || !isOurWebview(wc)) throw new Error('Der Mini-Browser dieses Terminals ist nicht erreichbar.');
    return wc;
  }

  // Resolves when the page finished loading or failed; never rejects, gives up after timeoutMs.
  function settled(wc, timeoutMs, events) {
    return new Promise((resolve) => {
      let timer;
      const done = (r) => {
        clearTimeout(timer);
        for (const [name, fn] of handlers) wc.removeListener(name, fn);
        resolve(r);
      };
      const handlers = [
        ['did-finish-load', () => done({ ok: true })],
        ['did-fail-load', (_e, code, desc, url, isMain) => { if (isMain !== false && code !== -3) done({ ok: false, error: `${desc || code}: ${url}` }); }],
      ];
      if (events) handlers.push(['did-navigate-in-page', () => done({ ok: true })]);
      for (const [name, fn] of handlers) wc.on(name, fn);
      timer = setTimeout(() => done({ ok: true, timeout: true }), timeoutMs);
    });
  }

  async function navigateWith(wc, action, timeoutMs) {
    const done = settled(wc, timeoutMs, true);
    action();
    const r = await done;
    if (!r.ok) throw new Error('Seite konnte nicht geladen werden (' + r.error + ').');
    return wc.getURL();
  }

  const commands = {
    open: (id, args) => callRenderer(id, 'open', args.url).then((r) => {
      if (!r || !r.ok) throw new Error((r && r.error) || 'Seite konnte nicht geöffnet werden.');
      return r.url;
    }),
    async show(id) { await callRenderer(id, 'show'); return null; },
    async hide(id) { await callRenderer(id, 'hide'); return null; },
    async url(id) { return (await pageOf(id)).getURL(); },
    async reload(id) { const wc = await pageOf(id); return navigateWith(wc, () => wc.reload(), LOAD_TIMEOUT_MS); },
    async back(id) {
      const wc = await pageOf(id);
      if (!wc.navigationHistory.canGoBack()) throw new Error('Kein früherer Eintrag im Verlauf.');
      return navigateWith(wc, () => wc.navigationHistory.goBack(), NAV_TIMEOUT_MS);
    },
    async forward(id) {
      const wc = await pageOf(id);
      if (!wc.navigationHistory.canGoForward()) throw new Error('Kein späterer Eintrag im Verlauf.');
      return navigateWith(wc, () => wc.navigationHistory.goForward(), NAV_TIMEOUT_MS);
    },
    async text(id, args) {
      const wc = await pageOf(id);
      const limit = Math.min(args.limit || DEFAULT_TEXT_LIMIT, MAX_TEXT_LIMIT);
      const body = String(await wc.executeJavaScript('document.body ? document.body.innerText : ""') || '');
      const head = `${wc.getTitle() || '(ohne Titel)'} | ${wc.getURL()}`;
      const cut = body.length > limit;
      return head + '\n\n' + body.slice(0, limit) + (cut ? `\n[gekürzt auf ${limit} Zeichen]` : '');
    },
    async console(id, args) {
      const wc = await pageOf(id);
      return consoleStore.get(wc.id, args.limit || DEFAULT_CONSOLE_LIMIT).map((e) => ({
        level: e.level,
        message: e.source ? `${e.message} (${shortSource(e.source)}:${e.line ?? '?'})` : e.message,
      }));
    },
    async screenshot(id, args) {
      // A hidden browser paints nothing: show it first (this also leaves "terminal only" mode).
      await callRenderer(id, 'show');
      await wait(PAINT_WAIT_MS);
      const wc = await pageOf(id);
      if (!(await callRenderer(id, 'visible'))) throw new Error('Der Mini-Browser ist gerade nicht sichtbar (anderes Projekt aktiv?).');
      const image = await capture(wc);
      let file;
      if (args.out) {
        file = path.resolve(args.out);
        if (!/\.png$/i.test(file)) throw new Error('Der Screenshot muss auf .png enden.');
        if (!fs.existsSync(path.dirname(file))) throw new Error('Zielordner existiert nicht: ' + path.dirname(file));
        if (fs.existsSync(file) && !isPng(file)) throw new Error('Datei existiert und ist kein PNG, wird nicht überschrieben: ' + file);
      } else {
        fs.mkdirSync(shotDir, { recursive: true, mode: 0o700 });
        file = path.join(shotDir, `terminal-${String(id).slice(0, 8)}-${stamp(clock())}.png`);
      }
      fs.writeFileSync(file, image.toPNG());
      return { path: file };
    },
  };

  // Handler for the bridge: (terminalId, cmd, args) -> result
  return async function handler(terminalId, cmd, args) {
    const run = commands[cmd];
    if (!run) throw new Error('Unbekannter Befehl.');
    return run(terminalId, args || {});
  };
}

module.exports = { createBrowserControl, createConsoleStore, createRendererLink, normalizeConsoleEvent, NO_BROWSER };
