'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeHookEvent, createAgentStatusStore, createAgentSettings } = require('../src/main/agent-events');

const META = { projectId: 'p1', accountId: 'a1', provider: 'claude' };
const T0 = 1_700_000_000_000;

function clockStore(opts = {}) {
  let t = T0;
  const store = createAgentStatusStore({ now: () => t, ...opts });
  return { store, set: (v) => { t = v; }, advance: (ms) => { t += ms; }, now: () => t };
}
function hook(store, id, name, extra = {}, at, options) {
  return store.ingest(id, { hook_event_name: name, ...(at === undefined ? {} : { at }), ...extra }, META, options);
}

test('every hook event maps to its state; other notifications carry no status', () => {
  const n = (args) => normalizeHookEvent(args, META, 't1', T0);
  assert.equal(n({ hook_event_name: 'UserPromptSubmit' }).state, 'working');
  assert.equal(n({ hook_event_name: 'Stop' }).state, 'turn-complete');
  assert.equal(n({ hook_event_name: 'PermissionRequest' }).state, 'needs-input');
  for (const type of ['permission_prompt', 'elicitation_dialog', 'agent_needs_input']) {
    assert.equal(n({ hook_event_name: 'Notification', notification_type: type }).state, 'needs-input');
  }
  assert.equal(n({ hook_event_name: 'Notification', notification_type: 'auth_success' }), null);
  assert.equal(n({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }), null);
  assert.equal(n({ hook_event_name: 'Notification' }), null);
  assert.equal(n({ hook_event_name: 'PreToolUse' }), null);
  assert.equal(n(null), null);
  const err = n({ hook_event_name: 'StopFailure', error: 'rate_limit' });
  assert.equal(err.state, 'error');
  assert.equal(err.errorType, 'rate_limit');
  assert.equal(n({ hook_event_name: 'StopFailure', error: '<script>' }).errorType, 'unknown');
  assert.equal(n({ hook_event_name: 'StopFailure' }).errorType, 'unknown');
  const start = n({ hook_event_name: 'SessionStart', session_id: 'abc' });
  assert.equal(start.state, 'unknown');
  assert.equal(start.nativeSessionId, 'abc');
  assert.equal(n({ hook_event_name: 'SessionEnd' }).ended, true);
});

test('event follows the contract shape and takes metadata from the caller', () => {
  const e = normalizeHookEvent({ hook_event_name: 'Stop', session_id: 's-1' }, META, 7, T0);
  assert.deepEqual(e, {
    terminalId: '7', projectId: 'p1', provider: 'claude', accountId: 'a1', nativeSessionId: 's-1',
    state: 'turn-complete', observedAt: T0, source: 'claude-hook:Stop',
  });
  const bare = normalizeHookEvent({ hook_event_name: 'Stop' }, {}, 't', T0);
  assert.equal(bare.projectId, null);
  assert.equal(bare.accountId, null);
  assert.equal('nativeSessionId' in bare, false);
});

test('client time is used only inside a plausible window', () => {
  const at = (v) => normalizeHookEvent({ hook_event_name: 'Stop', at: v }, META, 't', T0).observedAt;
  assert.equal(at(T0 - 500), T0 - 500);
  assert.equal(at(T0 + 10_000), T0);
  assert.equal(at(T0 - 3_600_000), T0);
  assert.equal(at('x'), T0);
});

test('prompt - working - answer - error chain reaches the right terminal only', () => {
  const { store, advance } = clockStore();
  hook(store, 'a', 'SessionStart', { session_id: 's1' });
  advance(100); hook(store, 'a', 'UserPromptSubmit');
  advance(100); hook(store, 'b', 'UserPromptSubmit');
  assert.equal(store.get('a').state, 'working');
  advance(5000); const r = hook(store, 'a', 'Stop');
  assert.equal(r.notify, true);
  assert.equal(store.get('a').state, 'turn-complete');
  assert.equal(store.get('a').unread, true);
  assert.equal(store.get('a').nativeSessionId, 's1');
  assert.equal(store.get('b').state, 'working');
  assert.equal(store.get('b').unread, false);
  advance(5000); hook(store, 'b', 'StopFailure', { error: 'overloaded' });
  assert.equal(store.get('b').state, 'error');
  assert.equal(store.get('b').errorType, 'overloaded');
  assert.equal(store.unreadCount(), 2);
});

test('unknown stays unknown: session start alone is not a result, silence changes nothing', () => {
  const { store, advance } = clockStore();
  hook(store, 'a', 'SessionStart', { session_id: 's1' });
  advance(10 * 60 * 1000);
  assert.equal(store.get('a').state, 'unknown');
  assert.equal(store.get('a').unread, false);
  assert.equal(store.get('nobody'), null);
});

test('a waiting terminal is unread; typing answers it', () => {
  const { store, advance } = clockStore();
  hook(store, 'a', 'UserPromptSubmit');
  advance(1000); hook(store, 'a', 'Notification', { notification_type: 'permission_prompt' });
  assert.equal(store.get('a').state, 'needs-input');
  assert.equal(store.get('a').unread, true);
  advance(1000); assert.equal(store.userInput('a'), true);
  assert.equal(store.get('a').state, 'working');
  assert.equal(store.get('a').unread, false);
  assert.equal(store.userInput('a'), false); // working: input changes nothing
  hook(store, 'b', 'Stop');
  assert.equal(store.userInput('b'), false); // turn-complete is not a question
  assert.equal(store.get('b').state, 'turn-complete');
});

