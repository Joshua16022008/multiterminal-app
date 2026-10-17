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

// Mid-luminance hues: at least 3:1 against both white and near-black backgrounds.
const PALETTE = [
  '#d9480f', '#b7791f', '#2f9e44', '#0c8599', '#1c7ed6',
  '#7048e8', '#c2255c', '#5c940d', '#a855f7', '#0d9488',
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
  // Newest activity first; ties and missing times fall back to the id so the
  // result never depends on the input order.
  const branches = nodes.filter((n) => n !== stem).sort((a, b) => {
    const d = timeOf(b) - timeOf(a);
    if (d) return d;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  });

  const out = [{ id: stem.id, x: TRUNK_X, y: TOP }];
  const edges = [];
  branches.forEach((n, i) => {
    const y = TOP + (i + 1) * ROW;
    const forkY = y - FORK_RISE;
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
