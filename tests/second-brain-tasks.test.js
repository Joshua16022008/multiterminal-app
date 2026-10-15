'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createSecondBrainTasks, resolveBaseUrl, DEFAULT_URL } = require('../src/main/second-brain-tasks');

const OPEN = [
  { id: 'abc123', type: 'todo', title: 'Erste', space: 'Arbeit', dueDate: '2026-10-20T10:00', priority: 'hoch', done: false, overdue: false, dueToday: true, secret: 'x' },
  { id: 'g1', type: 'goal', title: 'Ziel', space: 'Privat', done: false, steps: [{ a: 1 }] },
  { id: 'd1', type: 'daily', title: 'Routine', space: 'Arbeit' },
  { id: 'i1', type: 'idee', title: 'Idee' },
  { id: 'bad id!', type: 'todo', title: 'kaputt' },
  { id: 'done1', type: 'todo', title: 'Schon fertig', done: true },
  { id: 'long1', type: 'todo', title: 'x'.repeat(500), space: 'Fremd' },
];
const DONE = [{ id: 'old1', type: 'todo', title: 'Erledigt gestern', space: 'Schule', done: true }];

async function withServer(handler, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, origin: req.headers.origin });
    handler(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  try { await fn(baseUrl, seen); } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
}
const json = (res, data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const normal = (req, res) => json(res, req.url === '/api/todos' ? OPEN : req.url === '/api/todos/erledigt' ? DONE : {}, req.url.startsWith('/api/todos') ? 200 : 404);

test('list: nur todo/goal, bereinigt, offene zuerst', async () => {
  await withServer(normal, async (baseUrl) => {
    const r = await createSecondBrainTasks({ baseUrl }).list();
    assert.equal(r.ok, true);
    assert.deepEqual(r.tasks.map((t) => t.id), ['abc123', 'g1', 'long1', 'done1']);
    assert.deepEqual(Object.keys(r.tasks[0]).sort(), ['done', 'dueDate', 'dueToday', 'id', 'overdue', 'priority', 'space', 'title', 'type']);
    assert.equal(r.tasks[0].dueDate, '2026-10-20');
    const long = r.tasks.find((t) => t.id === 'long1');
    assert.equal(long.title.length, 200);
    assert.equal(long.space, '');
  });
});

test('get: offen, erledigt, fehlend', async () => {
  await withServer(normal, async (baseUrl) => {
    const s = createSecondBrainTasks({ baseUrl });
    assert.equal((await s.get('abc123')).task.title, 'Erste');
    const d = await s.get('old1');
    assert.equal(d.task.done, true);
    assert.equal(d.task.title, 'Erledigt gestern');
    assert.deepEqual(await s.get('nirgends'), { ok: true, missing: true });
  });
});

test('Dienst sendet nur GET und keinen Origin-Header', async () => {
  await withServer(normal, async (baseUrl, seen) => {
    const s = createSecondBrainTasks({ baseUrl });
    await s.list(); await s.get('old1');
    assert.ok(seen.length >= 3);
    for (const q of seen) { assert.equal(q.method, 'GET'); assert.equal(q.origin, undefined); }
  });
});

test('ungültige ID: kein Netzwerkzugriff', async () => {
  await withServer(normal, async (baseUrl, seen) => {
    const r = await createSecondBrainTasks({ baseUrl }).get('../etc');
    assert.equal(r.ok, false);
    assert.equal(seen.length, 0);
    assert.equal((await createSecondBrainTasks({ baseUrl }).get(42)).ok, false);
  });
});

test('Server aus: offline', async () => {
  const s = createSecondBrainTasks({ baseUrl: 'http://127.0.0.1:1' });
  for (const r of [await s.list(), await s.get('abc')]) {
    assert.equal(r.ok, false); assert.equal(r.offline, true); assert.match(r.error, /nicht erreichbar/);
  }
});

test('Timeout', async () => {
  await withServer(() => { /* antwortet nie */ }, async (baseUrl) => {
    const r = await createSecondBrainTasks({ baseUrl, timeoutMs: 80 }).list();
    assert.equal(r.ok, false); assert.equal(r.offline, true); assert.match(r.error, /Zeitüberschreitung/);
  });
});

test('kaputtes JSON, 403 und Nicht-Liste', async () => {
  await withServer((req, res) => { res.writeHead(200); res.end('<html>'); }, async (baseUrl) => {
    const r = await createSecondBrainTasks({ baseUrl }).list();
    assert.equal(r.ok, false); assert.equal(r.offline, false);
  });
  await withServer((req, res) => json(res, { error: 'Origin' }, 403), async (baseUrl) => {
    const r = await createSecondBrainTasks({ baseUrl }).list();
    assert.equal(r.ok, false); assert.equal(r.offline, false); assert.match(r.error, /403/);
  });
  await withServer((req, res) => json(res, { not: 'list' }), async (baseUrl) => {
    assert.equal((await createSecondBrainTasks({ baseUrl }).list()).ok, false);
  });
});

test('fetch-Ausnahme erreicht nie den Aufrufer', async () => {
  const s = createSecondBrainTasks({ fetchImpl: () => { throw new Error('boom'); } });
  assert.equal((await s.list()).ok, false);
});

test('resolveBaseUrl akzeptiert nur lokale Adressen mit Port', () => {
  assert.equal(resolveBaseUrl('http://127.0.0.1:5555/'), 'http://127.0.0.1:5555');
  assert.equal(resolveBaseUrl('http://localhost:5555'), 'http://localhost:5555');
  for (const bad of ['http://evil.example:80', 'https://127.0.0.1:5555', 'http://127.0.0.1', 'x', undefined, 5]) {
    assert.equal(resolveBaseUrl(bad), DEFAULT_URL);
  }
});
