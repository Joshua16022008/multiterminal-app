'use strict';

/* User Guide: liest docs/guide/*.md, baut den Index und liefert Seiten.
   Slugs kommen ausschließlich aus dem Index (Whitelist), nie aus der Eingabe: kein Pfad-Traversal.
   Der Cache wird pro Datei über mtime+Größe ungültig, Änderungen im Dev-Betrieb erscheinen sofort. */
const fs = require('fs');
const path = require('path');
const { parse } = require('../renderer/guide-markdown');

const SLUG_RE = /^[a-z0-9-]+$/;
const DEFAULT_ORDER = 1000;

/* Minimales Front-Matter: nur "key: value"-Zeilen zwischen zwei '---'-Zeilen am Dateianfang. */
function splitFrontMatter(raw) {
  const text = String(raw).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { meta, body: text.slice(m[0].length) };
}

function buildPage(slug, raw) {
  const { meta, body } = splitFrontMatter(raw);
  const { headings } = parse(body);
  const order = Number.parseInt(meta.order, 10);
  const first = headings.find((x) => x.level === 1);
  return {
    slug,
    title: meta.title || (first && first.text) || slug,
    order: Number.isFinite(order) ? order : DEFAULT_ORDER,
    keywords: meta.keywords || '',
    headings: headings.map(({ level, text, anchor }) => ({ level, text, anchor })),
    markdown: body,
  };
}

function createGuideService({ dir }) {
  const cache = new Map(); // slug -> { key, page }

  function load() {
    let names;
    try { names = fs.readdirSync(dir); } catch (_) { cache.clear(); return []; }
    const pages = [];
    const seen = new Set();
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      const slug = name.slice(0, -3);
      if (!SLUG_RE.test(slug)) continue; // README.md u. Ä. sind keine Seiten
      const file = path.join(dir, name);
      let stat;
      try { stat = fs.statSync(file); } catch (_) { continue; }
      if (!stat.isFile()) continue;
      seen.add(slug);
      const key = stat.mtimeMs + ':' + stat.size;
      let entry = cache.get(slug);
      if (!entry || entry.key !== key) {
        try { entry = { key, page: buildPage(slug, fs.readFileSync(file, 'utf8')) }; } catch (_) { cache.delete(slug); continue; }
        cache.set(slug, entry);
      }
      pages.push(entry.page);
    }
    for (const slug of [...cache.keys()]) if (!seen.has(slug)) cache.delete(slug);
    pages.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'de'));
    return pages;
  }

  return {
    index() {
      return { pages: load().map(({ slug, title, order, keywords, headings }) => ({ slug, title, order, keywords, headings: headings.map((x) => ({ ...x })) })) };
    },
    read(slug) {
      if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
      const page = load().find((p) => p.slug === slug);
      return page ? { slug: page.slug, title: page.title, markdown: page.markdown } : null;
    },
  };
}

module.exports = { createGuideService, splitFrontMatter };
