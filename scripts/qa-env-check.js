#!/usr/bin/env node
'use strict';

// Preflight for the native qa-*.js scripts: starts a minimal Electron app
// (no product code) and reports whether this process can reach the macOS
// window server. Exit codes: 0 = native QA can run, 2 = environment cannot
// (see docs/dev/qa-sigabrt.md), 1 = unexpected failure, 3 = not macOS (check
// not applicable, deliberately NOT 0 so '&&' chains do not read it as "QA possible").
// QA_ENV_TIMEOUT_MS overrides the 30 s probe timeout (slow first start).
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

const EXIT = { ok: 0, failed: 1, sandboxed: 2, unsupported: 3 };

function exitCodeFor(verdict) {
  return Object.prototype.hasOwnProperty.call(EXIT, verdict) ? EXIT[verdict] : EXIT.failed;
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
        code: err && err.code,
        timedOut: Boolean(err && err.killed),
        stderr: String(stderr || '').slice(-400)
      });
    });
  });
}

async function main(opts = {}) {
  const platform = opts.platform || process.platform;
  if (platform !== 'darwin') {
    console.error('qa-env-check: not macOS, check not applicable (exit 3)');
    return EXIT.unsupported;
  }
  const bin = opts.bin || path.join(__dirname, '..', 'node_modules', '.bin', 'electron');
  const envTimeout = Number(process.env.QA_ENV_TIMEOUT_MS);
  const timeoutMs = opts.timeoutMs || (envTimeout > 0 ? envTimeout : 30000);
  const result = await probe(bin, timeoutMs);
  const verdict = diagnose(result);
  if (verdict === 'ok') { console.log('qa-env-check: native Electron QA possible'); return EXIT.ok; }
  const what = result.timedOut ? 'timeout, possibly sandbox' : (result.signal || result.code || 'no output');
  console.error('qa-env-check: Electron cannot start here (' + what + ').');
  if (verdict === 'sandboxed') {
    console.error('Possibly an agent/seatbelt sandbox without window-server access (or a slow first start;');
    console.error('retry with QA_ENV_TIMEOUT_MS=90000). Run the qa-* scripts from Terminal.app or a normal');
    console.error('Aqua session instead (see docs/dev/qa-sigabrt.md).');
  }
  if (result.stderr) console.error(result.stderr);
  return exitCodeFor(verdict);
}

if (require.main === module) main().then(code => process.exit(code), err => { console.error(err); process.exit(1); });
module.exports = { diagnose, probe, main, exitCodeFor, EXIT };
