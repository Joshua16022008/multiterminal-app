# Startaufträge für die Nutzungsfeatures

Stand: 14.10.2026. Die verbindlichen Paketbeschreibungen stehen in `ENTWICKLUNGSPLAN.md`, die Recherche mit Quellen in `FEATURE_RECHERCHE.md`. Diese Datei enthält ausschließlich die Zuordnung und Startprompts; laufende Belegung steht in `WORK_IN_PROGRESS.md`, Ergebnisse stehen in `PROGRESS.md`.

## Verteilung

| In dieser Sitzung gewählte Rolle | Vorgesehenes Modell | Aufgaben zur Auswahl | Sinnvoller erster Start |
| --- | --- | --- | --- |
| CLAUDE-A | Claude Opus 5.5 | F01 Status/Aufmerksamkeit; F02 eindeutiges Fortsetzen | F01 |
| CLAUDE-B | Claude Opus 5.5 | F07 Worktrees; F05 Browser-Feedback und UI-Aktionen | F07 |
| CODEX-A | Codex 6.1 / Sol 6.1 | F06 Dateien/Bilder und Promptvorschau; F03 Suche; F08 Arbeitsaufbauten | F06, damit Review und Browser-Feedback anschließen können |
| CODEX-B | Codex 6.1 / Sol 6.1 | F11 Devserver/Ports; F04 Diffs; F09 Übergabe; F10 Aufgabenabgleich | F11; F04 vollständig erst mit F06 |

Die vier Zeilen sind separate Hauptagentensitzungen, die Joshua selbst mit dem passenden Modell öffnet. Es werden durch dieses Dokument keine Sitzungen gestartet. Die Auswahl nach Schwierigkeit ist eine Planungseinschätzung. Die ausdrücklich genannten Modelle gelten für diese Aufträge; kein automatischer Wechsel bei fehlender Verfügbarkeit.

Jeder Startprompt autorisiert genau ein startfähiges Paket der gewählten Rolle. Vor Beginn alle im Entwicklungsplan genannten Regeln/Abhängigkeiten lesen und eigene Reservierung anlegen. Nicht alle Pakete der Rolle am Stück abarbeiten. Gemeinsame Integrationsdateien werden nacheinander bearbeitet; eigenständige neue Module können parallel entstehen. Keine fremden Änderungen übernehmen, keine bestehende Reservierung allein wegen ihres Alters als frei behandeln.

F10 ist zunächst ausdrücklich ein Konzeptpaket; alle anderen Pakete sind begrenzte Umsetzungspakete mit Prüfungen. Neue native Hooks/Konfigurationseingriffe, bezahlte Provider-Tests, Installation nach `/Applications` und Commit/Push werden nicht durch die Startprompts freigegeben. Das gilt nicht als zusätzliche Bestätigungspflicht für bereits anderweitig ausdrücklich genehmigte Arbeit.

## Prompt 1 – Claude Opus 5.5, Rolle CLAUDE-A

```text
Arbeite im Projekt "/Volumes/M4MegaDiva/Projekte/Lokale-Projekte/Desktop/Second_Brain/Arbeit/Ai Builds and projekts/Claude_code_tasks/Projekte/multiterminal-app". Lies AGENTS.md, AGENTEN_AUFTRAEGE.md und ENTWICKLUNGSPLAN.md sowie die dort genannten aktuellen Statusdateien. Übernimm die Rolle CLAUDE-A (für diesen Auftrag Claude Opus 5.5). Wähle genau ein freies, startfähiges Paket deiner Rolle, vorzugsweise F01, reserviere es in WORK_IN_PROGRESS.md und setze es einschließlich Oberfläche und angemessener Prüfung um. Beachte Dateizuständigkeiten, Abhängigkeiten und die Reihenfolge für gemeinsame Integrationsdateien. Dokumentiere das tatsächliche Ergebnis und gib deine Reservierung frei. Beginne danach kein weiteres Paket automatisch.
```

