'use strict';

// Shared by the renderer and main process: one vocabulary for menus and xterm.
(function () {
  const ACTION_PREFIX = 'focus-terminal:';
  const SLOTS = 10;
  // Edition (dev/public): the page gets it from the preload, the main process from edition.js.
  // A page with a missing edition response must not expose unavailable developer actions.
  const node = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const edition = (function () {
    if (typeof window !== 'undefined' && window.deck && window.deck.edition) return window.deck.edition;
    if (node) { try { return require('../main/edition'); } catch (_) { return null; } }
    return null;
  })();
  const features = edition && edition.features ? edition.features : null;
  const enabled = (action) => !action.feature || (features ? features[action.feature] === true : !(typeof window !== 'undefined' && window.deck));
  const allActions = [
    { id: 'settings', label: 'Einstellungen öffnen' },
    { id: 'new-terminal', label: 'Neues Terminal' },
    { id: 'close-terminal', label: 'Terminal schließen' },
    { id: 'next-attention', label: 'Nächste Rückmeldung' },
    // F03
    { id: 'command-palette', label: 'Befehlspalette' },
    { id: 'terminal-search', label: 'Im Terminalverlauf suchen' },
    { id: 'project-manager', label: 'Projektmanager öffnen' }, // PM
    // Neue Funktionen: Panels, Übergabe, Browser, Aufgaben, Aufbauten, Komfort, Manager-Lagebild
    { id: 'diff-panel', label: 'Änderungen anzeigen' },
    { id: 'ports-panel', label: 'Ports anzeigen' },
    { id: 'attention-panel', label: 'Rückmeldungen anzeigen' },
    { id: 'progress-panel', label: 'Fortschritt anzeigen' },
    { id: 'handoff', label: 'Übergabe an anderes Terminal' },
    { id: 'browser-pick', label: 'Element im Browser kommentieren' },
    { id: 'task-link', label: 'Aufgabe der Kachel', feature: 'taskLink' }, // Bezeichnung der Entwicklerversion: dev-features.js
    { id: 'layout-start', label: 'Aufbau starten' },
    { id: 'layout-save', label: 'Aufbau speichern' },
    { id: 'qol-panel', label: 'Komfort-Einstellungen' },
    { id: 'auto-sort', label: 'Automatische Sortierung an/aus' },
    { id: 'pm-situation', label: 'Lagebild im Projektmanager ein/aus' },
    { id: 'worktree-tree', label: 'Stammbaum / Arbeitskopien' },
    { id: 'help', label: 'Hilfe öffnen' },
    ...Array.from({ length: SLOTS }, (_, i) => ({ id: actionFor(i), label: `Terminal ${i + 1}` }))
  ];
  // Actions of switched-off features do not exist in this edition (no menu, no binding, no conflict).
  const actions = allActions.filter(enabled);
  const disabled = allActions.filter(action => !enabled(action)).map(action => action.id);
  function setLabel(id, label) {
    const action = actions.find(item => item.id === id);
    if (action && typeof label === 'string' && label) action.label = label;
  }
  const modifiers = ['Cmd', 'Ctrl', 'Alt', 'Shift'];
  const aliases = { command: 'Cmd', cmd: 'Cmd', meta: 'Cmd', control: 'Ctrl', ctrl: 'Ctrl', option: 'Alt', alt: 'Alt', shift: 'Shift' };
  const keyAliases = {
    space: 'Space', spacebar: 'Space', enter: 'Enter', return: 'Enter', tab: 'Tab',
    backspace: 'Backspace', delete: 'Delete', del: 'Delete', home: 'Home', end: 'End',
    pageup: 'PageUp', pagedown: 'PageDown', up: 'Up', arrowup: 'Up', down: 'Down',
    arrowdown: 'Down', left: 'Left', arrowleft: 'Left', right: 'Right', arrowright: 'Right',
    comma: ',', period: '.', semicolon: ';', quote: "'", bracketleft: '[', bracketright: ']',
    backslash: '\\', slash: '/', grave: '`', backquote: '`', minus: '-', equal: '='
  };

  function keyForIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= SLOTS) return '';
    return String((index + 1) % SLOTS);
  }
  function indexForKey(key) {
    if (typeof key !== 'string' || !/^[0-9]$/.test(key)) return -1;
    return (Number(key) + SLOTS - 1) % SLOTS;
  }
  function actionFor(index) {
    return keyForIndex(index) === '' ? null : ACTION_PREFIX + keyForIndex(index);
  }
  function indexForAction(action) {
    if (typeof action !== 'string' || !action.startsWith(ACTION_PREFIX)) return -1;
    return indexForKey(action.slice(ACTION_PREFIX.length));
  }
  function targetFor(action, count) {
    const index = indexForAction(action);
    return index >= 0 && index < count ? index : -1;
  }
  function defaults(platform = 'darwin') {
    const primary = platform === 'darwin' ? 'Cmd' : 'Ctrl';
    const result = { settings: [`${primary}+,`], 'new-terminal': [`${primary}+T`], 'close-terminal': [`${primary}+W`], 'next-attention': [`${primary}+J`] };
    // F03: Cmd+K / Cmd+F; auf anderen Systemen mit Umschalt, damit Strg+K/Strg+F im Terminal (readline) frei bleiben.
    result['command-palette'] = [platform === 'darwin' ? 'Cmd+K' : 'Ctrl+Shift+P'];
    result['terminal-search'] = [platform === 'darwin' ? 'Cmd+F' : 'Ctrl+Shift+F'];
    result['project-manager'] = [`${primary}+Shift+O`]; // PM (Cmd+Shift+M ist als reserviert gesperrt)
    // Mac: Cmd+Umschalt+Buchstabe; sonst Strg+Alt, damit Strg+Umschalt-Kürzel der Shell frei bleiben.
    const extra = (letter) => [platform === 'darwin' ? `Cmd+Shift+${letter}` : `Ctrl+Alt+${letter}`];
    Object.assign(result, {
      'diff-panel': extra('D'), 'ports-panel': extra('P'), 'attention-panel': extra('J'), 'progress-panel': extra('G'),
      handoff: extra('U'), 'browser-pick': extra('E'), 'task-link': extra('L'), 'layout-start': extra('B'),
      'layout-save': [platform === 'darwin' ? 'Cmd+Alt+B' : 'Ctrl+Alt+Shift+B'], 'qol-panel': extra('K'), 'auto-sort': extra('S'),
      'pm-situation': [platform === 'darwin' ? 'Cmd+\\' : 'Ctrl+Alt+\\'], // Strg+Backslash wäre in Terminals SIGQUIT
      'worktree-tree': extra('Y'), help: extra('H'), // Y wie eine Gabelung; ⌘H allein bleibt „Ausblenden“
    });
    for (let i = 0; i < SLOTS; i++) result[actionFor(i)] = platform === 'darwin' ? [`Cmd+${keyForIndex(i)}`, `Ctrl+${keyForIndex(i)}`] : [`Ctrl+${keyForIndex(i)}`];
    for (const id of disabled) delete result[id];
    return result;
  }
  function normalizeKey(key) {
    if (key === ' ') return 'Space';
    if (typeof key !== 'string') return null;
    if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
    if (/^[,.;'\[\]\\/`=\-]$/.test(key)) return key;
    if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase();
    return keyAliases[key.toLowerCase()] || null;
  }
  // Zeichen-Tasten brauchen Cmd oder Ctrl: Shift+D oder Alt+D würden sonst Großbuchstaben bzw. Sonderzeichen im Terminal verschlucken.
  // Funktionstasten tippen nichts, deshalb reicht dort jeder Modifikator (Shift, Alt, Ctrl oder Cmd).
  const isFunctionKey = (key) => /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
  function modifiersSuffice(mods, key) {
    const has = (m) => (mods instanceof Set ? mods.has(m) : Boolean(mods[m]));
    if (has('Cmd') || has('Ctrl')) return true;
    return isFunctionKey(key) && (has('Alt') || has('Shift'));
  }
  function canonical(accelerator) {
    if (typeof accelerator !== 'string' || !accelerator.trim()) throw new Error('Bitte ein gültiges Tastenkürzel eingeben.');
    const parts = accelerator.trim().split('+').map(part => part.trim());
    const key = normalizeKey(parts.pop());
    const seen = new Set();
    for (const part of parts) {
      const modifier = aliases[part.toLowerCase()];
      if (!modifier || seen.has(modifier)) throw new Error(`Ungültiges Tastenkürzel „${accelerator}“. Modifikatoren nur einmal verwenden.`);
      seen.add(modifier);
    }
    if (!key || !modifiersSuffice(seen, key)) throw new Error(`Ungültiges Tastenkürzel „${accelerator}“: Cmd oder Ctrl und eine unterstützte Taste verwenden; F1–F24 gehen auch mit Shift oder Alt.`);
    return [...modifiers.filter(modifier => seen.has(modifier)), key].join('+');
  }
  function reserved(accelerator, platform) {
    if (platform === 'darwin' && ['Cmd+Alt+I', 'Cmd+Ctrl+F', 'Cmd+Alt+Shift+V'].includes(accelerator)) return true;
    if (platform !== 'darwin' && ['Ctrl+Shift+I', 'Ctrl+Shift+V'].includes(accelerator)) return true;
    const parts = accelerator.split('+');
    const key = parts.pop();
    // Keep standard editing, app/system management and zoom shortcuts intact.
    // H: Cmd+H / Cmd+Alt+H hide the app; with Shift or as Ctrl+Alt it is free for the help.
    if (key === 'H') return !(parts.includes('Shift') || (parts.includes('Ctrl') && parts.includes('Alt')));
    if (['Q', 'M', 'Space', 'Tab', '=', '-'].includes(key)) return true;
    // Y: Cmd/Ctrl+Y is redo or readline yank; with Shift or Alt it is free (Z with Shift stays redo).
    if (key === 'Y') return !parts.includes('Alt') && !parts.includes('Shift');
    if (['A', 'C', 'V', 'X', 'Z'].includes(key) && !parts.includes('Alt')) return true;
    return ['F4', 'Delete'].includes(key) && parts.includes('Alt');
  }
  function validate(bindings, platform = 'darwin') {
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) throw new Error('Die Tastenkürzel müssen als vollständige Belegung vorliegen.');
    const known = new Set(actions.map(action => action.id));
    for (const id of Object.keys(bindings)) if (!known.has(id)) throw new Error(`Unbekannte Tastenkürzel-Aktion „${id}“.`);
    const result = {};
    const used = new Map();
    for (const { id, label } of actions) {
      if (!Object.prototype.hasOwnProperty.call(bindings, id)) throw new Error(`Die Belegung für „${label}“ fehlt.`);
      if (!Array.isArray(bindings[id]) || bindings[id].length > 2) throw new Error(`„${label}“ benötigt eine Liste mit höchstens zwei Tastenkürzeln.`);
      result[id] = Array.from(bindings[id], input => {
        const combo = canonical(input);
        if (reserved(combo, platform)) throw new Error(`„${combo}“ ist für Bearbeitungs- oder Systemfunktionen reserviert.`);
        if (used.has(combo)) throw new Error(`Konflikt: „${combo}“ ist „${used.get(combo)}“ und „${label}“ zugewiesen.`);
        used.set(combo, label);
        return combo;
      });
    }
    return result;
  }
  function eventAccelerator(event) {
    if (!event || event.isComposing || event.getModifierState?.('AltGraph')) return null;
    let key = normalizeKey(event.key);
    // Prefer the actual layout's key. Physical codes are only a fallback for
    // shifted symbols (such as + or !) that have no standalone vocabulary key.
    const code = event.code || '';
    const codeKeys = { Comma: ',', Period: '.', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Slash: '/', Backquote: '`', Minus: '-', Equal: '=' };
    if (!key && (event.shiftKey || event.altKey)) {
      if (codeKeys[code]) key = codeKeys[code];
      else if (/^Digit[0-9]$/.test(code)) key = code.slice(-1);
    }
    if (!key || !modifiersSuffice({ Cmd: event.metaKey, Ctrl: event.ctrlKey, Alt: event.altKey, Shift: event.shiftKey }, key)) return null;
    return [event.metaKey && 'Cmd', event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+');
  }
  function format(accelerator) {
    if (!accelerator) return 'Nicht belegt';
    const symbols = { Cmd: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Space: 'Leertaste', Enter: '↵', Tab: '⇥', Backspace: '⌫', Delete: '⌦', Up: '↑', Down: '↓', Left: '←', Right: '→' };
    try { return canonical(accelerator).split('+').map(part => symbols[part] || part).join(' + '); } catch { return String(accelerator); }
  }
  let active = new Set(Object.values(defaults()).flat());
  function setBindings(bindings) {
    const validated = validate(bindings);
    active = new Set(Object.values(validated).flat());
    return validated;
  }
  function isHotkeyEvent(event) {
    const combo = eventAccelerator(event);
    return combo !== null && active.has(combo);
  }
  const api = { SLOTS, actions, disabled, defaults, validate, eventAccelerator, format, setBindings, keyForIndex, indexForKey, actionFor, indexForAction, targetFor, isHotkeyEvent, setLabel };
  // Developer version in Node (menus): its own labels come from the developer-only module.
  if (node && edition && edition.devFeatures && edition.devFeatures.applyHotkeyLabels) edition.devFeatures.applyHotkeyLabels(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckHotkeys = api;
})();
