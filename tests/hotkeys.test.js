'use strict';

const test = require('node:test');
const assert = require('node:assert');
const hk = require('../src/renderer/hotkeys.js');

test('positions 0..8 get keys 1..9 and position 9 gets 0', () => {
  assert.deepStrictEqual([0, 1, 8, 9].map(hk.keyForIndex), ['1', '2', '9', '0']);
});

test('only the first ten positions have a key', () => {
  for (const i of [-1, 10, 29, 1.5, NaN, '3', null]) assert.strictEqual(hk.keyForIndex(i), '');
});

test('keys map back to positions, 0 is the tenth tile', () => {
  assert.deepStrictEqual(['1', '5', '9', '0'].map(hk.indexForKey), [0, 4, 8, 9]);
  for (const k of ['a', '', '10', undefined, 5]) assert.strictEqual(hk.indexForKey(k), -1);
});

test('key and position are inverse for all ten slots', () => {
  for (let i = 0; i < 10; i++) assert.strictEqual(hk.indexForKey(hk.keyForIndex(i)), i);
});

test('actions round-trip and foreign actions are rejected', () => {
  assert.strictEqual(hk.actionFor(9), 'focus-terminal:0');
  assert.strictEqual(hk.actionFor(10), null);
  assert.strictEqual(hk.indexForAction('focus-terminal:3'), 2);
  for (const a of ['new-terminal', 'focus-terminal:', 'focus-terminal:x', null]) assert.strictEqual(hk.indexForAction(a), -1);
});

test('targetFor ignores numbers beyond the tiles of the project', () => {
  assert.strictEqual(hk.targetFor('focus-terminal:2', 5), 1);
  assert.strictEqual(hk.targetFor('focus-terminal:6', 5), -1);
  assert.strictEqual(hk.targetFor('focus-terminal:0', 10), 9);
  assert.strictEqual(hk.targetFor('focus-terminal:0', 9), -1);
  assert.strictEqual(hk.targetFor('focus-terminal:1', 0), -1);
});

test('shifted or alt digits are not hotkeys', () => {
  assert.strictEqual(hk.isHotkeyEvent({ ctrlKey: true, key: '1' }), true);
  assert.strictEqual(hk.isHotkeyEvent({ metaKey: true, key: '0' }), true);
  assert.strictEqual(hk.isHotkeyEvent({ ctrlKey: true, shiftKey: true, key: '1' }), false);
  assert.strictEqual(hk.isHotkeyEvent({ metaKey: true, altKey: true, key: '1' }), false);
  assert.strictEqual(hk.isHotkeyEvent({ key: '1' }), false);
  assert.strictEqual(hk.isHotkeyEvent({ ctrlKey: true, key: 'a' }), false);
});

test('full platform defaults preserve primary commands and ten terminal aliases', () => {
  // 31 Aktionen insgesamt; in der öffentlichen Version fehlen die der abgeschalteten Funktionen (task-link) in actions, stehen aber in disabled.
  assert.strictEqual(hk.actions.length + hk.disabled.length, 31);
  assert.deepStrictEqual(hk.defaults().settings, ['Cmd+,']);
  assert.deepStrictEqual(hk.defaults()['focus-terminal:0'], ['Cmd+0', 'Ctrl+0']);
  assert.deepStrictEqual(hk.defaults('linux')['focus-terminal:0'], ['Ctrl+0']);
  for (const platform of ['darwin', 'win32', 'linux']) assert.deepStrictEqual(hk.validate(hk.defaults(platform), platform), hk.defaults(platform));
  const copy = hk.defaults();
  copy.settings.push('Cmd+F1');
  assert.deepStrictEqual(hk.defaults().settings, ['Cmd+,']);
});

test('validation canonicalizes aliases and modifier order without changing input', () => {
  const input = hk.defaults();
  input.settings = ['shift+control+command+alt+f12'];
  const result = hk.validate(input);
  assert.deepStrictEqual(result.settings, ['Cmd+Ctrl+Alt+Shift+F12']);
  assert.deepStrictEqual(input.settings, ['shift+control+command+alt+f12']);
  input.settings = ['Ctrl+quote'];
  assert.deepStrictEqual(hk.validate(input).settings, ["Ctrl+'"]);
});

