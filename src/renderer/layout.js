'use strict';

// Grid layout for the terminal tiles of one project.
// Loaded by the browser via <script> and required from Node tests.

const MAX_TERMINALS = 10;

// Columns and rows per terminal count (index = count).
const GRIDS = [
  { cols: 1, rows: 1 }, // 0
  { cols: 1, rows: 1 }, // 1
  { cols: 2, rows: 1 }, // 2
  { cols: 2, rows: 2 }, // 3
  { cols: 2, rows: 2 }, // 4
  { cols: 3, rows: 2 }, // 5
  { cols: 3, rows: 2 }, // 6
  { cols: 3, rows: 3 }, // 7
  { cols: 3, rows: 3 }, // 8
  { cols: 3, rows: 3 }, // 9
  { cols: 4, rows: 3 }, // 10
];

function normalizeCount(count) {
  if (typeof count !== 'number' || Number.isNaN(count) || count < 0) return 0;
  const whole = Math.floor(count);
  return whole > MAX_TERMINALS ? MAX_TERMINALS : whole;
}

function gridFor(count) {
  const grid = GRIDS[normalizeCount(count)];
  return { cols: grid.cols, rows: grid.rows };
}

const api = { MAX_TERMINALS, gridFor };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.DeckLayout = api;
