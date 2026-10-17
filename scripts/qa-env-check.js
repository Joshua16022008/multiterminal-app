#!/usr/bin/env node
'use strict';

// Preflight for the native qa-*.js scripts: starts a minimal Electron app
// (no product code) and reports whether this process can reach the macOS
// window server. Exit 0 = native QA can run, 2 = environment cannot (see
// docs/dev/qa-sigabrt.md), 1 = unexpected failure.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

function diagnose(result) {
  if (result.ok) return 'ok';
  if (result.signal === 'SIGABRT' || result.signal === 'SIGTRAP' || result.timedOut) {
    return 'sandboxed';
  }
  return 'failed';
}

function probe(electronBin, timeoutMs = 30000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-qa-env-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"qa-env-probe","main":"main.js"}');
  fs.writeFileSync(path.join(dir, 'main.js'),
    "const{app}=require('electron');app.whenReady().then(()=>{console.log('READY');app.quit();});");
  return new Promise(resolve => {
    execFile(electronBin, [dir], { timeout: timeoutMs, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({
        ok: !err && /READY/.test(stdout),
        signal: err && err.signal,
        timedOut: Boolean(err && err.killed),
        stderr: String(stderr || '').slice(-400)
      });
    });
  });
}

async function main() {
  if (process.platform !== 'darwin') { console.log('qa-env-check: not macOS, skipped'); return 0; }
  const bin = path.join(__dirname, '..', 'node_modules', '.bin', 'electron');
  const result = await probe(bin);
  const verdict = diagnose(result);
  if (verdict === 'ok') { console.log('qa-env-check: native Electron QA possible'); return 0; }
  console.error('qa-env-check: Electron cannot start here (' + (result.signal || 'no output') + ').');
  if (verdict === 'sandboxed') {
    console.error('Likely an agent/seatbelt sandbox without window-server access. Run the qa-* scripts from');
    console.error('Terminal.app or a normal Aqua session instead (see docs/dev/qa-sigabrt.md).');
  }
  if (result.stderr) console.error(result.stderr);
  return verdict === 'sandboxed' ? 2 : 1;
}

if (require.main === module) main().then(code => process.exit(code), err => { console.error(err); process.exit(1); });
module.exports = { diagnose, probe };