test('validation rejects incomplete, foreign, invalid and duplicate bindings', () => {
  for (const input of [null, [], 'Cmd+T', {}]) assert.throws(() => hk.validate(input));
  const missing = hk.defaults();
  delete missing.settings;
  assert.throws(() => hk.validate(missing), /fehlt/);
  assert.throws(() => hk.validate({ ...hk.defaults(), foreign: [] }), /Unbekannte/);
  for (const settings of [['T'], ['Alt+T'], ['Cmd+Cmd+T'], ['Cmd+F25'], ['Cmd++'], ['Cmd+Escape'], [null], ['Cmd+F1', 'Cmd+F2', 'Cmd+F3'], 'Cmd+T']) {
    assert.throws(() => hk.validate({ ...hk.defaults(), settings }));
  }
  assert.throws(() => hk.validate({ ...hk.defaults(), settings: ['command+t'] }), /Konflikt.*Neues Terminal/);
  assert.throws(() => hk.validate({ ...hk.defaults(), settings: ['Cmd+F1', 'Cmd+F1'] }), /Konflikt/);
});

test('standard editing, system management and zoom combinations remain reserved', () => {
  for (const combo of ['Cmd+C', 'Ctrl+V', 'Cmd+Shift+Z', 'Cmd+Q', 'Ctrl+Q', 'Cmd+H', 'Cmd+M', 'Cmd+Space', 'Cmd+Tab', 'Cmd+-', 'Ctrl+Shift+Equal', 'Ctrl+Alt+F4', 'Cmd+Alt+I', 'Ctrl+Cmd+F', 'Cmd+Ctrl+Space', 'Cmd+Alt+Shift+V']) {
    assert.throws(() => hk.validate({ ...hk.defaults(), settings: [combo] }), /reserviert/, combo);
  }
  for (const combo of ['Ctrl+Shift+I', 'Ctrl+Shift+V']) assert.throws(() => hk.validate({ ...hk.defaults('linux'), settings: [combo] }, 'linux'), /reserviert/);
  assert.deepStrictEqual(hk.validate({ ...hk.defaults(), settings: ['Cmd+Shift+T'] }).settings, ['Cmd+Shift+T']);
  assert.deepStrictEqual(hk.validate(hk.defaults())['focus-terminal:0'], ['Cmd+0', 'Ctrl+0']);
});

