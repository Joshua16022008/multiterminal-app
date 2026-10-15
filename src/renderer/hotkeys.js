'use strict';

// Shared by the renderer and main process: one vocabulary for menus and xterm.
(function () {
  const ACTION_PREFIX = 'focus-terminal:';
  const SLOTS = 10;
  const actions = [
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
    { id: 'task-link', label: 'Second-Brain-Aufgabe der Kachel' },
    { id: 'layout-start', label: 'Aufbau starten' },
    { id: 'layout-save', label: 'Aufbau speichern' },
    { id: 'qol-panel', label: 'Komfort-Einstellungen' },
    { id: 'auto-sort', label: 'Automatische Sortierung an/aus' },
    { id: 'pm-situation', label: 'Lagebild im Projektmanager ein/aus' },
    ...Array.from({ length: SLOTS }, (_, i) => ({ id: actionFor(i), label: `Terminal ${i + 1}` }))
  ];
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
    });
    for (let i = 0; i < SLOTS; i++) result[actionFor(i)] = platform === 'darwin' ? [`Cmd+${keyForIndex(i)}`, `Ctrl+${keyForIndex(i)}`] : [`Ctrl+${keyForIndex(i)}`];
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
    if (!key || (!seen.has('Cmd') && !seen.has('Ctrl'))) throw new Error(`Ungültiges Tastenkürzel „${accelerator}“: Cmd oder Ctrl und eine unterstützte Taste verwenden.`);
    return [...modifiers.filter(modifier => seen.has(modifier)), key].join('+');
  }
  function reserved(accelerator, platform) {
    if (platform === 'darwin' && ['Cmd+Alt+I', 'Cmd+Ctrl+F', 'Cmd+Alt+Shift+V'].includes(accelerator)) return true;
    if (platform !== 'darwin' && ['Ctrl+Shift+I', 'Ctrl+Shift+V'].includes(accelerator)) return true;
    const parts = accelerator.split('+');
    const key = parts.pop();
    // Keep standard editing, app/system management and zoom shortcuts intact.
    if (['Q', 'H', 'M', 'Space', 'Tab', '=', '-'].includes(key)) return true;
    if (['A', 'C', 'V', 'X', 'Z', 'Y'].includes(key) && !parts.includes('Alt')) return true;
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
    if (!key || (!event.metaKey && !event.ctrlKey)) return null;
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
  const api = { SLOTS, actions, defaults, validate, eventAccelerator, format, setBindings, keyForIndex, indexForKey, actionFor, indexForAction, targetFor, isHotkeyEvent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckHotkeys = api;
})();
