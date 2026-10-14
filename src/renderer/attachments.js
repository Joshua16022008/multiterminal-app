'use strict';

// Pure reference preparation only. The host checks file existence; the prompt
// controller owns target selection, user confirmation and the actual PTY write.
(function () {
  const MAX_FILES = 20;
  const MAX_PATH_LENGTH = 4096;
  const MAX_TEXT_LENGTH = 32000;
  const MAX_PROMPT_LENGTH = 65536;
  const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;
  const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif|svg)$/i;

  function validatePath(path) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new Error('Ein Dateipfad muss ein absoluter lokaler Pfad sein.');
    }
    if (path.length > MAX_PATH_LENGTH) {
      throw new Error(`Der Dateipfad ist zu lang (maximal ${MAX_PATH_LENGTH} Zeichen).`);
    }
    if (CONTROL_CHARACTERS.test(path)) {
      throw new Error('Der Dateipfad enthält Steuerzeichen oder Zeilenumbrüche und kann nicht eingefügt werden.');
    }
    return path;
  }

  function normalizeFiles(files) {
    if (!Array.isArray(files)) throw new Error('Die Anhänge müssen als Dateiliste übergeben werden.');
    if (files.length > MAX_FILES) throw new Error(`Bitte höchstens ${MAX_FILES} Dateien gleichzeitig anhängen.`);
    const seen = new Set();
    const result = [];
    for (const file of files) {
      if (!file || typeof file !== 'object' || Array.isArray(file)) {
        throw new Error('Jeder Anhang benötigt einen gültigen Dateipfad.');
      }
      const path = validatePath(file.path);
      const kind = file.kind === undefined ? (IMAGE_EXTENSION.test(path) ? 'image' : 'file') : file.kind;
      if (kind !== 'file' && kind !== 'image') throw new Error('Ein Anhang muss die Dateiart „file“ oder „image“ haben.');
      // Validate every entry, even a duplicate, so malformed input never vanishes.
      if (!seen.has(path)) {
        seen.add(path);
        result.push({ path, kind });
      }
    }
    return result;
  }

  function quotePath(path) {
    // End the single-quoted string, add a literal quote, then reopen it.
    // $, backticks, semicolons, whitespace and globbing remain literal.
    return "'" + validatePath(path).replace(/'/g, "'\"'\"'") + "'";
  }

  function buildPromptText(text, files = []) {
    if (typeof text !== 'string') throw new Error('Der Prompt-Text muss eine Zeichenfolge sein.');
    if (text.length > MAX_TEXT_LENGTH) throw new Error(`Der Prompt-Text ist zu lang (maximal ${MAX_TEXT_LENGTH} Zeichen).`);
    // A line feed in edited prose becomes a space. Other terminal controls,
    // including CR and bracketed-paste escapes, are refused rather than hidden.
    const sanitizedText = text.replace(/\n/g, ' ');
    if (CONTROL_CHARACTERS.test(sanitizedText)) {
      throw new Error('Der Prompt-Text enthält unerlaubte Steuerzeichen oder Zeilenumbrüche.');
    }
    const references = normalizeFiles(files).map(file => quotePath(file.path)).join(' ');
    const result = sanitizedText && references ? sanitizedText + ' ' + references : sanitizedText || references;
    if (result.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Der gesamte Prompt ist zu lang (maximal ${MAX_PROMPT_LENGTH} Zeichen).`);
    }
    return result;
  }

  function isFileTransfer(dataTransfer) {
    if (!dataTransfer) return false;
    return Array.prototype.some.call(dataTransfer.types || [], type => type === 'Files') ||
      Array.prototype.some.call(dataTransfer.items || [], item => item && item.kind === 'file');
  }

  const api = { MAX_FILES, MAX_PATH_LENGTH, MAX_TEXT_LENGTH, MAX_PROMPT_LENGTH,
    normalizeFiles, quotePath, buildPromptText, isFileTransfer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckAttachments = api;
})();
