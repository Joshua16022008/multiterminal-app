'use strict';

(function () {
  const filesApi = typeof module !== 'undefined' && module.exports ? require('./attachments') : window.DeckAttachments;

  // The captured pane object matters: a reused id must never redirect an old draft.
  function createController({ getPane, insert, validateFiles = async () => {}, onChange = () => {}, onClose = () => {} }) {
    let draft = null;
    let target = null;
    function get() { return draft ? { ...draft, files: draft.files.map(f => ({ ...f })) } : null; }
    function changed() { onChange(get()); }
    function requireTarget() {
      const pane = draft && getPane(draft.terminalId);
      if (!pane || pane !== target || pane.disposed || pane.status !== 'running') {
        throw new Error('Das Ziel-Terminal ist geschlossen oder läuft nicht mehr.');
      }
      return pane;
    }
    function open({ terminalId, text = '', files = [] } = {}) {
      if (draft) throw new Error('Bitte die offene Vorschau zuerst einfügen oder schließen.');
      const pane = typeof terminalId === 'string' && getPane(terminalId);
      if (!pane || pane.disposed || pane.status !== 'running') throw new Error('Dieses Terminal läuft nicht mehr.');
      if (typeof text !== 'string' || text.length > filesApi.MAX_TEXT_LENGTH) throw new Error('Der Prompt-Text ist ungültig oder zu lang.');
      const normalized = filesApi.normalizeFiles(files);
      target = pane;
      draft = { terminalId, text, files: normalized, targetLabel: [pane.project && pane.project.name, pane.desc && pane.desc.title || terminalId].filter(Boolean).join(' · '), busy: false, error: '' };
      changed();
      return get();
    }
    function close() {
      const pane = target;
      draft = null; target = null; changed(); onClose(pane);
    }
    function updateText(text) {
      if (!draft || draft.busy) return;
      if (typeof text !== 'string' || text.length > filesApi.MAX_TEXT_LENGTH) throw new Error('Der Prompt-Text ist zu lang.');
      draft.text = text; draft.error = ''; changed();
    }
    function addFiles(files) {
      if (!draft || draft.busy) return;
      draft.files = filesApi.normalizeFiles([...draft.files, ...files]); draft.error = ''; changed();
    }
    function removeFile(index) {
      if (!draft || draft.busy || !Number.isInteger(index) || index < 0 || index >= draft.files.length) return;
      draft.files.splice(index, 1); draft.error = ''; changed();
    }
    async function insertDraft() {
      if (!draft || draft.busy) return false;
      const current = draft;
      try {
        requireTarget();
        const text = filesApi.buildPromptText(current.text, current.files);
        if (!text.trim()) throw new Error('Bitte Text eingeben oder eine Datei hinzufügen.');
        current.busy = true; current.error = ''; changed();
        await validateFiles(current.files);
        if (draft !== current) return false;
        const pane = requireTarget();
        if (insert(pane, text) === false) throw new Error('Der Text konnte nicht eingefügt werden.');
        close();
        return true;
      } catch (error) {
        if (draft === current) { current.busy = false; current.error = error.message || String(error); changed(); }
        return false;
      }
    }
    return { open, close, get, updateText, addFiles, removeFile, insert: insertDraft };
  }

  function createPromptDraft({ document: doc, getPane, activatePane, host, notify }) {
    const dialog = doc.createElement('dialog');
    dialog.id = 'prompt-draft-dialog'; dialog.className = 'prompt-draft';
    dialog.setAttribute('aria-labelledby', 'prompt-draft-title');
    function el(tag, cls, text) {
      const e = doc.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e;
    }
    const title = el('h2', '', 'Text und Dateien einfügen'); title.id = 'prompt-draft-title';
    const target = el('p', 'prompt-draft-target');
    const label = el('label', 'prompt-draft-label', 'Dein Auftrag'); label.htmlFor = 'prompt-draft-text';
    const text = el('textarea'); text.id = 'prompt-draft-text'; text.rows = 5; text.maxLength = filesApi.MAX_TEXT_LENGTH;
    const list = el('ul', 'prompt-draft-files'); list.setAttribute('aria-label', 'Dateiverweise');
    const tools = el('div', 'prompt-draft-tools');
    function button(name, cls, action) { const b = el('button', cls || 'btn-small', name); b.type = 'button'; b.addEventListener('click', action); return b; }
    const pick = button('Dateien hinzufügen…', '', () => runTask(() => host.pickFiles()));
    const clipboard = button('Bild aus Zwischenablage', '', () => runTask(async () => [await host.clipboardImage()]));
    tools.append(pick, clipboard);
    const hint = el('p', 'prompt-draft-hint', 'Dateien werden als Pfade eingefügt. Der Agent muss sie selbst öffnen. Zeilenumbrüche im Text werden beim Einfügen zu Leerzeichen.');
    const previewLabel = el('strong', 'prompt-draft-preview-label', 'So wird eingefügt');
    const preview = el('pre', 'prompt-draft-preview');
    const error = el('p', 'prompt-draft-error'); error.setAttribute('role', 'alert');
    const row = el('div', 'prompt-draft-actions');
    const cancel = button('Abbrechen', '', () => controller.close());
    const submit = button('Ins Terminal einfügen', 'btn-primary', () => controller.insert());
    submit.id = 'prompt-draft-insert'; row.append(cancel, submit);
    dialog.append(title, target, label, text, list, tools, hint, previewLabel, preview, error, row);
    doc.body.append(dialog);
    let pending = false;
    let generation = 0;
    const controller = createController({
      getPane,
      validateFiles: files => files.length ? host.validateFiles(files) : Promise.resolve(),
      insert: (pane, value) => {
        activatePane(pane);
        // xterm handles bracketed paste; the prepared text has no Enter/control chars.
        pane.term.paste(value);
        return true;
      },
      onClose: pane => { if (pane && !pane.disposed && pane.status === 'running') { activatePane(pane); pane.focus(); } },
      onChange: draw,
    });
    function draw(draft) {
      if (!draft) { generation++; if (dialog.open) dialog.close(); return; }
      target.textContent = 'Ziel: ' + draft.targetLabel;
      if (text.value !== draft.text) text.value = draft.text;
      text.disabled = draft.busy || pending;
      list.replaceChildren(...draft.files.map((file, index) => {
        const item = el('li'); const name = el('span', '', (file.kind === 'image' ? 'Bilddatei: ' : 'Datei: ') + file.path);
        const remove = button('Entfernen', '', () => controller.removeFile(index)); remove.disabled = draft.busy || pending;
        item.append(name, remove); return item;
      }));
      let problem = draft.error;
      try { preview.textContent = filesApi.buildPromptText(draft.text, draft.files) || '(noch leer)'; }
      catch (e) { preview.textContent = ''; problem = e.message; }
      error.textContent = problem; error.hidden = !problem;
      for (const b of [pick, clipboard, submit]) b.disabled = draft.busy || pending;
      if (!dialog.open) { dialog.showModal(); text.focus(); }
    }
    async function runTask(action) {
      if (pending || !controller.get()) return;
      // Do not attach a delayed clipboard/file result to a different draft.
      const token = generation;
      pending = true; draw(controller.get());
      let failure = '';
      try {
        const files = await action();
        if (generation === token && controller.get()) controller.addFiles(files);
      } catch (e) { if (generation === token) failure = e.message || String(e); }
      finally {
        pending = false;
        if (controller.get()) {
          draw(controller.get());
          if (generation === token && failure) { error.textContent = failure; error.hidden = false; }
        }
      }
    }
    text.addEventListener('input', () => { try { controller.updateText(text.value); } catch (e) { error.textContent = e.message; error.hidden = false; } });
    dialog.addEventListener('cancel', e => { e.preventDefault(); controller.close(); });
    dialog.addEventListener('keydown', e => { e.stopPropagation(); });
    dialog.addEventListener('close', () => { if (!dialog.open && controller.get()) controller.close(); });

    async function transferFiles(transfer) {
      const result = [];
      const incoming = Array.from(transfer.files || []);
      if (!incoming.length) throw new Error('In dieser Auswahl sind keine lesbaren Dateien.');
      if (incoming.length > filesApi.MAX_FILES) throw new Error('Bitte höchstens 20 Dateien gleichzeitig hinzufügen.');
      for (const file of incoming) {
        const path = host.pathForFile(file);
        if (path) result.push({ path });
        else if (file.type.startsWith('image/')) {
          if (file.size > 20 * 1024 * 1024) throw new Error('Das Bild ist zu groß (maximal 20 MB).');
          result.push(await host.saveImage(await file.arrayBuffer()));
        } else throw new Error('Diese Datei hat keinen lokalen Dateipfad. Bitte zuerst speichern.');
      }
      return filesApi.normalizeFiles(result);
    }
    function open(options) {
      try { controller.open(options); generation++; return true; }
      catch (e) { notify(e.message || String(e)); return false; }
    }
    async function receive(pane, transfer) {
      const current = controller.get();
      if (current && current.terminalId !== pane.id) { notify('Bitte die offene Vorschau zuerst schließen.'); return; }
      if (!current && !open({ terminalId: pane.id })) return;
      await runTask(() => transferFiles(transfer));
    }
    function bindPane(pane) {
      const attach = button('📎', 'ib attachment-button', () => {
        activatePane(pane); open({ terminalId: pane.id });
      });
      attach.title = 'Dateien oder Bildverweise einfügen'; attach.setAttribute('aria-label', attach.title);
      const spacer = pane.head.querySelector('.spacer');
      if (spacer) spacer.before(attach); else pane.head.append(attach);
      pane.el.addEventListener('dragover', e => {
        if (!filesApi.isFileTransfer(e.dataTransfer)) return;
        e.preventDefault(); e.stopImmediatePropagation(); e.dataTransfer.dropEffect = 'copy';
        pane.el.classList.add('attachment-drop-target');
      }, true);
      pane.el.addEventListener('dragleave', e => { if (!pane.el.contains(e.relatedTarget)) pane.el.classList.remove('attachment-drop-target'); });
      pane.el.addEventListener('drop', e => {
        pane.el.classList.remove('attachment-drop-target');
        if (!filesApi.isFileTransfer(e.dataTransfer)) return;
        e.preventDefault(); e.stopImmediatePropagation(); receive(pane, e.dataTransfer);
      }, true);
      pane.el.addEventListener('paste', e => {
        if (!filesApi.isFileTransfer(e.clipboardData)) return;
        e.preventDefault(); e.stopImmediatePropagation(); receive(pane, e.clipboardData);
      }, true);
    }
    // Keep text paste normal. Pasted images/files inside the editor join its list.
    dialog.addEventListener('paste', e => {
      if (!filesApi.isFileTransfer(e.clipboardData)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      runTask(() => transferFiles(e.clipboardData));
    }, true);
    function clearDropHints() {
      doc.body.classList.remove('attachment-dragging');
      for (const tile of doc.querySelectorAll('.attachment-drop-target')) tile.classList.remove('attachment-drop-target');
    }
    doc.addEventListener('dragenter', e => {
      if (filesApi.isFileTransfer(e.dataTransfer)) doc.body.classList.add('attachment-dragging');
    }, true);
    doc.addEventListener('drop', e => {
      if (filesApi.isFileTransfer(e.dataTransfer)) { e.preventDefault(); setTimeout(clearDropHints, 0); }
    }, true);
    doc.addEventListener('dragend', clearDropHints);
    doc.addEventListener('dragleave', e => {
      if (e.relatedTarget === null && e.clientX === 0 && e.clientY === 0) clearDropHints();
    });
    return { open, close: () => controller.close(), bindPane, get: () => controller.get() };
  }

  const api = { createController, createPromptDraft };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckPromptDraft = api;
})();
