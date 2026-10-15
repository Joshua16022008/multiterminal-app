/* Aktivität je Kachel aus dem Agentenstatus (F01): Markierung der Kopfleiste und automatische Sortierung. */
(function () {
  'use strict';
  const RANK = { waiting: 0, working: 1, idle: 2 };

  // waiting = braucht dich (Freigabe/Frage, ungesehene fertige Antwort, Fehler),
  // working = Agent arbeitet, idle = bereit / Antwort schon gesehen. null = kein Agent bekannt.
  function activityOf(entry, running = true) {
    if (!entry || !running) return null;
    switch (entry.state) {
      case 'working': return 'working';
      case 'needs-input': case 'error': return 'waiting';
      case 'turn-complete': return entry.unread ? 'waiting' : 'idle';
      default: return 'idle';
    }
  }

  // Stabil: innerhalb einer Gruppe bleibt die manuelle Reihenfolge erhalten. Ohne Agent = hinten.
  function sortByActivity(list, activityFor) {
    return list
      .map((item, index) => ({ item, index, rank: RANK[activityFor(item)] ?? RANK.idle }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((x) => x.item);
  }

  const api = { activityOf, sortByActivity, RANK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DeckActivity = api;
})();
