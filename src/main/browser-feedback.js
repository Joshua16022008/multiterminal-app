'use strict';

// F05: Element im Mini-Browser einer Kachel markieren (Auswahlmodus) und die zwei begrenzten
// UI-Aktionen `click` / `type` der Browser-CLI.
//
// Alles, was in die Seite injiziert wird, sind feste Funktionen (kein zusammengesetzter Code):
// Argumente reichen nur als JSON-Literal hinein. Die Seite erhält keine Rechte; ihre Antwort
// wird im Hauptprozess erneut bereinigt und gekürzt, bevor sie weitergegeben wird.
// Electron-spezifisches (Seite, Bildablage) wird injiziert, damit alles ohne Electron testbar ist.

const LIMITS = Object.freeze({
  selector: 300, tag: 40, id: 100, className: 40, classes: 8, text: 200, html: 1000, title: 100, url: 300,
});
const MAX_SELECTOR_LENGTH = 500; // CLI: click/type
const MAX_TYPE_TEXT = 10000;
const CAPTURE_TIMEOUT_MS = 3000;
const PICK_TIMEOUT_MS = 10 * 60 * 1000;

function truncate(value, max) {
  const s = value === undefined || value === null ? '' : String(value);
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100000, Math.round(n))) : 0;
}

// Selektor aus der CLI: Text, nicht leer, begrenzt, keine Steuerzeichen.
function validateSelector(selector) {
  if (typeof selector !== 'string' || !selector.trim()) throw new Error('Ein Selektor fehlt.');
  if (selector.length > MAX_SELECTOR_LENGTH) throw new Error(`Der Selektor ist zu lang (höchstens ${MAX_SELECTOR_LENGTH} Zeichen).`);
  if (/[\u0000-\u001f\u007f]/.test(selector)) throw new Error('Der Selektor enthält Steuerzeichen.');
  return selector;
}

function validateTypeText(text) {
  if (typeof text !== 'string') throw new Error('Der Text fehlt.');
  if (text.length > MAX_TYPE_TEXT) throw new Error(`Der Text ist zu lang (höchstens ${MAX_TYPE_TEXT} Zeichen).`);
  return text;
}

// Alles, was die Seite über das gewählte Element meldet, gilt als unzuverlässig.
function sanitizeElement(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const rect = r.rect && typeof r.rect === 'object' ? r.rect : {};
  const classes = Array.isArray(r.classes) ? r.classes.slice(0, LIMITS.classes).map((c) => truncate(c, LIMITS.className)).filter(Boolean) : [];
  return {
    url: truncate(r.url, LIMITS.url),
    title: truncate(r.title, LIMITS.title),
    selector: truncate(r.selector, LIMITS.selector),
    tag: truncate(String(r.tag || '').toLowerCase(), LIMITS.tag),
    id: truncate(r.id, LIMITS.id),
    classes,
    text: truncate(r.text, LIMITS.text),
    html: truncate(r.html, LIMITS.html),
    rect: { x: num(rect.x), y: num(rect.y), width: num(rect.width), height: num(rect.height) },
  };
}

// JSON, das sicher in Quelltext passt (auch U+2028/2029 und `</script>`-artige Folgen).
function safeJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/* ---------- Seiten-Code (läuft im Gastinhalt; darf nichts aus diesem Modul verwenden) ---------- */

