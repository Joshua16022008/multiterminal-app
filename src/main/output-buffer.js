'use strict';

// Ausgabe-Puffer je Terminal für den Projektmanager. Hält
//  - einen Zeilenring ohne ANSI-/Steuersequenzen (für `mt-pm output`),
//  - einen begrenzten Rohrest (für das Wiederanzeigen im Manager-Fenster).
// Reine Datenhaltung, keine Dateien, keine Prozesse.

const MAX_TAIL_LINES = 500;
const DEFAULT_TAIL_LINES = 50;
const MAX_LINE_LENGTH = 2000;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

// keepRaw(id): nur Terminals, die den Rohrest brauchen (Manager), führen ihn mit.
function createOutputBuffer({ maxLines = 2000, maxRawBytes = 256 * 1024, keepRaw = () => true } = {}) {
  const entries = new Map(); // terminalId -> { lines, current, state, raw }

  function entryFor(id) {
    let e = entries.get(id);
    if (!e) {
      e = { lines: [], current: '', state: 'text', raw: '' };
      entries.set(id, e);
    }
    return e;
  }

  function pushLine(e) {
    let line = e.current.replace(/\s+$/, '');
    if (line.length > MAX_LINE_LENGTH) line = line.slice(0, MAX_LINE_LENGTH);
    e.lines.push(line);
    if (e.lines.length > maxLines) e.lines.splice(0, e.lines.length - maxLines);
    e.current = '';
  }

  // Zustandsautomat, damit auch über Datenblöcke verteilte Sequenzen entfernt werden.
  function feed(e, data) {
    for (let i = 0; i < data.length; i++) {
      // Schneller Pfad: gewöhnlicher Text in großen Stücken statt Zeichen für Zeichen.
      if (e.state === 'text' && !e.cr) {
        CONTROL_RE.lastIndex = i;
        const m = CONTROL_RE.exec(data);
        const end = m ? m.index : data.length;
        if (end > i) {
          if (e.current.length < MAX_LINE_LENGTH) e.current += data.slice(i, Math.min(end, i + MAX_LINE_LENGTH - e.current.length));
          i = end - 1;
          continue;
        }
      }
      const ch = data[i];
      const code = data.charCodeAt(i);
      switch (e.state) {
        case 'esc':
          if (ch === '[') e.state = 'csi';
          else if (ch === ']') e.state = 'osc';
          else if (ch === 'P' || ch === '^' || ch === '_' || ch === 'X') e.state = 'str';
          else if (ch === '(' || ch === ')' || ch === '*' || ch === '+' || ch === '#' || ch === '%') e.state = 'skip1';
          else e.state = 'text';
          continue;
        case 'skip1':
          e.state = 'text';
          continue;
        case 'csi':
          if (code >= 0x40 && code <= 0x7e) e.state = 'text';
          continue;
        case 'osc':
          if (code === 7) e.state = 'text';
          else if (code === 0x1b) e.state = 'oscesc';
          continue;
        case 'str':
          if (code === 0x1b) e.state = 'oscesc';
          continue;
        case 'oscesc':
          e.state = ch === '\\' ? 'text' : (code === 0x1b ? 'oscesc' : 'osc');
          continue;
        default:
          break;
      }
      if (code === 0x1b) { e.state = 'esc'; continue; }
      if (ch === '\n') { e.cr = false; pushLine(e); continue; }
      // Wagenrücklauf erst beim nächsten Zeichen auswerten: CRLF kann über zwei Datenblöcke verteilt sein.
      if (ch === '\r') { e.cr = true; continue; }
      if (code < 0x20 && ch !== '\b' && ch !== '\t') continue;
      if (code === 0x7f || (code >= 0x80 && code < 0xa0)) continue;
      if (e.cr) { e.current = ''; e.cr = false; } // Wagenrücklauf: die Zeile wird überschrieben
      if (ch === '\b') { e.current = e.current.slice(0, -1); continue; }
      if (ch === '\t') { if (e.current.length < MAX_LINE_LENGTH) e.current += '  '; continue; }
      if (e.current.length < MAX_LINE_LENGTH) e.current += ch; // überlange Zeilen ohne Umbruch werden gekappt
    }
  }

  function trimRaw(e) {
    if (e.raw.length * 4 <= maxRawBytes) return;
    while (e.raw.length > 0 && Buffer.byteLength(e.raw) > maxRawBytes) {
      e.raw = e.raw.slice(Math.max(1, Math.ceil(e.raw.length * 0.1)));
    }
  }

  function append(terminalId, data) {
    if (typeof data !== 'string' || data === '') return;
    const e = entryFor(String(terminalId));
    feed(e, data);
    if (keepRaw(String(terminalId))) {
      e.raw += data;
      trimRaw(e);
    }
  }

  function tail(terminalId, lines = DEFAULT_TAIL_LINES) {
    const e = entries.get(String(terminalId));
    if (!e) return [];
    let n = Math.floor(Number(lines));
    if (!Number.isFinite(n) || n < 1) n = DEFAULT_TAIL_LINES;
    n = Math.min(n, MAX_TAIL_LINES);
    const cur = e.current.slice(0, MAX_LINE_LENGTH).replace(/\s+$/, '');
    const all = e.current.trim() ? [...e.lines, cur] : e.lines;
    return all.slice(-n);
  }

  function raw(terminalId) {
    const e = entries.get(String(terminalId));
    return e ? e.raw : '';
  }

  function forget(terminalId) {
    entries.delete(String(terminalId));
  }

  return { append, tail, raw, forget };
}

module.exports = { createOutputBuffer, MAX_TAIL_LINES, DEFAULT_TAIL_LINES };