test('stale events are dropped, duplicates collapse, newer ones win', () => {
  const { store, advance, now } = clockStore();
  hook(store, 'a', 'Stop', {}, now());
  const base = now();
  assert.equal(hook(store, 'a', 'UserPromptSubmit', {}, base - 400).changed, false); // older than the state
  assert.equal(store.get('a').state, 'turn-complete');
  advance(300); const dup = hook(store, 'a', 'Stop', {}, now());
  assert.equal(dup.changed, false);
  assert.equal(dup.notify, false);
  assert.equal(store.get('a').observedAt, base);
  advance(10_000); assert.equal(hook(store, 'a', 'Stop', {}, now()).changed, true); // late repeat counts again
  advance(100); assert.equal(hook(store, 'a', 'UserPromptSubmit', {}, now()).changed, true);
});

test('permission prompt followed by its notification notifies once', () => {
  const { store, advance } = clockStore();
  const calls = [];
  store.subscribe((l) => calls.push(l.length));
  const a = hook(store, 'a', 'PermissionRequest');
  advance(50); const b = hook(store, 'a', 'Notification', { notification_type: 'permission_prompt' });
  assert.equal(a.notify, true);
  assert.equal(b.notify, false);
  assert.equal(calls.length, 1);
});

test('a visible, focused tile stays read and silent', () => {
  const { store } = clockStore();
  const r = hook(store, 'a', 'Stop', {}, undefined, { visible: true });
  assert.equal(r.changed, true);
  assert.equal(r.notify, false);
  assert.equal(store.get('a').unread, false);
  assert.equal(store.get('a').state, 'turn-complete');
});

test('closed terminal and session end remove the entry; a late event after close creates a new one only from a session start', () => {
  const { store, advance } = clockStore();
  hook(store, 'a', 'Stop');
  hook(store, 'b', 'Stop');
  assert.equal(store.terminalClosed('a'), true);
  assert.equal(store.terminalClosed('a'), false);
  assert.equal(store.get('a'), null);
  advance(100); assert.equal(hook(store, 'b', 'SessionEnd').changed, true);
  assert.equal(store.get('b'), null);
  assert.equal(hook(store, 'b', 'SessionEnd').changed, false);
  assert.deepEqual(store.list(), []);
});

test('session start must not wipe a running turn (compact), but clears an old result', () => {
  const { store, advance } = clockStore();
  hook(store, 'a', 'UserPromptSubmit');
  advance(5000); hook(store, 'a', 'SessionStart', { session_id: 'new' });
  assert.equal(store.get('a').state, 'working');
  assert.equal(store.get('a').nativeSessionId, 'new');
  advance(5000); hook(store, 'a', 'Stop');
  advance(5000); hook(store, 'a', 'SessionStart', { session_id: 'next' });
  assert.equal(store.get('a').state, 'unknown');
  assert.equal(store.get('a').unread, false);
});

test('markRead, markAllRead and list order (unread first, then newest)', () => {
  const { store, advance } = clockStore();
  hook(store, 'a', 'Stop');
  advance(1000); hook(store, 'b', 'UserPromptSubmit');
  advance(1000); hook(store, 'c', 'Stop');
  assert.deepEqual(store.list().map((e) => e.terminalId), ['c', 'a', 'b']);
  assert.equal(store.markRead('a'), true);
  assert.equal(store.markRead('a'), false);
  assert.deepEqual(store.list().map((e) => e.terminalId), ['c', 'b', 'a']);
  assert.equal(store.markAllRead(), true);
  assert.equal(store.markAllRead(), false);
  assert.equal(store.unreadCount(), 0);
});

test('a throwing listener does not break the store; unsubscribe works', () => {
  const { store } = clockStore();
  store.subscribe(() => { throw new Error('x'); });
  let n = 0;
  const off = store.subscribe(() => { n++; });
  hook(store, 'a', 'Stop');
  off();
  hook(store, 'b', 'Stop');
  assert.equal(n, 1);
  assert.equal(store.list().length, 2);
});

test('list returns copies', () => {
  const { store } = clockStore();
  hook(store, 'a', 'Stop');
  store.list()[0].unread = false;
  assert.equal(store.get('a').unread, true);
});

test('settings default to off; switching on writes the hooks file, off removes it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-ae-'));
  try {
    const mtEventPath = path.join(dir, 'with space', 'bin', 'mt-event');
    const s = createAgentSettings({ dataDir: dir, mtEventPath });
    assert.deepEqual(s.get(), { statusEnabled: false, desktopNotification: false, sound: false, hooksFile: s.hooksFile });
    s.sync();
    assert.equal(fs.existsSync(s.hooksFile), false);
    s.set({ statusEnabled: true, sound: true, bogus: true });
    assert.equal(fs.existsSync(s.hooksFile), true);
    const hooks = JSON.parse(fs.readFileSync(s.hooksFile, 'utf8')).hooks;
    assert.match(hooks.Stop[0].hooks[0].command, /with space\/bin\/mt-event' Stop$/);
    assert.equal(s.get().sound, true);
    assert.equal('bogus' in s.get(), false);
    // a second instance (app restart) sees the stored switches
    assert.equal(createAgentSettings({ dataDir: dir, mtEventPath }).get().statusEnabled, true);
    s.set({ statusEnabled: false });
    assert.equal(fs.existsSync(s.hooksFile), false);
    assert.equal(s.get().sound, true);
    fs.writeFileSync(s.settingsFile, '{broken');
    assert.equal(s.get().statusEnabled, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sync removes a leftover hooks file when the stored switch is off', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-ae-'));
  try {
    const s = createAgentSettings({ dataDir: dir, mtEventPath: path.join(dir, 'bin', 'mt-event') });
    fs.writeFileSync(s.hooksFile, '{}');
    s.sync();
    assert.equal(fs.existsSync(s.hooksFile), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