test('event accelerators handle modifiers, named keys and shifted punctuation', () => {
  assert.strictEqual(hk.eventAccelerator({ key: 't', metaKey: true, shiftKey: true }), 'Cmd+Shift+T');
  assert.strictEqual(hk.eventAccelerator({ key: 'ArrowDown', ctrlKey: true, altKey: true }), 'Ctrl+Alt+Down');
  assert.strictEqual(hk.eventAccelerator({ key: '+', code: 'Equal', metaKey: true, shiftKey: true }), 'Cmd+Shift+=');
  assert.strictEqual(hk.eventAccelerator({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+1');
  assert.strictEqual(hk.eventAccelerator({ key: ';', code: 'Comma', metaKey: true }), 'Cmd+;');
  assert.strictEqual(hk.eventAccelerator({ key: ';', code: 'Comma', metaKey: true, shiftKey: true }), 'Cmd+Shift+;');
  assert.strictEqual(hk.eventAccelerator({ key: ',', code: 'Semicolon', ctrlKey: true }), 'Ctrl+,');
  assert.strictEqual(hk.eventAccelerator({ key: ' ', ctrlKey: true }), 'Ctrl+Space');
  for (const event of [null, {}, { key: 'Shift', metaKey: true }, { key: 't' }, { key: 't', ctrlKey: true, isComposing: true }, { key: 't', ctrlKey: true, getModifierState: () => true }]) assert.strictEqual(hk.eventAccelerator(event), null);
});

test('remapping and disabling release old events, resetting restores defaults', () => {
  try {
    const bindings = hk.defaults();
    bindings['new-terminal'] = ['Cmd+Shift+N'];
    bindings['focus-terminal:1'] = [];
    hk.setBindings(bindings);
    assert.strictEqual(hk.isHotkeyEvent({ metaKey: true, key: 't' }), false);
    assert.strictEqual(hk.isHotkeyEvent({ metaKey: true, shiftKey: true, key: 'n' }), true);
    assert.strictEqual(hk.isHotkeyEvent({ metaKey: true, key: '1' }), false);
    assert.strictEqual(hk.isHotkeyEvent({ ctrlKey: true, key: '1' }), false);
    assert.throws(() => hk.setBindings({}));
    assert.strictEqual(hk.isHotkeyEvent({ metaKey: true, shiftKey: true, key: 'n' }), true);
  } finally { hk.setBindings(hk.defaults()); }
  assert.strictEqual(hk.isHotkeyEvent({ metaKey: true, key: 't' }), true);
  assert.strictEqual(hk.isHotkeyEvent({ ctrlKey: true, key: '1' }), true);
});

test('shortcut labels show modifier and key names clearly', () => {
  assert.strictEqual(hk.format('Cmd+Shift+T'), '⌘ + ⇧ + T');
  assert.strictEqual(hk.format('Ctrl+Down'), '⌃ + ↓');
  assert.strictEqual(hk.format(''), 'Nicht belegt');
});

test('new feature actions have conflict-free defaults on every platform', () => {
  const mac = hk.defaults('darwin'), linux = hk.defaults('linux');
  assert.deepStrictEqual(mac['diff-panel'], ['Cmd+Shift+D']);
  assert.deepStrictEqual(mac['pm-situation'], ['Cmd+\\']);
  assert.deepStrictEqual(linux['pm-situation'], ['Ctrl+Alt+\\'], 'Ctrl+Backslash stays SIGQUIT in terminals');
  assert.deepStrictEqual(linux['ports-panel'], ['Ctrl+Alt+P'], 'no clash with Ctrl+Shift+P (palette)');
  for (const platform of ['darwin', 'win32', 'linux']) {
    const all = Object.values(hk.defaults(platform)).flat();
    assert.strictEqual(new Set(all).size, all.length, platform + ': every combination used once');
  }
});

test('printing keys need Cmd or Ctrl; function keys also work with Shift or Alt', () => {
  const ev = (o) => ({ key: o.key, code: '', metaKey: !!o.meta, ctrlKey: !!o.ctrl, altKey: !!o.alt, shiftKey: !!o.shift, getModifierState: () => false });
  assert.strictEqual(hk.eventAccelerator(ev({ key: 'F5', shift: true })), 'Shift+F5');
  assert.strictEqual(hk.eventAccelerator(ev({ key: 'F6', alt: true })), 'Alt+F6');
  assert.strictEqual(hk.eventAccelerator(ev({ key: 'D', ctrl: true, shift: true })), 'Ctrl+Shift+D', 'Ctrl+Shift already worked');
  assert.strictEqual(hk.eventAccelerator(ev({ key: 'F5' })), null, 'a bare function key stays free for terminal programs');
  assert.strictEqual(hk.eventAccelerator(ev({ key: 'X', shift: true })), null, 'Shift+letter would swallow capital letters');
  assert.strictEqual(hk.eventAccelerator(ev({ key: 'x', alt: true })), null, 'Alt+letter would swallow special characters');
  const base = hk.defaults();
  assert.deepStrictEqual(hk.validate({ ...base, settings: ['shift+f5'] }).settings, ['Shift+F5']);
  assert.deepStrictEqual(hk.validate({ ...base, settings: ['Alt+Shift+F12'] }).settings, ['Alt+Shift+F12']);
  assert.throws(() => hk.validate({ ...base, settings: ['Shift+X'] }), /F1–F24/);
  assert.throws(() => hk.validate({ ...base, settings: ['F5'] }), /Ungültiges Tastenkürzel/);
  assert.throws(() => hk.validate({ ...base, settings: ['Alt+F4'] }), /reserviert/, 'Alt+F4 stays reserved');
});

test('Stammbaum and help get Cmd+Shift+Y / Cmd+Shift+H while hide, redo and yank stay reserved', () => {
  const mac = hk.defaults('darwin'), linux = hk.defaults('linux');
  assert.deepStrictEqual(mac['worktree-tree'], ['Cmd+Shift+Y']);
  assert.deepStrictEqual(mac.help, ['Cmd+Shift+H']);
  assert.deepStrictEqual(linux['worktree-tree'], ['Ctrl+Alt+Y']);
  assert.deepStrictEqual(linux.help, ['Ctrl+Alt+H']);
  for (const platform of ['darwin', 'win32', 'linux']) {
    const d = hk.defaults(platform);
    assert.deepStrictEqual(hk.validate(d, platform), d, platform + ' defaults pass reserved()');
    // the renderer validates with the default platform; these defaults must pass there too
    assert.deepStrictEqual(hk.validate(d), d, platform + ' defaults pass the renderer check');
  }
  for (const combo of ['Cmd+H', 'Cmd+Alt+H', 'Ctrl+H', 'Cmd+Y', 'Ctrl+Y', 'Cmd+Shift+Z', 'Ctrl+Shift+Z']) {
    assert.throws(() => hk.validate({ ...hk.defaults(), settings: [combo] }), /reserviert/, combo);
  }
  assert.strictEqual(hk.actions.find((a) => a.id === 'worktree-tree').label, 'Stammbaum / Arbeitskopien');
  assert.strictEqual(hk.actions.find((a) => a.id === 'help').label, 'Hilfe öffnen');
});
