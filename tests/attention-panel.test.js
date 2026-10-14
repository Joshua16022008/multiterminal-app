'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/renderer/attention-panel');

function h(tag, props = {}, ...children) {
  const el = {
    tag, ...props, children: children.flat().filter(Boolean), hidden: !!props.hidden, attrs: {},
    style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
    classList: { set: new Set(), toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); } },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
  };
  return el;
}
const all = (el) => [el, ...(el.children || []).flatMap(all)];
const text = (root) => all(root).map((e) => e.text || '').join('\n');

const NOW = 1_700_000_100_000;
const entry = (over) => ({ terminalId: 't1', projectId: 'p1', provider: 'claude', accountId: 'a', state: 'turn-complete', observedAt: NOW - 90_000, source: 'claude-hook:Stop', unread: true, ...over });

test('labels per state and per error type; no completion claims', () => {
  assert.equal(A.stateLabel(entry({ state: 'working' })), 'arbeitet');
  assert.equal(A.stateLabel(entry({ state: 'needs-input' })), 'wartet auf dich');
  assert.equal(A.stateLabel(entry({ state: 'turn-complete' })), 'Antwort fertig');
  assert.equal(A.stateLabel(entry({ state: 'error', errorType: 'rate_limit' })), 'Fehler: Kontingent erreicht');
  assert.equal(A.stateLabel(entry({ state: 'error', errorType: 'weird' })), 'Fehler: Unbekannter Fehler');
  assert.equal(A.stateLabel(entry({ state: 'unknown', source: 'claude-hook:SessionStart' })), 'bereit');
  assert.equal(A.stateLabel(entry({ state: 'unknown', source: 'x' })), 'Status unbekannt');
  assert.equal(A.stateLabel(null), 'Status unbekannt');
  for (const type of Object.keys(A.ERROR_LABELS)) assert.ok(A.errorLabel(type));
  const everything = Object.values(A.ERROR_LABELS).join(' ') + ['working', 'needs-input', 'turn-complete', 'error', 'unknown'].map((state) => A.stateLabel(entry({ state }))).join(' ');
  assert.doesNotMatch(everything, /erledigt|✓|abgenommen/i);
});

test('relative time', () => {
  assert.equal(A.relativeTime(NOW - 2000, NOW), 'gerade eben');
  assert.equal(A.relativeTime(NOW - 30_000, NOW), 'vor 30 s');
  assert.equal(A.relativeTime(NOW - 90_000, NOW), 'vor 1 Min.');
  assert.equal(A.relativeTime(NOW - 3 * 3_600_000, NOW), 'vor 3 Std.');
  assert.equal(A.relativeTime(NOW - 3 * 86_400_000, NOW), 'vor 3 T.');
  assert.equal(A.relativeTime(NOW + 5000, NOW), 'gerade eben'); // clock skew
  assert.equal(A.relativeTime(undefined, NOW), '');
});

test('sort: unread first, then newest; input untouched', () => {
  const list = [entry({ terminalId: 'a', unread: false, observedAt: 5 }), entry({ terminalId: 'b', unread: true, observedAt: 1 }), entry({ terminalId: 'c', unread: true, observedAt: 3 }), entry({ terminalId: 'd', unread: false, observedAt: 9 })];
  assert.deepEqual(A.sortEntries(list).map((e) => e.terminalId), ['c', 'b', 'd', 'a']);
  assert.equal(list[0].terminalId, 'a');
});

test('status dot follows the entry and hides without an agent', () => {
  const dot = A.createStatusDot({ h });
  assert.equal(dot.el.hidden, true);
  dot.update(entry({ state: 'needs-input' }));
  assert.equal(dot.el.hidden, false);
  assert.equal(dot.el.attrs['data-state'], 'needs-input');
  assert.equal(dot.el.style.props['--attn-color'], 'var(--warn)');
  assert.equal(dot.el.attrs.title, 'Claude: wartet auf dich');
  assert.ok(dot.el.classList.set.has('unread'));
  dot.update(entry({ state: 'working', unread: false }));
  assert.equal(dot.el.style.props['--attn-color'], 'var(--accent)');
  assert.ok(!dot.el.classList.set.has('unread'));
  dot.update(null);
  assert.equal(dot.el.hidden, true);
  assert.equal('title' in dot.el.attrs, false);
  assert.equal(A.stateColor('error'), 'var(--err)');
  assert.equal(A.stateColor('turn-complete'), 'var(--ok)');
  assert.equal(A.stateColor('nonsense'), 'var(--dim)');
});

