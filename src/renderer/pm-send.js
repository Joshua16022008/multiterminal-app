'use strict';

// PM: Verarbeitet 'pm:sendRequest' des Hauptprozesses. Der Auftrag des Managers landet NUR in der
// Promptvorschau der Zielkachel; eingefügt wird erst nach Klick des Nutzers.
(function () {
  const PREFIX = '[Projektmanager] ';

  function createSendHandler({ getPane, getDraft, openDraft }) {
    // Liefert { ok:true } oder { ok:false, error } – wirft nie.
    return function handle(payload) {
      try {
        const { projectId, terminalId, text } = payload || {};
        if (typeof terminalId !== 'string' || typeof text !== 'string' || !text.trim()) {
          return { ok: false, error: 'Ungültige Anfrage.' };
        }
        const pane = getPane(terminalId);
        if (!pane || pane.disposed) return { ok: false, error: 'Diese Kachel gibt es nicht mehr.' };
        if (!pane.project || pane.project.id !== projectId) return { ok: false, error: 'Diese Kachel gehört nicht zum Projekt des Managers.' };
        if (pane.status !== 'running') return { ok: false, error: 'Diese Kachel läuft nicht mehr.' };
        if (getDraft()) return { ok: false, error: 'Es ist bereits eine Vorschau offen.' };
        const opened = openDraft({ terminalId, text: PREFIX + text });
        if (opened === false) return { ok: false, error: 'Die Vorschau konnte nicht geöffnet werden.' };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      }
    };
  }

  const api = { PREFIX, createSendHandler };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckPmSend = api;
})();
