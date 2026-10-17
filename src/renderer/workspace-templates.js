/* Benannte Aufbauten (F08): Kacheln eines Projekts als Vorlage speichern und später als NEUE Kacheln starten.
   Der obere Teil (Modell) ist DOM-frei und wird auch von Node-Tests geladen; die Oberfläche hängt an window.DeckApp.
   Beim bloßen Öffnen der Vorschau wird nichts ausgeführt – erst „Starten“ erzeugt Kacheln über die vorhandenen Wege. */
(function () {
  'use strict';

  /* ---------- Modell (ohne DOM) ---------- */

  // Befehle, die wie ein lang laufender Entwicklungsserver aussehen.
  const DEV_PATTERNS = [
    /^(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:dev|start|serve|watch|preview)(?:[:\s]|$)/,
    /^(?:npx\s+)?(?:vite|next\s+dev|nuxt\s+dev|astro\s+dev|remix\s+dev|svelte-kit\s+dev|webpack(?:\s+serve|-dev-server)|parcel|nodemon|live-server|http-server|serve)(?:\s|$)/,
    /^(?:ng|expo|gatsby)\s+(?:serve|start|develop)(?:\s|$)/,
    /^(?:flask|rails|php\s+artisan|python3?\s+manage\.py|django-admin)\s+(?:run|s|server|serve|runserver)(?:\s|$)/,
    /^(?:python3?\s+-m\s+http\.server|uvicorn|gunicorn|hugo\s+server|jekyll\s+serve|cargo\s+watch|docker[\s-]compose\s+up)(?:\s|$)/,
  ];

  function isDevServerCommand(command) {
    if (typeof command !== 'string') return false;
    // Umgebungsvariablen am Anfang (PORT=3000 npm start) und „cd x && …“ überspringen
    const parts = command.split(/&&|;/).map((p) => p.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ''));
    return parts.some((p) => DEV_PATTERNS.some((re) => re.test(p)));
  }

  const AGENT_PRESETS = new Set(['claude', 'codex', 'kimi']);

  // Aktuelle Kacheln -> Vorlagenkacheln (nur die erlaubten Felder). Reihenfolge = Anordnung.
  // Nie übernommen: Gesprächs-IDs, resumeCommand, Arbeitskopie, Konten.
  function tilesFromDescs(descs) {
    return (descs || []).map((d) => {
      const t = { title: d.title || 'Terminal', presetId: d.presetId || null };
      if (typeof d.command === 'string' && d.command.trim() && !/[\r\n]/.test(d.command)) t.startCommand = d.command.trim();
      if (Number.isInteger(d.color)) t.color = d.color;
      if (typeof d.browserUrl === 'string' && /^https?:\/\//i.test(d.browserUrl)) t.browserUrl = d.browserUrl;
      return t;
    });
  }

  // Vorschau: was würde passieren? Reine Daten, keine Wirkung.
  function previewModel(template, { presets = [], existingCount = 0, max = 30 } = {}) {
    const byId = new Map(presets.map((p) => [p.id, p]));
    const items = template.tiles.map((tile) => {
      const preset = tile.presetId ? byId.get(tile.presetId) || null : null;
      const missingPreset = !!tile.presetId && !preset;
      // Fehlendes Schnellstart-Preset: normale Shell, ohne Befehl.
      const command = missingPreset ? null : (tile.startCommand || (preset ? preset.command : null) || null);
      const devServer = isDevServerCommand(command);
      const agent = !!preset && (preset.builtin ? AGENT_PRESETS.has(preset.id) : false) && !devServer;
      return {
        title: tile.title, presetId: tile.presetId, preset, command, color: tile.color,
        browserUrl: tile.browserUrl || null,
        kind: devServer ? 'devserver' : (agent ? 'agent' : (command ? 'command' : 'shell')),
        devServer, missingPreset,
        run: !!command && !devServer,
        note: missingPreset ? 'Schnellstart nicht mehr vorhanden – wird als normale Shell angelegt.' : null,
      };
    });
    const free = Math.max(0, max - existingCount);
    const overLimit = items.length > free;
    return {
      items, free, overLimit,
      limitMessage: overLimit
        ? `Der Aufbau hat ${items.length} Kacheln, im Projekt ist nur noch Platz für ${free} (Grenze ${max}). Es wird nichts gestartet.`
        : null,
    };
  }

  // Auswahl der Häkchen -> Startaufträge für die Kachelerzeugung; Abbruch/Überschreitung -> leer.
  function startPlan(preview, runFlags) {
    if (preview.overLimit) return [];
    return preview.items.map((it, i) => ({
      title: it.title, preset: it.missingPreset ? null : it.preset, command: it.command,
      run: !!it.command && !!runFlags[i], color: it.color, browserUrl: it.browserUrl,
    }));
  }

  const model = { isDevServerCommand, tilesFromDescs, previewModel, startPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  if (typeof window === 'undefined' || !window.DeckApp) return;

  /* ---------- Oberfläche ---------- */
  const D = window.DeckApp;
  let ctx = null; // { getProject, getPanes, getPresets, existingCount, max, createTile }

  const modalEl = () => document.getElementById('modal');
  function closeModal() { const m = modalEl(); m.hidden = true; m.replaceChildren(); m.onmousedown = null; m.onkeydown = null; }
  function showModal(form) {
    const m = modalEl();
    m.onmousedown = (e) => { if (e.target === m) closeModal(); };
    m.onkeydown = (e) => { if (e.key === 'Escape') closeModal(); };
    m.replaceChildren(form);
    m.hidden = false;
  }
  const api = () => window.deck.templates;

  function checkRow(label, checked, title) {
    const box = D.h('input', { type: 'checkbox', checked: !!checked });
    return { box, el: D.h('label', { class: 'tpl-check', title: title || null }, box, D.h('span', { text: label })) };
  }

  /* Aufbau speichern */
  function openSave() {
    const { h } = D;
    const project = ctx.getProject();
    if (!project) { D.notify('Zuerst ein Projekt auswählen.'); return; }
    const descs = ctx.getPanes().map((p) => p.desc);
    if (!descs.length) { D.notify('Dieses Projekt hat noch keine Terminals zum Speichern.'); return; }
    const tiles = tilesFromDescs(descs);
    const name = h('input', { placeholder: 'z. B. Entwicklung', maxLength: 60, required: true });
    const err = h('div', { class: 'tpl-error', hidden: true });
    const replace = checkRow('Vorhandenen Aufbau mit diesem Namen ersetzen', false);
    replace.el.hidden = true;
    const rows = tiles.map((t) => {
      const take = checkRow(t.title, true, 'Kachel in den Aufbau aufnehmen');
      const cmd = t.startCommand ? checkRow('Startbefehl merken', true) : null;
      const line = h('div', { class: 'tpl-row' },
        h('div', { class: 'tpl-main' }, take.el, t.startCommand ? h('code', { class: 'tpl-cmd', text: t.startCommand, title: t.startCommand }) : h('small', { class: 'tpl-dim', text: 'normale Shell' })),
        cmd ? cmd.el : null);
      if (cmd) take.box.addEventListener('change', () => { cmd.box.disabled = !take.box.checked; });
      return { t, take: take.box, cmd: cmd && cmd.box, line };
    });
    const form = h('form', { class: 'tpl-form' },
      h('h2', { text: 'Aufbau speichern' }),
      h('p', { class: 'tpl-note', text: `Speichert die ${tiles.length} Kacheln von „${project.name}“ (Titel, Schnellstart, Farbe, Browseradresse, Reihenfolge) als Vorlage. Gespräche, Konten und Arbeitskopien werden nicht gespeichert.` }),
      h('label', { text: 'Name' }, name),
      h('div', { class: 'tpl-list' }, rows.map((r) => r.line)),
      err, replace.el,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn-small', text: 'Abbrechen', onclick: closeModal }),
        h('button', { type: 'submit', class: 'btn-primary', text: 'Speichern' })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const chosen = rows.filter((r) => r.take.checked).map((r) => {
        const t = { ...r.t };
        if (r.cmd && !r.cmd.checked) delete t.startCommand;
        return t;
      });
      const fail = (msg) => { err.textContent = msg; err.hidden = false; };
      if (!chosen.length) { fail('Mindestens eine Kachel auswählen.'); return; }
      if (!name.value.trim()) { fail('Bitte einen Namen eingeben.'); return; }
      try {
        const saved = await api().save({ name: name.value, tiles: chosen, replace: replace.box.checked });
        closeModal();
        D.notify(`Aufbau „${saved.name}“ gespeichert (${saved.tiles.length} Kacheln).`, 'ok');
      } catch (ex) {
        const msg = D.errText(ex);
        fail(msg);
        if (/existiert bereits/.test(msg)) replace.el.hidden = false;
      }
    });
    showModal(form);
    name.focus();
  }

  /* Liste der Vorlagen */
  async function openList() {
    const { h } = D;
    const project = ctx.getProject();
    if (!project) { D.notify('Zuerst ein Projekt auswählen.'); return; }
    const templates = await D.guard(() => api().list(), null);
    if (!templates) return;
    const list = h('div', { class: 'tpl-list' });
    const render = (items) => {
      list.replaceChildren(...(items.length ? items.map((t) => {
        const del = h('button', { type: 'button', class: 'btn-small', text: 'Löschen', title: 'Vorlage löschen (laufende Terminals bleiben unberührt)' });
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Wirklich?'; return; }
          const ok = await D.guard(() => api().delete(t.id), false);
          if (ok) render(items.filter((x) => x.id !== t.id));
        });
        return h('div', { class: 'tpl-row pick', onclick: () => openPreview(t) },
          h('div', { class: 'tpl-main' }, h('span', { class: 'tpl-name', text: t.name }), h('small', { class: 'tpl-dim', text: `${t.tiles.length} Kacheln` })),
          del);
      }) : [h('p', { class: 'tpl-note', text: 'Noch keine Aufbauten gespeichert. Im Projektmenü „Aufbau speichern…“ wählen.' })]));
    };
    render(templates);
    showModal(h('form', { class: 'tpl-form', onsubmit: (e) => e.preventDefault() },
      h('h2', { text: 'Aufbau starten' }, typeof window !== 'undefined' && window.DeckApp && window.DeckApp.help && window.DeckApp.help.link ? window.DeckApp.help.link('terminals-und-agenten') : null),
      h('p', { class: 'tpl-note', text: `Neue Terminals in „${project.name}“. Zuerst gibt es eine Vorschau – es wird nichts ausgeführt, bevor du „Starten“ wählst.` }),
      list,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn-small', text: 'Schließen', onclick: closeModal }))));
  }

  /* Vorschau mit Befehlen */
  function openPreview(template) {
    const { h } = D;
    const project = ctx.getProject();
    if (!project) return;
    const preview = previewModel(template, { presets: ctx.getPresets(), existingCount: ctx.getPanes().length, max: ctx.max });
    const flags = preview.items.map((it) => it.run);
    const rows = preview.items.map((it, i) => {
      const run = checkRow('Startbefehl ausführen', it.run, it.devServer ? 'Devserver laufen dauerhaft – bewusst einschalten' : null);
      run.box.disabled = !it.command;
      run.box.addEventListener('change', () => { flags[i] = run.box.checked; });
      return h('div', { class: 'tpl-row' + (it.missingPreset ? ' warn' : '') },
        h('div', { class: 'tpl-main' },
          h('span', { class: 'tpl-name' }, it.title,
            it.devServer ? h('span', { class: 'tpl-badge', text: 'Devserver' }) : null,
            it.browserUrl ? h('span', { class: 'tpl-badge', text: 'Browser' }) : null),
          it.command ? h('code', { class: 'tpl-cmd', text: it.command, title: it.command }) : h('small', { class: 'tpl-dim', text: 'normale Shell, kein Startbefehl' }),
          it.note ? h('small', { class: 'tpl-warn', text: it.note }) : null),
        run.el);
    });
    const start = h('button', { type: 'button', class: 'btn-primary', text: `Starten (${preview.items.length})`, disabled: preview.overLimit });
    start.addEventListener('click', () => {
      const plan = startPlan(preview, flags);
      if (!plan.length) return;
      closeModal();
      let made = 0;
      for (const spec of plan) if (ctx.createTile(project.id, spec)) made++;
      const missing = preview.items.filter((it) => it.missingPreset).length;
      D.notify(`Aufbau „${template.name}“ gestartet: ${made} neue Kacheln.` + (missing ? ` ${missing}× Schnellstart fehlte – als normale Shell angelegt.` : ''), 'ok');
    });
    showModal(h('form', { class: 'tpl-form', onsubmit: (e) => e.preventDefault() },
      h('h2', { text: template.name }),
      h('p', { class: 'tpl-note', text: `Legt ${preview.items.length} neue Kacheln in „${project.name}“ an. Vorhandene Terminals bleiben unberührt.` }),
      h('div', { class: 'tpl-list' }, rows),
      preview.limitMessage ? h('div', { class: 'tpl-error', text: preview.limitMessage }) : null,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn-small', text: 'Zurück', onclick: openList }),
        h('button', { type: 'button', class: 'btn-small', text: 'Abbrechen', onclick: closeModal }),
        start)));
  }

  window.DeckApp.workspaceTemplates = Object.assign({
    init(options) { ctx = options; },
    openSave, openList,
  }, model);
})();
