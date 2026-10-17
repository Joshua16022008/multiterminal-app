/* Stammbaum-Ansicht (Paket W-D): zeigt je Projekt alle Arbeitskopien als Äste am Trunk-Branch.
   Liest nur (api.worktrees.tree); verändernd sind allein die Aktionen auf den Karten.
   Arbeitet gegen den Vertrag in docs/dev/ipc-contract.md, nicht gegen eine Layout-Implementierung. */
(function () {
  'use strict';
  // „?“-Link zur Hilfe (gemeinsamer Zugang in help-panel.js); ohne Hilfe-Panel bleibt er weg.
  const helpLink = (key, opts) => (typeof window !== 'undefined' && window.DeckHelp && window.DeckHelp.linkFor ? window.DeckHelp.linkFor(key, opts) : null);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CARD_GAP = 10;
  const FALLBACK = { x0: 28, y0: 36, row: 168 };
  const EXTERNAL_WARNING = 'Dieser Ordner gehört einem anderen Werkzeug (Codex). Ein zweiter Agent im selben Ordner kann dessen Arbeit stören.';
  const EXTERNAL_WARNING_OTHER = 'Dieser Ordner gehört einem anderen Werkzeug. Ein zweiter Agent im selben Ordner kann dessen Arbeit stören.';
  const EXTERNAL_QUESTION = '\n\nTrotzdem verknüpfen und fortfahren?';
  const BRANCH_HINT = 'Ein Branch-Wechsel im Terminal (git checkout) wird erst bei der nächsten Aktualisierung sichtbar. Die Zuordnung der Kacheln folgt dem Startordner, ein cd im Terminal wird nicht erkannt.';
  const ACTIVITY_LABEL = { waiting: 'wartet auf dich', working: 'arbeitet', idle: 'inaktiv' };

  /* ---------- reine Helfer ---------- */
  function relTime(time, now) {
    if (!Number.isFinite(time) || time <= 0) return '';
    const ms = time < 1e12 ? time * 1000 : time; // git %ct is seconds, generatedAt is ms
    const s = Math.max(0, Math.round(((Number.isFinite(now) ? now : Date.now()) - ms) / 1000));
    if (s < 60) return 'gerade eben';
    const m = Math.floor(s / 60);
    if (m < 60) return 'vor ' + m + ' Min.';
    const hrs = Math.floor(m / 60);
    if (hrs < 24) return 'vor ' + hrs + ' Std.';
    const d = Math.floor(hrs / 24);
    if (d < 60) return 'vor ' + d + ' T.';
    return 'vor ' + Math.floor(d / 30) + ' Mon.';
  }

  function shortPath(p) {
    const parts = String(p || '').split('/').filter(Boolean);
    if (parts.length <= 3) return String(p || '');
    return '…/' + parts.slice(-3).join('/');
  }

  const isOrphan = (n) => Boolean(n.prunable || n.missing);

  function kindLabel(n) {
    if (isOrphan(n)) return 'verwaist';
    if (n.kind === 'project') return 'Projekt';
    if (n.kind === 'managed') return 'verwaltet';
    if (n.kind === 'linked') return 'übernommen';
    return n.origin === 'codex' ? 'extern (Codex)' : 'extern';
  }

  const branchName = (n) => n.branch || ('losgelöst @ ' + String(n.head || '').slice(0, 7));

  /* Used when window.DeckTreeLayout is absent: plain vertical stack. */
  function fallbackLayout(tree) {
    const nodes = (tree.nodes || []).map((n, i) => ({ id: n.id, x: FALLBACK.x0, y: FALLBACK.y0 + i * FALLBACK.row }));
    const edges = nodes.slice(1).map((n) => ({ from: nodes[0].id, to: n.id, d: 'M' + FALLBACK.x0 + ',' + nodes[0].y + ' L' + n.x + ',' + n.y }));
    return { width: 320, height: FALLBACK.y0 + nodes.length * FALLBACK.row, nodes, edges };
  }

  function removalBlock(node, panes) {
    if (node.kind !== 'managed') return null;
    if (panes.length) return 'Eine Kachel nutzt diese Arbeitskopie. Erst die Kachel schließen.';
    if (node.changes == null) return 'Der Zustand ist nicht lesbar; nichts wird entfernt.';
    if (node.changes > 0) return node.changes + ' ungesicherte Änderungen. Erst sichern oder verwerfen.';
    if (node.locked) return 'Die Arbeitskopie ist gesperrt.';
    return null;
  }

  /* ---------- Ansicht ---------- */
  function create({ document: doc, api, h, notify, confirm, now, layout, rootId, errText }) {
    const rootEl = () => doc.getElementById(rootId || 'worktree-view');
    const clock = now || Date.now;
    const ask = confirm || ((m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false));
    let hooks = {};
    let isOpenFlag = false, lastCards = [], project = null, focusId = null, tree = null, error = '', loading = false, token = 0, busy = false;

    const getLayout = () => layout || (typeof window !== 'undefined' ? window.DeckTreeLayout : null) || (typeof globalThis !== 'undefined' ? globalThis.DeckTreeLayout : null) || null;
    const colorOf = (branch) => { const L = getLayout(); try { return L && L.colorFor && branch ? L.colorFor(branch) : null; } catch (_) { return null; } };
    // Prefer the shared helper (DeckApp.errText); the regex is only a fallback for standalone use.
    const msg = (e) => (typeof errText === 'function' ? errText(e) : String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));

    function setHooks(next) { hooks = { ...hooks, ...(next || {}) }; }
    const call = (name, ...args) => (typeof hooks[name] === 'function' ? hooks[name](...args) : undefined);
    const panesOf = (node) => { try { return (call('panesFor', node.id) || []).filter(Boolean); } catch (_) { return []; } };

    /* ----- Daten ----- */
    async function load() {
      if (!project) return;
      const my = ++token;
      loading = true; error = '';
      render();
      try {
        const t = await api.worktrees.tree(project.id, true);
        if (my !== token || !isOpenFlag) return;
        tree = t;
        if (t && t.ok === false) error = t.error || 'Der Stammbaum konnte nicht gelesen werden.';
      } catch (e) {
        if (my !== token || !isOpenFlag) return;
        error = msg(e) || 'Der Stammbaum konnte nicht gelesen werden.';
      }
      loading = false;
      render();
      scrollToFocus();
    }

    /* ----- Aktionen ----- */
    // Returns the workspaceId ('' for the project folder) or false when the user cancelled / adopt failed.
    async function prepare(node, warn) {
      if (node.kind === 'project') return '';
      if (node.workspaceId) return node.workspaceId;
      // Adopting leaves a lasting record, so every path (also "Änderungen ansehen") asks first.
      if (warn && !ask((node.origin === 'codex' ? EXTERNAL_WARNING : EXTERNAL_WARNING_OTHER) + EXTERNAL_QUESTION)) return false;
      let r;
      try { r = await api.worktrees.adopt(project.id, node.path); } catch (e) { r = { ok: false, error: msg(e) }; }
      if (!r || !r.ok || !r.workspace) { notify((r && r.error) || 'Der Ordner konnte nicht verknüpft werden.'); return false; }
      call('onAdopt', project, { ...node, kind: 'linked', workspaceId: r.workspace.workspaceId });
      return r.workspace.workspaceId;
    }

    async function act(node, kind) {
      if (busy) return;
      busy = true;
      try {
        const ws = await prepare(node, true);
        if (ws === false) return;
        const record = ws ? { workspaceId: ws, branch: node.branch, cwd: node.path } : null;
        close();
        if (kind === 'terminal') call('onOpenTerminal', project, record);
        else if (kind === 'agent') call('onStartAgent', project, ws || null);
        else call('onShowDiff', project, ws || null);
      } finally { busy = false; }
    }

    async function removeNode(node) {
      if (busy) return;
      const panes = panesOf(node);
      if (removalBlock(node, panes)) return;
      if (!ask('Arbeitskopie „' + branchName(node) + '“ entfernen?\nDer Ordner wird gelöscht, der Branch bleibt bestehen.')) return;
      busy = true;
      try {
        const r = await api.worktrees.remove(node.workspaceId);
        if (!r || !r.ok) notify((r && r.error) || 'Entfernen fehlgeschlagen.');
        else notify('Arbeitskopie entfernt. Der Branch „' + (r.branchKept || node.branch || '') + '“ bleibt bestehen.', 'ok');
      } catch (e) { notify(msg(e)); }
      finally { busy = false; }
      await load();
    }

    function jump(paneId) { close(); call('onJump', paneId); }

    /* ----- Darstellung ----- */
    function badge(text, cls) { return h('span', { class: 'wtv-badge' + (cls ? ' ' + cls : ''), text }); }

    function paneRow(p) {
      const act = p.activity && ACTIVITY_LABEL[p.activity] ? p.activity : null;
      const label = (p.title || 'Terminal') + (act ? ' · ' + ACTIVITY_LABEL[act] : '');
      return h('button', { class: 'wtv-pane', type: 'button', title: 'Zu dieser Kachel springen: ' + label, onclick: () => jump(p.id) },
        h('span', { class: 'wtv-dot', 'data-activity': act || 'none', 'aria-hidden': 'true' }),
        h('span', { class: 'wtv-pane-title', text: label }));
    }

    function statsLine(n) {
      const parts = [];
      if (n.kind !== 'project' || n.ahead != null) {
        if (n.ahead != null) parts.push(h('span', { class: 'wtv-stat', title: 'Commits vor dem Stamm', text: '↑' + n.ahead }));
        if (n.behind != null) parts.push(h('span', { class: 'wtv-stat', title: 'Commits hinter dem Stamm', text: '↓' + n.behind }));
      }
      if (n.merged) parts.push(badge('gemergt', 'merged'));
      parts.push(h('span', { class: 'wtv-stat' + (n.changes ? ' dirty' : ''), title: 'Ungesicherte Änderungen',
        text: n.changes == null ? 'Änderungen: –' : n.changes + (n.changes === 1 ? ' Änderung' : ' Änderungen') }));
      return h('div', { class: 'wtv-stats' }, ...parts);
    }

    function lastLine(n) {
      if (!n.last) return h('div', { class: 'wtv-last dim', text: 'Kein Commit lesbar.' });
      return h('div', { class: 'wtv-last', title: n.last.author ? 'Autor: ' + n.last.author : '' },
        h('code', { text: String(n.last.sha || '').slice(0, 7) }),
        h('span', { class: 'wtv-subject', text: ' ' + (n.last.subject || '') }),
        h('span', { class: 'wtv-time', text: ' · ' + relTime(n.last.time, clock()) }));
    }

    function actionBar(n, panes) {
      if (isOrphan(n)) {
        return h('p', { class: 'wtv-hint', text: 'Verwaister Eintrag: Der Ordner existiert nicht mehr. Aufräumen im Terminal mit „git worktree prune“; hier gibt es dafür keine Aktion.' });
      }
      const external = n.kind === 'external';
      const bar = h('div', { class: 'wtv-actions' },
        h('button', { class: 'btn-small', type: 'button', text: external ? 'Übernehmen…' : 'Terminal hier öffnen',
          title: external ? 'Den fremden Ordner verknüpfen und ein Terminal darin öffnen' : 'Neues Terminal in diesem Ordner', onclick: () => act(n, 'terminal') }),
        h('button', { class: 'btn-small', type: 'button', text: 'Agent hier starten', onclick: () => act(n, 'agent') }),
        h('button', { class: 'btn-small', type: 'button', text: 'Änderungen ansehen', onclick: () => act(n, 'diff') }));
      if (n.kind === 'managed') {
        const block = removalBlock(n, panes);
        bar.append(h('button', { class: 'btn-small danger', type: 'button', text: 'Entfernen', disabled: Boolean(block),
          title: block || 'Arbeitskopie entfernen (der Branch bleibt bestehen)', onclick: () => removeNode(n) }));
      }
      return bar;
    }

    function card(n, pos) {
      const panes = panesOf(n);
      const color = colorOf(n.branch);
      const el = h('article', { class: 'wtv-card kind-' + n.kind + (isOrphan(n) ? ' orphan' : '') + (n.id === focusId ? ' focus' : ''), 'data-node-id': n.id });
      if (color) el.style.setProperty('--wt-color', color);
      el.style.left = (pos.x + 20) + 'px';
      el.style.top = (pos.y - 14) + 'px';
      // Native append() would print null as the text "null"; only h() skips empty children.
      el.append(...[
        h('header', { class: 'wtv-card-head' },
          h('strong', { class: 'wtv-branch', text: '⑂ ' + branchName(n), title: n.branch || '' }),
          badge(kindLabel(n), 'kind'),
          n.locked ? badge('gesperrt') : null),
        h('div', { class: 'wtv-path', text: shortPath(n.path), title: n.path || '' }),
        isOrphan(n) ? null : statsLine(n),
        isOrphan(n) ? null : lastLine(n),
        panes.length ? h('div', { class: 'wtv-panes' }, ...panes.map(paneRow)) : null,
        actionBar(n, panes)].filter(Boolean));
      return el;
    }

    function svgEl(tag, attrs) {
      const e = doc.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, String(v)); // null = leave to CSS
      return e;
    }

    // heights (optional): measured card heights per node id from a first render pass.
    function stage(heights) {
      const L = getLayout();
      let lay;
      try { lay = L && typeof L.layout === 'function' ? L.layout(tree, heights ? { heights, gap: CARD_GAP } : undefined) : null; } catch (_) { lay = null; }
      if (!lay || !Array.isArray(lay.nodes)) lay = fallbackLayout(tree);
      const byId = new Map(lay.nodes.map((p) => [p.id, p]));
      const width = Math.max(320, lay.width || 0), height = Math.max(120, lay.height || 0);
      const svg = svgEl('svg', { class: 'wtv-svg', width, height, viewBox: '0 0 ' + width + ' ' + height, 'aria-hidden': 'true' });
      const projectPos = tree.nodes.map((n) => (n.kind === 'project' ? byId.get(n.id) : null)).find(Boolean);
      const ys = lay.nodes.map((p) => p.y);
      if (projectPos && ys.length) svg.append(svgEl('line', { class: 'wtv-trunk', x1: projectPos.x, x2: projectPos.x, y1: Math.min(...ys), y2: Math.max(...ys) }));
      const byNodeId = new Map(tree.nodes.map((n) => [n.id, n]));
      for (const e of lay.edges || []) {
        const target = byNodeId.get(e.to);
        const color = target ? colorOf(target.branch) : null;
        svg.append(svgEl('path', { class: 'wtv-edge', d: e.d, fill: 'none', stroke: color }));
      }
      for (const n of tree.nodes) {
        const p = byId.get(n.id);
        if (!p) continue;
        svg.append(svgEl('circle', { class: 'wtv-node', cx: p.x, cy: p.y, r: 5, fill: colorOf(n.branch) }));
      }
      const box = h('div', { class: 'wtv-stage' }, svg);
      box.style.width = width + 'px';
      box.style.height = height + 'px';
      const cards = [];
      for (const n of tree.nodes) {
        const p = byId.get(n.id);
        if (!p) continue;
        const c = card(n, p);
        cards.push({ id: n.id, el: c, top: p.y - 14 });
        box.append(c);
      }
      return { box, cards, height };
    }

    // Card heights after layout (browser only); null when nothing is measurable (tests, hidden).
    function measure(s) {
      const out = {};
      for (const c of s.cards) {
        const hgt = c.el.offsetHeight;
        if (!(hgt > 0)) return null;
        out[c.id] = hgt;
      }
      return s.cards.length ? out : null;
    }

    // Cards are taller than a layout row may assume: push overlapping ones down (browser only).
    function relax(s) {
      const sorted = s.cards.filter((c) => c.el.offsetHeight > 0).sort((a, b) => a.top - b.top);
      let bottom = 0;
      for (const c of sorted) {
        const top = Math.max(c.top, bottom + (bottom ? CARD_GAP : 0));
        if (top !== c.top) c.el.style.top = top + 'px';
        bottom = top + c.el.offsetHeight;
      }
      if (bottom + 16 > s.height) s.box.style.height = (bottom + 16) + 'px';
    }

    function body() {
      if (loading && !tree) return h('p', { class: 'wtv-state', text: 'Lese Arbeitskopien …' });
      if (error) return h('div', { class: 'wtv-state error', role: 'alert' }, h('p', { text: error }), h('button', { class: 'btn-small', type: 'button', text: 'Erneut versuchen', onclick: load }));
      if (!tree) return h('p', { class: 'wtv-state', text: 'Kein Projekt ausgewählt.' });
      if (tree.isGit === false) return h('p', { class: 'wtv-state', text: 'Dieses Projekt ist kein Git-Repository. Es gibt keine Arbeitskopien, die sich anzeigen ließen.' });
      if (!Array.isArray(tree.nodes) || !tree.nodes.length) return h('p', { class: 'wtv-state', text: 'Es sind noch keine Arbeitskopien vorhanden. Mit „Terminal in Arbeitskopie…“ legst du eine an.' });
      const trunk = tree.trunk
        ? h('p', { class: 'wtv-trunk-line' }, h('strong', { text: 'Stamm: ' + tree.trunk.name }),
          h('span', { class: 'dim', text: ' · ' + String(tree.trunk.head || '').slice(0, 7) + ' ' + (tree.trunk.subject || '') + (tree.trunk.time ? ' · ' + relTime(tree.trunk.time, clock()) : '') }))
        : h('p', { class: 'wtv-trunk-line dim', text: 'Kein Stamm-Branch erkannt (noch kein Commit?).' });
      const s = stage();
      lastCards = s.cards;
      return { nodes: [trunk, h('div', { class: 'wtv-scroll' }, s.box)], stage: s };
    }

    function render() {
      const root = rootEl();
      if (!root) return;
      root.hidden = !isOpenFlag;
      if (!isOpenFlag) { root.replaceChildren(); return; }
      const b = body();
      const content = b && b.nodes ? b.nodes : [b];
      root.replaceChildren(
        h('div', { class: 'wtv-head' },
          h('button', { class: 'btn-small', type: 'button', text: '← Zurück zu den Terminals', onclick: close }),
          h('strong', { class: 'wtv-title', text: 'Arbeitskopien' + (project && project.name ? ' · ' + project.name : '') }),
          helpLink('worktrees'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn-small', type: 'button', text: '⟳ Aktualisieren', disabled: loading, title: 'Stammbaum neu einlesen', onclick: load })),
        h('p', { class: 'wtv-note', text: BRANCH_HINT }),
        ...content);
      if (b && b.stage) {
        // Second pass: rows sized to the real cards, so curves and dots meet their cards.
        const heights = measure(b.stage);
        const L = getLayout();
        if (heights && L && typeof L.layout === 'function' && b.stage.box.parentNode) {
          const s2 = stage(heights);
          b.stage.box.parentNode.replaceChild(s2.box, b.stage.box);
          lastCards = s2.cards;
          relax(s2);
        } else relax(b.stage);
      }
    }

    function scrollToFocus() {
      if (!focusId) return;
      // Looked up in the rendered card list, so ids with quotes or backslashes work too.
      const hit = lastCards.find((c) => c.id === focusId);
      const target = hit && hit.el;
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    /* ----- Öffnen / Schließen ----- */
    function onKey(e) {
      if (e.key === 'Escape' && isOpenFlag) { if (e.preventDefault) e.preventDefault(); close(); }
    }

    function open(opts) {
      opts = opts || {};
      const same = project && opts.project && project.id === opts.project.id;
      if (!opts.project && !project) return Promise.resolve(); // nothing to show: stay closed
      project = opts.project || project;
      focusId = opts.focusId || null;
      if (!same) { tree = null; error = ''; lastCards = []; }
      if (!isOpenFlag) doc.addEventListener('keydown', onKey);
      isOpenFlag = true;
      return load();
    }

    function close() {
      if (!isOpenFlag) return;
      isOpenFlag = false; token++; loading = false;
      if (doc.removeEventListener) doc.removeEventListener('keydown', onKey);
      const root = rootEl();
      if (root) { root.hidden = true; root.replaceChildren(); }
      call('onClose');
    }

    return { open, close, isOpen: () => isOpenFlag, refresh: () => (isOpenFlag ? load() : Promise.resolve()), setHooks };
  }

  const api = { create, relTime, shortPath, kindLabel, removalBlock, EXTERNAL_WARNING };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckWorktreeTree = api;
})();
