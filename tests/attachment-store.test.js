'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAttachmentStore, MAX_IMAGE_BYTES } = require('../src/main/attachment-store');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6DfkAAAAASUVORK5CYII=', 'base64');

function setup(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-attachment-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createAttachmentStore({ dataDir: root, decodeImage: bytes => bytes, ...extra });
  return { root, store };
}

test('clipboard images are stored as distinct private PNG files under app data', async t => {
  const { root, store } = setup(t, { readClipboardImage: async () => png });
  const first = await store.clipboardImage();
  const second = await store.clipboardImage();
  assert.equal(first.kind, 'image');
  assert.equal(path.dirname(first.path), path.join(root, 'attachments'));
  assert.notEqual(first.path, second.path);
  assert.deepEqual(fs.readFileSync(first.path), png);
  assert.equal(fs.statSync(first.path).mode & 0o777, 0o600);
});

test('pasted image buffers are validated and saved without accepting an output path', t => {
  const { root, store } = setup(t);
  const saved = store.saveImage(new Uint8Array(png));
  assert.ok(saved.path.startsWith(path.join(root, 'attachments') + path.sep));
  assert.throws(() => store.saveImage(Buffer.from('not an image')), /Bild|PNG/);
  assert.throws(() => store.saveImage({ path: '/tmp/overwrite', data: png }), /Bild/);
  assert.throws(() => store.saveImage(new Uint8Array(MAX_IMAGE_BYTES + 1)), /groß/);
});

test('empty clipboard and unreadable or non-file attachments fail without writing', async t => {
  const { root, store } = setup(t, { readClipboardImage: async () => null });
  await assert.rejects(store.clipboardImage(), /Zwischenablage/);
  const file = path.join(root, "Datei ' mit $ Zeichen.txt"); fs.writeFileSync(file, 'test');
  assert.deepEqual(store.validateFiles([{ path: file, kind: 'file' }]), [{ path: file, kind: 'file' }]);
  assert.throws(() => store.validateFiles([{ path: root }]), /Datei/);
  assert.throws(() => store.validateFiles([{ path: path.join(root, 'missing') }]), /nicht|gefunden/);
  assert.throws(() => store.validateFiles([{ path: file + '\n' }]), /Steuer|Zeilen/);
  assert.equal(fs.existsSync(path.join(root, 'attachments')), false);
});

test('an existing attachment-directory symlink is not used for image writes', t => {
  const { root, store } = setup(t);
  const other = path.join(root, 'elsewhere'); fs.mkdirSync(other);
  fs.symlinkSync(other, path.join(root, 'attachments'));
  assert.throws(() => store.saveImage(png), /Ordner|Verzeichnis/);
  assert.deepEqual(fs.readdirSync(other), []);
});
