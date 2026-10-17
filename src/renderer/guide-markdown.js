'use strict';

/* Guide-Markdown: kleiner Subset-Renderer für docs/guide/*.md.
   parse() ist rein (kein DOM) und wird auch vom Guide-Service im Main-Prozess genutzt, damit
   Überschriften-Anker in Index und Seite identisch sind. render() baut DOM-Knoten über h(),
   nie über innerHTML; Roh-HTML erscheint als Text.
   Unterstützt: Überschriften, Absätze, fett/kursiv/inline-code, Codeblöcke, Listen (verschachtelt),
   Tabellen, Links, Blockzitate, Trennlinie und den Platzhalter <!-- mt:NAME -->. */
(function () {
  const SLUG_RE = /^[a-z0-9-]+$/;

  /* GitHub-kompatibler Anker: klein, Umlaute bleiben, Satzzeichen entfallen, Leerzeichen -> '-'. */
  function anchor(text) {
    return String(text == null ? '' : text).normalize('NFC').trim().toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '')
      .replace(/ /g, '-');
  }

  /* ---------- Inline ---------- */
  const INLINE_RE = new RegExp([
    '\\\\([\\\\`*_{}\\[\\]()#+\\-.!|<>~])', // 1 Escape
    '(`+)([\\s\\S]*?[^`])\\2(?!`)', // 2 ticks, 3 code
    '\\[((?:[^\\[\\]]|\\[[^\\]]*\\])*)\\]\\(\\s*<?((?:[^()\\s>]|\\([^()\\s]*\\))*)>?(?:\\s+"[^"]*")?\\s*\\)', // 4 Linktext, 5 href
    '\\*\\*(?=\\S)([\\s\\S]*?\\S)\\*\\*', // 6
    '__(?=\\S)([\\s\\S]*?\\S)__', // 7
    '\\*(?=\\S)([\\s\\S]*?\\S)\\*', // 8
    '\\b_(?=\\S)([^_]*?\\S)_\\b', // 9
  ].join('|'));

  function pushText(out, value) {
    if (!value) return;
    const last = out[out.length - 1];
    if (last && last.type === 'text') last.value += value;
    else out.push({ type: 'text', value });
  }

  function parseInline(src, noLinks) {
    const out = [];
    let rest = String(src);
    for (;;) {
      const m = INLINE_RE.exec(rest);
      if (!m) { pushText(out, rest); break; }
      pushText(out, rest.slice(0, m.index));
      rest = rest.slice(m.index + m[0].length);
      if (m[1] !== undefined) pushText(out, m[1]);
      else if (m[3] !== undefined) out.push({ type: 'code', value: m[3].trim() || m[3] });
      else if (m[4] !== undefined) {
        const children = parseInline(m[4], true);
        if (noLinks) for (const c of children) out.push(c);
        else out.push({ type: 'link', href: m[5], children });
      } else if (m[6] !== undefined || m[7] !== undefined) out.push({ type: 'strong', children: parseInline(m[6] !== undefined ? m[6] : m[7], noLinks) });
      else out.push({ type: 'em', children: parseInline(m[8] !== undefined ? m[8] : m[9], noLinks) });
    }
    return out;
  }

  function plainText(nodes) {
    return nodes.map((n) => (n.value !== undefined ? n.value : plainText(n.children || []))).join('');
  }

  /* ---------- Blöcke ---------- */
  const FENCE_RE = /^\s{0,3}(```+|~~~+)\s*([\w+#.-]*)/;
  const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
  const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const QUOTE_RE = /^\s{0,3}>/;
  const ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const HOOK_RE = /^\s*<!--\s*mt:([a-z0-9-]+)\s*-->\s*$/;
  const COMMENT_START_RE = /^\s*<!--/;
  const SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

  function indentOf(line) {
    const m = /^[ \t]*/.exec(line)[0];
    return m.replace(/\t/g, '    ').length;
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '', tick = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
      if (ch === '`') tick = !tick;
      if (ch === '|' && !tick) { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function isTableStart(lines, i) {
    const line = lines[i], next = lines[i + 1];
    if (next === undefined || !line.includes('|') || !next.includes('|') || !SEP_RE.test(next)) return false;
    return splitRow(line).length === splitRow(next).length;
  }

  function startsBlock(lines, i) {
    const line = lines[i];
    return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line)
      || ITEM_RE.test(line) || COMMENT_START_RE.test(line) || isTableStart(lines, i);
  }

  function parseBlocks(lines, state) {
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      let m = FENCE_RE.exec(line);
      if (m) {
        const fence = m[1], lang = m[2] || '';
        const body = [];
        i++;
        const closing = (l) => { const c = /^\s{0,3}(```+|~~~+)\s*$/.exec(l); return Boolean(c) && c[1][0] === fence[0] && c[1].length >= fence.length; };
        while (i < lines.length && !closing(lines[i])) { body.push(lines[i]); i++; }
        i++; // schließender Zaun (oder Ende)
        blocks.push({ type: 'code', lang, text: body.join('\n') });
        continue;
      }
      m = HOOK_RE.exec(line);
      if (m) {
        i++;
        let fallback = null;
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && isTableStart(lines, j)) {
          const [tbl, used] = takeTable(lines, j);
          fallback = tbl; i = j + used;
        }
        blocks.push({ type: 'hook', name: m[1], fallback });
        continue;
      }
      if (COMMENT_START_RE.test(line)) { // übrige Kommentare sind unsichtbar, auch mehrzeilig
        while (i < lines.length && !lines[i].includes('-->')) i++;
        i++;
        continue;
      }
      m = HEADING_RE.exec(line);
      if (m) {
        const inline = parseInline(m[2].trim());
        const text = plainText(inline);
        const base = anchor(text);
        const n = state.counts.get(base) || 0;
        state.counts.set(base, n + 1);
        const id = n ? base + '-' + n : base;
        const block = { type: 'heading', level: m[1].length, text, inline, anchor: id };
        state.headings.push({ level: block.level, text, anchor: id });
        blocks.push(block);
        i++;
        continue;
      }
      if (HR_RE.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
      if (QUOTE_RE.test(line)) {
        const inner = [];
        while (i < lines.length && lines[i].trim() && QUOTE_RE.test(lines[i])) { inner.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++; }
        blocks.push({ type: 'quote', blocks: parseBlocks(inner, state) });
        continue;
      }
      if (isTableStart(lines, i)) {
        const [tbl, used] = takeTable(lines, i);
        blocks.push(tbl); i += used;
        continue;
      }
      m = ITEM_RE.exec(line);
      if (m) {
        const [list, used] = takeList(lines, i, state);
        blocks.push(list); i += used;
        continue;
      }
      const para = [line.trim()];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) { para.push(lines[i].trim()); i++; }
      blocks.push({ type: 'paragraph', inline: parseInline(para.join(' ')) });
    }
    return blocks;
  }

  function takeTable(lines, i) {
    const head = splitRow(lines[i]);
    const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
    const rows = [];
    let j = i + 2;
    while (j < lines.length && lines[j].trim() && lines[j].includes('|')) {
      const cells = splitRow(lines[j]);
      while (cells.length < head.length) cells.push('');
      rows.push(cells.slice(0, head.length).map((c) => parseInline(c)));
      j++;
    }
    return [{ type: 'table', align, head: head.map((c) => parseInline(c)), rows }, j - i];
  }

  function takeList(lines, start, state) {
    const first = ITEM_RE.exec(lines[start]);
    const base = indentOf(first[1]);
    const ordered = /\d/.test(first[2]);
    const startNum = ordered ? parseInt(first[2], 10) : 1;
    const items = [];
    let i = start, current = null;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j >= lines.length || !current) break;
        const nm = ITEM_RE.exec(lines[j]);
        const ind = indentOf(lines[j]);
        if (ind > base || (nm && ind === base && /\d/.test(nm[2]) === ordered)) { current.push(''); i++; continue; }
        break;
      }
      const ind = indentOf(line);
      const m = ITEM_RE.exec(line);
      if (ind <= base && m && indentOf(m[1]) === base) {
        if (/\d/.test(m[2]) !== ordered) break;
        current = [m[3]];
        items.push(current);
        i++;
        continue;
      }
      if (ind > base || (current && current[current.length - 1] !== '' && !startsBlock(lines, i))) {
        if (!current) break;
        current.push(line);
        i++;
        continue;
      }
      break;
    }
    const parsed = items.map((raw) => {
      const sub = raw.slice(1).filter((l) => l.trim());
      const minIndent = sub.length ? Math.min(...sub.map(indentOf)) : 0;
      const dedented = [raw[0]].concat(raw.slice(1).map((l) => {
        let strip = 0, k = 0;
        while (k < l.length && strip < minIndent && (l[k] === ' ' || l[k] === '\t')) { strip += l[k] === '\t' ? 4 : 1; k++; }
        return l.slice(k);
      }));
      return parseBlocks(dedented, state);
    });
    return [{ type: 'list', ordered, start: startNum, items: parsed }, i - start];
  }

  /* markdown -> { blocks, headings }. Ein evtl. vorhandenes Front-Matter bleibt unberührt (Service entfernt es). */
  function parse(markdown) {
    const lines = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n');
    const state = { counts: new Map(), headings: [] };
    const blocks = parseBlocks(lines, state);
    return { blocks, headings: state.headings };
  }

  /* ---------- Links ---------- */
  /* null = verwerfen; sonst { external, href, slug, anchor }. */
  function classifyHref(href) {
    const clean = String(href == null ? '' : href).trim();
    const probe = clean.replace(/[\u0000- \u007f-\u009f]/g, '');
    if (!probe) return null;
    if (probe.startsWith('//') || probe.includes('\\')) return null;
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(probe);
    if (scheme) {
      return ['http', 'https', 'mailto'].includes(scheme[1].toLowerCase()) ? { external: true, href: probe, slug: null, anchor: null } : null;
    }
    const hashAt = probe.indexOf('#');
    let pathPart = hashAt < 0 ? probe : probe.slice(0, hashAt);
    let hash = hashAt < 0 ? '' : probe.slice(hashAt + 1);
    try { hash = decodeURIComponent(hash); } catch (_) { /* roh lassen */ }
    hash = hash.normalize('NFC');
    let slug = null;
    if (pathPart) {
      pathPart = pathPart.replace(/^\.\//, '').replace(/\.md$/i, '');
      if (!SLUG_RE.test(pathPart)) return null;
      slug = pathPart;
    }
    return { external: false, href: probe, slug, anchor: hash || null };
  }

  /* ---------- DOM ---------- */
  function render(markdown, opts) {
    const { h, onLink, onHeading, onHook } = opts || {};
    const doc = (opts && opts.document) || (typeof document !== 'undefined' ? document : null);
    if (typeof h !== 'function' || !doc) throw new Error('render braucht h und document.');
    const text = (value) => doc.createTextNode(value);

    function inlineNodes(nodes) {
      return nodes.map((n) => {
        if (n.type === 'text') return text(n.value);
        if (n.type === 'code') return h('code', { class: 'guide-inline-code', text: n.value });
        if (n.type === 'strong') return h('strong', {}, ...inlineNodes(n.children));
        if (n.type === 'em') return h('em', {}, ...inlineNodes(n.children));
        const info = classifyHref(n.href);
        const kids = inlineNodes(n.children);
        if (!info) return h('span', { class: 'guide-link-disabled' }, ...kids);
        return h('a', {
          class: info.external ? 'guide-link external' : 'guide-link',
          href: info.external ? info.href : '#' + (info.anchor || ''),
          rel: 'noopener noreferrer',
          title: info.external ? info.href : null,
          onclick: (e) => {
            if (e && e.preventDefault) e.preventDefault();
            if (onLink) onLink({ ...info });
          },
        }, ...kids);
      });
    }

    function blockNode(b) {
      switch (b.type) {
        case 'heading': {
          const el = h('h' + b.level, { class: 'guide-h', 'data-anchor': b.anchor }, ...inlineNodes(b.inline));
          if (onHeading) onHeading(b.anchor, el, b);
          return el;
        }
        case 'paragraph': return h('p', {}, ...inlineNodes(b.inline));
        case 'code': return h('pre', { class: 'guide-code' }, h('code', { text: b.text, 'data-lang': b.lang || null }));
        case 'hr': return h('hr', { class: 'guide-hr' });
        case 'quote': return h('blockquote', { class: 'guide-quote' }, ...b.blocks.map(blockNode));
        case 'list': {
          const items = b.items.map((blocks) => {
            const tight = blocks.length && blocks[0].type === 'paragraph';
            const kids = blocks.map((blk, k) => (k === 0 && tight ? inlineNodes(blk.inline) : [blockNode(blk)])).flat();
            return h('li', {}, ...kids);
          });
          return h(b.ordered ? 'ol' : 'ul', { class: 'guide-list', start: b.ordered && b.start !== 1 ? b.start : null }, ...items);
        }
        case 'table': {
          const cell = (tag, nodes, col) => h(tag, { class: b.align[col] ? 'align-' + b.align[col] : null }, ...inlineNodes(nodes));
          return h('div', { class: 'guide-table-wrap' }, h('table', { class: 'guide-table' },
            h('thead', {}, h('tr', {}, ...b.head.map((c, k) => cell('th', c, k)))),
            h('tbody', {}, ...b.rows.map((r) => h('tr', {}, ...r.map((c, k) => cell('td', c, k)))))));
        }
        case 'hook': {
          const el = h('div', { class: 'guide-hook', 'data-mt-hook': b.name }, ...(b.fallback ? [blockNode(b.fallback)] : []));
          if (onHook) onHook(b.name, el);
          return el;
        }
        default: return text('');
      }
    }

    const frag = doc.createDocumentFragment();
    for (const b of parse(markdown).blocks) frag.append(blockNode(b));
    return frag;
  }

  const api = { render, parse, anchor, classifyHref, parseInline };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckGuideMarkdown = api;
})();
