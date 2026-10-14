'use strict';

// Reihenfolge der Kacheln eines Projekts: Tausch zweier Plätze.
// Loaded by the browser via <script> and required from Node tests.
(function () {
  const valid = (list, i) => Array.isArray(list) && Number.isInteger(i) && i >= 0 && i < list.length;

  // Neue Liste, in der die Einträge an den Plätzen a und b ihre Plätze getauscht haben
  // (echter Tausch, die Kacheln dazwischen bleiben). Ungültig oder gleicher Platz: null.
  function swapped(list, a, b) {
    if (!valid(list, a) || !valid(list, b) || a === b) return null;
    const out = list.slice();
    out[a] = list[b];
    out[b] = list[a];
    return out;
  }

  // Liste an Ort und Stelle tauschen; true, wenn sich etwas geändert hat.
  function swapInPlace(list, a, b) {
    const out = swapped(list, a, b);
    if (!out) return false;
    list.splice(0, list.length, ...out);
    return true;
  }

  const api = { swapped, swapInPlace };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckReorder = api;
})();
