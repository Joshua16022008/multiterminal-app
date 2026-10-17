'use strict';

// Pure layout of the worktree tree: the trunk runs vertically on the left, every
// other node is a branch that forks off it. Positions are plain numbers and the
// edges are SVG path strings, so the view only has to draw them.
// Loaded by the browser via <script> and required from Node tests.

const TRUNK_X = 28;
const BRANCH_X = 120;
const TOP = 28;
const ROW = 96;
// How far above its card a branch leaves the trunk.
const FORK_RISE = 36;
const BOTTOM_PAD = 40;
const WIDTH = 300;

// Mid-luminance hues: at least 3:1 against white and the app's dark surfaces
// (--bg #14161a, --bg-2 #1a1d23, --bg-3 #22262e).
const PALETTE = [
  '#d9480f', '#b7791f', '#2f9e44', '#0c8599', '#1c7ed6',
  '#7c5cff', '#d6336c', '#5c940d', '#a855f7', '#0d9488',
];
const NEUTRAL = '#868e96';

function hash(text) {
  // FNV-1a, 32 bit: stable across runs and platforms.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function colorFor(branch) {
  if (typeof branch !== 'string' || !branch) return NEUTRAL;
  return PALETTE[hash(branch) % PALETTE.length];
}

function timeOf(node) {
  const t = node && node.last && Number(node.last.time);
  return Number.isFinite(t) ? t : 0;
}

function layout(tree) {
  const nodes = tree && Array.isArray(tree.nodes) ? tree.nodes : [];
  if (!nodes.length) {
    return { width: WIDTH, height: TOP + BOTTOM_PAD, trunk: null, nodes: [], edges: [] };
  }
  const stem = nodes.find((n) => n.kind === 'project') || nodes[0];
  // Branches are ordered by where they leave the trunk: newest fork point
  // first, then fork point (so siblings stay together), then newest activity;
  // the id makes the result independent of the input order.
  const forkT = (n) => (Number.isFinite(Number(n.forkTime)) ? Number(n.forkTime) : 0);
  const forkP = (n) => (typeof n.forkPoint === 'string' ? n.forkPoint : '');
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const branches = nodes.filter((n) => n !== stem).sort((a, b) => (
    forkT(b) - forkT(a) || cmp(forkP(a), forkP(b)) || timeOf(b) - timeOf(a) || cmp(String(a.id), String(b.id))
  ));

  const out = [{ id: stem.id, x: TRUNK_X, y: TOP }];
  const edges = [];
  // Branches sharing a fork point leave the trunk at the same height.
  const forkYs = new Map();
  branches.forEach((n, i) => {
    const y = TOP + (i + 1) * ROW;
    const fp = forkP(n);
    if (fp && !forkYs.has(fp)) forkYs.set(fp, y - FORK_RISE);
    const forkY = fp ? forkYs.get(fp) : y - FORK_RISE;
    out.push({ id: n.id, x: BRANCH_X, y });
    const c1y = forkY + (y - forkY) * 0.6;
    const c2x = TRUNK_X + (BRANCH_X - TRUNK_X) * 0.4;
    edges.push({
      from: stem.id,
      to: n.id,
      d: `M ${TRUNK_X} ${forkY} C ${TRUNK_X} ${c1y} ${c2x} ${y} ${BRANCH_X} ${y}`,
    });
  });

  const lastY = TOP + branches.length * ROW;
  const height = lastY + BOTTOM_PAD;
  return {
    width: WIDTH,
    height,
    trunk: { x: TRUNK_X, y1: TOP, y2: lastY, d: `M ${TRUNK_X} ${TOP} V ${lastY}` },
    nodes: out,
    edges,
  };
}

const api = { layout, colorFor, PALETTE };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.DeckTreeLayout = api;
