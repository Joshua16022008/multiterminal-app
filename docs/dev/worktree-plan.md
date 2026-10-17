<!-- Entwurf des Planungs-Workflows vom 17.10.2026. Verbindlich bei Abweichungen: docs/dev/ipc-contract.md und docs/dev/oss-gesamtplan.md. -->

# Teilplan Vorhaben 1: Worktrees (Branch an der Kachel und Stammbaum-Ansicht)

## Ziel
- Jede Kachel in einem Git-Projekt zeigt im Kopf, auf welchem Branch und in welcher Arbeitskopie sie läuft.
- Ein Klick auf diese Angabe öffnet den Stammbaum genau an diesem Ast.
- Der Stammbaum ist eine eigene Ansicht je Projekt:
  - main ist der Stamm, alle `git worktree list`-Einträge sind Äste. Das umfasst auch fremde Worktrees von Codex, die als „extern“ markiert werden.
  - An jedem Ast hängen die laufenden Kacheln mit ihrem Agentenstatus. Ein Klick auf eine Kachel springt zu ihr.
- Die Ansicht liest nur und braucht keine neue Abhängigkeit. Verändernd sind ausschließlich die Aktionen „Terminal hier öffnen“, „Agent hier starten“ und „Entfernen“, und Entfernen gibt es nur für Worktrees, die die App selbst verwaltet.

## Befund im Code (Ist-Stand)
- **wtChip** (`src/renderer/terminal-pane.js:145`, Kopf `:187`, Logik `:293-303`):
  - Er erscheint nur, wenn `desc.workspaceId` gesetzt ist, und zeigt dann `⑂ <branch>`, `(fehlt)` oder `⑂ unbekannt`.
  - Er wird einmal beim Einhängen der Kachel per `api.worktrees.inspect` gefüllt und danach nie aktualisiert. Ein `git checkout` im Terminal bleibt also unsichtbar.
  - Er ist nicht klickbar. Er nutzt die Klasse `acct-chip` (`styles.css:217`, max-width 30 %), und `.wt-chip.bad` liegt in `worktree.css:15`.
  - Kacheln im Projektordner haben gar keinen Chip.
- **Sortierung:**
  - `app.js:120-170`: `displayList()` sortiert über `DeckActivity.sortByActivity` (wartet → arbeitet → inaktiv) und ist stabil zur manuellen Reihenfolge `panesOf(pid)`.
  - `syncGrid` setzt nur CSS-`order`, die DOM-Knoten bleiben stehen. Das ist wichtig, weil der webview sonst neu lädt.
  - `reorder.js` tauscht nur zwei Plätze, `layout.js` liefert nur Spalten und Zeilen.
  - Eine Gruppierung nach Worktree gibt es nicht.
- **Branch-Informationen:**
  - `diff-service.listChanges(cwd)` liefert `branch`, `root` und die Dateien.
  - `worktree-service.inspect` liefert branch, changes und exists.
  - `registeredPaths()` (privat) liest `git worktree list --porcelain` und ignoriert dabei `branch`, `HEAD`, `locked` und `prunable`.
  - `git-service.js` kümmert sich nur um GitHub, Pull und Sync und liefert nichts für Branches.
  - Für ahead/behind, merge-base und „gemergt“ gibt es noch keinen Code.
- **Zuordnung:**
  - Der PTY-Snapshot (`pty-manager.js:171`) kennt `cwd` (nur das Startverzeichnis) und `workspaceId`.
  - `port-service.js` liest die Prozessbäume bereits mit `ps -axo pid=,ppid=` und `lsof`; das lässt sich für eine spätere Erkennung des aktuellen Arbeitsordners wiederverwenden.
  - Agent-Events tragen kein cwd.
- **`resolveCwd`** verlangt einen eigenen Datensatz in `worktrees.json`. Externe Worktrees können deshalb heute weder Terminal- noch Diff-Ziel sein.
- **Live-Befund im Repo:** `git worktree list` zeigt aktuell vier Einträge: den Hauptcheckout, `~/.codex/worktrees/1580/...`, `.agent-worktrees/...` und einen prunable-Rest unter `.qa-hotkeys-tmp/...`. Das ist ein guter Realtest für die Arten.

## Nutzerablauf
1. Im Kachelkopf steht direkt hinter dem Titel ein Branch-Chip.
   - Kachel im Projektordner: `⑂ main`, gedämpft dargestellt.
   - Kachel in einer Arbeitskopie: `⑂ feature/x` in der Astfarbe, bei ungesicherten Änderungen mit einem Punkt.
   - Ein Klick öffnet den Stammbaum, scrollt zum Ast und hebt ihn hervor.
