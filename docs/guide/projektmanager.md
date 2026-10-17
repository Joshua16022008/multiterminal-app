---
title: Projektmanager
order: 80
keywords: projektmanager, pm, lagebild, manager, mt-pm, planung, aufträge, fenster
---

# Projektmanager

Der Projektmanager ist ein eigener Agent in einem eigenen Fenster. Er behält den Überblick über ein Projekt, während die Agenten in den Kacheln am Code arbeiten. Er liest, plant und schlägt Aufträge vor. Am Produktcode ändert er nichts.

## Öffnen

- ⌘⇧O,
- der Knopf „◆“ in der Projektzeile der Seitenleiste,
- „☰ Menü → ◆ Projektmanager“ oder das Menü „Terminal → Projektmanager öffnen“.

Jedes Projekt hat sein eigenes Manager-Fenster. Ist es schon offen, holt der Befehl es nach vorn.

## Das Fenster

Links läuft der Manager-Agent in einem Terminal. Er ist eine Claude-Code-Sitzung im Projektordner mit einer festen Rollenbeschreibung. Rechts steht das **Lagebild**:

- **Kacheln**: alle Terminals des Projekts mit Agentenzustand (siehe [Agentenstatus](terminals-und-agenten.md#agentenstatus)). Ist der Agentenstatus aus, steht dort „Agentenzustand unbekannt“.
- **Arbeitskopien**: Branches und Zustand der zusätzlichen [Arbeitskopien](worktrees.md).
- **Änderungen**: Zusammenfassung der Git-Änderungen.
- **Ports**: lauschende Ports und die Kachel, zu der sie gehören (siehe [Ports](ports.md)).
- **Nächster Schritt**: aus der Datei `PROJECT_STATUS.md` des Projekts, falls vorhanden. Daneben die Zahl der aktiven Reservierungen aus `WORK_IN_PROGRESS.md`. Was die App nicht findet, nennt sie „unbekannt“.

Knöpfe in der Kopfleiste des Fensters:

| Knopf | Wirkung |
|---|---|
| Lagebild ⟩ | blendet das Lagebild ein oder aus (⌘\\) |
| Lagebild aktualisieren | liest den Stand sofort neu |
| Neues Gespräch | startet den Manager mit einem frischen Gespräch und verwirft die gespeicherte Gesprächs-ID |
| Neu starten | beendet den Manager-Agenten und startet ihn neu. Das letzte Gespräch wird fortgesetzt, wenn eines bekannt ist. |
| App aktualisieren… | siehe [App aktualisieren](updates.md) |

Beendet sich der Manager, zeigt das Fenster „Neu starten“ und „Neues Gespräch“.

## Was der Manager tut

Er arbeitet mit dem Befehl `mt-pm`, den es nur in diesem Fenster gibt:

| Befehl | Zweck |
|---|---|
| `mt-pm status` | Lagebild des Projekts |
| `mt-pm output <kachel>` | die letzten Zeilen einer Kachel |
| `mt-pm changes` | Git-Änderungen im Projektordner und in Arbeitskopien |
| `mt-pm ports` | lauschende Ports des Projekts |
| `mt-pm docs` | `PROGRESS.md`, `WORK_IN_PROGRESS.md`, `PROJECT_STATUS.md`, Git-Verlauf und Branches |
| `mt-pm send <kachel> <text>` | Auftrag an eine Kachel |

Er soll Überschneidungen erkennen, zum Beispiel zwei Kacheln in denselben Dateien oder einen Agenten, der auf dich wartet, und Aufträge sinnvoll verteilen.

### Aufträge nur mit deiner Bestätigung

Ein Auftrag des Managers landet in der Zielkachel nur als **Vorschau**. Wie bei allen anderen Vorschauen fügt die App nichts ein, bevor du es bestätigst (siehe [Promptvorschau](uebergaben-und-anhaenge.md#promptvorschau)). Der Manager schreibt nie selbst in ein anderes Terminal.
