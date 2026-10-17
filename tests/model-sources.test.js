'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarnessCatalog } = require('../src/main/harness-catalog');
const { createModelSources, PUBLIC_SOURCES } = require('../src/main/model-sources');
const response = (data) => ({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify(data) });

test('models: construction and static sources perform no calls; opaque endpoint IDs stay local', async () => {
  const calls = [];
  const service = createModelSources({ catalog: createHarnessCatalog(), run: async (...args) => calls.push(args), fetch: async (...args) => calls.push(args) });
  assert.equal(calls.length, 0);
  assert.deepEqual(await service.models('claude', 'ep-custom'), { models: ['sonnet', 'opus', 'haiku'], source: 'static' });
  assert.deepEqual(await service.models('gemini', 'https://evil.test'), { models: [], source: 'static' });
  assert.equal(calls.length, 0);
  assert.match((await service.models('unknown')).error, /Freitext/);
});

test('models: on-demand query executes argv directly and accepts only model grammar', async () => {
  const calls = [];
  const service = createModelSources({ catalog: createHarnessCatalog(), run: async (...args) => {
    calls.push(args); return { stdout: 'p/model\np/model\n p/model:latest \nunsafe model\n$(bad)\n' };
  } });
  assert.equal(calls.length, 0);
  assert.deepEqual(await service.models('opencode'), { models: ['p/model', 'p/model:latest'], source: 'query' });
  assert.deepEqual(calls[0].slice(0, 2), ['opencode', ['models']]);
  assert.ok(calls[0][2].timeout <= 10000);
  assert.equal(calls[0][2].shell, undefined);
});

test('models: public sources have fixed URLs, no credentials or redirects, filtered lists', async () => {
  const calls = [];
  const service = createModelSources({ catalog: createHarnessCatalog(), fetch: async (url, options) => {
    calls.push({ url, options });
    return response(url === PUBLIC_SOURCES.ollama ? { models: [{ name: 'llama:latest' }, { name: 'bad x' }] } : { data: [{ id: 'org/model' }, { id: 'org/model' }] });
  } });
  assert.deepEqual(await service.models('codex', 'ollama'), { models: ['llama:latest'], source: 'ollama' });
  assert.deepEqual(await service.models('claude', 'openrouter'), { models: ['org/model'], source: 'openrouter' });
  assert.deepEqual(calls.map((c) => c.url), Object.values(PUBLIC_SOURCES));
  for (const { options } of calls) { assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, undefined); assert.ok(options.signal); }
});

