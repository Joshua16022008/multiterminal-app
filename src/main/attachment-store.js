'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeFiles } = require('../renderer/attachments');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function imageBuffer(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) {
    throw new Error('Das Bild konnte nicht gelesen werden.');
  }
  if (value.byteLength === 0) throw new Error('Das Bild ist leer.');
  if (value.byteLength > MAX_IMAGE_BYTES) throw new Error('Das Bild ist zu groß (maximal 20 MB).');
  return Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
}

function createAttachmentStore({ dataDir, decodeImage, readClipboardImage }) {
  const directory = path.join(dataDir, 'attachments');

  function validateFiles(files) {
    const normalized = normalizeFiles(files);
    for (const file of normalized) {
      let stat;
      try { stat = fs.statSync(file.path); fs.accessSync(file.path, fs.constants.R_OK); }
      catch (_) { throw new Error('Datei nicht gefunden oder nicht lesbar: ' + file.path); }
      if (!stat.isFile()) throw new Error('Bitte eine Datei auswählen: ' + file.path);
    }
    return normalized;
  }

  function saveImage(value) {
    const input = imageBuffer(value);
    const png = imageBuffer(decodeImage(input));
    if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw new Error('Das Bild konnte nicht als PNG gelesen werden.');
    }
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Der Bildordner ist kein reguläres Verzeichnis.');
    const file = path.join(directory, 'bild-' + crypto.randomUUID() + '.png');
    fs.writeFileSync(file, png, { flag: 'wx', mode: 0o600 });
    return { path: file, kind: 'image' };
  }

  async function clipboardImage() {
    const bytes = await readClipboardImage();
    if (!bytes) throw new Error('In der Zwischenablage ist kein unterstütztes Bild.');
    return saveImage(bytes);
  }

  return { validateFiles, saveImage, clipboardImage };
}

module.exports = { createAttachmentStore, MAX_IMAGE_BYTES };