2. Die Topbar hat neben dem Projekttitel einen Knopf `⑂ 3` (Anzahl der Äste). Er öffnet denselben Stammbaum ohne Fokus auf einen Ast. Alternativ geht das per Hotkey oder über die Befehlspalette mit dem Eintrag „Stammbaum / Arbeitskopien“.
3. Die Ansicht ersetzt den Kachelbereich, so wie heute die Einstellungen. Esc oder „Zurück zu den Terminals“ schließt sie.
   - Links verläuft der Stamm (Trunk-Branch) senkrecht.
   - Jeder Ast zweigt am Gabelpunkt (merge-base) ab und trägt eine Karte mit diesen Angaben:
     - Branch, Pfad (gekürzt) und Art: verwaltet, extern (Codex), extern oder verwaist
     - ↑ahead und ↓behind gegenüber dem Trunk
     - die Markierung „gemergt“
     - letzter Commit: Kurz-SHA, Betreff, relative Zeit
     - Anzahl ungesicherter Änderungen
     - die Kacheln, die dort laufen, mit Statuspunkt (wartet/arbeitet/inaktiv). Ein Klick springt zur Kachel.
4. Aktionen je Ast:
   - **Terminal hier öffnen**
   - **Agent hier starten** (öffnet den Kontextstart-Dialog mit der Arbeitskopie schon ausgewählt)
   - **Änderungen ansehen** (Diff-Panel für diesen Ast)
   - **Entfernen**: nur für verwaltete Worktrees, nur wenn sie sauber sind und keine Kachel sie nutzt. Der Branch bleibt bestehen.
   - Verwaiste (prunable) Einträge bekommen nur einen Hinweis. Es gibt keine Prune-Aktion.
5. Bei einem externen Ast verknüpft „Terminal hier öffnen“ den Worktree als nicht verwalteten Datensatz (`managed:false`) und startet erst dann. Vorher erscheint der Hinweis „Dieser Ordner gehört einem anderen Werkzeug (Codex). Ein zweiter Agent im selben Ordner kann dessen Arbeit stören.“

## Platzierung des Einstiegs (Empfehlung)
- **Hauptweg: ein `⑂ n`-Knopf in der Topbar direkt rechts von `#ws-title` und `#counter`.**
  - Der Stammbaum gehört zu einem Projekt, und der Projektname steht genau dort.
  - Der Bereich oben links neben „Einstellungen“ ist projektübergreifend und daher die falsche Ebene.
  - Neben „+“ wäre es ein Startweg und würde mit dem Split-Menü verwechselt.
  - Der Knopf ist ausgeblendet, wenn das Projekt kein Git-Repo ist.
- **Zusätzlich:**
  - der Branch-Chip in jeder Kachel, fokussiert auf den jeweiligen Ast
  - Hotkey-Aktion `worktree-tree`, Vorschlag `Cmd+Shift+Y` (das Y ähnelt einer Gabelung). Die Buchstaben D, P, J, G, U, E, L, B, K, S und O sind belegt; `reserved()` wird geprüft.
  - ein Eintrag in der Befehlspalette
  - ein Menüpunkt „Arbeitskopien-Stammbaum…“ neben „Terminal in Arbeitskopie…“ (`app.js:606`)

## Datenmodell
**Neue IPC-Schnittstelle `worktrees:tree(projectId)`.** Sie liest nur, alles läuft per execFile mit Argument-Arrays.
```js
{ ok, isGit, projectPath,
  trunk: { name, head, subject, time },            // origin/HEAD → main → master → current branch of project path
  nodes: [{
    id,                    // workspaceId oder 'path:'+sha1(realpath)
    path, branch|null, head, detached, locked, prunable, missing,
    kind: 'project'|'managed'|'linked'|'external',  // linked = managed:false-Datensatz
    origin: 'app'|'codex'|'agent-worktrees'|'other', // aus Pfadmuster (~/.codex/worktrees, /.agent-worktrees/)
    workspaceId|null,
    forkPoint, ahead, behind, merged,              // merged = merge-base --is-ancestor <branch> <trunk>
    last: { sha, subject, time, author },
    changes: number|null                           // null = nicht lesbar / prunable
  }],
  generatedAt }
```
- **Die Zuordnung der Terminals erfolgt im Renderer**, denn er kennt Panes und Status:
  - Gilt `desc.workspaceId === node.workspaceId`, hängt die Kachel an diesem Ast.
  - Hat eine Kachel keine workspaceId, hängt sie am Projekt-Knoten.
