'use strict';

// The public, storable part of a harness start: { harnessId, model?, endpointId? }.
// Shared by presets, session.json and terminals:create. Never a command line,
// environment, prompt, secret or keychain lookup: those are rebuilt in main.
const HARNESS_ID = /^[a-z][a-z0-9-]{0,63}$/;
const MODEL = /^[A-Za-z0-9._:/@\[\]+-]{1,200}$/;
const ENDPOINT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const KEYS = new Set(['harnessId', 'model', 'endpointId']);

// -> clean copy or null (invalid). Unknown fields make the whole value invalid
// rather than being dropped silently, so a tampered entry never starts.
function sanitizeLaunch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !KEYS.has(key))) return null;
  if (typeof value.harnessId !== 'string' || !HARNESS_ID.test(value.harnessId)) return null;
  const out = { harnessId: value.harnessId };
  if (value.model !== undefined && value.model !== null && value.model !== '') {
    if (typeof value.model !== 'string' || !MODEL.test(value.model)) return null;
    out.model = value.model;
  }
  if (value.endpointId !== undefined && value.endpointId !== null && value.endpointId !== '') {
    if (typeof value.endpointId !== 'string' || !ENDPOINT_ID.test(value.endpointId)) return null;
    out.endpointId = value.endpointId;
  }
  return out;
}

module.exports = { sanitizeLaunch, HARNESS_ID, MODEL, ENDPOINT_ID };
