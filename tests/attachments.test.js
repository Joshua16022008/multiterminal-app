'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const attachmentPath = require.resolve('../src/renderer/hotkeys.js').replace('hotkeys.js', 'attachments.js');
// Missing feature yields assertion failures during the first red run.
const attachments = fs.existsSync(attachmentPath) ? require(attachmentPath) : {};

test('normalization preserves Unicode paths, infers images and deduplicates without mutation', () => {
  assert.equal(typeof attachments.normalizeFiles, 'function');
  const files = Object.freeze([
    Object.freeze({ path: '/tmp/Koralle groß.PNG' }),
    Object.freeze({ path: '/tmp/notes.md', kind: 'file' }),
    Object.freeze({ path: '/tmp/Koralle groß.PNG', kind: 'file' }),
    Object.freeze({ path: '/tmp/vector.svg', kind: 'image' }),
  ]);
  assert.deepEqual(attachments.normalizeFiles(files), [
    { path: '/tmp/Koralle groß.PNG', kind: 'image' },
    { path: '/tmp/notes.md', kind: 'file' },
    { path: '/tmp/vector.svg', kind: 'image' },
  ]);
});

test('file normalization rejects invalid input instead of silently omitting files', () => {
  assert.equal(typeof attachments.normalizeFiles, 'function');
  for (const files of [null, {}, 'file', [null], ['/tmp/a'], [{ path: 4 }], [{ path: '' }],
    [{ path: 'relative.txt' }], [{ path: 'file:///tmp/a' }], [{ path: '/tmp/a', kind: 'url' }],
    [{ path: '/tmp/a', kind: null }]]) {
    assert.throws(() => attachments.normalizeFiles(files), /Datei|Pfad|Anhang|Liste/);
  }
  assert.deepEqual(attachments.normalizeFiles([]), []);
});

test('control characters in filenames are rejected including terminal escape sequences', () => {
  assert.equal(typeof attachments.normalizeFiles, 'function');
  for (const control of ['\n', '\r', '\t', '\0', '\x1b', '\x7f', '\x85', '\u2028', '\u2029']) {
    assert.throws(() => attachments.normalizeFiles([{ path: `/tmp/a${control}b` }]), /Steuerzeichen|Zeilenumbruch/);
  }
});

test('file count and path length are bounded before building a prompt', () => {
  assert.equal(attachments.MAX_FILES, 20);
  assert.equal(attachments.MAX_PATH_LENGTH, 4096);
  const path = '/' + 'a'.repeat(attachments.MAX_PATH_LENGTH - 1);
  assert.equal(attachments.normalizeFiles([{ path }])[0].path, path);
  assert.throws(() => attachments.normalizeFiles([{ path: path + 'a' }]), /lang|4096/);
  assert.throws(() => attachments.normalizeFiles(Array.from({ length: 21 }, (_, i) => ({ path: `/tmp/${i}` }))), /20|viele/);
});

test('single quote escaping keeps shell metacharacters inside one literal path argument', () => {
  assert.equal(typeof attachments.quotePath, 'function');
  assert.equal(attachments.quotePath("/tmp/it's $(touch pwn);`echo x` & *.png"),
    "'/tmp/it'\"'\"'s $(touch pwn);`echo x` & *.png'");
  assert.equal(attachments.quotePath('/tmp/ä ö.png'), "'/tmp/ä ö.png'");
  assert.throws(() => attachments.quotePath('/tmp/a\nb'), /Steuerzeichen|Zeilenumbruch/);
  assert.throws(() => attachments.quotePath('relative'), /Pfad/);
});

test('prompt text combines edited text with safe references and never inserts an Enter', () => {
  assert.equal(typeof attachments.buildPromptText, 'function');
  const result = attachments.buildPromptText('Bitte prüfen\nzweite Zeile', [{ path: '/tmp/a b.png' }]);
  assert.equal(result, "Bitte prüfen zweite Zeile '/tmp/a b.png'");
  assert.doesNotMatch(result, /[\x00-\x1f\x7f-\x9f\u2028\u2029]/);
  assert.equal(attachments.buildPromptText('', [{ path: '/tmp/a' }]), "'/tmp/a'");
  assert.equal(attachments.buildPromptText('nur Text', []), 'nur Text');
  assert.equal(attachments.buildPromptText('', []), '');
});

test('prompt text refuses terminal controls and wrong text types', () => {
  assert.equal(typeof attachments.buildPromptText, 'function');
  for (const text of ['a\rb', 'a\tb', '\x1b[201~touch /tmp/pwn', '\0', '\x03', '\x85', '\u2028', null, 42]) {
    assert.throws(() => attachments.buildPromptText(text, []), /Text|Steuerzeichen|Zeilenumbruch/);
  }
});

test('text and combined prompt limits bound terminal input even after quote expansion', () => {
  assert.equal(attachments.MAX_TEXT_LENGTH, 32000);
  assert.equal(attachments.MAX_PROMPT_LENGTH, 65536);
  assert.equal(attachments.buildPromptText('a'.repeat(32000), []).length, 32000);
  assert.throws(() => attachments.buildPromptText('a'.repeat(32001), []), /lang|32000/);
  const files = Array.from({ length: 20 }, (_, i) => ({ path: `/tmp/${i}` + "'".repeat(4000) }));
  assert.throws(() => attachments.buildPromptText('', files), /lang|65536/);
});

test('file transfer detection recognizes native files but leaves tile dragging alone', () => {
  assert.equal(typeof attachments.isFileTransfer, 'function');
  assert.equal(attachments.isFileTransfer({ types: ['Files', 'text/plain'] }), true);
  assert.equal(attachments.isFileTransfer({ items: [{ kind: 'file', type: 'image/png' }] }), true);
  assert.equal(attachments.isFileTransfer({ types: { 0: 'Files', length: 1 } }), true);
  for (const transfer of [null, {}, { types: ['text/plain'] }, { items: [{ kind: 'string' }] },
    { files: [{ name: 'tile' }], types: ['text/plain'] }]) {
    assert.equal(attachments.isFileTransfer(transfer), false);
  }
});

test('browser script exposes the same pure API without Node or DOM dependencies', () => {
  assert.ok(fs.existsSync(attachmentPath), 'attachments browser module exists');
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(attachmentPath, 'utf8'), context);
  assert.equal(context.window.DeckAttachments.buildPromptText('Bild', [{ path: '/tmp/bild.jpg' }]), "Bild '/tmp/bild.jpg'");
});
