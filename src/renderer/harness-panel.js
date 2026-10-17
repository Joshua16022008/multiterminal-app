/* App-wide harness settings. Only explicit actions query models or type install text.
   Integration events bubble from el and are cancelable (listener calls preventDefault):
   harness:quickstart { label, launch: { harnessId, model?, endpointId? } }
   harness:install-terminal { harnessId, acceptTerminal(id): Promise<void> }
   The latter lets the app create/select a project terminal without extending IPC. */
(function () {
  'use strict';
  const MODEL = /^[A-Za-z0-9._:/@\[\]+-]{1,200}$/;
  const EVIDENCE = { local: 'Lokal geprüft', doc: 'Dokumentiert', 'third-party': 'Drittquelle', unconfirmed: 'Unbestätigt' };
  const TYPES = ['anthropic', 'openai', 'ollama', 'deepseek'];

  function create({ document, api, h, notify = () => {}, guard }) {
    // Sensitive operations catch their own failures before guard can log an IPC error.
    const el = h('section', { class: 'harness-panel', 'aria-label': 'Harnesses & Modelle' });
    let entries = [], endpoints = [], templates = [], error = '', loading = false, generation = 0;
    let editor = null, removing = null, ownJSON = '', exported = '', saving = false;
    const selections = new Map(), modelLists = new Map(), fetching = new Set();
    const button = (text, onclick, props = {}) => h('button', { type: 'button', class: 'btn-small', text, onclick, ...props });
    const note = text => h('p', { class: 'settings-note', text });
    const field = (label, input) => h('label', { class: 'harness-field' }, h('span', { text: label }), input);
    const input = props => h('input', { type: 'text', ...props });
    const action = async (fn, message) => {
      try { return await fn(); }
      catch (_) { error = message; paint(); return null; }
    };
    function emit(name, detail) {
      const EventClass = document.defaultView && document.defaultView.CustomEvent;
      if (!EventClass) return false;
      return !el.dispatchEvent(new EventClass(name, { bubbles: true, cancelable: true, detail }));
    }
    async function copy(text) {
      const clipboard = document.defaultView && document.defaultView.navigator && document.defaultView.navigator.clipboard;
      if (!clipboard) { notify('Kopieren ist hier nicht verfügbar. Den angezeigten Text markieren und kopieren.'); return; }
      if (await action(async () => { await clipboard.writeText(text); return true; }, 'Text konnte nicht kopiert werden.')) notify('Kopiert.', 'ok');
    }
    async function render() {
      const current = ++generation;
      loading = true; error = ''; paint();
      try {
        const result = await Promise.all([api.harness.list(), api.endpoints.list(), api.endpoints.templates()]);
        if (current !== generation) return;
        [entries, endpoints, templates] = result;
      } catch (_) {
        if (current !== generation) return;
        entries = []; endpoints = []; templates = [];
        error = 'Harnesses und Endpunkte konnten nicht geladen werden.';
      }
      if (current === generation) { loading = false; paint(); }
    }
    function selection(entry) {
      if (!selections.has(entry.id)) selections.set(entry.id, { model: entry.defaultModel || '', endpointId: '' });
      const selected = selections.get(entry.id);
      if (selected.endpointId && !endpoints.some(ep => ep.id === selected.endpointId && (entry.endpointTypes || []).includes(ep.type))) selected.endpointId = '';
      return selected;
    }
    function key(entry, selected) { return entry.id + ':' + selected.endpointId; }
    async function models(entry) {
      const selected = selection(entry), cacheKey = key(entry, selected), endpointId = selected.endpointId;
      if (fetching.has(cacheKey)) return;
      fetching.add(cacheKey); paint();
      const result = await action(() => api.harness.models(entry.id, endpointId || undefined), 'Modellliste konnte nicht geladen werden. Freitext bleibt möglich.');
      if (result) modelLists.set(cacheKey, result);
      fetching.delete(cacheKey); paint();
    }
    function quickstart(entry) {
      const selected = selection(entry), launch = { harnessId: entry.id };
      if (entry.evidence !== 'unconfirmed') {
        const model = selected.model.trim();
        if (model && !MODEL.test(model)) { error = 'Modellname ungültig: maximal 200 Zeichen, nur Buchstaben, Zahlen und . _ : / @ [ ] + -.'; paint(); return; }
        if (model) launch.model = model;
        if (selected.endpointId) launch.endpointId = selected.endpointId;
      }
      const ep = endpoints.find(p => p.id === launch.endpointId);
      const label = [entry.label, ep && ep.label, launch.model].filter(Boolean).join(' · ');
      if (!emit('harness:quickstart', { label, launch })) notify('Schnellstart kann in dieser Ansicht noch nicht angelegt werden.');
    }
    function install(entry) {
      let accepted = false;
      const handled = emit('harness:install-terminal', {
        harnessId: entry.id,
        async acceptTerminal(terminalId) {
          // A click may target only one terminal, even if multiple listeners exist.
          if (accepted || typeof terminalId !== 'string' || !terminalId) return;
          accepted = true;
          const ok = await action(() => api.harness.typeInstall(entry.id, terminalId), 'Installationsbefehl konnte nicht eingetippt werden.');
          if (ok) notify('Installationsbefehl eingetippt. Enter zum Ausführen selbst drücken.', 'ok');
        },
      });
      if (!handled) notify('Zum Anzeigen des Befehls zuerst ein Projekt mit einem Terminal öffnen.');
    }
    async function detect(id) {
      const result = await action(() => api.harness.detect(id), 'Installation konnte nicht geprüft werden.');
      if (result) {
        for (const detected of result) entries = entries.map(entry => entry.id === detected.id ? { ...entry, ...detected } : entry);
        paint();
      }
    }
    function harnessRow(entry) {
      const selected = selection(entry), uncertain = entry.evidence === 'unconfirmed';
      const modelKey = key(entry, selected), list = modelLists.get(modelKey);
      const modelInput = input({ id: 'harness-model-' + entry.id, value: selected.model,
        placeholder: 'Modellname oder Standard des CLI', disabled: uncertain,
        oninput: event => { selected.model = event.target.value; } });
      // HTMLInputElement.list is a read-only DOM property; the shared h helper
      // assigns existing properties, so this association must use the attribute.
      modelInput.setAttribute('list', 'harness-models-' + entry.id);
      const endpointSelect = h('select', { id: 'harness-endpoint-' + entry.id, disabled: uncertain,
        onchange: event => {
          selected.endpointId = event.target.value;
          const endpoint = endpoints.find(ep => ep.id === selected.endpointId);
          if (endpoint && endpoint.defaultModel) selected.model = endpoint.defaultModel;
          paint();
        } }, h('option', { value: '', text: 'Standard des CLI' }),
      ...endpoints.filter(ep => (entry.endpointTypes || []).includes(ep.type)).map(ep => h('option', { value: ep.id, text: ep.label })));
      endpointSelect.value = selected.endpointId;
      const docs = /^https?:\/\//.test(entry.docsUrl || '') ? h('a', { href: entry.docsUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Dokumentation' }) : null;
      return h('article', { class: 'harness-card', 'data-harness-id': entry.id },
        h('div', { class: 'harness-heading' }, h('h4', { text: entry.label }),
          h('span', { class: 'harness-badge' + (entry.installed ? ' installed' : ''), text: entry.installed ? 'Installiert' : 'Fehlt' }),
          h('span', { class: 'harness-badge evidence-' + entry.evidence, text: EVIDENCE[entry.evidence] || 'Unbestätigt' }), docs),
        entry.path ? h('code', { class: 'harness-path', text: entry.path }) : null,
        entry.version ? note('Version: ' + entry.version) : null,
        button('Installation / Version prüfen', () => detect(entry.id)),
        uncertain ? note('Unbestätigt: startet nur mit dem Grundbefehl, ohne Modell- und Fortsetzen-Optionen.') : null,
        entry.kind === 'web' ? note('Öffnet einen lokalen Webdienst im Terminal. Die ausgegebene URL im Browser öffnen.') : null,
        h('div', { class: 'harness-model-row' }, field('Modell', modelInput),
          h('datalist', { id: 'harness-models-' + entry.id }, ...(list && list.models || []).map(model => h('option', { value: model }))),
          button(fetching.has(modelKey) ? 'Lädt…' : 'Modellliste aktualisieren', () => models(entry), { disabled: uncertain || fetching.has(modelKey) }),
          field('Endpunkt', endpointSelect)),
        list ? note(list.error ? 'Modellquelle nicht erreichbar. Modellnamen können frei eingegeben werden.' : 'Modellquelle: ' + list.source + ' · ' + list.models.length + ' Modelle') : null,
        selected.endpointId && entry.id === 'claude' ? note('Eigener Claude-Konfigordner pro Endpunkt; Kontowahl entfällt. Anmeldungen und Verlauf bleiben getrennt.') : null,
        h('div', { class: 'harness-actions' }, button('Als Schnellstart anlegen', () => quickstart(entry), { disabled: !entry.installed }),
          button('Katalog-JSON exportieren', async () => {
            const value = await action(() => api.harness.export(entry.id), 'Katalogeintrag konnte nicht exportiert werden.');
            if (typeof value === 'string') { exported = value; paint(); }
          }),
          entry.builtin ? null : button('Eigenen Eintrag entfernen', () => { removing = { kind: 'harness', id: entry.id, label: entry.label }; paint(); })),
        ...(!entry.installed ? (entry.install || []).map((item, index) => h('div', { class: 'harness-install' },
          h('code', { text: item.display }), button(item.method === 'manual' ? 'Dokumentationshinweis kopieren' : 'Installationsbefehl kopieren', () => copy(item.display)),
          item.method !== 'manual' && index === (entry.install || []).findIndex(option => option.method !== 'manual')
            ? button('Ohne Enter im Terminal anzeigen', () => install(entry)) : null)) : []));
    }
    function editEndpoint(profile = {}) {
      editor = { id: profile.id, label: profile.label || '', type: profile.type || 'anthropic', baseUrl: profile.baseUrl || '',
        defaultModel: profile.defaultModel || '', modelMap: profile.modelMap ? JSON.stringify(profile.modelMap, null, 2) : '',
        isolateClaudeConfig: profile.isolateClaudeConfig !== false, hasSecret: Boolean(profile.hasSecret) };
      error = ''; paint();
    }
    async function saveEndpoint(password) {
      if (saving || !editor) return;
      // The password never enters editor/state, a returned profile, an error or a notification.
      let secret = password.value;
      password.value = '';
      const draft = { ...editor };
      const profile = { label: draft.label.trim(), type: draft.type, baseUrl: draft.baseUrl.trim(),
        defaultModel: draft.defaultModel.trim() || null, isolateClaudeConfig: draft.isolateClaudeConfig };
      if (draft.id) profile.id = draft.id;
      try {
        if (!profile.label || !profile.baseUrl) throw new Error();
        if (profile.defaultModel && !MODEL.test(profile.defaultModel)) throw new Error();
        profile.modelMap = draft.modelMap.trim() ? JSON.parse(draft.modelMap) : null;
        if (profile.modelMap && (typeof profile.modelMap !== 'object' || Array.isArray(profile.modelMap))) throw new Error();
      } catch (_) { secret = ''; error = 'Bezeichnung, URL, Modell oder Modellzuordnung prüfen (JSON-Objekt).'; paint(); return; }
      error = ''; saving = true; paint();
      try {
        await api.endpoints.save(profile, secret || undefined);
        if (editor === null || editor.id === draft.id) editor = null;
        notify('Endpunkt gespeichert.', 'ok');
      } catch (_) { error = 'Endpunkt konnte nicht gespeichert werden. Schlüssel bei Bedarf erneut eingeben.'; }
      finally { secret = ''; saving = false; }
      if (!error) await render(); else paint();
    }
    function endpointEditor() {
      if (!editor) return null;
      const draft = editor;
      const text = (name, props = {}) => input({ value: draft[name], oninput: event => { draft[name] = event.target.value; }, ...props });
      const type = h('select', { id: 'harness-endpoint-type', onchange: event => { draft.type = event.target.value; } }, ...TYPES.map(value => h('option', { value, text: value })));
      type.value = draft.type;
      const password = input({ type: 'password', id: 'harness-endpoint-secret', autocomplete: 'new-password', value: '',
        placeholder: draft.hasSecret ? 'Gespeichert · leer lassen zum Beibehalten' : 'Optionaler API-Schlüssel' });
      const mapping = h('textarea', { id: 'harness-endpoint-map', value: draft.modelMap, rows: 3,
        placeholder: '{"haiku":"deepseek-flash"}', oninput: event => { draft.modelMap = event.target.value; } });
      const isolate = input({ type: 'checkbox', checked: draft.isolateClaudeConfig,
        onchange: event => { draft.isolateClaudeConfig = event.target.checked; } });
      return h('section', { class: 'harness-editor', 'aria-label': 'Endpunkt bearbeiten' },
        h('h4', { text: draft.id ? 'Endpunkt bearbeiten' : 'Neuer Endpunkt' }),
        field('Bezeichnung', text('label', { id: 'harness-endpoint-label' })), field('Typ', type),
        field('Base-URL', text('baseUrl', { id: 'harness-endpoint-url', type: 'url' })),
        field('Standardmodell', text('defaultModel', { id: 'harness-endpoint-model' })),
        field('Modellzuordnung (JSON, optional)', mapping), field('API-Schlüssel', password),
        h('label', { class: 'harness-check' }, isolate, h('span', { text: 'Claude-Konfiguration pro Endpunkt isolieren (empfohlen)' })),
        note('Schlüssel werden im macOS-Schlüsselbund gespeichert. Ein leeres Feld behält den bisherigen Schlüssel.'),
        h('div', { class: 'harness-actions' }, button(saving ? 'Speichert…' : 'Endpunkt speichern', () => saveEndpoint(password), { disabled: saving }),
          button('Abbrechen', () => { password.value = ''; editor = null; paint(); }, { disabled: saving })));
    }
    async function confirmRemove() {
      const item = removing;
      if (!item || saving) return;
      saving = true; paint();
      const ok = await action(() => item.kind === 'endpoint' ? api.endpoints.remove(item.id) : api.harness.removeOwn(item.id), 'Eintrag konnte nicht entfernt werden.');
      saving = false;
      if (ok) { removing = null; await render(); } else paint();
    }
    function paint() {
      const templateSelect = h('select', { id: 'harness-endpoint-template', disabled: saving, onchange: event => {
        const template = templates.find(item => item.id === event.target.value);
        if (template) editEndpoint({ ...template, id: undefined, hasSecret: false });
      } }, h('option', { value: '', text: 'Vorlage wählen…' }), ...templates.map(item => h('option', { value: item.id, text: item.label })));
      const children = [h('h3', { text: 'Harnesses & Modelle' }),
        note('Agenten-CLIs, Modellwahl und Anbieter-Endpunkte. Modelllisten werden erst auf Klick abgefragt; Installationsbefehle werden ohne Enter angezeigt.'),
        error ? h('p', { class: 'settings-note err', role: 'alert', text: error }) : null,
        loading ? note('Katalog wird geladen…') : null,
        button('Katalog neu laden', render, { disabled: loading || saving }),
        h('div', { class: 'harness-catalog' }, ...entries.map(harnessRow)),
        h('section', { class: 'harness-endpoints' }, h('h3', { text: 'Endpunkt-Profile' }),
          ...endpoints.map(endpoint => h('div', { class: 'harness-endpoint', 'data-endpoint-id': endpoint.id },
            h('strong', { text: endpoint.label }), h('code', { text: endpoint.baseUrl }),
            h('span', { text: endpoint.type + ' · ' + (endpoint.hasSecret ? 'Schlüssel gespeichert' : 'Kein Schlüssel') }),
            button('Bearbeiten', () => editEndpoint(endpoint), { disabled: saving }),
            button('Endpunkt entfernen', () => { removing = { kind: 'endpoint', id: endpoint.id, label: endpoint.label }; paint(); }, { disabled: saving }))),
          h('div', { class: 'harness-actions' }, button('Endpunkt hinzufügen', () => editEndpoint(), { disabled: saving }), field('Anbieter-Vorlage', templateSelect)), endpointEditor()),
        removing ? h('div', { class: 'harness-confirm', role: 'alert' }, note('„' + removing.label + '“ entfernen?' + (removing.kind === 'endpoint' ? ' Der zugehörige Schlüsselbund-Eintrag wird ebenfalls gelöscht.' : '')),
          button('Entfernen bestätigen', confirmRemove, { disabled: saving }), button('Behalten', () => { removing = null; paint(); }, { disabled: saving })) : null,
        h('section', { class: 'harness-own' }, h('h3', { text: 'Eigener Katalogeintrag' }),
          note('Einen vollständigen Katalogeintrag als JSON einfügen. Eigene Einträge können wieder exportiert und als Community-Beitrag geteilt werden.'),
          field('Katalog-JSON', h('textarea', { id: 'harness-own-json', rows: 7, value: ownJSON, spellcheck: false, oninput: event => { ownJSON = event.target.value; } })),
          button('JSON importieren', async () => {
            let parsed;
            try { parsed = JSON.parse(ownJSON); } catch (_) { error = 'Ungültiges JSON. Bitte den Katalogeintrag prüfen.'; paint(); return; }
            const result = await action(() => api.harness.addOwn(parsed), 'Katalogeintrag ungültig oder konnte nicht gespeichert werden.');
            if (result) { ownJSON = ''; await render(); }
          }),
          exported ? field('Exportiertes Katalog-JSON', h('textarea', { id: 'harness-export-json', rows: 7, value: exported, readonly: true })) : null,
          exported ? button('Export kopieren', () => copy(exported)) : null)];
      el.replaceChildren(...children.filter(Boolean));
    }
    // Keep the required factory surface small; mounting code explicitly calls render().
    paint();
    return { el, render };
  }
  const exported = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (typeof window !== 'undefined') window.DeckHarnessPanel = exported;
})();
