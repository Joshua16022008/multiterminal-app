'use strict';

// F05: "Element kommentieren" in der Browserleiste einer Kachel.
// Ablauf: Knopf -> Auswahlmodus in der Seite -> Klick -> kleines Kommentarfeld ->
// "In Promptvorschau" (D.promptDraft.open, schreibt erst nach Nutzerklick ohne Enter).
// Reine Hilfsfunktionen sind ohne DOM testbar; die Oberfläche braucht ein document.
(function () {
  const MAX_COMMENT = 4000;

  // Gleiche Seite = gleiche Adresse ohne #Fragment.
  function samePage(a, b) {
    const strip = (u) => String(u || '').replace(/#.*$/, '');
    return !!a && !!b && strip(a) === strip(b);
  }

  // Text für die Promptvorschau. Kurz und mit dem Kontext, den ein Agent zum Finden des Elements braucht.
  function buildFeedbackText({ element, comment }) {
    const e = element || {};
    const quote = (s) => String(s || '').replace(/[„“”"]/g, "'");
    const label = e.text ? ` („${quote(e.text)}“)` : '';
    const lines = [`Im Browser (${e.url || '?'}) Element ${e.selector || e.tag || '?'}${label}:`];
    if (e.html) lines.push(e.html);
    lines.push('', 'Kommentar: ' + String(comment || '').trim());
    return lines.join('\n');
  }

  function cleanError(e) {
    return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }

  function createBrowserFeedback({ document, api, getPromptDraft, notify = () => {} }) {
    const h = (tag, attrs, ...kids) => {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
      for (const kid of kids) if (kid) el.append(kid);
      return el;
    };

    // terminalId: eigene Kachel; getUrl(): aktuelle Adresse der Seite; host: Element, an dem das Feld hängt.
    function attach({ terminalId, getUrl, host: initialHost }) {
      let host = initialHost;
      let state = 'idle'; // idle | picking | commenting
      let chosen = null;
      let panel = null;
      const button = h('button', { class: 'ib bf-btn', title: 'Element im Browser markieren und kommentieren', text: '⌖', onclick: () => (state === 'picking' ? cancel() : start()) });

      function setState(next) {
        state = next;
        button.classList.toggle('on', next === 'picking');
        button.title = next === 'picking' ? 'Auswahl abbrechen (Esc)' : 'Element im Browser markieren und kommentieren';
      }
      function closePanel() {
        if (panel) { panel.remove(); panel = null; }
        chosen = null;
        if (state === 'commenting') setState('idle');
      }
      function onKey(e) { if (e.key === 'Escape' && state === 'picking') cancel(); }
      document.addEventListener('keydown', onKey, true);

      async function start() {
        if (state === 'picking') return;
        closePanel();
        setState('picking');
        notify('Element im Browser anklicken (Esc bricht ab).', 'info', 3500);
        const mine = {}; // identifiziert diesen Durchlauf, falls inzwischen abgebrochen und neu gestartet wurde
        start.current = mine;
        let r;
        try {
          r = await api.pick(terminalId);
        } catch (e) {
          if (start.current === mine) setState('idle');
          notify(cleanError(e), 'error');
          return;
        }
        if (start.current !== mine || state !== 'picking') return; // abgebrochen
        if (!r || !r.ok) {
          setState('idle');
          if (r && r.navigated) notify('Seite hat sich geändert – Auswahl verworfen.', 'error');
          else notify('Auswahl abgebrochen.', 'info');
          return;
        }
        chosen = r;
        setState('commenting');
        showPanel();
      }

      function cancel() {
        if (state === 'picking') {
          start.current = null;
          setState('idle');
          Promise.resolve(api.pickCancel(terminalId)).catch(() => {});
        } else {
          closePanel();
        }
      }

      function showPanel() {
        const e = chosen.element;
        const area = h('textarea', { class: 'bf-comment', rows: '3', maxlength: String(MAX_COMMENT), placeholder: 'Kommentar zum Element, z. B. „Der Abstand fehlt“' });
        const warn = h('div', { class: 'bf-warn', hidden: '' });
        const send = h('button', { class: 'btn-small bf-send', text: 'In Promptvorschau', onclick: () => submit(area, warn) });
        const drop = h('button', { class: 'btn-small bf-drop', text: 'Verwerfen', onclick: () => closePanel() });
        const info = h('div', { class: 'bf-info', text: `${e.selector || e.tag}${e.text ? ' – „' + e.text.slice(0, 60) + '“' : ''}` });
        panel = h('div', { class: 'bf-panel', role: 'dialog', 'aria-label': 'Element kommentieren' }, info,
          chosen.screenshot ? null : h('div', { class: 'bf-note', text: 'Ohne Bildausschnitt (Screenshot nicht möglich).' }),
          area, warn, h('div', { class: 'bf-actions' }, send, drop));
        panel.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); closePanel(); } });
        host.append(panel);
        area.focus();
      }

      function submit(area, warn) {
        const comment = area.value.trim();
        if (!comment) { warn.hidden = false; warn.textContent = 'Bitte einen Kommentar eingeben.'; return; }
        if (!samePage(chosen.element.url, getUrl())) {
          closePanel();
          notify('Seite hat sich geändert – Auswahl verworfen.', 'error');
          return;
        }
        const draft = getPromptDraft();
        if (!draft) { warn.hidden = false; warn.textContent = 'Die Promptvorschau ist nicht verfügbar.'; return; }
        try {
          draft.open({
            terminalId,
            text: buildFeedbackText({ element: chosen.element, comment }),
            files: chosen.screenshot ? [{ path: chosen.screenshot.path, kind: 'image' }] : [],
          });
        } catch (err) {
          warn.hidden = false; warn.textContent = cleanError(err);
          return;
        }
        closePanel();
      }

      return {
        button,
        cancel,
        dispose() { document.removeEventListener('keydown', onKey, true); cancel(); },
        state: () => state,
        // Für Tests und die Kachel: Auswahl starten.
        start,
        setHost(el) { host = el; },
      };
    }

    return { attach };
  }

  const exported = { MAX_COMMENT, samePage, buildFeedbackText, createBrowserFeedback };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (typeof window !== 'undefined') window.DeckBrowserFeedback = exported;
})();