function pickInPage(limits) {
  if (window.__mtPickCancel) { try { window.__mtPickCancel(); } catch (_) { /* old pick already gone */ } }
  const CSSesc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'));
  const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const overlay = document.createElement('div');
  overlay.setAttribute('data-mt-pick', '1');
  overlay.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;outline:2px solid #4da3ff;background:rgba(77,163,255,.18);display:none;left:0;top:0;width:0;height:0;box-sizing:border-box';
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#16324f;color:#fff;font:11px/1.3 monospace;padding:2px 6px;border-radius:3px;max-width:60vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;display:none';
  (document.documentElement || document.body).append(overlay, label);

  function selectorFor(el) {
    const unique = (sel) => { try { const f = document.querySelectorAll(sel); return f.length === 1 && f[0] === el; } catch (_) { return false; } };
    if (el.id && unique('#' + CSSesc(el.id))) return '#' + CSSesc(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) { part += '#' + CSSesc(cur.id); parts.unshift(part); if (unique(parts.join(' > '))) break; continue; }
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.prototype.filter.call(parent.children, (c) => c.tagName === cur.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function describe(el) {
    const r = el.getBoundingClientRect();
    const text = (el.innerText || el.value || el.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      url: location.href, title: document.title, selector: selectorFor(el), tag: el.tagName, id: el.id || '',
      classes: Array.prototype.slice.call(el.classList || [], 0, limits.classes).map(String),
      text: clip(text, limits.text), html: clip(el.outerHTML, limits.html),
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    };
  }

  return new Promise((resolve) => {
    let current = null;
    let finished = false;
    const swallow = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    function move(e) {
      const el = e.target;
      if (!el || el.nodeType !== 1 || el === overlay || el === label) return;
      current = el;
      const r = el.getBoundingClientRect();
      overlay.style.cssText += ';display:block;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
      label.textContent = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
      label.style.display = 'block';
      label.style.left = Math.max(0, r.left) + 'px';
      label.style.top = Math.max(0, r.top - 20) + 'px';
    }
    function finish(value) {
      if (finished) return;
      finished = true;
      for (const [name, fn] of listeners) window.removeEventListener(name, fn, true);
      overlay.remove(); label.remove();
      delete window.__mtPickCancel;
      // Zwei Frames warten, damit der Rahmen beim Screenshot sicher verschwunden ist.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(value)));
    }
    function click(e) {
      swallow(e);
      const el = e.target && e.target.nodeType === 1 ? e.target : current;
      if (!el) return;
      let data;
      try { data = describe(el); } catch (err) { finish({ cancelled: true, error: String(err && err.message) }); return; }
      finish({ element: data });
    }
    function key(e) { if (e.key === 'Escape') { swallow(e); finish({ cancelled: true }); } }
    const listeners = [
      ['mousemove', move], ['mouseover', move], ['click', click], ['keydown', key],
      ['mousedown', swallow], ['mouseup', swallow], ['pointerdown', swallow], ['pointerup', swallow], ['auxclick', swallow], ['contextmenu', swallow],
    ];
    for (const [name, fn] of listeners) window.addEventListener(name, fn, true);
    window.__mtPickCancel = () => finish({ cancelled: true });
  });
}

// kind: 'click' | 'type'. Liefert { ok: true, tag, text } oder { ok: false, error }.
function actionInPage(kind, selector, text) {
  const g = globalThis;
  const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  let el;
  try { el = document.querySelector(selector); } catch (_) { return { ok: false, error: 'Ungültiger Selektor.' }; }
  if (!el) return { ok: false, error: 'Kein Element für diesen Selektor gefunden.' };
  const style = g.getComputedStyle ? g.getComputedStyle(el) : {};
  const box = el.getBoundingClientRect();
  if (style.display === 'none' || style.visibility === 'hidden' || !(box.width > 0 && box.height > 0)) {
    return { ok: false, error: 'Das Element ist nicht sichtbar.' };
  }
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { ok: false, error: 'Das Element ist deaktiviert.' };
  const tag = el.tagName.toLowerCase();
  if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
  if (kind === 'click') {
    el.click();
    return { ok: true, tag, text: clip(el.innerText || el.value || '', 60) };
  }
  const TYPES = ['text', 'search', 'email', 'url', 'tel', 'number', 'password'];
  const isArea = tag === 'textarea';
  const isInput = tag === 'input' && TYPES.includes(String(el.type || 'text').toLowerCase());
  const editable = el.isContentEditable === true;
  if (!isArea && !isInput && !editable) return { ok: false, error: 'Das Element ist kein Texteingabefeld.' };
  if (el.readOnly) return { ok: false, error: 'Das Eingabefeld ist schreibgeschützt.' };
  if (el.focus) el.focus();
  if (editable && !isArea && !isInput) {
    el.textContent = text;
  } else {
    const proto = isArea ? g.HTMLTextAreaElement.prototype : g.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, text); // am Framework-Wrapper vorbei, damit React & Co. die Änderung sehen
  }
  el.dispatchEvent(new g.Event('input', { bubbles: true }));
  el.dispatchEvent(new g.Event('change', { bubbles: true }));
  return { ok: true, tag, text: String(text.length) + ' Zeichen' };
}

function buildPickScript() {
  return `(${pickInPage.toString()})(${safeJson(LIMITS)})`;
}

function buildActionScript(kind, selector, text) {
  if (kind !== 'click' && kind !== 'type') throw new Error('Unbekannte Aktion.');
  validateSelector(selector);
  const typed = kind === 'type' ? validateTypeText(text) : '';
  return `(${actionInPage.toString()})(${safeJson(kind)},${safeJson(selector)},${safeJson(typed)})`;
}

const CANCEL_SCRIPT = '(function(){ if (window.__mtPickCancel) { window.__mtPickCancel(); return true; } return false; })()';

/* ---------- Hauptprozess ---------- */

// pageOf(terminalId) -> webContents der eigenen Kachel (oder Fehler); saveImage(buffer) -> { path }.
function createBrowserFeedback({ pageOf, saveImage, captureTimeoutMs = CAPTURE_TIMEOUT_MS, pickTimeoutMs = PICK_TIMEOUT_MS }) {
  const active = new Map(); // terminalId -> { wc, done }

  async function screenshotOf(wc, rect) {
    if (!rect.width || !rect.height) return { error: 'Element ohne Fläche.' };
    let timer;
    try {
      const image = await Promise.race([
        wc.capturePage({ x: rect.x, y: rect.y, width: Math.max(1, rect.width), height: Math.max(1, rect.height) }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('keine Antwort')), captureTimeoutMs); }),
      ]);
      if (!image || image.isEmpty()) return { error: 'leeres Bild' };
      return { path: saveImage(image.toPNG()).path };
    } catch (e) {
      return { error: e.message };
    } finally {
      clearTimeout(timer);
    }
  }

  // Eine neue Auswahl in derselben Kachel beendet zuerst eine noch laufende (z. B. gerade abgebrochene).
  async function pick(terminalId) {
    const id = String(terminalId);
    const previous = active.get(id);
    if (previous) {
      await cancel(id);
      await previous.done.catch(() => {});
      if (active.has(id)) throw new Error('In diesem Mini-Browser läuft bereits eine Elementauswahl.');
    }
    const wc = await pageOf(id);
    if (active.has(id)) throw new Error('In diesem Mini-Browser läuft bereits eine Elementauswahl.');
    const entry = { wc, done: null };
    entry.done = runPick(id, wc);
    active.set(id, entry);
    return entry.done;
  }

  async function runPick(id, wc) {
    let onNav;
    let timer;
    const interrupted = new Promise((resolve) => {
      onNav = (...a) => {
        const d = a[0] && typeof a[0] === 'object' && 'isMainFrame' in a[0] ? a[0] : { isSameDocument: a[2], isMainFrame: a[3] };
        if (d.isMainFrame && !d.isSameDocument) resolve({ navigated: true });
      };
      wc.on('did-start-navigation', onNav);
      timer = setTimeout(() => resolve({ cancelled: true, timeout: true }), pickTimeoutMs);
    });
    try {
      const result = await Promise.race([
        Promise.resolve(wc.executeJavaScript(buildPickScript())).catch(() => ({ cancelled: true })),
        interrupted,
      ]);
      if (!result || result.navigated) return { ok: false, navigated: true };
      if (result.cancelled || !result.element) {
        if (result.timeout) { try { await wc.executeJavaScript(CANCEL_SCRIPT); } catch (_) { /* page gone */ } }
        return { ok: false, cancelled: true };
      }
      const element = sanitizeElement(result.element);
      const shot = await screenshotOf(wc, element.rect);
      return { ok: true, element, screenshot: shot.path ? { path: shot.path } : null, screenshotError: shot.error || null };
    } finally {
      clearTimeout(timer);
      if (onNav && !wc.isDestroyed()) wc.removeListener('did-start-navigation', onNav);
      active.delete(id);
    }
  }

  async function cancel(terminalId) {
    const entry = active.get(String(terminalId));
    const wc = entry && entry.wc;
    if (!wc || wc.isDestroyed()) return false;
    try { await wc.executeJavaScript(CANCEL_SCRIPT); } catch (_) { /* page gone */ }
    return true;
  }

  return { pick, cancel, isPicking: (terminalId) => active.has(String(terminalId)) };
}

module.exports = {
  LIMITS, MAX_SELECTOR_LENGTH, MAX_TYPE_TEXT,
  truncate, validateSelector, validateTypeText, sanitizeElement, safeJson,
  buildPickScript, buildActionScript, createBrowserFeedback,
  // nur für Tests
  pickInPage, actionInPage,
};
