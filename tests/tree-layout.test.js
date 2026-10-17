'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { layout, colorFor, PALETTE } = require('../src/renderer/tree-layout.js');

function mk(n) {
  const nodes = [{ id: 'proj', kind: 'project', branch: 'main', last: { time: 1000 } }];
  for (let i = 0; i < n; i++) nodes.push({ id: `n${i}`, kind: 'managed', branch: `b${i}`, last: { time: 100 + i } });
  return { nodes };
}

test('empty or missing tree gives an empty layout', () => {
  for (const t of [null, {}, { nodes: [] }]) {
    const l = layout(t);
    assert.deepStrictEqual(l.nodes, []);
    assert.deepStrictEqual(l.edges, []);
    assert.ok(l.width > 0 && l.height > 0);
  }
});

test('trunk is vertical, one edge per branch, forking on the trunk', () => {
  const l = layout(mk(3));
  assert.strictEqual(l.nodes.length, 4);
  assert.strictEqual(l.edges.length, 3);
  const stem = l.nodes.find((n) => n.id === 'proj');
  assert.match(l.trunk.d, /^M \d+ \d+ V \d+$/);
  assert.strictEqual(l.trunk.x, stem.x);
  for (const e of l.edges) {
    assert.strictEqual(e.from, 'proj');
    const target = l.nodes.find((n) => n.id === e.to);
    assert.ok(e.d.startsWith(`M ${stem.x} `), e.d);
    assert.ok(e.d.endsWith(` ${target.x} ${target.y}`), e.d);
  }
  assert.ok(l.height > l.nodes[l.nodes.length - 1].y);
});

test('deterministic and independent of input order', () => {
  const t = mk(7);
  const shuffled = { nodes: [t.nodes[0], ...t.nodes.slice(1).reverse()] };
  assert.deepStrictEqual(layout(t), layout(JSON.parse(JSON.stringify(t))));
  assert.deepStrictEqual(layout(t), layout(shuffled));
});

test('no overlapping positions for 1 to 30 branches', () => {
  for (let n = 1; n <= 30; n++) {
    const l = layout(mk(n));
    assert.strictEqual(l.nodes.length, n + 1);
    const ys = l.nodes.filter((p) => p.id !== 'proj').map((p) => p.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 60, `n=${n}`);
    assert.strictEqual(new Set(l.nodes.map((p) => `${p.x},${p.y}`)).size, n + 1);
    assert.ok(l.nodes.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
});

test('newest branch sits closest to the stem', () => {
  const l = layout(mk(3));
  const y = (id) => l.nodes.find((n) => n.id === id).y;
  assert.ok(y('n2') < y('n1') && y('n1') < y('n0'));
});

test('without a project node the first node becomes the stem', () => {
  const l = layout({ nodes: [{ id: 'a', kind: 'external' }, { id: 'b', kind: 'external' }] });
  assert.strictEqual(l.edges.length, 1);
  assert.strictEqual(l.edges[0].from, 'a');
});

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test('colorFor is stable, valid and falls back to a neutral', () => {
  assert.strictEqual(colorFor('feature/x'), colorFor('feature/x'));
  assert.match(colorFor('feature/x'), /^#[0-9a-f]{6}$/);
  assert.match(colorFor(null), /^#[0-9a-f]{6}$/);
  assert.strictEqual(colorFor(''), colorFor(null));
  const used = new Set(['main', 'master', 'feature/a', 'feature/b', 'fix/1', 'fix/2', 'claude/x', 'codex/y', 'z', 'q'].map(colorFor));
  assert.ok(used.size >= 4, 'hash should spread over the palette');
});

test('every palette color is readable on light and dark backgrounds', () => {
  for (const c of PALETTE) {
    assert.ok(contrast(c, '#ffffff') >= 3, `${c} on white`);
    for (const bg of ['#14161a', '#1a1d23', '#22262e']) assert.ok(contrast(c, bg) >= 3, `${c} on ${bg}`);
  }
});

test('branches with the same fork point leave the trunk at the same height', () => {
  const l = layout({ nodes: [
    { id: 'proj', kind: 'project', branch: 'main', last: { time: 1000 } },
    { id: 'a', kind: 'managed', forkPoint: 'f1', forkTime: 500, last: { time: 900 } },
    { id: 'b', kind: 'managed', forkPoint: 'f1', forkTime: 500, last: { time: 800 } },
    { id: 'c', kind: 'managed', forkPoint: 'f0', forkTime: 100, last: { time: 950 } },
  ] });
  const startY = (id) => Number(l.edges.find((e) => e.to === id).d.split(' ')[2]);
  assert.strictEqual(startY('a'), startY('b'));
  assert.ok(startY('c') > startY('a'), 'older fork point sits lower on the trunk');
  const y = (id) => l.nodes.find((n) => n.id === id).y;
  assert.ok(y('a') < y('c') && y('b') < y('c'));
});
