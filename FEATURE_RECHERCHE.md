# Nützlichere Alltagsfunktionen für Multiterminal

Stand: 14.10.2026. Aufgabe `RESEARCH-20261014-01`, Codex mit lesendem Sol-6.1-Unteragenten für den App-Abgleich. Recherche und Vorschläge; keine Umsetzung beauftragt oder vorgenommen.

## Empfehlung

Den größten persönlichen Nutzen sehe ich bei **Agentenstatus mit gezielten Hinweisen**, **eindeutigem Fortsetzen derselben Unterhaltung** und **schnellem Finden von Kacheln und Ausgaben**. Diese Funktionen helfen unabhängig davon, ob du gerade eine Website, eine Electron-App oder ein anderes Projekt bearbeitest.

Danach würde ich Feedback vereinfachen: **Codeänderungen ansehen und kommentieren**, **Elemente im Mini-Browser markieren** und **Dateien/Bilder gezielt an eine Kachel übergeben**. **Optionale getrennte Arbeitskopien** sind besonders wertvoll, sobald mehrere Agenten gleichzeitig Dateien desselben Projekts ändern.

Diese Reihenfolge ist meine Einschätzung aus deinem Arbeitsablauf und dem Quellvergleich, keine gemessene Produktivitätssteigerung. Aufwand unten bedeutet relative technische Größenordnung, keine Zeit- oder Kostenzusage.

## Rechercheumfang und Grenzen

Verglichen wurden aktuelle offizielle Seiten von cmux, Superset, Emdash, Conductor und Vibe Kanban. Bei Superset und cmux wurden zusätzlich Funktionsdokumentationen gelesen. Beschriebene Fremdfunktionen sind Herstellerangaben; die Apps wurden nicht installiert oder praktisch getestet.

