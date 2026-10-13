'use strict';

// Runs after `npm install`.
// node-pty ships a prebuilt helper program ("spawn-helper") that must be executable.
// npm sometimes installs it without the executable bit, so this script sets it.
// It never fails the install: every error is caught and the script exits with 0.

const fs = require('fs');
const path = require('path');

const EXECUTABLE_MODE = 0o755;
const PROJECT_ROOT = path.join(__dirname, '..');
const NODE_PTY_DIR = path.join(PROJECT_ROOT, 'node_modules', 'node-pty');

function makeExecutable(file) {
  try {
    if (!fs.existsSync(file)) return;
    const current = fs.statSync(file).mode & 0o777;
    if (current === EXECUTABLE_MODE) return;
    fs.chmodSync(file, EXECUTABLE_MODE);
    console.log(`postinstall: ${path.relative(PROJECT_ROOT, file)} ausführbar gesetzt`);
  } catch (err) {
    console.log(`postinstall: ${path.relative(PROJECT_ROOT, file)} konnte nicht geändert werden (${err.code || err.message})`);
  }
}

function prebuildFolders(prebuildsDir) {
  try {
    return fs
      .readdirSync(prebuildsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (err) {
    return [];
  }
}

function main() {
  if (process.platform === 'win32') return;

  const prebuildsDir = path.join(NODE_PTY_DIR, 'prebuilds');
  for (const folder of prebuildFolders(prebuildsDir)) {
    makeExecutable(path.join(prebuildsDir, folder, 'spawn-helper'));
  }

  makeExecutable(path.join(NODE_PTY_DIR, 'build', 'Release', 'spawn-helper'));
}

try {
  main();
} catch (err) {
  console.log(`postinstall: übersprungen (${err.message})`);
}

process.exit(0);
