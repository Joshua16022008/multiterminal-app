'use strict';

// Grid layout for the terminal tiles of one project.
// Loaded by the browser via <script> and required from Node tests.

// Safety ceiling, not a design limit: every terminal is a real shell process.
const MAX_TERMINALS = 30;
const MAX_COLS = 3;
// Rows that share the visible height; further rows are reached by scrolling.
const VISIBLE_ROWS = 2;

function normalizeCount(count) {
  if (typeof count !== 'number' || Number.isNaN(count) || count < 0) return 0;
  const whole = Math.floor(count);
  return whole > MAX_TERMINALS ? MAX_TERMINALS : whole;
}

// One or two terminals sit side by side; from three on the grid is always
// three wide and grows downwards.
function gridFor(count) {
  const n = Math.max(normalizeCount(count), 1);
  const cols = Math.min(n, MAX_COLS);
  const rows = Math.ceil(n / cols);
  return { cols, rows, visibleRows: Math.min(rows, VISIBLE_ROWS) };
}

const api = { MAX_TERMINALS, gridFor };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.DeckLayout = api;