## Prompt 2 – Claude Opus 5.5, Rolle CLAUDE-B

```text
Arbeite im Projekt "/Volumes/M4MegaDiva/Projekte/Lokale-Projekte/Desktop/Second_Brain/Arbeit/Ai Builds and projekts/Claude_code_tasks/Projekte/multiterminal-app". Lies AGENTS.md, AGENTEN_AUFTRAEGE.md und ENTWICKLUNGSPLAN.md sowie die dort genannten aktuellen Statusdateien. Übernimm die Rolle CLAUDE-B (für diesen Auftrag Claude Opus 5.5). Wähle genau ein freies, startfähiges Paket deiner Rolle, vorzugsweise F07, reserviere es in WORK_IN_PROGRESS.md und setze es einschließlich Oberfläche und angemessener Prüfung um. Beachte Dateizuständigkeiten, Abhängigkeiten und die Reihenfolge für gemeinsame Integrationsdateien. Dokumentiere das tatsächliche Ergebnis und gib deine Reservierung frei. Beginne danach kein weiteres Paket automatisch.
```

## Prompt 3 – Codex 6.1, Rolle CODEX-A

```text
Arbeite im Projekt "/Volumes/M4MegaDiva/Projekte/Lokale-Projekte/Desktop/Second_Brain/Arbeit/Ai Builds and projekts/Claude_code_tasks/Projekte/multiterminal-app". Lies AGENTS.md, AGENTEN_AUFTRAEGE.md und ENTWICKLUNGSPLAN.md sowie die dort genannten aktuellen Statusdateien. Übernimm die Rolle CODEX-A (Codex 6.1 / Sol 6.1). Wähle genau ein freies, startfähiges Paket deiner Rolle, vorzugsweise F06, reserviere es in WORK_IN_PROGRESS.md und setze es einschließlich Oberfläche und angemessener Prüfung um. Liefere bei F06 auch die im Plan vereinbarte gemeinsame Promptvorschau. Beachte Dateizuständigkeiten, Abhängigkeiten und die Reihenfolge für gemeinsame Integrationsdateien. Dokumentiere das tatsächliche Ergebnis und gib deine Reservierung frei. Beginne danach kein weiteres Paket automatisch.
```

## Prompt 4 – Codex 6.1, Rolle CODEX-B

```text
Arbeite im Projekt "/Volumes/M4MegaDiva/Projekte/Lokale-Projekte/Desktop/Second_Brain/Arbeit/Ai Builds and projekts/Claude_code_tasks/Projekte/multiterminal-app". Lies AGENTS.md, AGENTEN_AUFTRAEGE.md und ENTWICKLUNGSPLAN.md sowie die dort genannten aktuellen Statusdateien. Übernimm die Rolle CODEX-B (Codex 6.1 / Sol 6.1). Wähle genau ein freies, startfähiges Paket deiner Rolle, vorzugsweise F11, reserviere es in WORK_IN_PROGRESS.md und bearbeite es bis zu den im Plan genannten Abnahmekriterien. F10 ist ausschließlich ein Konzeptpaket; die anderen Pakete schließen Oberfläche und angemessene Prüfung ein. Beachte Dateizuständigkeiten, Abhängigkeiten und die Reihenfolge für gemeinsame Integrationsdateien. Dokumentiere das tatsächliche Ergebnis und gib deine Reservierung frei. Beginne danach kein weiteres Paket automatisch.
```

## Nach einem erledigten Paket

Wenn eine Sitzung weiterarbeiten soll, reicht ein neuer kurzer Auftrag:

```text
Lies die aktuellen Statusdateien und ENTWICKLUNGSPLAN.md erneut. Wähle genau ein weiteres freies, startfähiges Paket deiner bisherigen Rolle und bearbeite es nach denselben Regeln vollständig. Übernimm keine noch belegten Dateien und beachte die vereinbarten Schnittstellen.
```