test('models: saved Ollama and OpenRouter endpoints resolve only on explicit refresh without key access', async () => {
  const requests = [], lookups = [];
  const saved = {
    'ep-ollama': { id: 'ep-ollama', type: 'ollama', baseUrl: 'http://192.168.1.20:11434/v1' },
    'ep-router': { id: 'ep-router', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
    'ep-moonshot': { id: 'ep-moonshot', type: 'openai', baseUrl: 'https://api.moonshot.ai/v1' },
  };
  const endpoints = { get: async (id) => { lookups.push(id); return saved[id] || null; }, keychain: { get: () => assert.fail('no key access') } };
  const service = createModelSources({ catalog: createHarnessCatalog(), endpoints, fetch: async (url, options) => {
    requests.push({ url, options });
    return response(url.includes('openrouter') ? { data: [{ id: 'org/model' }] } : { models: [{ name: 'local:latest' }] });
  } });
  assert.equal(lookups.length, 0); assert.equal(requests.length, 0);
  assert.deepEqual(await service.models('codex', 'ep-ollama'), { models: ['local:latest'], source: 'ollama' });
  assert.deepEqual(await service.models('claude', 'ep-router'), { models: ['org/model'], source: 'openrouter' });
  assert.deepEqual(requests.map((request) => request.url), ['http://192.168.1.20:11434/api/tags', PUBLIC_SOURCES.openrouter]);
  assert.deepEqual(await service.models('claude', 'ep-moonshot'), { models: ['sonnet', 'opus', 'haiku'], source: 'static' });
  assert.deepEqual(await service.models('claude', 'ep-unknown'), { models: ['sonnet', 'opus', 'haiku'], source: 'static' });
  assert.deepEqual(await service.models('claude', 'http://evil.test'), { models: ['sonnet', 'opus', 'haiku'], source: 'static' });
  assert.deepEqual(lookups, ['ep-ollama', 'ep-router', 'ep-moonshot', 'ep-unknown']);
  assert.equal(requests.length, 2);
  for (const { options } of requests) { assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.deepEqual(options.headers, { Accept: 'application/json' }); }
});

test('models: saved endpoint validation blocks credentials, controls, non-HTTP, query tokens and spoofed OpenRouter hosts', async () => {
  for (const baseUrl of ['http://user:FAKE_SECRET@localhost:11434', 'file:///etc/passwd', 'http://localhost:11434/?token=FAKE_SECRET', 'http://localhost:11434/#fragment', 'http://localhost:11434/\nsecret']) {
    let called = false;
    const endpoints = { get: async () => ({ type: 'ollama', baseUrl }) };
    const service = createModelSources({ catalog: createHarnessCatalog(), endpoints, fetch: async () => { called = true; } });
    const result = await service.models('claude', 'ep-invalid');
    assert.match(result.error, /Freitext/); assert.equal(JSON.stringify(result).includes('FAKE_SECRET'), false); assert.equal(called, false);
  }
  for (const baseUrl of ['https://openrouter.ai.evil.test/api/v1', 'https://evil.test/openrouter.ai', 'http://openrouter.ai/api/v1', 'https://openrouter.ai:8443/api/v1']) {
    let called = false;
    const endpoints = { get: async () => ({ type: 'openai', baseUrl }) };
    const service = createModelSources({ catalog: createHarnessCatalog(), endpoints, fetch: async () => { called = true; } });
    assert.equal((await service.models('claude', 'ep-spoofed')).source, 'static'); assert.equal(called, false);
  }
});

test('models: saved metadata errors return sanitized fallback and no HTTP request', async () => {
  let called = false;
  const endpoints = { get: async () => { throw new Error('FAKE_PRIVATE_METADATA'); } };
  const service = createModelSources({ catalog: createHarnessCatalog(), endpoints, fetch: async () => { called = true; } });
  const result = await service.models('claude', 'ep-broken');
  assert.deepEqual(result.models, ['sonnet', 'opus', 'haiku']); assert.match(result.error, /Freitext/);
  assert.equal(JSON.stringify(result).includes('FAKE_PRIVATE_METADATA'), false); assert.equal(called, false);
});

test('models: subprocess/HTTP failures keep fallback and never disclose error detail', async () => {
  const secret = 'FAKE_PROVIDER_SECRET';
  for (const run of [async () => { throw new Error(secret); }, async () => ({ stdout: secret, code: 1 })]) {
    const result = await createModelSources({ catalog: createHarnessCatalog(), run }).models('opencode');
    assert.equal(result.source, 'query'); assert.match(result.error, /Freitext/); assert.equal(JSON.stringify(result).includes(secret), false);
  }
  for (const fetch of [async () => { throw new Error(secret); }, async () => ({ ...response({}), ok: false }), async () => response({ models: 'bad' }), async () => ({ ...response({}), text: async () => 'x'.repeat(2 * 1024 * 1024 + 1) })]) {
    const result = await createModelSources({ catalog: createHarnessCatalog(), fetch }).models('claude', 'ollama');
    assert.deepEqual(result.models, ['sonnet', 'opus', 'haiku']);
    assert.match(result.error, /Freitext/); assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('models: catalog query cannot redirect process execution to another binary', async () => {
  let called = false;
  const catalog = { get: () => ({ binary: 'opencode', model: { static: [], query: { argv: ['curl', 'https://evil.test'], parse: 'lines' } } }) };
  const service = createModelSources({ catalog, run: async () => { called = true; } });
  assert.match((await service.models('opencode')).error, /Freitext/); assert.equal(called, false);
});

test('models: hanging HTTP body is aborted by the overall deadline', async () => {
  const fetch = async () => ({ ok: true, text: () => new Promise(() => {}) });
  assert.match((await createModelSources({ catalog: createHarnessCatalog(), fetch }).models('codex', 'ollama')).error, /Freitext/);
});

test('models: streamed HTTP bodies enforce byte budget while reading and cancel without text buffering', async () => {
  let reads = 0, cancelled = false, signal;
  const reader = {
    read: async () => { reads++; return { done: false, value: new Uint8Array(512 * 1024) }; },
    cancel: async () => { cancelled = true; }, releaseLock() {},
  };
  const fetch = async (_, options) => {
    signal = options.signal;
    return { ok: true, body: { getReader: () => reader }, text: () => assert.fail('must stream real bodies') };
  };
  const result = await createModelSources({ catalog: createHarnessCatalog(), fetch }).models('codex', 'ollama');
  assert.match(result.error, /Freitext/); assert.equal(reads, 5); assert.equal(cancelled, true); assert.equal(signal.aborted, true);
});

test('models: streamed JSON assembles UTF-8 across chunks and releases its reader', async () => {
  const bytes = Buffer.from(JSON.stringify({ models: [{ name: 'local:latest' }] }));
  const chunks = [bytes.subarray(0, 7), bytes.subarray(7)];
  let released = false, cancelled = false;
  const fetch = async () => ({ ok: true, body: { getReader: () => ({
    read: async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true },
    cancel: async () => { cancelled = true; }, releaseLock: () => { released = true; },
  }) } });
  assert.deepEqual(await createModelSources({ catalog: createHarnessCatalog(), fetch }).models('codex', 'ollama'), { models: ['local:latest'], source: 'ollama' });
  assert.equal(released, true); assert.equal(cancelled, false);
});

test('models: a hanging stream read is aborted and cancelled by the body deadline', async () => {
  let cancelled = false, signal;
  const fetch = async (_, options) => {
    signal = options.signal;
    return { ok: true, body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => { cancelled = true; }, releaseLock() {} }) } };
  };
  const result = await createModelSources({ catalog: createHarnessCatalog(), fetch }).models('codex', 'ollama');
  assert.match(result.error, /Freitext/); assert.equal(signal.aborted, true); assert.equal(cancelled, true);
});
