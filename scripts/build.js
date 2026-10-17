'use strict';
// Packages the app into dist/Multiterminal-darwin-<arch>/Multiterminal.app
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const APP_NAME = 'Multiterminal';
// Paths are relative to the project root with a leading slash, as @electron/packager tests them.
const IGNORE = [
  /^\/dist($|\/)/,
  /^\/tests($|\/)/,
  /^\/\.git($|\/)/,
  /^\/scripts\/build\.js$/,
  /^\/node_modules\/node-pty\/prebuilds\/win32-/,
  // Local test fixtures/caches can contain dangling account-setting symlinks.
  /^\/node_modules\/\.cache($|\/)/,
  // Lokale Werkzeug- und Arbeitsdaten (Agent-Sitzungen, Browser-Protokolle, Terminal-Mitschnitte, QA-Reste) gehören nicht ins Paket.
  /^\/\.(claude|claude-flow|gstack|multiterminal|qa-[^/]*)($|\/)/,
  // Von docs/ gehört nur der User Guide ins Paket (Hilfe-Panel); Entwicklerpläne bleiben draußen.
  /^\/docs\/(?!guide($|\/))/,
];

function findAllFiles(dir, name, out = [], depth = 0) {
  if (depth > 10 || !fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) out.push(full);
    else if (entry.isDirectory()) findAllFiles(full, name, out, depth + 1);
  }
  return out;
}

async function main() {
  // @electron/packager is an ES module; load it with dynamic import from CommonJS.
  const { packager } = await import('@electron/packager');

  const appPaths = await packager({
    dir: ROOT,
    name: APP_NAME,
    icon: path.join(ROOT, 'assets', 'icon.icns'),
    out: path.join(ROOT, 'dist'),
    // Keep Electron extraction beside the output, also when the project lives on
    // an external volume and the system's temporary volume has little free space.
    tmpdir: path.join(ROOT, 'dist', '.build-tmp'),
    platform: 'darwin',
    arch: process.arch,
    asar: false, // node-pty needs real files (prebuilds, spawn-helper with exec bit)
    overwrite: true,
    prune: true, // drops devDependencies (default, stated explicitly)
    appBundleId: 'de.joshua.multiterminal',
    // Diktat: Flüsterflow nimmt als Kindprozess dieser App über das Mikrofon auf.
    usageDescription: { Microphone: 'Für das Diktat in ein Terminal (Flüsterflow, lokal auf diesem Mac).' },
    ignore: IGNORE,
    quiet: false,
  });

  if (!appPaths || !appPaths.length) throw new Error('Packager returned no output directory');

  for (const outDir of appPaths) {
    const appBundle = path.join(outDir, `${APP_NAME}.app`);
    if (!fs.existsSync(appBundle)) throw new Error(`App bundle not found: ${appBundle}`);

    const helpers = findAllFiles(path.join(appBundle, 'Contents', 'Resources', 'app'), 'spawn-helper');
    if (!helpers.length) {
      throw new Error('spawn-helper of node-pty is missing in the packaged app');
    }
    for (const helper of helpers) {
      const mode = fs.statSync(helper).mode;
      if ((mode & 0o111) !== 0o111) {
        fs.chmodSync(helper, mode | 0o755);
        console.log(`chmod +x ${helper}`);
      }
      fs.accessSync(helper, fs.constants.X_OK);
    }
    console.log(`spawn-helper OK (${helpers.length} file(s))`);
    console.log(`App: ${appBundle}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Build failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = { IGNORE };
