/* Optionaler Agentstart. Eigenes Dialogfenster; bestehende Schnellstarts bleiben unabhängig.
   QA: #agent-launch-dialog, -provider, -folder, -workspace, -branch, -base,
   -task, -scope, -acceptance, -prepare, -context, -back, -start, -cancel,
   -error, -summary, -warnings (jeweils Präfix agent-launch).
   Node: createController({api, launch, onChange, notify}). */
(function () {
  'use strict';

  function createController({ api, launch, onChange = () => {}, notify = () => {} }) {
    let generation = 0;
    let state = { opened: false, busy: false, loading: false };
    const emit = () => onChange(state);
    const current = (token) => state.opened && token === generation;
    const errorText = (error) => error && error.message || String(error || 'Unbekannter Fehler.');
    const requireOK = (result, fallback) => {
      if (!result || !result.ok) throw new Error(result && result.error || fallback);
      return result;
    };

    // workspaceId (optional, e.g. from the Stammbaum): a string preselects that working copy,
    // null the project folder; left out, the dialog starts with a new working copy as before.
    async function open({ project, workspaceId } = {}) {
      if (!project || !project.id || !project.path) return false;
      const token = ++generation;
      const preset = typeof workspaceId === 'string' && workspaceId ? 'existing' : workspaceId === null ? 'project' : 'new';
      state = {
        opened: true, project, busy: false, loading: true, step: 'edit', error: '',
        provider: 'claude', folder: preset, workspaceId: preset === 'existing' ? workspaceId : '', workspaces: [],
        branch: '', baseRef: 'HEAD', task: '', scope: '', acceptance: '',
        preview: null, text: '', creationWarning: '', createdBase: '', createdWorkspaceId: '',
      };
      emit();
      try {
        const items = await api.worktrees.list(project.id);
        if (!current(token)) return false;
        if (!Array.isArray(items)) throw new Error('Arbeitskopien konnten nicht geladen werden.');
        state.workspaces = items;
      } catch (error) {
        if (!current(token)) return false;
        state.error = errorText(error);
      }
      if (!current(token)) return false;
      state.loading = false;
      emit();
      return true;
    }

    function close() {
      ++generation;
      state = { ...state, opened: false, busy: false, loading: false };
      emit();
    }

    function update(field, value) {
      if (!state.opened || state.busy || state.loading) return false;
      if (!['provider', 'folder', 'workspaceId', 'branch', 'baseRef', 'task', 'scope', 'acceptance', 'text'].includes(field)) return false;
      if (field === 'provider' && !['claude', 'codex'].includes(value)) return false;
      if (field === 'folder' && !['new', 'project', 'existing'].includes(value)) return false;
      if (state[field] === value) return true;
      state[field] = value;
      state.error = '';
      if (field !== 'text') {
        state.preview = null;
        state.step = 'edit';
        state.text = '';
      }
      emit();
      return true;
    }

    async function preview() {
      if (!state.opened || state.busy || state.loading) return false;
      if (!state.task.trim()) { state.error = 'Bitte eine Aufgabe eingeben.'; emit(); return false; }
      if (state.folder === 'new' && !state.branch.trim()) { state.error = 'Bitte einen Namen für den neuen Branch eingeben.'; emit(); return false; }
      if (state.folder === 'existing' && !state.workspaces.some((ws) => ws.workspaceId === state.workspaceId)) {
        state.error = 'Bitte eine vorhandene Arbeitskopie auswählen.'; emit(); return false;
      }
      const token = generation;
      state.busy = true; state.error = ''; emit();
      try {
        if (state.folder === 'new') {
          const result = requireOK(await api.worktrees.create(state.project.id, {
            branch: state.branch.trim(), baseRef: state.baseRef.trim() || undefined,
          }), 'Arbeitskopie konnte nicht angelegt werden.');
          if (!current(token)) {
            notify('Die bereits beauftragte Arbeitskopie wurde angelegt. Du findest sie beim nächsten Öffnen in der Liste.');
            return false;
          }
          const ws = result.worktree;
          if (!ws || !ws.workspaceId) throw new Error('Die neue Arbeitskopie wurde nicht zurückgegeben. Bitte den Dialog erneut öffnen und die Liste prüfen.');
          state.workspaces = [...state.workspaces.filter((item) => item.workspaceId !== ws.workspaceId), ws];
          state.workspaceId = ws.workspaceId;
          state.createdWorkspaceId = ws.workspaceId;
          state.folder = 'existing';
          state.createdBase = state.baseRef.trim() || 'HEAD';
          state.creationWarning = result.projectChanges > 0
            ? `${result.projectChanges} nicht gesicherte Änderungen im Projektordner wurden nicht übernommen.` : '';
          emit();
        }
        const workspaceId = state.folder === 'existing' ? state.workspaceId : null;
        if (workspaceId) {
          const info = requireOK(await api.worktrees.inspect(workspaceId), 'Arbeitskopie konnte nicht geprüft werden.');
          if (!current(token)) return false;
          if (!info.exists) throw new Error('Diese Arbeitskopie fehlt. Bitte eine andere auswählen.');
          if (info.unreadable) throw new Error('Diese Arbeitskopie kann nicht gelesen werden.');
        }
        const result = requireOK(await api.launch.preview({
          projectId: state.project.id, workspaceId,
          task: state.task.trim(), scope: state.scope.trim(), acceptance: state.acceptance.trim(),
        }), 'Kontext konnte nicht vorbereitet werden.');
        if (!current(token)) return false;
        state.preview = result;
        state.text = result.text;
        state.step = 'preview';
        return true;
      } catch (error) {
        if (current(token)) state.error = errorText(error);
        return false;
      } finally {
        if (current(token)) { state.busy = false; emit(); }
      }
    }

    function back() {
      if (!state.opened || state.busy) return;
      state.step = 'edit'; state.error = ''; emit();
    }

    async function start() {
      if (!state.opened || state.busy || state.step !== 'preview' || !state.preview) return false;
      if (!state.text.trim()) { state.error = 'Bitte den Startkontext eingeben.'; emit(); return false; }
      const token = generation;
      state.busy = true; state.error = ''; emit();
      try {
        const prepared = requireOK(await api.launch.prepare({
          projectId: state.project.id, workspaceId: state.preview.workspaceId || null,
          provider: state.provider, text: state.text,
          expectedHead: state.preview.head, expectedCwd: state.preview.cwd, expectedBranch: state.preview.branch,
        }), 'Der Start konnte nicht vorbereitet werden.');
        if (!current(token)) return false;
        const result = await launch({ project: state.project, provider: state.provider, prepared });
        if (!current(token)) return false;
        if (result === false || result && result.ok === false) throw new Error(result && result.error || 'Der Agent konnte nicht gestartet werden.');
        close();
        return true;
      } catch (error) {
        if (current(token)) state.error = errorText(error);
        return false;
      } finally {
        if (current(token)) { state.busy = false; emit(); }
      }
    }

    return { open, close, update, preview, back, start, getState: () => state };
  }

  function create({ document: doc, api, notify, launch }) {
    let previousFocus = null;
    const el = (tag, attrs = {}, children = []) => {
      const node = doc.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'text') node.textContent = value;
        else node.setAttribute(key, value);
      }
      node.append(...children);
      return node;
    };
    const id = (name) => 'agent-launch-' + name;
    const field = (name, label, type = 'input', attrs = {}) => {
      const input = el(type, { id: id(name), ...attrs });
      return { input, label: el('label', { for: id(name), class: 'agent-launch-field' }, [el('span', { text: label }), input]) };
    };
    const button = (name, text, primary = false) => el('button', { id: id(name), type: 'button', class: primary ? 'btn-primary' : 'btn-small', text });
    const provider = field('provider', 'Agent', 'select');
    for (const [value, label] of [['claude', 'Claude Code'], ['codex', 'Codex']]) provider.input.append(el('option', { value, text: label }));
    const folder = field('folder', 'Arbeitsordner', 'select');
    for (const [value, label] of [['new', 'Neue Arbeitskopie für diese Aufgabe'], ['project', 'Projektordner verwenden'], ['existing', 'Vorhandene Arbeitskopie verwenden']]) folder.input.append(el('option', { value, text: label }));
    const workspace = field('workspace', 'Vorhandene Arbeitskopie', 'select');
    const branch = field('branch', 'Neuer Branch', 'input', { placeholder: 'z. B. feature/suche', spellcheck: 'false' });
    const base = field('base', 'Ausgangsbasis', 'input', { placeholder: 'HEAD', spellcheck: 'false' });
    const task = field('task', 'Aufgabe (erforderlich)', 'textarea', { rows: '3', required: '', placeholder: 'Was soll der Agent erledigen?' });
    const scope = field('scope', 'Erlaubte Dateien und Grenzen', 'textarea', { rows: '2', placeholder: 'z. B. nur src/suche; keine Installation' });
    const acceptance = field('acceptance', 'Woran erkennst du das Ergebnis?', 'textarea', { rows: '2', placeholder: 'z. B. Suche funktioniert per Tastatur und Tests bestehen' });
    const context = field('context', 'Vollständiger Startkontext – vor dem Start bearbeitbar', 'textarea', { rows: '16', spellcheck: 'false' });
    const summary = el('div', { id: id('summary'), class: 'agent-launch-summary' });
    const warnings = el('div', { id: id('warnings'), class: 'agent-launch-warnings' });
    const error = el('p', { id: id('error'), role: 'alert', class: 'agent-launch-error' });
    const status = el('p', { id: id('status'), role: 'status', 'aria-live': 'polite', class: 'agent-launch-note' });
    const prepare = button('prepare', 'Kontext vorbereiten', true);
    const start = button('start', 'Agent starten', true);
    const back = button('back', 'Zurück');
    const cancel = button('cancel', 'Abbrechen');
    const newFolder = el('div', { class: 'agent-launch-columns' }, [branch.label, base.label]);
    const edit = el('div', { id: id('edit') }, [
      el('div', { class: 'agent-launch-columns' }, [provider.label, folder.label]), workspace.label, newFolder,
      el('p', { class: 'agent-launch-note', text: 'Kontextstart für Claude Code und Codex. Kimi bleibt im Schnellstart verfügbar.' }),
      el('p', { class: 'agent-launch-note', text: 'Eine Git-Arbeitskopie (Worktree) trennt die Dateien. Nicht gesicherte Änderungen im Projektordner werden nicht automatisch übernommen. Ports und Datenbanken bleiben gemeinsam.' }),
      task.label, scope.label, acceptance.label,
    ]);
    const preview = el('div', { id: id('preview') }, [context.label]);
    const heading = el('h2', { id: id('title'), text: 'Agent mit Kontext starten' });
    const dialog = el('dialog', { id: id('dialog'), 'aria-labelledby': id('title'), 'aria-describedby': id('intro') }, [
      heading, el('p', { id: id('intro'), class: 'agent-launch-note', text: 'Wähle den Arbeitsordner und beschreibe den Auftrag. Der Agent startet erst mit „Agent starten“.' }),
      edit, summary, warnings, preview, status, error,
      el('div', { class: 'agent-launch-actions' }, [cancel, back, prepare, start]),
    ]);
    doc.body.append(dialog);
    let listSignature = '';
    let focusStep = '';
    let renderedPreview = null;

    function paint(state) {
      if (!state.opened) {
        if (dialog.open) dialog.close();
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
        previousFocus = null; focusStep = ''; renderedPreview = null;
        return;
      }
      if (!dialog.open) dialog.showModal();
      heading.textContent = 'Agent mit Kontext starten · ' + (state.project.name || state.project.path);
      const isPreview = state.step === 'preview';
      edit.hidden = isPreview; preview.hidden = !isPreview;
      prepare.hidden = isPreview; start.hidden = !isPreview; back.hidden = !isPreview;
      workspace.label.hidden = state.folder !== 'existing'; newFolder.hidden = state.folder !== 'new';
      const signature = JSON.stringify(state.workspaces);
      if (signature !== listSignature || !workspace.input.options.length) {
        listSignature = signature;
        workspace.input.replaceChildren(el('option', { value: '', text: 'Bitte auswählen …' }), ...state.workspaces.map((ws) =>
          el('option', { value: ws.workspaceId, text: `${ws.branch || 'ohne Branch'} · ${ws.cwd}` })));
      }
      for (const [input, value] of [[provider.input, state.provider], [folder.input, state.folder], [workspace.input, state.workspaceId],
        [branch.input, state.branch], [base.input, state.baseRef], [task.input, state.task], [scope.input, state.scope], [acceptance.input, state.acceptance], [context.input, state.text]]) {
        if (input.value !== value) input.value = value;
        input.disabled = state.busy || state.loading;
      }
      prepare.disabled = start.disabled = back.disabled = state.busy || state.loading;
      const chosen = state.folder === 'existing' ? state.workspaces.find((ws) => ws.workspaceId === state.workspaceId) : null;
      const info = state.preview || chosen;
      const detail = [
        'Ordner: ' + (info && info.cwd || (state.folder === 'project' ? state.project.path : state.folder === 'new' ? 'wird nach „Kontext vorbereiten“ angelegt' : 'bitte auswählen')),
        'Branch: ' + (info && info.branch || (state.folder === 'new' ? state.branch || 'bitte eingeben' : 'wird beim Vorbereiten geprüft')),
      ];
      if (state.folder === 'new') detail.push('Ausgangsbasis: ' + (state.baseRef.trim() || 'HEAD'));
      else if (state.createdBase && chosen && chosen.workspaceId === state.createdWorkspaceId) detail.push('Ausgangsbasis: ' + state.createdBase);
      if (state.preview && state.preview.head) detail.push('Stand: ' + state.preview.head);
      summary.textContent = detail.join('\n');
      const warningList = state.preview && Array.isArray(state.preview.warnings) ? state.preview.warnings : [];
      const hasProjectChangesWarning = warningList.some((warning) => String(warning).startsWith('Der ursprüngliche Projektordner enthält ungesicherte Änderungen'));
      warnings.textContent = [chosen && chosen.workspaceId === state.createdWorkspaceId && !hasProjectChangesWarning ? state.creationWarning : '', ...warningList].filter(Boolean).join('\n');
      warnings.hidden = !warnings.textContent;
      error.textContent = state.error; error.hidden = !state.error;
      status.textContent = state.loading ? 'Arbeitskopien werden geladen …' : state.busy ? (isPreview ? 'Start wird vorbereitet …' : 'Kontext wird vorbereitet …') : '';
      dialog.setAttribute('aria-busy', String(state.busy || state.loading));
      const step = state.step + ':' + state.loading;
      if (!state.busy && !state.loading && step !== focusStep) {
        (isPreview ? context.input : task.input).focus();
        focusStep = step;
      }
      if (isPreview && state.preview !== renderedPreview) {
        context.input.scrollTop = 0;
        renderedPreview = state.preview;
      }
    }
    const controller = createController({ api, launch, notify, onChange: paint });
    for (const [control, key] of [[provider.input, 'provider'], [folder.input, 'folder'], [workspace.input, 'workspaceId'], [branch.input, 'branch'], [base.input, 'baseRef'], [task.input, 'task'], [scope.input, 'scope'], [acceptance.input, 'acceptance'], [context.input, 'text']]) {
      control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', () => controller.update(key, control.value));
    }
    prepare.addEventListener('click', () => controller.preview());
    start.addEventListener('click', () => controller.start());
    back.addEventListener('click', () => controller.back());
    cancel.addEventListener('click', () => controller.close());
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); controller.close(); });
    dialog.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); controller.close(); }
    });
    dialog.addEventListener('keyup', (event) => event.stopPropagation());
    dialog.addEventListener('keypress', (event) => event.stopPropagation());
    dialog.addEventListener('close', () => { if (!dialog.open && controller.getState().opened) controller.close(); });
    return {
      open(options = {}) {
        if (!options.project || !options.project.id || !options.project.path) return Promise.resolve(false);
        previousFocus = doc.activeElement;
        return controller.open(options);
      },
      close: controller.close,
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createController, create };
  if (typeof window !== 'undefined') window.DeckAgentLaunch = { create, createController };
})();