- **Optionale Live-Erkennung (AP-F):** `worktrees:liveCwds(projectId)` liefert `{ terminalId: cwd }` aus dem cwd der Nachfahren der Shell. Zugeordnet wird über das längste gemeinsame Präfix der realpath-Pfade und mit dem Zusatz „erkannt über Ordner“ markiert.
- **`worktrees.json`:** Das Schema bleibt `version: 1`. Neu sind nur Datensätze mit `managed:false`, die `adopt` anlegt. Das Feld gibt es bereits. Für `remove` gilt dann:
  - Bei `managed:false` wird nur der Datensatz vergessen, es läuft niemals `git worktree remove`.
- **Branch-Farbe:** eine pure Funktion `colorFor(branch)` mit stabilem Hash auf eine kleine Palette. Kachel-Chip und Ast nutzen dieselbe Farbe.

## Betroffene und neue Dateien
| Datei | Neu/Änd. | Grund |
|---|---|---|
| `src/main/worktree-tree.js` | neu | Reine Parser (`parsePorcelain`, `classifyOrigin`, `pickTrunk`) und `buildTree({projectPath, records, run})` mit Git-Abfragen. Nebenläufigkeit begrenzt, Timeout je Abfrage, Ergebnis maximal 10 s gecacht. |
| `src/main/worktree-service.js` | Änd. | `registeredPaths` auf den gemeinsamen Parser umstellen; neue Funktion `adopt({project, path})` (Pfad muss in `worktree list` stehen, nicht prunable, nicht der Projektordner); `remove` bei `managed:false` vergisst nur den Datensatz. |
| `src/main/main.js` | Änd. | IPC `worktrees:tree` und `worktrees:adopt`, später `worktrees:liveCwds`. Den Menüeintrag für den Hotkey über die vorhandene `shortcutItems` einhängen. |
| `src/main/preload.js` | Änd. | `worktrees.tree`, `worktrees.adopt` (und `liveCwds`) |
| `src/renderer/tree-layout.js` | neu | Pure Funktion: Knoten → Positionen (Stamm-y nach Zeit des Gabelpunkts, Äste gestaffelt) und SVG-Pfade (kubische Kurven). Läuft im Browser und in Node-Tests, nach dem Muster von `layout.js`. |
| `src/renderer/worktree-tree.js` | neu | Ansicht `D.worktreeTree.open({project, focusId})`: SVG für Stamm und Kurven, HTML-Karten für Äste und Kacheln, Aktionen, Aktualisieren-Knopf, leere Zustände und Fehlerzustände. |
| `src/renderer/worktree-tree.css` | neu | Styles der Ansicht, Hell und Dunkel über die vorhandenen CSS-Variablen |
| `src/renderer/terminal-pane.js` | Änd. | Chip für alle Git-Kacheln, `pane.refreshBranch()` (Aufruf bei Fokus mit Drossel und nach dem Laden des Stammbaums), Klick → `hooks.onBranchClick(pane)`, Drag-Schutz wie beim statusDot. Kacheln im Projektordner holen den Branch über `api.diff.list`, die mit Arbeitskopie über `inspect`. |
| `src/renderer/app.js` | Änd. | `#btn-tree` verdrahten und Zähler pflegen; Hook `onBranchClick`, Palette- und `runFeatureAction('worktree-tree')`; `jumpToPane` an die Ansicht übergeben; Diff für einen gewählten Ast über eine `getContext`-Überschreibung |
| `src/renderer/diff-panel.js` | Änd. (klein) | `showFor({workspaceId})`: einmalige Kontextüberschreibung |
| `src/renderer/agent-launch.js` | Änd. (klein) | `open({project, workspaceId})` wählt `folder:'existing'` und die Arbeitskopie vor |
| `src/renderer/hotkeys.js` | Änd. | Aktion `worktree-tree` und deren Standardbelegung |
| `src/renderer/index.html`, `styles.css`, `worktree.css` | Änd. | Knopf, Container `<section id="worktree-view" hidden>`, Script-/CSS-Tags, Chip-Varianten (`.wt-chip.trunk`, `.clickable`, Farbe per `--wt-color`) |
| `src/renderer/activity.js` (oder neues `worktree-groups.js`) | Änd./neu (optional) | `groupByWorkspace(list, keyFn)`: stabil, innerhalb der Gruppen gilt weiter die Aktivitätssortierung |
| `src/renderer/qol-panel.js` | Änd. (optional) | Schalter „Kacheln nach Arbeitskopie gruppieren“, standardmäßig aus |