function panel(over = {}) {
  const root = h('aside');
  const calls = { jump: [], read: 0, settings: [] };
  const p = A.createAttentionPanel({
    root, h, now: () => NOW,
    getLabel: (e) => (e.terminalId === 'gone' ? null : { project: 'Projekt <b>X</b>', number: 3, name: 'Server' }),
    onJump: (e) => calls.jump.push(e.terminalId), onMarkAllRead: () => { calls.read++; }, onSettings: (patch) => calls.settings.push(patch), ...over,
  });
  return { root, p, calls };
}

test('list shows project, tile number and name, agent, state, time; unread highlighted; text only', () => {
  const { root, p } = panel();
  p.update([entry({ terminalId: 'x', unread: false, observedAt: NOW - 1000 }), entry({ terminalId: 'y', state: 'needs-input', source: 'claude-hook:Notification' })], { statusEnabled: true });
  const t = text(root);
  assert.match(t, /Projekt <b>X<\/b> · Kachel 3 · Server/); // rendered as text, not as markup
  assert.match(t, /Claude · wartet auf dich/);
  assert.match(t, /vor 1 Min\./);
  assert.match(t, /1 ungelesen/);
  const rows = all(root).filter((e) => e.tag === 'button' && /attn-entry/.test(e.class || ''));
  assert.equal(rows[0]['data-terminal-id'], 'y'); // unread first
  assert.match(rows[0].class, /unread/);
  assert.doesNotMatch(rows[1].class, /unread/);
  assert.ok(all(root).every((e) => !('innerHTML' in e)));
});

test('click jumps to the tile; closed terminals cannot be jumped to', () => {
  const { root, p, calls } = panel();
  p.update([entry({ terminalId: 'x' }), entry({ terminalId: 'gone' })], { statusEnabled: true });
  const rows = all(root).filter((e) => e.tag === 'button' && /attn-entry/.test(e.class || ''));
  rows[0].onclick();
  assert.deepEqual(calls.jump, ['x']);
  const closed = rows.find((r) => r['data-terminal-id'] === 'gone');
  assert.equal(closed.disabled, true);
  assert.match(text(root), /Terminal nicht mehr geöffnet/);
});

test('mark-all button: enabled only with unread entries, calls back', () => {
  const { root, p, calls } = panel();
  p.update([entry({ unread: false })], { statusEnabled: true });
  const btn = () => all(root).find((e) => e.tag === 'button' && e.text === 'Alle gelesen');
  assert.equal(btn().disabled, true);
  p.update([entry({ unread: true })]);
  assert.equal(!!btn().disabled, false);
  btn().onclick();
  assert.equal(calls.read, 1);
});

test('settings: three switches, the explanation, the Codex note; extras need the main switch', () => {
  const { root, p, calls } = panel();
  p.update([], { statusEnabled: false, desktopNotification: false, sound: false });
  const t = text(root);
  assert.ok(t.includes(A.SETTINGS_HELP));
  assert.ok(t.includes('Codex: Status noch nicht unterstützt'));
  assert.match(t, /Der Agentenstatus ist ausgeschaltet\./);
  const boxes = all(root).filter((e) => e.type === 'checkbox');
  assert.equal(boxes.length, 3);
  assert.equal(!!boxes[0].disabled, false);
  assert.equal(boxes[1].disabled, true);
  assert.equal(boxes[2].disabled, true);
  boxes[0].onchange({ target: { checked: true } });
  assert.deepEqual(calls.settings, [{ statusEnabled: true }]);
  p.update([], { statusEnabled: true, sound: true });
  const on = all(root).filter((e) => e.type === 'checkbox');
  assert.equal(!!on[1].disabled, false);
  assert.equal(on[2].checked, true);
  assert.match(text(root), /Noch keine Agentensitzung gemeldet/);
});
