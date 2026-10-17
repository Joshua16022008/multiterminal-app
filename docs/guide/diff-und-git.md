---
title: Änderungen und Git
order: 60
keywords: diff, änderungen, git, github, gh, sync, pull, push, repository, klonen, kommentar
---

# Änderungen und Git

Die App zeigt dir, was die Agenten im Projekt verändert haben, und bindet GitHub über die GitHub-CLI `gh` an. Sie committet nie von selbst.

## Änderungen ansehen

Das Panel „Änderungen“ öffnest du mit ⌘⇧D oder über „☰ Menü → Änderungen“. Es zeigt die lokalen Git-Änderungen des aktiven Projekts, also des Projektordners. Über den [Stammbaum](worktrees.md#stammbaum) („Änderungen ansehen“ auf einer Karte) öffnest du es für eine Arbeitskopie. Die Kopfzeile nennt Projekt, Ordner und Branch.

**Das Panel liest nur.** Es stagt nichts, setzt nichts zurück und committet nichts. Die Änderungen werden auch keinem bestimmten Agenten zugeschrieben.

Die Dateien sind in Gruppen sortiert:

- Gestaged (Index gegen HEAD)
- Nicht gestaged (Arbeitsbaum gegen Index)
- Neu, nicht verfolgt

Jede Datei trägt ihren Zustand: geändert, neu, gelöscht, umbenannt, kopiert, Typ geändert oder Konflikt. Ein Klick auf eine Datei lädt ihren Diff. Binärdateien zeigen nur den Hinweis „Binärdatei geändert“. Bei sehr großen Diffs wird nur der Anfang angezeigt. „⟳“ liest alles neu.

### Dem Agenten einen Kommentar schicken

Du kannst Zeilen im Diff markieren und dem Agenten dazu etwas schreiben:

1. Klicke eine Zeile an. Mit Umschalt-Klick wählst du einen Bereich.
2. Schreibe den Kommentar in das Feld „Kommentar für den Agenten …“.
3. Wähle unter „Zielkachel“ das Terminal, das den Text bekommen soll.
4. „In Promptvorschau“ öffnet die [Promptvorschau](uebergaben-und-anhaenge.md#promptvorschau) mit Datei, Zeilen und deinem Kommentar. Erst dort fügst du ihn ins Terminal ein.

## GitHub

Repositories von GitHub hinzufügen und Projekte auf GitHub anlegen brauchen die GitHub-CLI `gh`. Installiere sie zum Beispiel mit `brew install gh` und melde dich mit `gh auth login --web` an. Das geht in jedem Terminal, auch in einer Kachel der App. Fehlt `gh` oder bist du nicht angemeldet, sagt dir der Dialog, was zu tun ist, mit dem Knopf „Erneut prüfen“.

### Repository als Projekt hinzufügen

„+ Projekt → Von GitHub…“ zeigt deine Repositories mit Suchfeld. Pfeiltasten wählen, Enter oder ein Klick übernimmt. Ein Repository, das noch nicht auf dem Mac liegt, wird geklont. Das Etikett „bereits auf diesem Mac“ zeigt ein vorhandenes lokales Exemplar, „bereits Projekt“ eines, das schon in der Seitenleiste steht.

### Projekt auf GitHub anlegen

Hat ein Git-Projekt noch kein GitHub-Repository, legst du es mit „+ Projekt → Aktives Projekt auf GitHub anlegen…“ an. Ein Dialog fragt, ob das Repository privat oder öffentlich sein soll. Danach wird es erstellt und der aktuelle Stand hochgeladen. Der Name des Repositorys ist der Ordnername.

### Synchronisieren

Bei Git-Projekten zeigt die Seitenleiste unter dem Namen den Stand:

| Anzeige | Bedeutung |
|---|---|
| `⎇ main` | der aktuelle Branch |
| `●3` | 3 nicht committete Änderungen |
| `↑2` | 2 Commits, die noch nicht auf GitHub sind |
| `↓1` | 1 Commit auf GitHub, der hier fehlt |

Der Knopf „⟳“ holt neue Änderungen (pull) und lädt vorhandene Commits hoch (push). Wenn du ein Projekt zum ersten Mal in einer App-Sitzung auswählst, holt die App einmal im Hintergrund neue Änderungen. Der Stand wird alle 20 Sekunden und beim Zurückkehren ins Fenster aufgefrischt.

Committen musst du selbst, im Terminal oder durch einen Agenten.
