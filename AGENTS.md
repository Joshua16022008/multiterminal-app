<!-- second-brain-project-status:start -->
## Second-Brain-Projektstatus

Vor jeder inhaltlichen Arbeit `PROJECT_STATUS.md` lesen. Nach jedem erledigten Arbeitsschritt sofort aktuellen Stand, genau einen nächsten Schritt, Blocker und Nachweise aktualisieren. Keine fachlichen Aussagen aus Git-Daten erraten.
<!-- second-brain-project-status:end -->

## Verbindliche Agentenkommunikation

Gilt für alle Agenten und Unteragenten, die in diesem Repository arbeiten. Diese Dokumente koordinieren die Arbeit per Absprache; sie implementieren keine technischen Dateisperren.

### Vor Beginn und bei Wiederaufnahme

1. `PROJECT_STATUS.md`, `WORK_IN_PROGRESS.md` und `PROGRESS.md` lesen. Auch Nachrichten, Blocker und pausierte Aufgaben berücksichtigen; nach Kontextwechsel erneut lesen.
2. Arbeitsordner, Branch und aktuelle lokale Änderungen prüfen. Unbekannte Änderungen als Fremdarbeit erhalten; weder zurücksetzen noch überschreiben.
3. Vor Änderungen eine eigene Aufgabe mit eindeutiger ID, Agent/Sitzung, Ziel, Arbeitskopie, konkreten Dateien/Bereichen, Zeitstempel und genau einer nächsten Aktion in `WORK_IN_PROGRESS.md` eintragen. Für lesende Aufgaben ebenfalls den Auftrag eintragen, aber keine unnötigen Quelldateien reservieren. Unteragenten erhalten ausdrücklich getrennte Bereiche.
4. Vor Arbeitsbeginn die Übersicht erneut lesen und prüfen, ob eine zweite Reservierung denselben Bereich beansprucht. Bei Überschneidung zuerst Übergabe oder Reihenfolge mit dem zuständigen Agenten klären; bis dahin nur unabhängig weiterarbeiten. Eine Anfrage allein ist keine bestätigte Übergabe.

### Während der Arbeit

- Vor dem Wechsel auf weitere Dateien, vor Integration und vor Commit/Push `WORK_IN_PROGRESS.md` erneut lesen. Reservierung erweitern, bevor zusätzliche Bereiche bearbeitet werden. Unterschiedliche Branches im selben Arbeitsordner trennen Änderungen nicht; Git-Operationen im geteilten Checkout abstimmen.
- Eigene Meldung nach einem erledigten Schritt, bei einem Blocker und vor einer Unterbrechung aktualisieren. Nachfragen und Übergaben unter „Nachrichten und Übergaben“ mit Absender, Empfänger/Aufgaben-ID, Zeitpunkt und betroffenen Dateien eintragen. Antworten ausdrücklich quittieren.
- `WORK_IN_PROGRESS.md`, `PROGRESS.md` und `PROJECT_STATUS.md` sind gemeinsame Dateien: unmittelbar vor jeder Änderung neu lesen, nur den eigenen Abschnitt bzw. gezielten Eintrag ändern und Fremdeinträge erhalten. Gleichzeitige Änderungen an diesen Dateien nacheinander abstimmen; bei Konflikten stoppen und auflösen. Keine komplette Datei aus einem alten Stand zurückschreiben.
- Pausierte, veraltete oder nicht bestätigte Reservierungen nicht eigenmächtig übernehmen. Eigentümer bzw. Hauptagenten um Klärung bitten. Wenn keine Zuständigkeit erreichbar ist, betroffenen Bereich als blockiert dokumentieren und unabhängige Arbeit fortsetzen.

### Abschluss und Übergabe

1. Ergebnis angemessen prüfen. `umgesetzt – ungeprüft`, `geprüft` und noch offene Abnahme unterscheiden; Tests anderer Sitzungen nicht als eigene Prüfung ausgeben.
2. In `PROGRESS.md` einen neuen Ergebniseintrag mit Aufgaben-ID, Agent/Sitzung, Zeitpunkt, Änderung, betroffenen Dateien, Entscheidungen, tatsächlichen Prüfungen, offenen Punkten und genau einer nächsten Aktion ergänzen. Bestehende Einträge erhalten.
3. `PROJECT_STATUS.md` als kurze Projektübersicht aktualisieren, ohne andere aktive Aufgaben zu entfernen. Die bestehende Pflicht zu Stand, nächstem Schritt, Blockern und Nachweisen bleibt gültig.
4. Eigene Reservierung nach vollständigem Abschluss freigeben; bei Übergabe verbleibende Arbeit und Bereiche nennen und Bestätigung abwarten. Bei Unterbrechung auf `pausiert` oder `blockiert` setzen und Reservierungen ausdrücklich benennen. Offene Nachrichten erhalten, bis die Übergabe geklärt ist.

### Zuständigkeit der Dateien

- `WORK_IN_PROGRESS.md`: laufende Aufgaben, Reservierungen, Nachrichten und Übergaben.
- `PROGRESS.md`: einziges ausführliches Fortschrittsprotokoll dieses Projekts; bleibt mit dem vorhandenen Fortschrittspanel kompatibel. Keine zusätzliche `FORTSCHRITT.md` mit denselben Ergebnissen führen.
- `PROJECT_STATUS.md`: kompakter Projektstand einschließlich genau eines nächsten Projektschritts.
- `CLAUDE.md`: bindet diese Regeln für Claude ein. In anderen Agentenoberflächen sicherstellen, dass `AGENTS.md` tatsächlich geladen oder ausdrücklich gelesen wird; Dateiexistenz allein belegt keine Befolgung. Bereits laufende Sitzungen müssen die neuen Regeln vor ihrer nächsten Änderung neu lesen.
