/* Local profiles and discovered provider resources. Never activates native instructions. */
(function () {
  'use strict';
  const D = (window.DeckApp = window.DeckApp || {}), h = D.h;
  const labels = { claude: 'Claude Code', codex: 'Codex', kimi: 'Kimi' };
  const tabs = { profile: 'Profil', quota: 'Kontingente', skills: 'Skills', plugins: 'Plugins', mods: 'Mods', libraries: 'Bibliotheken', hotkeys: 'Hotkeys' };
  const HK = window.DeckHotkeys;
  let hotkeyDraft = null, hotkeyOriginal = null, hotkeyDefaults = null, hotkeyPlatform = 'darwin', recording = null, recordingGeneration = 0;
  const copyBindings = value => Object.fromEntries(Object.entries(value).map(([id, bindings]) => [id, [...bindings]]));
  function hotkeyDirty() { return hotkeyDraft && JSON.stringify(hotkeyDraft) !== JSON.stringify(hotkeyOriginal); }
  const drafts = new Map();
  let root, opts = {}, open = false, scope = 'claude', tab = 'profile', overview = [], error = '', message = '';
  let overviewGeneration = 0, generation = 0, quotaGeneration = 0, previewGeneration = 0, timer, previousFocus, search = '', page = 0, busy = false;
  let accounts = [], usage = [], updated = null, sortByUsage = false, claudeUsage = null;
  function button(text, action, props = {}) { return h('button', { class: 'btn-small', text, onclick: action, type: 'button', ...props }); }
  function note(text) { return h('p', { class: 'settings-note', text }); }
  function fail(e) { error = D.errText(e); }
  function dirty() { if (tab === 'hotkeys') return hotkeyDirty(); const d = drafts.get(scope); return d && d.text !== d.original; }
  function mayLeave() { return !dirty() || window.confirm('Deine Änderungen sind noch nicht gespeichert. Ansicht wechseln? Der Entwurf bleibt bis zum Schließen der App erhalten.'); }
  function provider() { return overview.find(p => p.id === scope || p.provider === scope); }
  async function reloadOverview() {
    const my = ++overviewGeneration;
    try {
      const r = await window.deck.settings.overview(typeof opts.projectId === 'function' ? opts.projectId() : opts.projectId);
      if (!open || my !== overviewGeneration) return;
      overview = r.providers || []; error = ''; previewGeneration++; render();
    } catch (e) { if (open && my === overviewGeneration) { fail(e); render(); } }
  }
  async function openFolder() {
    const selected = scope, my = overviewGeneration;
    try { await window.deck.settings.openFolder(selected); if (open && my === overviewGeneration) await reloadOverview(); }
    catch (e) { if (open && my === overviewGeneration) { fail(e); render(); } }
  }
  function folderButton() { return button('Agent-Ordner öffnen', openFolder, { title: 'Öffnet den eigenen Anbieter-Ordner mit Skills, Plugins, Mods und Bibliothek. Fehlende Ordner werden angelegt.' }); }
  function syncTimer() {
    clearInterval(timer); timer = null;
    if (open && tab === 'quota') timer = setInterval(loadQuota, 60000);
  }
  async function loadProfile() {
    const selected = scope, my = generation;
    if (drafts.has(selected)) return;
    try {
      const r = await window.deck.settings.readProfile(selected);
      if (!drafts.has(selected)) drafts.set(selected, { ...r, text: r.text || '', original: r.text || '' });
    } catch (e) { if (my === generation) fail(e); }
    if (open && my === generation && scope === selected && tab === 'profile') render();
  }
  async function save() {
    const selected = scope, d = drafts.get(selected);
    if (!d || busy) return;
    const text = d.text; busy = true; error = ''; message = ''; render();
    try {
      const r = await window.deck.settings.saveProfile(selected, text, d.revision);
      drafts.set(selected, { ...r, text: d.text, original: text });
      if (scope === selected) message = 'Profil gespeichert.';
    } catch (e) { fail(e); }
    busy = false; if (open) render();
  }
  async function loadQuota() {
    if (!open || tab !== 'quota') return;
    const my = ++quotaGeneration;
    try {
      const result = await Promise.all([window.deck.accounts.list(), window.deck.usage.list(), window.deck.usage.claudeStatus ? window.deck.usage.claudeStatus().catch(() => null) : null]);
      if (!open || my !== quotaGeneration || tab !== 'quota') return;
      [accounts, usage] = result; claudeUsage = result[2] && result[2].state; updated = new Date(); error = '';
    } catch (e) { if (my === quotaGeneration) fail(e); }
    if (open && tab === 'quota' && my === quotaGeneration) render();
  }
  function select(nextScope, nextTab) {
    if (!mayLeave()) return;
    stopRecording();
    scope = nextScope; tab = nextTab;
    generation++; previewGeneration++; search = ''; page = 0; error = ''; message = '';
    render(); syncTimer();
    if (tab === 'profile') loadProfile();
    if (tab === 'quota') loadQuota();
    if (tab === 'hotkeys') loadHotkeys();
  }
  async function loadHotkeys() {
    if (hotkeyDraft) return;
    const my = generation;
    try {
      const result = await window.deck.hotkeys.get();
      if (!open || my !== generation || tab !== 'hotkeys') return;
      hotkeyDraft = copyBindings(result.bindings); hotkeyOriginal = copyBindings(result.bindings);
      hotkeyDefaults = result.defaults; hotkeyPlatform = result.platform; error = '';
    } catch (e) { if (my === generation) fail(e); }
    if (open && my === generation) render();
  }
  function stopRecording() {
    recordingGeneration++;
    const hadRecording = !!recording;
    recording = null;
    if (hadRecording) window.deck.hotkeys.capture(false).catch(fail);
  }
  async function recordHotkey(action, index) {
    stopRecording();
    const my = recordingGeneration;
    recording = { action, index, ready: false }; error = ''; message = ''; render();
    try {
      await window.deck.hotkeys.capture(true);
      if (my !== recordingGeneration || !open || tab !== 'hotkeys') return;
      recording.ready = true; render();
      root.querySelector('.hotkey-recording')?.focus();
    } catch (e) { stopRecording(); fail(e); if (open) render(); }
  }
  function changeHotkey(action, bindings) {
    try {
      hotkeyDraft = HK.validate({ ...hotkeyDraft, [action]: bindings }, hotkeyPlatform);
      error = ''; message = '';
    } catch (e) { fail(e); }
    render();
  }
  async function saveHotkeys() {
    if (busy || !hotkeyDraft) return;
    stopRecording(); busy = true; error = ''; message = ''; render();
    try {
      const saved = await window.deck.hotkeys.save(hotkeyDraft);
      hotkeyDraft = copyBindings(saved); hotkeyOriginal = copyBindings(saved);
      message = 'Hotkeys gespeichert. Die Belegung ist sofort aktiv.';
    } catch (e) { fail(e); }
    busy = false; if (open) render();
  }
  function hotkeysView(body) {
    body.append(h('h2', { text: 'Hotkeys' }), note('Gilt für die gesamte App und alle Agenten. Klicke auf ein Kürzel und drücke die neue Kombination mit ⌘ oder Strg. Esc bricht die Aufnahme ab. Bis zu zwei Kürzel pro Aktion.'), note('Änderungen werden erst mit „Hotkeys speichern“ aktiv. Bearbeitungs- und Systemkürzel bleiben reserviert.'));
    if (!hotkeyDraft) { body.append(note(error ? 'Hotkeys konnten nicht geladen werden.' : 'Hotkeys werden geladen …')); return; }
    const list = h('div', { class: 'hotkey-list' });
    for (const { id, label } of HK.actions) {
      const bindings = hotkeyDraft[id], controls = h('div', { class: 'hotkey-controls' });
      bindings.forEach((binding, index) => {
        const active = recording && recording.action === id && recording.index === index;
        controls.append(h('span', { class: 'hotkey-pair' }, button(active ? (recording.ready ? 'Kombination drücken …' : 'Aufnahme startet …') : HK.format(binding), () => recordHotkey(id, index), { class: 'btn-small hotkey-binding' + (active ? ' hotkey-recording' : ''), disabled: busy, 'aria-label': label + ': ' + (active ? 'Kombination aufnehmen' : 'Kürzel ' + (index + 1) + ' ändern'), 'data-action': id, 'data-index': index }), button('×', () => { stopRecording(); changeHotkey(id, bindings.filter((_, i) => i !== index)); }, { disabled: busy, 'aria-label': label + ': Kürzel ' + (index + 1) + ' entfernen' })));
      });
      if (bindings.length < 2) {
        const active = recording && recording.action === id && recording.index === bindings.length;
        controls.append(button(active ? (recording.ready ? 'Kombination drücken …' : 'Aufnahme startet …') : '+ Kürzel', () => recordHotkey(id, bindings.length), { class: 'btn-small hotkey-binding' + (active ? ' hotkey-recording' : ''), disabled: busy, 'aria-label': label + ': Kürzel hinzufügen', 'data-action': id, 'data-index': bindings.length }));
      }
      controls.append(button('Standard', () => { stopRecording(); changeHotkey(id, [...hotkeyDefaults[id]]); }, { disabled: busy, 'aria-label': label + ': Standard wiederherstellen' }));
      list.append(h('div', { class: 'hotkey-row', 'data-hotkey-action': id }, h('div', { class: 'hotkey-info' }, h('strong', { text: label }), note('Standard: ' + hotkeyDefaults[id].map(HK.format).join(' / ')), !bindings.length ? note('Deaktiviert') : null), controls));
    }
    body.append(list, h('div', { class: 'settings-save hotkey-save' }, button(busy ? 'Speichert …' : 'Hotkeys speichern', saveHotkeys, { class: 'btn-primary', disabled: busy || !hotkeyDirty() || !!recording }), button('Alle auf Standard zurücksetzen', () => { stopRecording(); hotkeyDraft = copyBindings(hotkeyDefaults); error = ''; message = ''; render(); }, { disabled: busy }), hotkeyDirty() ? note('Ungespeicherte Änderungen') : null));
    if (recording) body.append(button('Aufnahme abbrechen', () => { stopRecording(); render(); }));
  }
  async function preview(item) {
    const my = ++previewGeneration;
    const pane = root.querySelector('.settings-preview');
    if (!pane) return;
    pane.replaceChildren(h('h3', { text: item.name || 'Quelldatei' }), note('Wird geladen …')); pane.hidden = false;
    try {
      const r = await window.deck.settings.readResource(item.id);
      if (my !== previewGeneration || !open || !pane.isConnected) return;
      pane.replaceChildren(h('div', { class: 'settings-preview-head' }, h('h3', { text: item.name || 'Quelldatei' }), button('Vorschau schließen', () => { previewGeneration++; pane.hidden = true; })), note(r.path), h('pre', { class: 'settings-source', text: r.text }));
    } catch (e) { if (my === previewGeneration && pane.isConnected) pane.replaceChildren(note(D.errText(e)), button('Vorschau schließen', () => { pane.hidden = true; })); }
  }
  const statusLabels = { enabled: 'Aktiviert', installed: 'Installiert', found: 'Gefunden', 'app-only': 'Nur Multiterminal', 'native-file': 'Anbieter-Datei', disabled: 'Deaktiviert', available: 'Verfügbar', detected: 'Gefunden', directory: 'Ordner', unknown: 'Unbekannt' };
  const KIMI_VARS = ['skills', 'agents_md', 'cwd', 'cwd_listing', 'os', 'shell', 'now', 'additional_dirs_info', 'base_prompt', 'plugin_sections', 'windows_notes', 'additional_dirs_section', 'skills_section'];
  function ago(ms) {
    if (!ms) return 'unbekannt';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 90) return 'gerade eben';
    const m = Math.round(s / 60); if (m < 60) return 'vor ' + m + ' Min.';
    const hr = Math.round(m / 60); if (hr < 36) return 'vor ' + hr + ' Std.';
    const d = Math.round(hr / 24); return d === 1 ? 'vor 1 Tag' : 'vor ' + d + ' Tagen';
  }
  function activationText(item) {
    return ({ native: 'Für ' + labels[scope] + ' aktiv (nativ vorhanden)', app: 'Aktiv über Multiterminal (Link im Skill-Ordner)', none: 'Nicht aktiv', changed: 'Verändert: der Link entspricht nicht mehr der Zuordnung' })[item.activation] || '';
  }
  function usageText(item) {
    const u = item.usage;
    if (!u || typeof u === 'string' || u.evidence === 'none') return 'Nutzung: keine Quelle';
    if (u.evidence === 'pending') return 'Nutzung: Auswertung läuft noch';
    if (u.evidence === 'failed') return 'Nutzung: Auswertung fehlgeschlagen';
    if (!u.count) return u.evidence === 'read' ? 'Nutzung: kein Hinweis in Tool-Aufrufen (kein Ausführungsbeleg)' : 'Nutzung: kein Beleg in den ausgewerteten Sitzungen';
    return u.evidence === 'read' ? 'In Tool-Aufrufen erwähnt ' + u.count + '× · zuletzt ' + ago(u.lastUsedAt) + ' (kein Lese- oder Ausführungsbeleg)' : 'Ausgeführt ' + u.count + '× · zuletzt ' + ago(u.lastUsedAt);
  }
  function canAssign() { return !!(window.deck.settings.assignSkill && window.deck.settings.unassignSkill); }
  async function runAssignment(item, assign) {
    const p = provider(), selected = scope, target = item.assignTarget || (p && p.skillTarget ? p.skillTarget.path + '/' + item.name : item.name);
    const sharedNote = p && p.skillTarget && p.skillTarget.note ? '\n\n' + p.skillTarget.note : '';
    const ask = assign
      ? 'Skill „' + item.name + '“ für ' + labels[scope] + ' aktivieren?\n\nEs wird ein Link angelegt:\n' + target + '\n\nDas verändert einen Ordner von ' + labels[scope] + ' außerhalb von Multiterminal. Vorhandene Dateien werden nicht überschrieben.' + sharedNote
      : 'Zuordnung von „' + item.name + '“ zurücknehmen?\n\nEntfernt wird nur der von Multiterminal angelegte Link:\n' + target + '\n\nDer Skill selbst bleibt unverändert.';
    if (!window.confirm(ask)) return;
    try {
      assign ? await window.deck.settings.assignSkill(selected, item.id) : await window.deck.settings.unassignSkill(selected, item.name);
      error = ''; message = assign ? '„' + item.name + '“ ist jetzt für ' + labels[selected] + ' aktiv. Neue Sitzungen sehen den Skill.' : 'Zuordnung von „' + item.name + '“ zurückgenommen.';
    } catch (e) { fail(e); message = ''; }
    if (open) { render(); await reloadOverview(); }
  }
  function resourceRow(item) {
    const skills = tab === 'skills';
    const meta = [item.source, item.from ? 'von ' + item.from : null, statusLabels[item.status] || item.status].filter(Boolean).join(' · ');
    const lines = [h('div', { class: 'settings-resource-meta', text: (skills ? 'Gefunden: ' : '') + meta })];
    if (skills && item.activation) lines.push(h('div', { class: 'settings-resource-meta', text: activationText(item) }));
    if (skills && !item.from) lines.push(h('div', { class: 'settings-resource-meta', text: usageText(item) }));
    const actions = [item.readable ? button('Ansehen', () => preview(item)) : null];
    if (skills && canAssign()) {
      if (item.assignable) actions.push(button('Für ' + labels[scope] + ' aktivieren', () => runAssignment(item, true)));
      if (item.activation === 'app') actions.push(button('Zuordnung zurücknehmen', () => runAssignment(item, false)));
    }
    actions.push(button('Im Finder', async () => { try { await window.deck.settings.reveal(item.id); } catch (e) { fail(e); render(); } }));
    return h('div', { class: 'settings-resource' }, h('div', { class: 'settings-resource-info' }, h('strong', { text: item.name }), note(item.description || item.path), ...lines), h('div', { class: 'settings-actions' }, ...actions));
  }
  async function toggleLoad(selected, enabled) {
    const d = drafts.get(selected); busy = true; render();
    try {
      await window.deck.settings.setLoadAtStart(selected, enabled);
      const r = await window.deck.settings.readProfile(selected);
      const kept = drafts.get(selected);
      drafts.set(selected, { ...kept, loadAtStart: r.loadAtStart, appliesTo: r.appliesTo });
      error = ''; message = enabled ? 'Profil wird bei neuen Terminals geladen.' : 'Profil wird nicht mehr automatisch geladen.';
    } catch (e) { fail(e); if (d) drafts.set(selected, d); }
    busy = false; if (open) render();
  }
  function loadSwitch() {
    const d = drafts.get(scope), selected = scope, canSet = d && window.deck.settings.setLoadAtStart;
    const box = h('input', { type: 'checkbox', id: 'settings-load-at-start', checked: !!(d && d.loadAtStart), disabled: busy || !canSet });
    box.addEventListener('change', () => toggleLoad(selected, box.checked));
    const resume = scope === 'kimi' ? ' Beim Fortsetzen einer Kimi-Sitzung wird kein Flag angehängt; die Sitzung behält das Profil, mit dem sie gestartet wurde.' : '';
    return h('div', { class: 'settings-load' }, h('label', { for: 'settings-load-at-start' }, box, h('span', { text: ' Profil beim Start aus Multiterminal laden' })),
      note('Wirkt nur für Terminals, die danach aus Multiterminal gestartet werden (Claude Code, Codex, Kimi per Schnellstart). Es werden keine Dateien der CLI geändert; der Anbieter erhält zusätzlich dieses Profil, seine eigenen Hinweise bleiben wirksam. Ein leeres Profil wird nicht geladen.' + (scope === 'kimi' ? ' Kimi behandelt ${…} im Profil als Platzhalter und ersetzt bekannte Namen (z. B. ${cwd}) durch eigene Inhalte; eine Maskierung nennt die Kimi-Doku nicht.' : '') + resume), window.deck.settings.setLoadAtStart ? null : note('Dieser Schalter wird nach dem nächsten Update der App aktiv.'));
  }
  function profileView(body) {
    body.append(h('h2', { text: labels[scope] + ': Ziele und Arbeitsweise' }), note('Dein eigenes Profil für ' + labels[scope] + ': Ziele, Vorlieben und Anweisungen als Markdown. Dieses Profil ist von den anderen Anbietern getrennt.'), note('In Multiterminal gespeichert. Ob ein Agent es erhält, bestimmt der Schalter unten.'));
    body.append(h('div', { class: 'settings-folder-actions' }, folderButton()));
    body.append(loadSwitch());
    const d = drafts.get(scope);
    if (d) {
      const saveBtn = button(busy ? 'Speichert …' : 'Profil speichern', save, { disabled: busy || !dirty(), class: 'btn-primary' });
      const indicator = h('span', { class: 'settings-note', text: dirty() ? 'Ungespeicherter Entwurf' : d.exists ? 'Gespeichert' : 'Noch kein Profil gespeichert' });
      const editor = h('textarea', { class: 'settings-editor', value: d.text, spellcheck: false, 'aria-label': labels[scope] + ' – Ziele und Anweisungen', placeholder: '# Ziele\n\n# Arbeitsweise\n\n# Anweisungen', disabled: busy });
      const warn = h('p', { class: 'settings-note settings-warn' });
      const refreshWarn = () => { const found = scope === 'kimi' ? KIMI_VARS.filter(v => new RegExp('\\$\\{\\s*' + v + '\\s*\\}').test(d.text)) : []; warn.textContent = found.length ? 'Achtung: Kimi ersetzt ' + found.map(v => '${' + v + '}').join(', ') + ' beim Start durch eigene Inhalte.' : ''; warn.hidden = !found.length; };
      refreshWarn();
      editor.addEventListener('input', () => { d.text = editor.value; refreshWarn(); saveBtn.disabled = busy || !dirty(); indicator.textContent = dirty() ? 'Ungespeicherter Entwurf' : 'Gespeichert'; });
      editor.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } });
      body.append(editor, warn, h('div', { class: 'settings-save' }, saveBtn, indicator, button('Gespeicherten Stand laden', async () => {
        if (dirty() && !window.confirm('Gespeicherten Stand laden und diesen Entwurf verwerfen?')) return;
        const selected = scope, my = generation;
        try { const r = await window.deck.settings.readProfile(selected); if (my !== generation || scope !== selected || !open) return; drafts.set(selected, { ...r, text: r.text || '', original: r.text || '' }); error = ''; message = ''; render(); }
        catch (e) { if (my === generation && open) { fail(e); render(); } }
      }, { disabled: busy })), note(d.path || ''));
    } else body.append(note(error ? 'Profil konnte nicht geladen werden.' : 'Profil wird geladen …'));
    const p = provider();
    if (p && (p.instructions || []).length) body.append(h('h3', { text: 'Vorhandene Anbieter-Anweisungen' }), note('Quelldateien zur Ansicht. Ob der Anbieter sie lädt, hängt von seinem Aufruf und Arbeitsordner ab.'), ...p.instructions.map(resourceRow));
  }
  async function toggleStatusline(enable) {
    try { enable ? await window.deck.usage.claudeEnable() : await window.deck.usage.claudeDisable(); error = ''; message = enable ? 'Claude-Verbrauch ist aktiviert. Er erscheint, sobald ein neu gestartetes Claude-Terminal antwortet.' : 'Claude-Verbrauch ist deaktiviert.'; }
    catch (e) { fail(e); message = ''; }
    await loadQuota();
  }
  function claudeSetup() {
    if (claudeUsage === 'fremd') return note('In den Claude-Einstellungen ist schon eine eigene Statuszeile gesetzt. Sie bleibt unverändert, daher gibt es keinen Claude-Verbrauch.');
    if (claudeUsage === 'aktiv') return h('div', { class: 'settings-folder-actions' }, note('Claude-Verbrauch ist aktiviert.'), button('Claude-Verbrauch deaktivieren', () => toggleStatusline(false), { title: 'Entfernt die Statuszeile aus ~/.claude/settings.json' }));
    if (claudeUsage === 'aus' || claudeUsage === 'veraltet') return h('div', { class: 'settings-load' }, note((claudeUsage === 'veraltet' ? 'Die eingetragene Statuszeile gehört zu einer älteren App-Version. ' : 'Claude liefert den Verbrauch nur über eine Statuszeile. ') + 'Aktivieren trägt sie in ~/.claude/settings.json ein und gilt für alle Claude-Konten.'), button(claudeUsage === 'veraltet' ? 'Claude-Verbrauch erneuern' : 'Claude-Verbrauch aktivieren', () => toggleStatusline(true)));
    return null;
  }
  function quotaView(body) {
    body.append(h('div', { class: 'settings-section-head' }, h('h2', { text: 'Kontingente je Konto' }), button('Aktualisieren', loadQuota), button('Konten verwalten', () => opts.onAccounts && opts.onAccounts())));
    if (scope === 'kimi') { body.append(note('Für Kimi gibt es keine lokale Quelle für Kontingente. Multiterminal zeigt hier deshalb nichts an.')); return; }
    body.append(note('Aktualisiert alle 60 Sekunden, solange diese Ansicht geöffnet ist.'), updated ? note('Zuletzt abgefragt: ' + updated.toLocaleTimeString()) : note('Kontingente werden geladen …'));
    if (scope === 'claude') { const setup = claudeSetup(); if (setup) body.append(setup); }
    const p = accounts.find(a => a.provider === scope || a.id === scope);
    const list = p ? p.accounts || [] : [];
    if (!list.length) body.append(note('Für diesen Anbieter wurden keine Konten gefunden.'));
    for (const a of list) {
      const r = usage.find(u => u.accountId === a.id);
      const box = h('section', { class: 'settings-quota' }, h('h3', { text: a.label + (a.active ? ' (aktiv)' : '') }));
      if (r) {
        const age = r.capturedAt ? (r.stale ? 'Veraltet, Stand ' : 'Stand ') + ago(r.capturedAt) : 'Noch kein Stand erfasst';
        box.append(note(age));
        if (window.DeckUsage) box.append(window.DeckUsage.buildAccountRow(r, null));
        if (r.note && !(r.windows || []).length) box.append(note('Grund: ' + r.note));
      } else box.append(note('Noch keine Verbrauchsdaten. Öffne das Konto in der Kontenverwaltung für Hinweise zur Einrichtung.'));
      body.append(box);
    }
  }
  function usageScope(p) {
    const u = p && p.usage;
    if (!u) return null;
    if (u.evidence === 'none' && u.status === 'ready') return scope === 'kimi' ? 'Kimi: keine belegte Protokollquelle, die Nutzung wird nicht erfasst.' : null;
    const parts = [labels[scope] + ': ' + (u.status === 'ready' ? u.scannedFiles + ' Sitzungen ausgewertet' : u.note)];
    if (u.status === 'ready' && u.skippedFiles) parts.push(u.skippedFiles + ' nicht ausgewertet');
    if (u.status === 'ready' && u.note) parts.push(u.note);
    return parts.join(' · ');
  }
  function usageRank(i) { return i.usage && typeof i.usage === 'object' ? (i.usage.count || 0) * 1e13 + (i.usage.lastUsedAt || 0) : 0; }
  function inventoryView(body) {
    const p = provider(), items = p && p.categories ? p.categories[tab] || [] : [];
    const skills = tab === 'skills';
    body.append(h('h2', { text: tabs[tab] }), note(skills ? 'Gefundene Skills mit drei getrennten Angaben: wo er liegt, ob ihn dieser Agent verwendet (aktiv) und ob es einen Nutzungsbeleg gibt.' : 'Gefundene lokale Ressourcen. Hier wird nichts installiert oder automatisch aktiviert.'));
    if (tab === 'plugins') body.append(note('Plugins werden über die jeweilige CLI aktiviert oder deaktiviert' + (scope === 'claude' ? ' (`claude plugin enable <name>` bzw. `claude plugin disable <name>`)' : '') + '. Multiterminal zeigt nur den vorhandenen Status an und ändert ihn nicht.'));
    if (skills && p && p.skillTarget) body.append(note('Zuordnungen landen in ' + p.skillTarget.path + '. ' + (p.skillTarget.note || '')));
    if (skills && !canAssign()) body.append(note('Skills einem Agenten zuordnen wird nach dem nächsten Update der App aktiv.'));
    const scopeLine = skills ? usageScope(p) : null;
    if (scopeLine) body.append(note(scopeLine));
    body.append(h('div', { class: 'settings-folder-actions' }, folderButton(), note('Lege eigene Dateien in die passenden Unterordner und aktualisiere danach die Übersicht.')));
    const input = h('input', { class: 'settings-search', type: 'search', value: search, placeholder: 'Name, Quelle oder Pfad suchen', 'aria-label': tabs[tab] + ' durchsuchen' });
    const sortBox = skills ? h('label', { class: 'settings-sort' }, h('input', { type: 'checkbox', checked: sortByUsage, onchange: e => { sortByUsage = e.target.checked; page = 0; update(); } }), h('span', { text: ' Nach Nutzung sortieren' })) : null;
    const list = h('div', { class: 'settings-resource-list' }), paging = h('div', { class: 'settings-pagination' }), cand = h('div', { class: 'settings-resource-list' });
    const match = query => i => [i.name, i.path, i.source, i.description].join(' ').toLocaleLowerCase().includes(query);
    function update() {
      const query = search.toLocaleLowerCase(), filtered = items.filter(match(query));
      if (sortByUsage && skills) filtered.sort((a, b) => usageRank(b) - usageRank(a) || a.name.localeCompare(b.name));
      const pages = Math.max(1, Math.ceil(filtered.length / 40)); page = Math.min(page, pages - 1);
      list.replaceChildren(...filtered.slice(page * 40, (page + 1) * 40).map(resourceRow));
      if (!filtered.length) list.append(note(items.length ? 'Keine passenden Ressourcen gefunden.' : 'In den geprüften Quellen wurde hier nichts gefunden.'));
      paging.replaceChildren(note(filtered.length + ' Einträge'), button('Zurück', () => { page--; update(); }, { disabled: page === 0 }), note((page + 1) + ' / ' + pages), button('Weiter', () => { page++; update(); }, { disabled: page + 1 === pages }));
      if (skills && p && (p.candidates || []).length) {
        const rest = p.candidates.filter(match(query));
        cand.replaceChildren(h('h3', { text: 'Von anderen Agenten übernehmen (' + rest.length + ')' }), note('Skills, die andere Agenten haben und ' + labels[scope] + ' fehlen. Zuordnen legt einen Link an; der Skill wird nicht kopiert.'), ...rest.slice(0, 40).map(resourceRow), ...(rest.length > 40 ? [note((rest.length - 40) + ' weitere – Suche eingrenzen.')] : []));
      } else cand.replaceChildren();
    }
    input.addEventListener('input', () => { search = input.value; page = 0; update(); }); body.append(input, ...(sortBox ? [sortBox] : []), list, paging, cand); update();
    if (p) {
      body.append(h('details', { class: 'settings-roots' }, h('summary', { text: 'Geprüfte Quellen (' + (p.roots || []).length + ')' }), ...(p.roots || []).map(r => note(`${r.label}: ${r.path} (${r.exists ? 'vorhanden' : 'nicht gefunden'})`))), ...(p.notes || []).map(n => note(typeof n === 'string' ? n : n.text || n.message || '')));
    }
  }
  function render() {
    if (!root) return;
    root.hidden = !open; if (!open) return;
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focused ? { tag: focused.tagName, label: focused.getAttribute('aria-label'), text: focused.textContent, start: focused.selectionStart, end: focused.selectionEnd } : null;
    const nav = h('nav', { class: 'settings-nav', 'aria-label': 'Anbieter' }, h('div', { class: 'settings-nav-title', text: 'Einstellungen' }));
    for (const [id, name] of Object.entries(labels)) nav.append(button(name, () => select(id, tab), { class: 'settings-provider' + (scope === id ? ' active' : ''), 'aria-current': scope === id ? 'page' : null }));
    const main = h('section', { class: 'settings-main' });
    main.append(h('div', { class: 'settings-top' }, h('strong', { class: 'settings-top-title', text: tab === 'hotkeys' ? 'App-Einstellungen' : labels[scope] }), tab === 'hotkeys' ? null : button('Übersicht aktualisieren', reloadOverview), button('Schließen', () => toggle(false), { 'aria-label': 'Einstellungen schließen' })));
    {
      const tablist = h('div', { class: 'settings-tabs', role: 'tablist', 'aria-label': 'Bereiche' });
      for (const [id, name] of Object.entries(tabs)) tablist.append(button(name, () => select(scope, id), { class: 'settings-tab' + (tab === id ? ' active' : ''), role: 'tab', 'aria-selected': String(tab === id), 'aria-controls': 'settings-content', tabindex: tab === id ? 0 : -1, onkeydown: e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const ids = Object.keys(tabs), index = ids.indexOf(id), next = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length; select(scope, ids[next]); root.querySelector('[role=tab][aria-selected=true]').focus(); } }));
      main.append(tablist);
    }
    const body = h('div', { id: 'settings-content', class: 'settings-content', role: 'tabpanel', 'aria-label': tabs[tab] });
    if (error) body.append(h('div', { class: 'settings-error', role: 'alert', text: error }));
    if (message) body.append(h('div', { class: 'settings-message', role: 'status', text: message }));
    if (tab === 'profile') profileView(body); else if (tab === 'quota') quotaView(body); else if (tab === 'hotkeys') hotkeysView(body); else inventoryView(body);
    body.append(h('section', { class: 'settings-preview', hidden: true, 'aria-label': 'Quellvorschau' })); main.append(body); root.replaceChildren(nav, main);
    if (focusKey) {
      const replacement = [...root.querySelectorAll('button,input,textarea')].find(el => el.tagName === focusKey.tag && el.getAttribute('aria-label') === focusKey.label && (focusKey.label || el.textContent === focusKey.text));
      if (replacement && !replacement.disabled) { replacement.focus({ preventScroll: true }); if (typeof focusKey.start === 'number' && replacement.setSelectionRange) replacement.setSelectionRange(focusKey.start, focusKey.end); }
    }
  }
  function toggle(force) {
    const next = typeof force === 'boolean' ? force : !open;
    if (next === open) return open;
    if (!next && !mayLeave()) return open;
    stopRecording();
    open = next; generation++; overviewGeneration++; previewGeneration++; quotaGeneration++;
    if (!open) { syncTimer(); render(); if (opts.onClose) opts.onClose(); if (previousFocus && previousFocus.isConnected) previousFocus.focus(); return false; }
    previousFocus = document.activeElement; error = ''; render(); syncTimer();
    root.querySelector('.settings-provider.active').focus();
    reloadOverview();
    if (tab === 'profile') loadProfile();
    if (tab === 'quota') loadQuota();
    if (tab === 'hotkeys') loadHotkeys();
    return open;
  }
  function init(options = {}) {
    opts = options; root = document.getElementById('settings-panel');
    if (!root) return;
    root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Einstellungen');
    root.addEventListener('keydown', e => {
      if (recording) {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { stopRecording(); render(); return; }
        if (!recording.ready || e.repeat || e.isComposing || ['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
        const accelerator = HK.eventAccelerator(e);
        const { action, index } = recording;
        stopRecording();
        if (!accelerator) { error = 'Bitte eine Kombination mit ⌘ oder Strg verwenden.'; render(); return; }
        const bindings = [...hotkeyDraft[action]]; bindings[index] = accelerator;
        changeHotkey(action, bindings); return;
      }
      if (e.key === 'Escape' && open) { e.preventDefault(); toggle(false); }
      if (e.key === 'Tab' && open) {
        const controls = [...root.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')].filter(el => el.getClientRects().length && el.tabIndex >= 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    window.addEventListener('blur', () => { if (recording) { stopRecording(); if (open) render(); } });
  }
  D.settingsPanel = { init, toggle, isOpen: () => open };
})();
