'use strict';

const { spawn } = require('node:child_process');

const SERVICE = 'de.multiterminal.endpoint';
const SECURITY = '/usr/bin/security';
const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TIMEOUT = 5000;

// Injectable boundary: run(file, argv, { input?, timeout }) -> { status, stdout?, stderr? }.
// Never include child output or the original exception in public errors: security can echo input.
function runSecurity(file, argv, { input, timeout = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, { shell: false, stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Schlüsselbund nicht erreichbar.')); });
    child.once('close', (status) => { clearTimeout(timer); resolve({ status }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function checkAccount(account) {
  if (typeof account !== 'string' || !ACCOUNT.test(account)) {
    throw new Error('Ungültige Endpunkt-ID.');
  }
  return account;
}

// security -i has its own line-oriented parser, not a shell. Quote every token and
// escape the two characters that parser treats specially inside double quotes.
function interpreterQuote(value) {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function createKeychain({ run = runSecurity } = {}) {
  async function invoke(argv, input, message) {
    try {
      const result = await run(SECURITY, argv, { input, timeout: TIMEOUT });
      const status = result && (result.status ?? result.code ?? result.exitCode);
      if (!Number.isInteger(status)) throw new Error('Unbekannter Prozessstatus.');
      return status;
    } catch {
      throw new Error(message);
    }
  }

  async function set(account, secret) {
    checkAccount(account);
    // Newlines cannot round-trip through security's command interpreter. Reject
    // them instead of allowing another command to be injected into stdin.
    if (typeof secret !== 'string' || secret.length === 0 || secret.length > 16384 || /[\x00-\x08\x0a-\x1f\x7f]/.test(secret)) {
      throw new Error('Der Schlüssel muss ein nicht leerer Text ohne Zeilenumbrüche oder Steuerzeichen sein.');
    }
    const input = ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', secret]
      .map(interpreterQuote).join(' ') + '\n';
    const status = await invoke(['-i'], input, 'Schlüssel konnte nicht im Schlüsselbund gespeichert werden.');
    if (status !== 0) throw new Error('Schlüssel konnte nicht im Schlüsselbund gespeichert werden.');
    return true;
  }

  async function has(account) {
    checkAccount(account);
    const status = await invoke(['find-generic-password', '-s', SERVICE, '-a', account], undefined,
      'Schlüsselbund konnte nicht geprüft werden.');
    if (status === 44) return false; // errSecItemNotFound, truncated process exit status
    if (status !== 0) throw new Error('Schlüsselbund konnte nicht geprüft werden.');
    return true;
  }

  async function remove(account) {
    checkAccount(account);
    const status = await invoke(['delete-generic-password', '-s', SERVICE, '-a', account], undefined,
      'Schlüssel konnte nicht aus dem Schlüsselbund entfernt werden.');
    if (status === 44) return false;
    if (status !== 0) throw new Error('Schlüssel konnte nicht aus dem Schlüsselbund entfernt werden.');
    return true;
  }

  function lookupExpression(account) {
    checkAccount(account);
    return `$(/usr/bin/security find-generic-password -s '${SERVICE}' -a '${account}' -w)`;
  }

  return { set, has, remove, lookupExpression };
}

module.exports = { createKeychain };
