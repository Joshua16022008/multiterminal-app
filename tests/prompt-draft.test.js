'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../src/renderer/prompt-draft');

function setup(extra = {}) {
  const a = { id: 'a', status: 'running', desc: { title: 'Alpha' }, project: { name: 'Projekt A' } };
  const b = { id: 'b', status: 'running', desc: { title: 'Beta' }, project: { name: 'Projekt B' } };
  const panes = new Map([['a', a], ['b', b]]);
  const writes = [];
  const c = createController({ getPane: id => panes.get(id), insert: (pane, text) => { writes.push([pane.id, text]); return true; }, ...extra });
  return { c, panes, writes, a, b };
}

test('opening, editing and cancelling a draft never writes to either terminal', () => {
  const { c, writes } = setup();
  c.open({ terminalId: 'a', text: 'Bitte prüfen', files: [{ path: '/tmp/Foto 1.png', kind: 'image' }] });
  c.updateText('Bearbeiteter Auftrag');
  assert.equal(c.get().text, 'Bearbeiteter Auftrag');
  assert.equal(c.get().targetLabel, 'Projekt A · Alpha');
  c.close();
  assert.equal(c.get(), null);
  assert.deepEqual(writes, []);
});

test('explicit insert targets the captured tile, quotes paths and adds no Enter', async () => {
  const { c, writes } = setup();
  c.open({ terminalId: 'b', text: 'Prüfe\ndas Bild', files: [{ path: "/tmp/a'$(touch nope).png", kind: 'image' }] });
  assert.equal(await c.insert(), true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'b');
  assert.ok(writes[0][1].startsWith('Prüfe das Bild '));
  assert.equal(writes[0][1], "Prüfe das Bild '/tmp/a'\"'\"'$(touch nope).png'");
  assert.doesNotMatch(writes[0][1], /[\r\n\x1b]/);
  assert.equal(c.get(), null);
});

test('closed and replaced target tiles cannot receive a previously prepared draft', async () => {
  for (const change of [panes => panes.delete('a'), panes => panes.set('a', { id: 'a', status: 'running' })]) {
    const { c, panes, writes } = setup();
    c.open({ terminalId: 'a', text: 'Nicht senden' });
    change(panes);
    assert.equal(await c.insert(), false);
    assert.deepEqual(writes, []);
    assert.match(c.get().error, /Terminal/);
  }
});

test('stopped targets, blank drafts, invalid controls and missing files remain editable', async () => {
  const { c, a, writes } = setup({ validateFiles: async () => { throw new Error('Datei nicht gefunden.'); } });
  c.open({ terminalId: 'a', text: '   ' });
  assert.equal(await c.insert(), false);
  assert.match(c.get().error, /Text|Datei/);
  c.updateText('Hallo\x1b[201~');
  assert.equal(await c.insert(), false);
  c.updateText('Gültig'); a.status = 'exited';
  assert.equal(await c.insert(), false);
  a.status = 'running'; c.addFiles([{ path: '/tmp/missing.pdf', kind: 'file' }]);
  assert.equal(await c.insert(), false);
  assert.match(c.get().error, /Datei nicht gefunden/);
  assert.deepEqual(writes, []);
});

test('file edits are copied, deduplicated and removable without changing caller data', () => {
  const { c } = setup();
  const files = [{ path: '/tmp/a.png', kind: 'image' }];
  c.open({ terminalId: 'a', files });
  files[0].path = '/tmp/changed.png';
  c.addFiles([{ path: '/tmp/a.png' }, { path: '/tmp/b.pdf' }]);
  assert.equal(c.get().files.length, 2);
  const copy = c.get(); copy.files[0].path = '/tmp/another.png';
  assert.equal(c.get().files[0].path, '/tmp/a.png');
  c.removeFile(0);
  assert.equal(c.get().files[0].path, '/tmp/b.pdf');
});

test('a second open does not discard an existing draft or change its target', () => {
  const { c } = setup();
  c.open({ terminalId: 'a', text: 'Ungespeicherter Auftrag' });
  assert.throws(() => c.open({ terminalId: 'b', text: 'Andere Aufgabe' }), /Vorschau/);
  assert.equal(c.get().terminalId, 'a');
});

test('cancelling or closing the target while validation is pending sends nothing', async () => {
  for (const cancel of [({ c }) => c.close(), ({ panes }) => panes.delete('a')]) {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const state = setup({ validateFiles: () => pending });
    state.c.open({ terminalId: 'a', text: 'Warten', files: [{ path: '/tmp/a.txt' }] });
    const insert = state.c.insert();
    cancel(state); finish();
    assert.equal(await insert, false);
    assert.deepEqual(state.writes, []);
  }
});

test('double insert during async validation produces exactly one write', async () => {
  let finish;
  const { c, writes } = setup({ validateFiles: () => new Promise(resolve => { finish = resolve; }) });
  c.open({ terminalId: 'a', text: 'Einmal', files: [{ path: '/tmp/a.txt' }] });
  const first = c.insert();
  assert.equal(await c.insert(), false);
  finish();
  assert.equal(await first, true);
  assert.equal(writes.length, 1);
});
