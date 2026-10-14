'use strict';

// Number keys that jump to a terminal tile: 1..9 select tiles 1..9, 0 selects
// tile 10. Loaded by the browser via <script> and required from Node tests.
// Wrapped in a function so no global names clash with the other scripts.
(function () {
  const ACTION_PREFIX = 'focus-terminal:';
  const SLOTS = 10;

  // Key that belongs to a 0-based tile position: 0 -> '1' ... 8 -> '9', 9 -> '0'.
  function keyForIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= SLOTS) return '';
    return String((index + 1) % SLOTS);
  }

  // 0-based tile position for a digit key ('1' -> 0 ... '9' -> 8, '0' -> 9).
  function indexForKey(key) {
    if (typeof key !== 'string' || !/^[0-9]$/.test(key)) return -1;
    return (Number(key) + SLOTS - 1) % SLOTS;
  }

  // Menu action sent from the main process for a 0-based position.
  function actionFor(index) {
    return keyForIndex(index) === '' ? null : ACTION_PREFIX + keyForIndex(index);
  }

  // Tile position (0-based) for a menu action, or -1 if it is not one of ours.
  function indexForAction(action) {
    if (typeof action !== 'string' || !action.startsWith(ACTION_PREFIX)) return -1;
    return indexForKey(action.slice(ACTION_PREFIX.length));
  }

  // Which tile a key press targets in a project with `count` tiles, or -1.
  function targetFor(action, count) {
    const index = indexForAction(action);
    return index >= 0 && index < count ? index : -1;
  }

  // Ctrl/Cmd + digit without Shift/Alt: the combos the menu owns.
  function isHotkeyEvent(e) {
    return !!e && !!(e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && indexForKey(e.key) >= 0;
  }

  const api = { SLOTS, keyForIndex, indexForKey, actionFor, indexForAction, targetFor, isHotkeyEvent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckHotkeys = api;
})();