## Wiederverwendbare Funktionen
- `runGit`/`gitEnv` (`src/main/worktree-service.js`), mit execFile, ohne Shell, mit `GIT_TERMINAL_PROMPT=0`
- `isDirty`, `real()`, `resolveCwd`, `inspect`, `remove` (`src/main/worktree-service.js`)
- `sessionUsesWorkspace` (`src/main/main.js:133`), die Sperre beim Entfernen
- `createDiffService().listChanges` (`src/main/diff-service.js`) für den Branch von Kacheln im Projektordner; `diff:list` mit workspaceId funktioniert nach `adopt` auch für externe Worktrees
- `DeckActivity.activityOf/projectActivity` (`src/renderer/activity.js`) für die Statuspunkte und die Zusammenfassung je Ast
- `DeckAttention.createStatusDot/dotInfo` (`src/renderer/attention-panel.js`) als einheitlicher Statuspunkt
- `jumpToPane` (`src/renderer/app.js:799`), `newTerminal(project.id, null, undefined, ws)` (`app.js:613`), `D.agentLaunch.open`, `D.diffPanel`, `D.worktreePicker`
- `D.h`, `D.guard`, `D.notify` als Renderer-Helfer
- `ps`/`lsof`-Auswertung in `src/main/port-service.js` für AP-F
- `qa-worktree.js` als Vorlage für Temp-Repo, isolierte Daten und Shell

## Arbeitspakete (Reihenfolge; Dateibereiche getrennt für parallele Worktrees)
| AP | Inhalt | Dateien (exklusiv) | hängt ab von |
|---|---|---|---|
| **A** Backend Baum | `worktree-tree.js` (Parser, Trunk-Wahl, ahead/behind über `rev-list --left-right --count trunk...branch`, `merge-base`, `merge-base --is-ancestor`, `log -1 --format=%H%x00%s%x00%ct%x00%an`, `status --porcelain`), dazu `adopt` und `remove`(linked) in `worktree-service.js` | `src/main/worktree-tree.js`, `src/main/worktree-service.js`, `tests/worktree-tree.test.js`, `tests/worktree-service.test.js` | – |
| **B** Layout-Kern | `tree-layout.js`, pure Funktionen, plus `colorFor` | `src/renderer/tree-layout.js`, `tests/tree-layout.test.js` | – (nur der Vertrag aus dem Datenmodell) |
| **C** Kachel-Chip | Chip für alle Git-Kacheln, Aktualisierung, Klick-Hook, Farbe | `src/renderer/terminal-pane.js`, `src/renderer/worktree.css`, `tests/terminal-pane-branch.test.js` | B (`colorFor`) |
| **D** Ansicht | `worktree-tree.js` und CSS, Aktionen über Callbacks (keine direkten app.js-Interna) | `src/renderer/worktree-tree.js`, `src/renderer/worktree-tree.css`, `tests/worktree-tree-view.test.js` | B, Vertrag aus A |
| **E** Integration | IPC und Preload, Topbar-Knopf, Hotkey, Palette, Menüpunkt, `onBranchClick`, Diff-Überschreibung, Vorbelegung im Kontextstart | `src/main/main.js`, `src/main/preload.js`, `src/renderer/app.js`, `index.html`, `styles.css`, `hotkeys.js`, `diff-panel.js`, `agent-launch.js`, `scripts/qa-worktree-tree.js` | A–D |
| **F** (optional) | Live-cwd-Erkennung und Gruppieren nach Arbeitskopie | `src/main/worktree-live.js` (neu), `src/renderer/worktree-groups.js` (neu), `qol-panel.js` | E |

- A, B, C und D können parallel laufen.
- E läuft allein im gemeinsamen Checkout, und erst nach Abstimmung in `WORK_IN_PROGRESS.md`: `main.js`, `preload.js`, `app.js` und `index.html` sind dort gerade von Codex-Arbeit belegt (uncommittet).

## Tests
**Unit-Tests (node:test, mit gefälschtem `run`):**
- `parsePorcelain`: Pfade mit Leerzeichen, `detached`, `locked`, `prunable <grund>`, bare. Als Fixture dient genau die aktuelle 4-Eintrags-Ausgabe des Repos.
- `classifyOrigin`: Pfade aus Codex, aus `.agent-worktrees`, App-Datenordner und sonstige.
- `pickTrunk`: mit origin/HEAD, mit nur `master`, ohne Commit.
- `buildTree`:
  - ahead/behind, merged, last, changes
  - ein Fehler in einem Knoten führt nur zu `null`-Feldern, nie zum Abbruch des ganzen Baums
  - Kein Git ergibt `isGit:false`.
