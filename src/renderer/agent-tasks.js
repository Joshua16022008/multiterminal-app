'use strict';
(function () {
  const instructions = `Agentenaufgaben in diesem Terminal: mt-agent peers zeigt erreichbare Projekt-Terminals. mt-agent inbox zeigt eingegangene Aufträge; mt-agent task <id> zeigt Details. Nur einen übernommenen Auftrag mit mt-agent accept <id> ausdrücklich annehmen. Mit mt-agent reply <id> --status completed --text '<vollständiges Ergebnis>' antworten (bei Fehler: --status failed). mt-agent send --to <terminal-id> --title '<Titel>' --text '<Auftrag>' übergibt Arbeit; mt-agent spawn --provider claude|codex --title '<Titel>' --text '<Auftrag>' fordert einen neuen Worker an. Kinder: --parent <id>, Abhängigkeiten: --after <id,id>. Ergebnisse: mt-agent task <id> oder mt-agent wait <id>. Delegation benötigt die Freigabe dieses Ursprungsterminals im Panel. Native Unteragenten handeln unter derselben Terminalidentität; einzelne Modelle werden nicht getrennt ausgewiesen. Bestehende Terminals lesen ihre Inbox selbst, es wird nichts automatisch eingetippt. Neue Worker starten ausschließlich in isolierten Git-Arbeitskopien auf dem committed Projektstand; uncommittete Änderungen werden nicht übernommen. Abbrechen vermerkt nur die Absicht und beendet keinen Prozess.`;
  const labels = { queued: 'Wartend', running: 'In Arbeit', completed: 'Abgeschlossen', failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen', interrupted: 'Unterbrochen' };
  function create({ button, root, api, getProject, notify = () => {} }) {
    const doc = root.ownerDocument;
    let open = false, sequence = 0, snapshot = null, selected = '', busy = false, error = '';
    const projectId = () => { const p = getProject(); return p && typeof p === 'object' ? p.id : p; };
    const el = (tag, text, cls) => { const n = doc.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
    const add = (parent, ...children) => { children.forEach(c => parent.appendChild(c)); return parent; };
    const action = (title, fn) => { const n = el('button', title); n.type = 'button'; n.disabled = busy; n.addEventListener('click', fn); return n; };
    async function mutate(fn, pid) {
      if (busy) return;
      busy = true; error = ''; render();
      try { await fn(); } catch (e) { if (pid === projectId()) error = e.message || String(e); }
      finally { busy = false; if (pid === projectId()) { if (!error) await refresh(); else render(); } else await refresh(); }
    }
    function render() {
      root.replaceChildren(); root.hidden = !open; root.classList.add('agent-tasks-panel');
      button.setAttribute('aria-expanded', String(open));
      if (!open) return;
      const head = el('div', undefined, 'agent-tasks-head');
      add(head, el('h2', 'Agentenaufgaben'), action('Aktualisieren', refresh), action('Schließen', () => toggle(false))); root.appendChild(head);
      root.appendChild(el('p', 'Bestehende Agenten lesen Aufträge mit mt-agent inbox und bestätigen mit accept/reply. Es wird nichts in laufende Terminals eingetippt. Native Unteragenten nutzen die Identität ihres Ursprungsterminals.', 'agent-tasks-help'));
      if (error) { const e = el('p', error, 'agent-tasks-error'); e.setAttribute('role', 'alert'); root.appendChild(e); }
      if (!projectId()) { root.appendChild(el('p', 'Zuerst ein Projekt auswählen.')); return; }
      if (!snapshot) { root.appendChild(el('p', busy ? 'Wird geladen …' : 'Keine Daten geladen.')); return; }
      const peers = snapshot.peers || [];
      if (!peers.some(p => (p.terminalId || p.id) === selected)) selected = peers[0] && (peers[0].terminalId || peers[0].id) || '';
      const form = el('section', undefined, 'agent-tasks-permissions');
      const selector = el('select'); selector.setAttribute('aria-label', 'Ursprungsterminal'); selector.disabled = busy;
      for (const peer of peers) { const id = peer.terminalId || peer.id; const option = el('option', `${peer.title || id} (${peer.provider || 'Terminal'})`); option.value = id; selector.appendChild(option); }
      selector.value = selected; selector.addEventListener('change', () => { selected = selector.value; render(); });
      add(form, el('h3', 'Delegation freigeben'), el('label', 'Ursprungsterminal'), selector);
      const grant = (snapshot.grants || {})[selected] || {};
      const checkbox = (text, value) => { const label = el('label'); const input = el('input'); input.type = 'checkbox'; input.checked = !!value; input.disabled = busy || !selected; add(label, input, el('span', text)); form.appendChild(label); return input; };
      const enabled = checkbox('Dieses Terminal darf Aufgaben delegieren', grant.enabled);
      const allowNew = checkbox('Neue Claude-/Codex-Worker erlauben', grant.allowNew);
      const cap = el('select'); cap.setAttribute('aria-label', 'Maximale neue Worker'); cap.disabled = busy || !selected;
      for (let i = 1; i <= 4; i++) { const o = el('option', String(i)); o.value = String(i); cap.appendChild(o); } cap.value = String(grant.maxNewWorkers || 2);
      add(form, el('label', 'Neue Worker pro gesamtem Aufgabenbaum (1–4)'), cap,
        el('p', 'Neue Worker erhalten isolierte Git-Arbeitskopien vom committed Projektstand. Ungesicherte Änderungen werden nicht übernommen. Das Limit gilt einschließlich bereits beendeter Worker; nach Neustart muss die Freigabe erneut erteilt werden.', 'agent-tasks-help'));
      const save = action(busy ? 'Wird gespeichert …' : 'Freigabe speichern', () => {
        const pid = projectId(), source = selected, patch = { enabled: enabled.checked, allowNew: allowNew.checked, maxNewWorkers: Number(cap.value) };
        return mutate(() => api.grant(pid, source, patch), pid);
      }); save.disabled = busy || !selected; form.appendChild(save); root.appendChild(form);
      const help = el('details'); add(help, el('summary', 'Werkzeughinweis für bestehende Agenten'));
      const pre = el('pre', instructions); help.appendChild(pre);
      help.appendChild(action('Werkzeughinweis kopieren', async () => {
        try { const clipboard = doc.defaultView && doc.defaultView.navigator && doc.defaultView.navigator.clipboard;
          if (!clipboard) throw new Error('Kopieren nicht verfügbar; den sichtbaren Werkzeughinweis markieren und kopieren.');
          await clipboard.writeText(instructions); notify('Werkzeughinweis kopiert.');
        } catch (e) { error = e.message || String(e); render(); }
      })); root.appendChild(help);
      const tasks = snapshot.tasks || []; root.appendChild(el('h3', `Aufgaben (${tasks.length})`));
      if (!tasks.length) root.appendChild(el('p', 'Noch keine Agentenaufgaben in diesem Projekt.'));
      for (const task of tasks) {
        const card = el('article', undefined, 'agent-task-card'); card.dataset.taskId = task.id;
        card.style.marginLeft = `${Math.min(3, Math.max(0, Number(task.depth) || 0)) * 10}px`;
        add(card, el('h4', task.title || task.id), el('p', `${labels[task.status] || task.status} · ${task.id}`, 'agent-task-status'),
          el('p', `${task.sourceTerminalId} → ${task.targetTerminalId || task.targetProvider || 'Worker'}`, 'agent-tasks-help'));
        if (task.parentId) card.appendChild(el('p', `Teilauftrag von: ${task.parentId}`));
        if (task.dependsOn && task.dependsOn.length) card.appendChild(el('p', `Abhängigkeiten: ${task.dependsOn.join(', ')}`));
        if (task.delivery) card.appendChild(el('p', `Zustellung: ${task.delivery.state || task.delivery}${task.delivery.error ? ` · ${task.delivery.error}` : ''}`));
        const details = el('details'); add(details, el('summary', 'Auftrag und vollständiges Ergebnis'), el('pre', task.text || ''));
        if (task.result) details.appendChild(el('pre', typeof task.result === 'string' ? task.result : task.result.text || '', 'agent-task-result'));
        else details.appendChild(el('p', 'Noch kein ausdrückliches Ergebnis.')); card.appendChild(details);
        if (['queued', 'running'].includes(task.status)) card.appendChild(action('Abbrechen', () => { const pid = projectId(); return mutate(() => api.cancel(pid, task.id), pid); }));
        root.appendChild(card);
      }
      root.appendChild(el('p', 'Abbrechen vermerkt die Absicht. Der Agentenprozess läuft weiter; auch Schließen beendet keinen Agenten.', 'agent-tasks-help'));
    }
    async function refresh() {
      const version = ++sequence, pid = projectId(); snapshot = null; error = ''; busy = true; render();
      if (!pid) { busy = false; render(); return; }
      try { const data = await api.snapshot(pid); if (version === sequence && pid === projectId()) snapshot = data; }
      catch (e) { if (version === sequence && pid === projectId()) error = e.message || String(e); }
      finally { if (version === sequence) { busy = false; render(); } }
    }
    function toggle(value) { open = typeof value === 'boolean' ? value : !open; if (open) return refresh(); render(); }
    button.addEventListener('click', () => toggle());
    if (api.onChanged) api.onChanged(() => { if (open) refresh(); });
    render(); return { toggle, refresh, isOpen: () => open };
  }
  const exported = { create, instructions };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (typeof window !== 'undefined') window.DeckAgentTasks = exported;
})();
