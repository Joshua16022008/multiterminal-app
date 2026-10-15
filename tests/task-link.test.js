'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { statusOf, chipText, filterTasks, shorten, dueText } = require('../src/renderer/task-link');

const task = (o = {}) => ({ id: 'a1', type: 'todo', title: 'Titel', space: 'Arbeit', dueDate: null, done: false, overdue: false, dueToday: false, ...o });

test('statusOf unterscheidet alle Zustände', () => {
  assert.equal(statusOf(null), 'loading');
  assert.equal(statusOf({ ok: false, offline: true }), 'offline');
  assert.equal(statusOf({ ok: false, offline: false }), 'error');
  assert.equal(statusOf({ ok: true, missing: true }), 'missing');
  assert.equal(statusOf({ ok: true, task: task() }), 'open');
  assert.equal(statusOf({ ok: true, task: task({ dueToday: true }) }), 'today');
  assert.equal(statusOf({ ok: true, task: task({ overdue: true, dueToday: true }) }), 'overdue');
  assert.equal(statusOf({ ok: true, task: task({ done: true, overdue: true }) }), 'done');
});

test('chipText: ohne Verknüpfung, geladen, offline, fehlend', () => {
  assert.equal(chipText(undefined, null), '+ Aufgabe');
  assert.equal(chipText('a1', { ok: true, task: task({ title: 'Kurz' }) }), 'Kurz');
  assert.ok(chipText('a1', { ok: true, task: task({ title: 'x'.repeat(80) }) }).length <= 28);
  assert.match(chipText('a1', { ok: false, offline: true }), /offline/);
  assert.match(chipText('a1', { ok: true, missing: true }), /fehlt/);
  assert.match(chipText('a1', null), /…/);
});

test('filterTasks: erledigte raus, Bereich und Text', () => {
  const tasks = [task({ id: 'a', title: 'Steuer machen' }), task({ id: 'b', title: 'Sport', space: 'Privat' }), task({ id: 'c', title: 'Steuer alt', done: true })];
  assert.deepEqual(filterTasks(tasks).map((t) => t.id), ['a', 'b']);
  assert.deepEqual(filterTasks(tasks, { space: 'Privat' }).map((t) => t.id), ['b']);
  assert.deepEqual(filterTasks(tasks, { query: ' STEUER ' }).map((t) => t.id), ['a']);
  assert.deepEqual(filterTasks(null), []);
});

test('shorten und dueText', () => {
  assert.equal(shorten('  a   b '), 'a b');
  assert.equal(dueText(task({ dueDate: '2026-10-20' })), '20.10.2026');
  assert.equal(dueText(task()), 'keine');
});