- `adopt`:
  - lehnt unbekannte, prunable und Projektordner-Pfade sowie Doppelte ab
  - `remove` bei `managed:false` ruft kein `worktree remove` auf (Spy auf `run`)
- `tree-layout`: deterministische Positionen, keine Überlappung bei 1 bis 30 Ästen, stabile Farben.
- Chip: Text und Klasse bei Trunk, Arbeitskopie, fehlender Kopie und Fehler; die Drossel der Aktualisierung.
- Ansicht (jsdom-frei wie die bisherigen Panel-Tests):
  - „Entfernen“ nur bei verwalteten Worktrees
  - Hinweis-Dialog bei externen
  - Kacheln korrekt an den Ästen
  - Klick ruft `onJump(paneId)` auf

**Electron-QA `scripts/qa-worktree-tree.js` nach dem Muster von `qa-worktree.js`:**
- Vorbereitung:
  - Temp-Repo `main` mit 2 Commits
  - App-Worktree `feature/a` mit einem zusätzlichen Commit und einer Datei geändert
  - von außen per `git worktree add` angelegter Worktree unter einem Pfad `…/.codex/worktrees/…`
  - ein gemergter Branch
  - ein gelöschter Ordner (prunable)
- Erwartungen:
  - Chips: `⑂ main` an der Kachel im Projektordner, `⑂ feature/a` an der Arbeitskopie
  - Ein Chip-Klick öffnet die Ansicht mit fokussiertem Ast; ein Knopf-Klick öffnet sie ohne Fokus.
  - Die Ansicht zeigt 4 Äste mit den richtigen Arten, ahead=1 und changes=1 bei `feature/a`, „gemergt“ beim gemergten Branch, „verwaist“ ohne Aktion.
  - Der Kachelklick springt (`DeckApp.state.activeByProject`).
  - „Terminal hier öffnen“ am externen Ast ergibt nach Bestätigung einen `managed:false`-Datensatz und eine Kachel mit diesem cwd (Marker-Datei).
  - Entfernen bei dirty wird abgelehnt, bei sauber entfernt; der Branch bleibt bestehen.
- Am Ende ein Screenshot, der visuell geprüft wird.

## Risiken
- **Leistung:** Pro Ast laufen 4 bis 5 Git-Aufrufe. Gegenmittel sind höchstens 4 parallele Aufrufe, ein Cache von 10 s, das Laden nur bei offener Ansicht und das Aktualisieren des Chips nur bei Fokus.
- **Agenten im selben Ordner:** Ein Terminal in einem Codex-Worktree kann einen laufenden Codex-Agenten stören. Dagegen helfen der Bestätigungsdialog und der Umstand, dass `adopt` kein Entfernen erlaubt.
- **Branch-Wechsel in einer Kachel:** Wird in einer Kachel `git checkout` ausgeführt, ist die Anzeige bis zur nächsten Aktualisierung veraltet. Ohne AP-F folgt die Zuordnung nur dem Startordner (`workspaceId`), ein `cd` im Terminal wird nicht erkannt. Das wird in der Ansicht ausdrücklich so benannt.
- **Trunk-Erkennung:** Bei Repos ohne `main` oder `master` oder ohne Commit kann sie danebenliegen. Fallback ist der aktuelle Branch des Projektordners, mit Kennzeichnung.
- **Platz im Kachelkopf:** Mit dem zusätzlichen Chip wird es eng (acct-chip max-width 30 %). Der Branch wird von links gekürzt, der volle Name steht im title.
- **Konfliktgefahr in AP-E:** Die Dateien sind im gemeinsamen Checkout uncommittet geändert. Integration daher nur nach Freigabe und Reihenfolge laut `WORK_IN_PROGRESS.md`.

## Offene Fragen an Joshua
1. Darf „Terminal hier öffnen“ bei fremden Codex-Worktrees diese nach einer Warnung als „verknüpft“ übernehmen, oder sollen externe Äste nur angezeigt werden (Diff ja, kein Terminal)?
2. Soll der Stammbaum auch lokale Branches ohne Worktree zeigen (als blasse Zweige), oder nur echte Arbeitskopien?