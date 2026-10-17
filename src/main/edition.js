'use strict';

// Edition of this checkout: the developer version ("dev") or the public version ("public").
// edition.json in the app root decides; without it the app is the developer version with
// today's values. Developer-only parts live in dev-features.js (and the modules it loads);
// a public export leaves those files out, so every feature also needs its module to exist.
//
//   edition.json: { "edition": "public", "appName": "Multiterminal", "bundleId": "io.github.multiterminal" }
//
// MULTITERMINAL_EDITION_FILE points to another edition.json (tests and QA only).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.join(ROOT, 'edition.json');
const EDITIONS = ['dev', 'public'];
const FEATURES = ['dictation', 'taskLink', 'secondBrain'];
const APP_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,62}$/;
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const PUBLIC_DEFAULTS = Object.freeze({ appName: 'Multiterminal', bundleId: 'io.github.multiterminal' });

// Developer-only module, or null when it was left out (public export).
function loadDevFeatures(load = () => require('./dev-features')) {
  try { return load(); } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && /dev-features/.test(String(err.message))) return null;
    throw err;
  }
}

function readFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return { raw: null };
    return { raw: {}, warning: `edition.json nicht lesbar: ${err.message}` };
  }
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { raw: {}, warning: 'edition.json muss ein Objekt sein.' };
    return { raw };
  } catch (err) { return { raw: {}, warning: `edition.json ist kein gültiges JSON: ${err.message}` }; }
}

// raw: parsed edition.json (null = no file); dev: dev-features module or null.
// A broken or unknown file never switches the developer features on.
function resolveEdition({ raw = null, dev = null } = {}) {
  const devDefaults = (dev && dev.EDITION) || {};
  const name = raw === null ? (dev ? 'dev' : 'public') : (EDITIONS.includes(raw.edition) ? raw.edition : 'public');
  const base = name === 'dev' ? { ...PUBLIC_DEFAULTS, ...devDefaults } : PUBLIC_DEFAULTS;
  const wanted = (raw && raw.features && typeof raw.features === 'object') ? raw.features : {};
  const features = {};
  for (const key of FEATURES) {
    const on = name === 'dev' && Boolean(dev) && Boolean(devDefaults.features && devDefaults.features[key]);
    features[key] = on && wanted[key] !== false;
  }
  const appName = raw && typeof raw.appName === 'string' && APP_NAME.test(raw.appName) ? raw.appName : base.appName;
  const bundleId = raw && typeof raw.bundleId === 'string' && BUNDLE_ID.test(raw.bundleId) ? raw.bundleId : base.bundleId;
  return Object.freeze({ edition: name, appName, bundleId, features: Object.freeze(features) });
}

function createEdition({ file = process.env.MULTITERMINAL_EDITION_FILE || FILE, dev = loadDevFeatures() } = {}) {
  const { raw, warning } = readFile(file);
  if (warning) console.error(warning);
  const info = resolveEdition({ raw, dev });
  const devFeatures = info.edition === 'dev' ? dev : null;
  return {
    ...info,
    devFeatures,
    isPublic: () => info.edition === 'public',
    isDev: () => info.edition === 'dev',
    // Sent to the page (preload): only names and switches, no paths.
    publicInfo: () => ({ edition: info.edition, appName: info.appName, features: { ...info.features } }),
    // Folder for new clones: the developer's project folder, otherwise a plain folder in the home directory.
    cloneDir(home = os.homedir()) {
      const own = info.features.secondBrain && devFeatures && devFeatures.projectsDir ? devFeatures.projectsDir(home) : null;
      if (own) return own;
      return info.edition === 'dev' ? path.join(home, 'Multiterminal') : path.join(home, info.appName, 'Projekte');
    },
  };
}

const current = createEdition();

module.exports = { ...current, createEdition, resolveEdition, loadDevFeatures, FEATURES, PUBLIC_DEFAULTS, FILE };
