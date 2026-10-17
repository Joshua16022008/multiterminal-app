---
title: Oberfläche
order: 20
keywords: seitenleiste, topbar, kachel, raster, layout, sortierung, reihenfolge, chips, aktivität
---

# Oberfläche

Das Fenster hat links eine Seitenleiste und rechts den Arbeitsbereich mit einer Kopfleiste und dem Kachelraster.

## Seitenleiste

Oben steht der Knopf „Einstellungen“. Darunter folgt die Liste deiner Projekte mit dem Knopf „+ Projekt“ (siehe [Erste Schritte](erste-schritte.md#projekt-hinzufügen)).

Jede Projektzeile zeigt:

- den Projektnamen (Doppelklick zum Umbenennen, Mauszeiger darüber zeigt den Ordner),
- die Zahl der laufenden Terminals,
- einen Knopf „◆“, der den [Projektmanager](projektmanager.md) öffnet,
- einen Knopf „✕“, der das Projekt aus der App entfernt (der Ordner auf der Platte bleibt),
- bei Git-Projekten eine zweite Zeile mit Branch, Zahl der nicht gesicherten Änderungen, ausstehenden Commits und dem Sync-Knopf. Mehr dazu unter [Änderungen und Git](diff-und-git.md#synchronisieren).

Wenn ein Agent auf dich wartet oder arbeitet, ist die Projektzeile entsprechend markiert (siehe [Terminals und Agenten](terminals-und-agenten.md#agentenstatus)).

## Kopfleiste

Von links nach rechts:

- Projektname und Zähler, zum Beispiel „3 / 30“
- „⑂ N“: öffnet die [Stammbaum-Ansicht](worktrees.md#stammbaum) mit N Arbeitskopien (erscheint nur bei Git-Projekten)
- „+“ legt ein neues Terminal an, „▾“ öffnet das Menü mit Schnellstarts
- „?“ öffnet dieses Handbuch
- „☰ Menü“ klappt weitere Knöpfe auf: Komfort, Rückmeldungen, Änderungen, Projektmanager, Ports, Konten, Fortschritt und Übergabe

Pro Projekt sind höchstens 30 Terminals möglich. Danach sind „+“ und „▾“ gesperrt, bis du eines schließt.

## Kachelraster

Jedes Terminal ist eine Kachel. Das Raster passt sich der Zahl der Kacheln an:

- Eine oder zwei Kacheln stehen nebeneinander.
- Ab drei Kacheln ist das Raster drei Spalten breit und wächst nach unten.
- Zwei Reihen teilen sich die sichtbare Höhe. Weitere Reihen erreichst du durch Scrollen.

Mit ⌘1 bis ⌘9 und ⌘0 springst du zur Kachel mit dieser Nummer. Die Nummer steht im Kachelkopf.

### Kachelkopf

Der Kopf einer Kachel zeigt von links nach rechts:

- die Nummer und den Titel. Der Titel entsteht automatisch aus deiner ersten Eingabe, solange du ihn nicht selbst vergibst. Doppelklick auf den Titel benennt die Kachel um.
- einen Statuspunkt, wenn ein Agent seinen Zustand meldet,
- einen Konto-Chip, wenn der Anbieter mehrere Konten hat,
- den Branch-Chip „⑂ Branch“ bei Git-Projekten. Ein Klick öffnet den [Stammbaum](worktrees.md#stammbaum). Ein Punkt „●“ zeigt ungesicherte Änderungen in einer Arbeitskopie.
- einen Knopf zum Fortsetzen, wenn die Kachel nach einem Neustart der App wiederhergestellt wurde (siehe [Fortsetzen](terminals-und-agenten.md#fortsetzen)),
- die Knöpfe 📎 (Dateien einfügen), 🌐 (Mini-Browser), 💾 (Snapshot), ⤢ (Maximieren) und ✕ (Schließen).

Jede Kachel bekommt automatisch eine eigene Farbtönung, damit du sie im Raster wiederfindest.

### Reihenfolge ändern

Ziehe den Kachelkopf auf eine andere Kachel desselben Projekts. Die beiden Kacheln tauschen ihre Plätze. Bei einer maximierten Kachel oder wenn nur eine Kachel existiert, ist das Ziehen abgeschaltet.

### Snapshot und Suche

- 💾 speichert die aktuelle Terminalausgabe als Datei im Projektordner unter `.multiterminal/snapshots/`.
- ⌘F öffnet die Suche im Verlauf der aktiven Kachel. Esc schließt sie.

## Aktivität und Sortierung

Wenn der Agentenstatus eingeschaltet ist, markiert die App die Kopfleiste jeder Kachel: „wartet auf dich“, „arbeitet“ oder „inaktiv“. Mit „Automatisch sortieren“ stehen wartende Kacheln vorn, arbeitende in der Mitte und inaktive hinten. Innerhalb jeder Gruppe bleibt deine manuelle Reihenfolge erhalten.

Alle Schalter dafür findest du im Panel „Komfort“ (⌘⇧K). ⌘⇧S schaltet die automatische Sortierung an oder aus. Die Einrichtung des Agentenstatus steht unter [Terminals und Agenten](terminals-und-agenten.md#agentenstatus).

## Panels

Rechts neben den Kacheln öffnen sich Panels, zum Beispiel Änderungen, Ports, Rückmeldungen, Fortschritt, Konten und diese Hilfe. Es ist immer nur ein Panel offen, ein neues ersetzt das alte. Das Fortschritt-Panel zeigt die Datei `PROGRESS.md` des Projekts. Über „Auftrag ins aktive Terminal“ tippt es einen Satz ins aktive Terminal (ohne Enter), der den Agenten anweist, `PROGRESS.md` zu lesen und dort weiterzumachen.
