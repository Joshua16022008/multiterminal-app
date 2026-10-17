---
title: Arbeitskopien (Worktrees)
order: 40
keywords: worktree, arbeitskopie, branch, stammbaum, git, übernehmen, extern, codex
---

# Arbeitskopien (Worktrees)

Mit einer Arbeitskopie arbeitet ein Agent in einem eigenen Ordner mit eigenem Branch, ohne dass er mit den Dateien in deinem Projektordner oder mit anderen Agenten kollidiert. Technisch ist das ein Git-Worktree: derselbe Repository-Verlauf, aber ein zweiter Arbeitsordner.

> Eine Arbeitskopie trennt Dateien, nicht Ports oder Datenbanken. Ein Devserver auf Port 3000 blockiert diesen Port auch für alle anderen Arbeitskopien. Nicht gesicherte Änderungen aus dem Projektordner werden nicht in die Arbeitskopie übernommen.

Arbeitskopien gibt es nur bei Git-Projekten.

## Anlegen

Im Menü „▾“ neben dem „+“ wähle „Terminal in Arbeitskopie…“. Der Dialog zeigt:

- **Projektordner**: ein normales Terminal ohne Arbeitskopie.
- Alle vorhandenen Arbeitskopien des Projekts mit Branch, Pfad und Zustand („sauber“, „N Änderungen“ oder „fehlt“). Ein Klick öffnet ein Terminal darin.
- **Neue Arbeitskopie**: Gib bei „Branch (wird neu angelegt)“ einen neuen Branch-Namen ein, zum Beispiel `feature/suche`. Bei „Ausgangsbasis (optional)“ kannst du angeben, wovon der Branch abzweigt. Leer bedeutet `HEAD`. „Anlegen und Terminal öffnen“ erzeugt Ordner und Branch und öffnet ein Terminal darin.

Der neue Ordner liegt im Datenordner der App, nicht neben deinem Projekt. Du kannst auch über [Agent mit Kontext starten](terminals-und-agenten.md#agent-mit-kontext-starten) gleich eine neue Arbeitskopie für einen Auftrag anlegen.

## Entfernen

Im Dialog „Terminal in Arbeitskopie…“ und im Stammbaum gibt es „Entfernen“. Das funktioniert nur, wenn

- keine Kachel die Arbeitskopie benutzt,
- sie keine ungesicherten Änderungen hat,
- ihr Zustand lesbar ist und sie nicht gesperrt ist.

Der Ordner wird gelöscht, der **Branch bleibt bestehen**. So geht keine Arbeit verloren, die schon committet ist. Die App entfernt nur Arbeitskopien, die sie selbst angelegt hat (im Stammbaum „verwaltet“).

## Branch-Chip

Bei jedem Git-Projekt zeigt der Kachelkopf den Chip „⑂ Branch“. Er sagt dir, in welchem Ordner das Terminal gestartet wurde:

- Im Projektordner steht der Branch des Projekts.
- In einer Arbeitskopie steht deren Branch. Ein Punkt „●“ weist auf ungesicherte Änderungen hin. Der Mauszeiger zeigt den Pfad und die Zahl der Änderungen.
- „⑂ unbekannt“ heißt, die Arbeitskopie war nicht lesbar. „(fehlt)“ heißt, der Ordner existiert nicht mehr.

Ein Klick auf den Chip öffnet den Stammbaum.

## Stammbaum

Der Stammbaum zeigt alle Arbeitskopien eines Projekts als Äste an einem Stamm. Du öffnest ihn mit dem Knopf „⑂“ in der Kopfleiste, mit ⌘⇧Y, über das Menü „Funktionen“ oder über „Arbeitskopien-Stammbaum…“ im Menü „▾“. Der Knopf „⑂ N“ erscheint bei Git-Projekten, N ist die Zahl der Arbeitskopien einschließlich des Projektordners. „← Zurück zu den Terminals“ schließt die Ansicht.

Oben steht der **Stamm**: der Hauptbranch mit letztem Commit. Jeder Ast ist eine Karte mit:

- Branch-Name und einer Art-Marke,
- Pfad,
- `↑` und `↓`: Commits vor und hinter dem Stamm, dazu die Marke „gemergt“, wenn der Branch schon im Stamm steckt,
- Zahl der ungesicherten Änderungen,
- dem letzten Commit mit Zeitangabe,
- den Kacheln, die in diesem Ordner laufen, mit ihrem Agentenzustand. Ein Klick springt zur Kachel.

Die Art-Marken:

| Marke | Bedeutung |
|---|---|
| Projekt | dein Projektordner |
| verwaltet | von dieser App angelegt, sie darf sie auch entfernen |
| übernommen | ein fremder Ordner, den du mit der App verknüpft hast |
| extern (Codex) oder extern | ein Git-Worktree, den ein anderes Werkzeug angelegt hat |
| verwaist | der Eintrag existiert in Git, der Ordner nicht mehr |
| gesperrt | Git hat die Arbeitskopie gesperrt |

Aktionen auf einer Karte:

- **Terminal hier öffnen**, **Agent hier starten** und **Änderungen ansehen** (öffnet das [Diff-Panel](diff-und-git.md#änderungen-ansehen) für diesen Ordner),
- **Entfernen** nur bei „verwaltet“,
- bei „verwaist“ gibt es keine Aktion. Die Karte erklärt, dass du im Terminal `git worktree prune` ausführen kannst.

### Fremde Arbeitskopien übernehmen

Arbeitskopien, die ein anderes Werkzeug angelegt hat (zum Beispiel Codex), zeigt der Stammbaum auch an. Bevor du darin etwas startest, musst du sie übernehmen. Statt „Terminal hier öffnen“ steht dort „Übernehmen…“. Die App warnt dann:

> Dieser Ordner gehört einem anderen Werkzeug (Codex). Ein zweiter Agent im selben Ordner kann dessen Arbeit stören.

Erst nach „Trotzdem verknüpfen und fortfahren?“ wird der Ordner verknüpft (Art-Marke „übernommen“) und die gewählte Aktion ausgeführt. Übernehmen solltest du nur, wenn das andere Werkzeug dort gerade nichts tut.

### Grenzen der Aktualisierung

- Die Ansicht liest den Zustand beim Öffnen und bei „⟳ Aktualisieren“. Ein `git checkout` im Terminal zeigt sich erst bei der nächsten Aktualisierung.
- Eine Kachel wird dem Ast zugeordnet, in dem sie gestartet wurde. Ein `cd` im Terminal erkennt die App nicht.
- Bei Projekten ohne Git zeigt die Ansicht nur einen Hinweis.