BridgeMind wurde ausdrücklich untersucht: Startseite, Produktseite und Dokumentation lieferten dem gstack-Browser eine Cloudflare-Sperrseite (HTTP 403). Suchergebnisse verweisen auf BridgeMind One mit Agenten, Coding-Threads, Routinen, Plugins und Diktat; diese Ausschnitte reichen für einen belastbaren Detailvergleich nicht aus. Deshalb wird hier keine konkrete Empfehlung als verifiziertes BridgeMind-Feature ausgegeben. Die Quellenlücke betrifft [Produktseite](https://www.bridgemind.ai/product) und [Dokumentation](https://docs.bridgemind.ai/).

Unser Vergleichsstand ist der aktuelle lokale Quellcode auf `main`, HEAD `0f322cc`, einschließlich vorhandener uncommitteter Änderungen. „Vorhanden“ bedeutet in dieser Recherche im Code nachgewiesen. Eine erneute Bedienprüfung der installierten App wurde nicht durchgeführt. „Nicht gefunden“ bezieht sich auf eingebaute Appfunktionen im geprüften Quellumfang; die gestarteten CLIs können zusätzliche eigene Funktionen besitzen.

## Was die anderen Werkzeuge für uns interessant macht

| Werkzeug | Relevanter Schwerpunkt aus offiziellen Quellen | Bedeutung für Multiterminal |
|---|---|---|
| [cmux](https://cmux.com/) | Terminaloberfläche mit Aufmerksamkeitssignalen, Arbeitsbereichsinformationen und programmierbarem Browser | Besonders nah an unserem Terminalansatz; Organisation und Aufmerksamkeit sind gute Vergleichspunkte. |
| [Superset](https://superset.sh/) | Getrennte Worktrees, Agentenstatus, Sitzungsfortsetzung, Code-Review und Browser-Feedback | Liefert die konkretesten dokumentierten Beispiele für fehlende Übergänge zwischen Auftrag, Arbeit und Prüfung. |
| [Emdash](https://emdash.com/) | Aufgabenbezogene Arbeitsbereiche halten Branch, Terminal, Gespräch und Review zusammen; Bibliothek für wiederverwendbare Ressourcen | Statt nur die Kachel zu speichern, den gesamten Arbeitsauftrag wiederfinden. |
| [Conductor](https://www.conductor.build/) | Aktuell stärker auf isolierte Cloud-Arbeitsbereiche, Gerätezugriff und Zusammenarbeit ausgerichtet | Für unsere persönliche lokale Nutzung weniger direkt relevant; daher keine Empfehlung, Cloudbetrieb nachzubauen. |
| [Vibe Kanban](https://www.vibekanban.com/) | Aufgaben strukturieren, Agenten parallel einsetzen, Änderungen kommentieren und UI prüfen | Gute Inspiration für die menschliche Planung und Abnahme. Die Website meldet aktuell die Einstellung des bisherigen Angebots mit Fortführung als Community-Projekt; hier nur als Funktionsreferenz verwendet. |
| [BridgeMind](https://www.bridgemind.ai/product) | Detailquellen im Recherche-Browser gesperrt | Vergleich offen; keine daraus abgeleiteten bestätigten Funktionsbehauptungen. |

## Unser Ausgangsstand

Bereits vorhanden sind Projektleiste, bis zu 30 Terminalkacheln, Schnellstartbefehle, Konten-/Profilbereiche, Diktat, Verbrauchsanzeige, Kachelnamen und Farben, Tastenkürzel, Kacheltausch sowie gespeicherter Aufbau und Scrollback. Diese Bereiche werden nicht nochmals als völlig neue Features vorgeschlagen. Details und bestehende Abnahmegrenzen stehen in `PROJECT_STATUS.md` und `PROGRESS.md`.

Wichtige Unterscheidungen aus dem Quellabgleich:

| Bereich | Aktueller Beleg | Tatsächliche Lücke |
|---|---|---|
| Status | `src/renderer/terminal-pane.js:218` setzt nach erfolgreichem Shell-Start `running`; Prozessende wird separat behandelt. | Kein nachgewiesener Zustand „Agent arbeitet / braucht Antwort / fertig“. |
| Wiederherstellung | `src/main/session-store.js:39` speichert Kachel, Befehle, Browser und Konten; `terminal-pane.js:207` lädt alten Scrollback. | Keine native Agent-Session-ID pro Kachel. Die eingebauten Fortsetzenbefehle verwenden die jeweils letzte Unterhaltung (`src/main/presets.js:13`). |
| Git | `src/main/git-service.js:144` liest Kurzstatus; `:177` synchronisiert vorhandene Commits. | Keine eingebaute Diff-Ansicht oder zeilenbezogene Rückmeldung. |
| Parallelität | `src/main/main.js:123` bestimmt den Arbeitsordner anhand des Projekts; PTYs erhalten dieses `cwd`. | Keine automatische Worktree-Zuordnung pro Aufgabe/Kachel. Dokumentierte Zuständigkeiten sind keine technische Dateitrennung. |
| Mini-Browser | `src/main/browser-control.js:177` enthält Navigation, Text, Console und Screenshot. | Kein Elementkommentar; agentisches Klicken/Tippen fehlt im Befehlsumfang. Screenshots setzen aktuell eine sichtbare Vorschau voraus (`:211`). |
| Start und Suche | `src/renderer/app.js:392` bietet eigene Einzelbefehle; `terminal-pane.js:125` lädt Terminal-Addons. | Keine gefundenen Mehrkachel-Vorlagen, Command Palette oder Terminal-Verlaufssuche. |
| Übergabe | `src/renderer/progress-panel.js:6` bietet einen festen PROGRESS.md-Leseauftrag fürs aktive Terminal. | Kein strukturierter Übergabedialog zwischen zwei Agentenkacheln. |

Zusätzlich wurden die gesamte IPC-Oberfläche und die Quellen nach Aufgaben, Inbox, Worktrees, Suche, Anhängen und Übergaben durchsucht. Der Hauptagent hat die entscheidenden Stellen für Status, Fortsetzen, Git und Browser selbst gegengeprüft. Die ausführliche Arbeitsnotiz des Unteragenten liegt temporär unter `/tmp/multiterminal-feature-baseline-20261014.md`; die dauerhaften Schlussfolgerungen stehen hier.

## Priorisierte Vorschläge

### 1. Sehen, welcher Agent dich braucht

**Nutzung:** Du lässt mehrere Agenten arbeiten und siehst eine kleine Liste: „Codex braucht eine Entscheidung“, „Claude hat seine Antwort beendet“, „Kimi-Status unbekannt“. Ein Klick oder Kürzel springt in die passende Kachel, auch in einem anderen Projekt.

**Vorbild:** cmux dokumentiert ungelesene Hinweise und das direkte Springen zum betroffenen Arbeitsbereich. Superset dokumentiert Agentenereignisse für Abschluss und Eingabebedarf; die Unterstützung unterscheidet sich je Agent. Quellen: [cmux Notifications](https://cmux.com/docs/notifications), [Superset Agent Status](https://docs.superset.sh/agent-status).

**Kleinster sinnvoller Einstieg:** Ungelesen-Markierung pro Kachel und eine Aufmerksamkeitliste; Desktop-Hinweise nur, wenn sie gebraucht werden. Zunächst einen Agenten zuverlässig anbinden, weitere erst mit passender Ereignisquelle. „Unbekannt“ ausdrücklich anzeigen, wenn kein belastbares Signal existiert.

**Priorität:** sehr hoch. **Aufwand:** mittel. Das Ende einer Agentenantwort bedeutet noch keine fachlich geprüfte Fertigstellung. Eine ausbleibende Terminalausgabe allein darf nicht als „fertig“ gelten.

### 2. Genau dasselbe Gespräch wieder öffnen

**Nutzung:** Nach einem App-Neustart öffnest du „Browserfehler prüfen“ und setzt genau dieses Gespräch fort, obwohl im selben Projekt noch drei andere Claude-Kacheln existieren.

**Vorbild:** Superset beschreibt Fortsetzen anhand der nativen Agent-Session-ID und zeigt gescheiterte Wiederaufnahme sichtbar an. Quelle: [Agent Sessions & Forking](https://docs.superset.sh/agent-sessions).

**Bei uns:** Layout und Ausgabe werden bereits gerettet. Der eingebaute Fortsetzenknopf verwendet aber `claude --continue`, `codex resume --last` oder `kimi --continue`; eine feste Gesprächszuordnung ist im gespeicherten Kachelschema nicht vorhanden. Das ist eine Zuordnungslücke, kein in dieser Recherche reproduzierter Fehlstart.

**Kleinster sinnvoller Einstieg:** Bei einem unterstützten Agenten Gesprächs-ID erfassen, mit Projekt und Konto speichern und gezielt fortsetzen. Ohne ID die fehlende Zuordnung sichtbar machen. Native Gesprächsfortsetzung und weiterlaufender Terminalprozess sind getrennte Funktionen.

**Priorität:** sehr hoch. **Aufwand:** mittel bis groß; agentenspezifisch.

### 3. Kacheln, Projekte und Ausgaben schnell finden

**Nutzung:** Ein Suchfeld findet „Kamera“, „npm-Fehler“ oder „Korallen“ über Kacheln und Projekte. Innerhalb einer Kachel kannst du eine Fehlermeldung im gespeicherten Verlauf wiederfinden, statt lange zurückzuscrollen.

**Vorbild:** cmux dokumentiert Command Palette, Arbeitsbereichswechsel, globale Suche und Terminalsuche. Quelle: [Keyboard Shortcuts](https://cmux.com/docs/keyboard-shortcuts).

**Kleinster sinnvoller Einstieg:** Zuerst eine Palette für Projekt-/Kachelnamen und vorhandene Aktionen; danach Suche im Terminalverlauf. Das Raster und die bestehenden Nummernkürzel bleiben nutzbar. Der Suchumfang muss sichtbar sein, weil unser persistierter Scrollback begrenzt ist (`terminal-pane.js:424`).

**Priorität:** hoch. **Aufwand:** klein bis mittel. Keine neue Modellanbindung erforderlich.

### 4. Geänderten Code direkt prüfen und Rückmeldung geben

**Nutzung:** „Was wurde geändert?“ öffnet die betroffenen Dateien. Du markierst eine Stelle und schickst „Bitte erklären“ oder „Hier auch den leeren Zustand behandeln“ an den zuständigen Agenten.

**Vorbild:** Superset dokumentiert Diff-Ansichten und das Übergeben ausgewählter PR-Zeilen mitsamt Dateikontext an einen Agenten. Emdash und Vibe Kanban führen Review ebenfalls als Kernablauf. Quellen: [Superset Diff Viewer](https://docs.superset.sh/diff-viewer), [Emdash](https://emdash.com/), [Vibe Kanban](https://www.vibekanban.com/).

**Kleinster sinnvoller Einstieg:** Lokale Dateiliste und lesender Diff gegen einen klar bezeichneten Vergleichsstand, anschließend Kommentar an eine gewählte Kachel. In einem gemeinsam bearbeiteten Ordner lassen sich Änderungen nicht zuverlässig einem einzelnen Agenten zuschreiben; die Ansicht sollte dort Projektänderungen benennen.

**Priorität:** hoch. **Aufwand:** mittel. Commit-/Merge-Automatik ist für den ersten Nutzen nicht nötig.

### 5. Im Mini-Browser auf das Problem zeigen

**Nutzung:** Du klickst auf einen Button und schreibst „auf dem Handy zu breit“. Der gewählte Agent erhält deinen Kommentar, URL, Screenshot und Elementkontext. Du musst das Problem nicht räumlich beschreiben und Dateien zusammensuchen.

**Vorbild:** Supersets Design Mode dokumentiert Elementauswahl mit Kommentar, DOM, berechneten Styles, Screenshot und gegebenenfalls React-Metadaten. Vibe Kanban nennt UI-Prüfung und Komponentenauswahl. Quellen: [Superset In-App Browser](https://docs.superset.sh/browser), [Vibe Kanban](https://www.vibekanban.com/).

**Bei uns:** Browser, Screenshot, Console und Seitentext existieren bereits. Der Mehrwert ist das gezielte Feedback an den Agenten. Eine weitere Ergänzung wären einfache Klick-/Eingabeaktionen für agentische UI-Prüfungen.

**Kleinster sinnvoller Einstieg:** Element markieren, sichtbaren Kommentar und Screenshot an eine ausgewählte Kachel übergeben. Tiefere Komponentenauflösung und umfangreiche Automation später.

**Priorität:** hoch bei UI-Arbeit. **Aufwand:** mittel bis groß.

### 6. Dateien und Bilder bequem an die richtige Kachel übergeben

**Nutzung:** Foto, Screenshot oder PDF auf eine Kachel ziehen; Dateiverweise im Prompt sehen und vor dem Senden prüfen. Das passt besonders zu Kamera-/OCR- und Bildprojekten.

**Vorbild:** cmux dokumentiert Dateianhänge im Texteingabebereich und das Einfügen des letzten Screenshots als Pfad. Quelle: [Keyboard Shortcuts](https://cmux.com/docs/keyboard-shortcuts).

**Bei uns:** Drag-and-drop tauscht Kacheln. Eine Appfunktion für Datei- oder Bildübergabe wurde nicht gefunden. Die Bild-/Zwischenablagefähigkeiten der einzelnen CLIs wurden nicht praktisch geprüft.

**Kleinster sinnvoller Einstieg:** Dateidrop mit sichtbarer Zielkachel und korrekt übergebenem Pfad; Zwischenablagebilder anschließend. Je Agent sichtbar unterscheiden, ob ein Dateipfad eingefügt oder ein echter Bildanhang geladen wurde.

**Priorität:** hoch für bildbezogene Projekte. **Aufwand:** klein bis mittel für Pfade, höher für durchgängige agentenspezifische Bildübergabe.

### 7. Optional eine getrennte Arbeitskopie pro Aufgabe

**Nutzung:** Ein Agent baut eine Funktion, ein zweiter untersucht einen Fehler. Beide arbeiten in eigenen Git-Worktrees: getrennte Dateistände desselben Repositories mit eigenen Branches. Du kannst Ergebnisse prüfen und gezielt zusammenführen.

**Vorbild:** Superset und Emdash beschreiben Worktree-Isolation als Grundlage paralleler Aufgaben. Quellen: [Superset](https://superset.sh/), [Emdash](https://emdash.com/).

**Bei uns:** Kacheln desselben Projekts verwenden denselben Projektordner. Unsere Reservierungen helfen bei der Absprache, verhindern Überschreiben aber technisch nicht. Manuell angelegte Worktrees lassen sich grundsätzlich schon als getrennte Projektordner nutzen; das ist hier nicht praktisch getestet.

**Kleinster sinnvoller Einstieg:** Beim Aufgabenstart bewusst zwischen aktuellem Ordner und neuem Worktree wählen; Branch/Ordner immer anzeigen. Beim Schließen unveröffentlichte Änderungen erkennbar erhalten. Worktrees trennen Dateien, aber keine Ports, Datenbanken oder externen Dienste; Merge-Konflikte bleiben möglich.

**Priorität:** sehr hoch bei mehreren schreibenden Agenten im selben Repository, sonst nach den ersten Komfortfunktionen. **Aufwand:** groß.

### 8. Benannte Arbeitsaufbauten und Startabläufe

**Nutzung:** „Web-Entwicklung“ öffnet Devserver, umsetzenden Agenten, Prüfterminal und Browser in der passenden Anordnung. „Recherche“ öffnet einen anderen Aufbau.

**Vorbild:** cmux dokumentiert gespeicherte Layoutvorlagen. Superset unterscheidet Projekt-Setup, aufrufbare Devserver und wiederverwendbare Terminalstarts. Quellen: [cmux Keyboard Shortcuts](https://cmux.com/docs/keyboard-shortcuts), [Superset Project Lifecycle Scripts](https://docs.superset.sh/setup-teardown-scripts).

**Bei uns:** Einzelbefehls-Presets und Wiederherstellung des letzten Aufbaus existieren bereits. Es fehlen mehrere auswählbare Zusammenstellungen mit Rollen, Befehlen und Startreihenfolge.

**Kleinster sinnvoller Einstieg:** Aktuellen Aufbau als benannte Vorlage speichern; gestartete Befehle vor dem Ausführen anzeigen. Devserver separat start-/stoppbar halten.

**Priorität:** mittel. **Aufwand:** mittel.

### 9. Agenten mit einer sichtbaren Übergabe wechseln

**Nutzung:** Claude hat untersucht, Codex soll umsetzen. Ein Übergabefenster enthält Ziel, geprüfte Ergebnisse, relevante Dateien, offene Fragen und genau den nächsten Schritt. Du siehst und bearbeitest den Text vor dem Senden.

**Vorbild:** Superset dokumentiert das Fortführen mit einem anderen Agenten auf Basis übergebenen Kontexts. Quelle: [Agent Sessions & Forking](https://docs.superset.sh/agent-sessions).

**Bei uns:** PROGRESS.md und der feste Leseauftrag sind eine brauchbare Basis. Eine Appfunktion zum gezielten Übergeben zwischen zwei Kacheln fehlt.

**Kleinster sinnvoller Einstieg:** Ausgewählten Text und vorhandene Statusdatei in eine editierbare Übergabevorlage übernehmen, Zielagent wählen. Eine echte Gesprächskopie desselben Agenten ist davon getrennt. Kontextübertragung ersetzt keine native Sitzung und keine Prüfung des aktuellen Dateistands.

**Priorität:** mittel bis hoch bei häufigen Agentenwechseln. **Aufwand:** mittel. Eine generierte Zusammenfassung würde zusätzlich Modellaufrufe erfordern; die erste Version kann ohne sie arbeiten.

### 10. Kleine persönliche Aufgabenliste mit Kachelbezug

**Nutzung:** Du hältst „Zoom testen“ fest, ordnest die Aufgabe später einer Kachel zu und findest Auftrag und Ergebnis auch nach einem Kachelwechsel wieder. Eine Arbeit kann „wartet auf mich“ oder „zur Prüfung“ sein, ohne im Terminalnamen unterzugehen.

**Vorbild:** Vibe Kanban organisiert Aufgaben um Planung und Review; Emdash hält Arbeitsbereich und Aufgabe zusammen. Quellen: [Vibe Kanban](https://www.vibekanban.com/), [Emdash](https://emdash.com/).

**Kleinster sinnvoller Einstieg:** Titel, Projekt, zugeordnete Kachel, Status und Notiz. PROGRESS.md und die vorhandenen Second-Brain-Aufgaben müssen dabei berücksichtigt werden; eine zweite unabhängig gepflegte Aufgabenwelt würde zusätzlichen Aufwand erzeugen.

**Priorität:** mittel; erst klären, welcher Teil in Second Brain bleiben soll. **Aufwand:** mittel.

### 11. Devserver und Ports im Blick behalten

**Nutzung:** Pro Projekt sehen, wo Frontend und Backend laufen, mit einem Klick zum Terminal oder Browser springen und erkennen, welcher Prozess einen benötigten Port belegt.

**Vorbild:** Superset dokumentiert Port-Erkennung, Prozesszuordnung und Browseraktionen. Es vergibt dabei ausdrücklich nicht automatisch Portbereiche pro Worktree. Quelle: [Port Management](https://docs.superset.sh/ports).

**Bei uns:** Localhost-URLs aus Terminalausgabe können den Mini-Browser öffnen. Das ist noch keine Prozess-/Portübersicht.

**Kleinster sinnvoller Einstieg:** Erkannte Server mit Kachelbezug und Zustand anzeigen; erst später Portkonflikte behandeln. Beim Einsatz mehrerer Worktrees gewinnt diese Funktion an Bedeutung.

**Priorität:** mittel; hoch bei mehreren parallelen Web-Projekten. **Aufwand:** mittel.

## Sinnvolle Reihenfolge für unsere Nutzung

1. **Aufmerksamkeit:** agentenspezifischer Status, ungelesene Hinweise und Sprung zur betreffenden Kachel.
2. **Wiederaufnahme:** Gesprächs-ID pro Kachel statt einer unbestimmten letzten Unterhaltung.
3. **Orientierung:** Kachel-/Projektsuche und Terminalsuche; Dateipfade bequem übergeben.
4. **Prüfung und Rückmeldung:** lokale Diffs sowie Elementkommentare im vorhandenen Mini-Browser.
5. **Parallele Umsetzung:** optionale Worktrees mit klarer Branch-/Ordneranzeige; dazu Devserver- und Portübersicht.
6. **Wiederkehrende Abläufe:** benannte Aufbauten und sichtbare Agentenübergabe; Aufgabenliste erst nach Abgleich mit Second Brain.

Wenn du häufig mehrere Agenten gleichzeitig im selben Projekt schreiben lässt, würde ich Punkt 5 vor Punkt 4 ziehen. Diese Priorisierung muss keine bereits laufende Profil-/QA-Arbeit unterbrechen. Deren offene Abnahmen stehen unabhängig von der Recherche in den Projektdateien.

Cloud-Sandboxes, Teamrollen, mobile Fernsteuerung und geplante autonome Läufe sind bei anderen Apps vorhanden. Für deine aktuelle lokale Nutzung sehe ich dafür weniger unmittelbaren Nutzen als bei den obigen Funktionen. Auch ein zusätzlicher eigener KI-Chat ist keine Voraussetzung für diese Verbesserungen.

## Verifikation und nächster Schritt

Primärquellen wurden am 14.10.2026 mit gstack `/browse` geöffnet. Appfunktionen wurden anhand aktueller Quelldateien abgeglichen, entscheidende Befunde vom Hauptagenten nachgelesen. Keine neuen Tests, Builds, App-Installationen oder bezahlten Modellaufrufe; für eine Dokumentationsrecherche war keine erneute Produkttestsuite erforderlich. Vorhandene Tests anderer Sitzungen werden hier nicht als eigene Prüfung ausgegeben.

Genau ein nächster Schritt für diesen Rechercheauftrag: **Ein erstes kleines Umsetzungspaket aus Aufmerksamkeit, Wiederaufnahme oder Suche auswählen und dessen sichtbares Verhalten festlegen.** Daraus entsteht noch keine automatische Umsetzung oder Änderung des bestehenden Entwicklungsplans.
