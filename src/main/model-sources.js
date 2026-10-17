'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { isValidModel } = require('./harness-catalog');
const runFile = promisify(execFile);
const PUBLIC_SOURCES = Object.freeze({
  ollama: 'http://127.0.0.1:11434/api/tags',
  openrouter: 'https://openrouter.ai/api/v1/models',
});
const LIMIT = 2 * 1024 * 1024;
const TIMEOUT = 5000;
const cleanModels = (items) => [...new Set(items.filter(isValidModel))].slice(0, 2000);

function endpointSource(endpoint) {
  if (!endpoint || typeof endpoint.baseUrl !== 'string' || endpoint.baseUrl.length > 2000
    || /[\x00-\x20\x7f]/.test(endpoint.baseUrl)) throw new Error('Ungültiger gespeicherter Endpunkt');
  const url = new URL(endpoint.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Ungültiger gespeicherter Endpunkt');
  if (endpoint.type === 'ollama') return { source: 'ollama', url: new URL('/api/tags', url).href };
  if (url.origin === 'https://openrouter.ai') return { source: 'openrouter', url: PUBLIC_SOURCES.openrouter };
  return null;
}

// No work during construction/listing. models() is the user's explicit refresh.
// endpointId is an opaque saved ID, never a URL and never sent over the network.
function createModelSources({ catalog, endpoints, run = runFile, fetch: fetcher = globalThis.fetch } = {}) {
  async function publicModels(source, url) {
    const controller = new AbortController();
    let timer, reader, complete = false;
    try {
      const response = await Promise.race([
        fetcher(url, { method: 'GET', signal: controller.signal, redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' } }),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Zeitüberschreitung')); }, TIMEOUT); }),
      ]);
      if (!response.ok || Number(response.headers?.get?.('content-length') || 0) > LIMIT) throw new Error('Modellliste nicht verfügbar');
      const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Zeitüberschreitung')), { once: true }));
      let body;
      if (typeof response.body?.getReader === 'function') {
        reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        for (;;) {
          const { done, value } = await Promise.race([reader.read(), aborted]);
          if (done) { complete = true; break; }
          if (!(value instanceof Uint8Array) || size + value.byteLength > LIMIT) {
            controller.abort();
            throw new Error('Modellliste zu groß');
          }
          size += value.byteLength;
          chunks.push(Buffer.from(value));
        }
        body = Buffer.concat(chunks, size).toString('utf8');
      } else {
        // Compatibility for injected test doubles; real fetch Responses expose
        // a reader and are bounded before the complete body enters memory.
        body = await Promise.race([response.text(), aborted]);
      }
      if (Buffer.byteLength(body, 'utf8') > LIMIT) throw new Error('Modellliste zu groß');
      const data = JSON.parse(body);
      const rows = source === 'ollama' ? data.models : data.data;
      if (!Array.isArray(rows)) throw new Error('Ungültige Modellliste');
      return cleanModels(rows.slice(0, 10000).map((item) => source === 'ollama' ? item?.name : item?.id));
    } finally {
      clearTimeout(timer); controller.abort();
      if (reader) {
        if (!complete) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} }
        try { reader.releaseLock(); } catch {}
      }
    }
  }
  return {
    async models(harnessId, endpointId) {
      const entry = catalog.get(harnessId);
      if (!entry) return { models: [], source: 'static', error: 'Harness nicht gefunden. Freitext bleibt möglich.' };
      const fallback = cleanModels(entry.model?.static || []);
      const query = entry.model?.query;
      let source = query ? 'query' : 'static';
      let timer;
      try {
        const selector = typeof endpointId === 'string' && Object.hasOwn(PUBLIC_SOURCES, endpointId) ? endpointId
          : query && Object.hasOwn(PUBLIC_SOURCES, query.parse) ? query.parse : null;
        let target = selector ? { source: selector, url: PUBLIC_SOURCES[selector] } : null;
        if (!selector && endpoints && typeof endpointId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(endpointId)) {
          const stored = await Promise.race([
            endpoints.get(endpointId),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Zeitüberschreitung')), TIMEOUT); }),
          ]);
          clearTimeout(timer); timer = null;
          if (stored) target = endpointSource(stored);
        }
        if (target) source = target.source;
        if (!target && !query) return { models: fallback, source: 'static' };
        let values;
        if (target) values = await publicModels(target.source, target.url);
        else {
          if (!Array.isArray(query.argv) || query.argv[0] !== entry.binary || query.argv.some((arg) => typeof arg !== 'string' || /[{}\x00-\x1f\x7f]/.test(arg))) throw new Error('Ungültige Modellabfrage');
          const result = await Promise.race([
            run(query.argv[0], query.argv.slice(1), { timeout: TIMEOUT, maxBuffer: LIMIT, encoding: 'utf8', windowsHide: true }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Zeitüberschreitung')), TIMEOUT); }),
          ]);
          if ((result?.exitCode ?? result?.status ?? result?.code ?? 0) !== 0) throw new Error('Modellabfrage fehlgeschlagen');
          const output = String(result?.stdout || '');
          if (Buffer.byteLength(output, 'utf8') > LIMIT) throw new Error('Modellliste zu groß');
          values = cleanModels(output.split(/\r?\n/).map((line) => line.trim()));
        }
        return { models: values, source };
      } catch {
        // CLI/HTTP errors can contain tokens or endpoint details. Never forward them.
        return { models: fallback, source, error: 'Modellliste konnte nicht geladen werden. Freitext bleibt möglich.' };
      } finally { clearTimeout(timer); }
    },
  };
}

module.exports = { createModelSources, PUBLIC_SOURCES };
