'use strict';

/* Hilfe-Panel: zeigt docs/guide/*.md als Seitenpanel mit Inhaltsverzeichnis, Suche, Anker-Sprung und Zurück.
   Die reinen Teile (buildSearchEntries, resolveKey, resolveLink, parseKey) sind ohne DOM testbar.
   Der Integrator hängt panel.el (aside#help-panel, anfangs hidden) in die Seite und verdrahtet onToggle. */
(function () {
  const LAST_KEY = 'mt.help.last';
  const MAX_RESULTS = 30;

  /* 'worktrees#anlegen' -> { slug, anchor } | null */
  function parseKey(key) {
    const m = /^([a-z0-9-]+)(?:#(.+))?$/.exec(String(key == null ? '' : key).trim());
    return m ? { slug: m[1], anchor: m[2] || null } : null;
  }

  /* Schlüssel gegen den Index prüfen. Unbekannte Seite -> null; unbekannter Anker wird zu null. */
  function resolveKey(key, index) {
    const parsed = parseKey(key);
    if (!parsed) return null;
    if (!index || !Array.isArray(index.pages)) return parsed;
    const page = index.pages.find((p) => p.slug === parsed.slug);
    if (!page) return null;
    const anchor = parsed.anchor && page.headings.some((x) => x.anchor === parsed.anchor) ? parsed.anchor : null;
    return { slug: page.slug, anchor };
  }

  /* Link-Beschreibung aus DeckGuideMarkdown ({ external, href, slug, anchor }) -> Ziel. */
  function resolveLink(link, currentSlug) {
    if (!link) return null;
    if (link.external) return { external: true, href: link.href };
    return { external: false, slug: link.slug || currentSlug || null, anchor: link.anchor || null };
  }

  /* Suchtreffer: ganze Seiten (Titel + Stichwörter + Überschriften) und einzelne Überschriften. */
  function buildSearchEntries(index) {
    const entries = [];
    for (const page of (index && index.pages) || []) {
      entries.push({
        id: 'page:' + page.slug, kind: 'page', title: page.title, subtitle: 'Seite',
        keywords: [page.keywords, ...page.headings.map((x) => x.text)].filter(Boolean).join(' '),
        slug: page.slug, anchor: null,
      });
    }
    for (const page of (index && index.pages) || []) {
      for (const head of page.headings) {
        if (head.level < 2) continue; // Ebene 1 ist der Seitentitel
        entries.push({ id: 'h:' + page.slug + '#' + head.anchor, kind: 'heading', title: head.text, subtitle: page.title, keywords: '', slug: page.slug, anchor: head.anchor });
      }
    }
    return entries;
  }

  function fallbackRank(entries, query) {
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const tokens = norm(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return entries;
    return entries.filter((e) => { const hay = norm([e.title, e.subtitle, e.keywords].join(' ')); return tokens.every((t) => hay.includes(t)); });
  }

  /* deps: document, api { index(), read(slug) }, h, palette { rank }, markdown (optional), storage,
     onToggle(open), onExternal(href), hooks { name: (el) => void }, restoreFocus() */
  function create({ document, api, h, palette, markdown, storage, onToggle, onExternal, hooks, restoreFocus }) {
    const md = markdown || (typeof window !== 'undefined' && window.DeckGuideMarkdown) || (typeof require === 'function' ? require('./guide-markdown') : null);
    const store = storage !== undefined ? storage : (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; } })();
    let index = null, isOpen = false, opener = null, token = 0;
    let current = null; // { slug, title }
    const history = [];
    let headingEls = new Map();
    let query = '';

    const backBtn = h('button', { class: 'ib', type: 'button', text: '←', title: 'Zurück', 'aria-label': 'Zurück', disabled: true, onclick: () => back() });
    const closeBtn = h('button', { class: 'ib', type: 'button', text: '✕', title: 'Hilfe schließen', 'aria-label': 'Hilfe schließen', onclick: () => close() });
    const search = h('input', {
      class: 'help-search', type: 'search', placeholder: 'Hilfe durchsuchen …', 'aria-label': 'Hilfe durchsuchen',
      oninput: (e) => { query = e.target.value; renderNav(); },
      onkeydown: (e) => {
        if (e.key !== 'Enter') return;
        const first = results()[0];
        if (first) { e.preventDefault(); go(first.slug, first.anchor); }
      },
    });
    const nav = h('nav', { class: 'help-nav', 'aria-label': 'Inhaltsverzeichnis' });
    const content = h('div', { class: 'help-content', tabindex: -1 });
    const el = h('aside', {
      id: 'help-panel', class: 'help-panel', hidden: true, 'aria-label': 'Hilfe',
      onkeydown: (e) => { if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); close(); } },
    },
    h('div', { class: 'help-head' }, backBtn, h('strong', { text: 'Hilfe' }), h('span', { class: 'spacer' }), closeBtn),
    search,
    h('div', { class: 'help-main' }, nav, content));

    const remember = (slug) => { try { if (store) store.setItem(LAST_KEY, slug); } catch (_) { /* nur diese Sitzung */ } };
    const recall = () => { try { return store ? store.getItem(LAST_KEY) : null; } catch (_) { return null; } };
    const message = (e) => (e && e.message ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

    function results() {
      const entries = buildSearchEntries(index);
      return palette && palette.rank ? palette.rank(entries, query, MAX_RESULTS) : fallbackRank(entries, query).slice(0, MAX_RESULTS);
    }

    function renderNav() {
      if (!index) { nav.replaceChildren(); return; }
      if (query.trim()) {
        const found = results();
        nav.replaceChildren(...(found.length
          ? found.map((r) => h('button', { class: 'help-hit', type: 'button', 'data-help-hit': r.id, onclick: () => go(r.slug, r.anchor) },
            h('span', { class: 'help-hit-title', text: r.title }), h('small', { text: r.subtitle })))
          : [h('p', { class: 'help-empty', text: 'Nichts gefunden.' })]));
        return;
      }
      const items = [];
      for (const page of index.pages) {
        const active = current && current.slug === page.slug;
        items.push(h('button', { class: 'help-page' + (active ? ' active' : ''), type: 'button', 'data-help-page': page.slug, 'aria-current': active ? 'page' : null, text: page.title, onclick: () => go(page.slug, null) }));
        if (active) {
          for (const head of page.headings) {
            if (head.level < 2 || head.level > 3) continue;
            items.push(h('button', { class: 'help-head-link level-' + head.level, type: 'button', 'data-help-anchor': head.anchor, text: head.text, onclick: () => go(page.slug, head.anchor) }));
          }
        }
      }
      nav.replaceChildren(...items);
    }

    function jump(anchor) {
      const target = anchor ? headingEls.get(anchor) : null;
      if (!target) { if (anchor === null) content.scrollTop = 0; return false; }
      if (target.scrollIntoView) target.scrollIntoView({ block: 'start' });
      if (target.classList) {
        target.classList.add('guide-target');
        if (typeof setTimeout === 'function') setTimeout(() => target.classList.remove('guide-target'), 1600);
      }
      return true;
    }

    function updateBack() { backBtn.disabled = history.length === 0; }

    function onLink(link) {
      const target = resolveLink(link, current && current.slug);
      if (!target) return;
      if (target.external) { openExternal(target.href); return; }
      go(target.slug, target.anchor);
    }

    function openExternal(href) {
      if (onExternal) { onExternal(href); return; }
      const view = document && document.defaultView;
      if (view && view.open) view.open(href, '_blank', 'noopener');
    }

    async function show(slug, anchor) {
      const my = ++token;
      let page;
      try { page = await api.read(slug); } catch (e) {
        if (my !== token) return false;
        current = null; // content no longer shows a page: the next go() must re-render
        renderNav();
        content.replaceChildren(h('p', { class: 'help-error', role: 'alert', text: 'Seite konnte nicht geladen werden: ' + message(e) }));
        return false;
      }
      if (my !== token) return false;
      if (!page) {
        current = null;
        renderNav();
        content.replaceChildren(h('p', { class: 'help-error', role: 'alert', text: 'Diese Hilfeseite gibt es nicht.' }));
        return false;
      }
      headingEls = new Map();
      const frag = md.render(page.markdown, {
        h, document, onLink,
        onHeading: (a, node) => headingEls.set(a, node),
        onHook: (name, node) => { if (hooks && Object.prototype.hasOwnProperty.call(hooks, name) && typeof hooks[name] === 'function') hooks[name](node); },
      });
      content.replaceChildren(frag);
      current = { slug: page.slug, title: page.title };
      remember(page.slug);
      renderNav();
      if (!jump(anchor || null)) content.scrollTop = 0;
      return true;
    }

    /* Navigation innerhalb des Panels; merkt sich die vorherige Stelle für „Zurück“. */
    async function go(slug, anchor) {
      if (!slug) return;
      const before = current ? { slug: current.slug, anchor: null } : null;
      if (current && current.slug === slug) {
        if (anchor) { history.push(before); updateBack(); jump(anchor); }
        else { content.scrollTop = 0; }
        return;
      }
      const ok = await show(slug, anchor);
      if (ok && before) { history.push(before); updateBack(); }
    }

    async function back() {
      const prev = history.pop();
      updateBack();
      if (prev) await show(prev.slug, prev.anchor);
    }

    async function open(slug, anchor) {
      if (!isOpen) {
        opener = document && document.activeElement ? document.activeElement : null;
        isOpen = true;
        el.hidden = false;
        if (onToggle) onToggle(true);
      }
      /* The index is reloaded on every open (cheap; the service caches by mtime), so pages added
         in dev mode show up without a reload. A failed refresh keeps the previous index. */
      {
        let fresh = null, failure = null;
        try { fresh = await api.index(); } catch (e) { failure = e; }
        if (fresh && Array.isArray(fresh.pages)) index = fresh;
        else if (!index) {
          if (!failure) { index = { pages: [] }; } else {
          content.replaceChildren(h('p', { class: 'help-error', role: 'alert', text: 'Hilfe konnte nicht geladen werden: ' + message(failure) }));
          return;
          }
        }
      }
      if (!isOpen) return; // währenddessen geschlossen
      const has = (s) => index.pages.some((p) => p.slug === s);
      const last = recall();
      const target = slug && has(slug) ? slug : (last && has(last) ? last : (index.pages[0] && index.pages[0].slug));
      if (!target) {
        nav.replaceChildren();
        content.replaceChildren(h('p', { class: 'help-empty', text: 'Keine Hilfeseiten gefunden.' }));
      } else {
        const keepAnchor = slug && has(slug) ? anchor : null;
        if (current) await go(target, keepAnchor || null); else await show(target, keepAnchor || null);
        if (!current) renderNav();
      }
      renderNav();
      if (search.focus) search.focus();
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      token++;
      el.hidden = true;
      if (onToggle) onToggle(false);
      if (restoreFocus) restoreFocus();
      else if (opener && opener.focus) opener.focus();
      opener = null;
    }

    function link(key) {
      return h('button', {
        class: 'help-link', type: 'button', text: '?', title: 'Hilfe zu diesem Thema', 'aria-label': 'Hilfe zu diesem Thema', 'data-help': key,
        onclick: (e) => {
          if (e && e.preventDefault) e.preventDefault();
          if (e && e.stopPropagation) e.stopPropagation();
          const parsed = parseKey(key) || {};
          open(parsed.slug, parsed.anchor);
        },
      });
    }

    return { el, open, close, link, toggle: (force) => ((force === undefined ? !isOpen : force) ? open() : close()), isOpen: () => isOpen };
  }

  const api = { create, buildSearchEntries, resolveKey, resolveLink, parseKey, LAST_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckHelp = api;
})();
