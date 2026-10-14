# Multiterminal – Weiterentwicklungsentwurf

Stand der Auftragsverteilung: 14.10.2026. Joshua nutzt die App zunächst allein und priorisiert persönliche Features. Die elf Vorschläge aus `FEATURE_RECHERCHE.md` sind unten als getrennte Agentenaufgaben eingeordnet. Kurze, vollständig kopierbare Startprompts stehen in `AGENTEN_AUFTRAEGE.md`. Der Plan verteilt Arbeit; in dieser Planungsrunde wurde keine Produktfunktion umgesetzt und kein Agent gestartet.

Die bestehenden Settings-/Profilpakete wurden inzwischen weiterentwickelt. Ihr tatsächlicher aktueller Abschluss und die weiterhin aktive unabhängige Claude-Prüfung stehen in `PROJECT_STATUS.md`, `WORK_IN_PROGRESS.md` und `PROGRESS.md`. Die nachfolgenden Abschnitte zum ersten Settings-Stand beschreiben den historischen Stand vom 13.10.2026, 23:24 +02:00; sie sind kein Auftrag, bereits vorhandene Funktionen erneut zu bauen.

## Persönliche Settings – historischer erster Stand

- Einstellungen sind unabhängig vom gewählten Projekt über den Knopf oben und `⌘,` erreichbar.
- Claude Code, Codex und Kimi haben jeweils ein eigenes Markdown-Profil für Ziele, Vorlieben und Arbeitsanweisungen. Keine gemeinsame Basis. Speichern, Entwürfe, Konflikterkennung und erneutes Laden wurden im echten Electron-Fenster geprüft.
- Je Anbieter gibt es getrennte Ordner `settings/<anbieter>/skills`, `plugins`, `mods` und `library` im App-Datenordner. „Agent-Ordner öffnen“ legt sie bei Bedarf an und öffnet den Anbieterordner im Finder.
- Kontingente verwenden die vorhandenen Claude-/Codex-Datenquellen. Kimi zeigt ausdrücklich die fehlende Anbindung. Die Anzeige aktualisiert beim Abruf und alle 60 Sekunden in der geöffneten Kontingentansicht.
- Skills, Plugins, Mods und Bibliotheken zeigen gefundene lokale Ressourcen mit Suche, Herkunft, Dokumentvorschau und Finder-Verweis. Claude-Plugin-Aktivierung kommt aus vorhandenen Metadaten; Hooks und Statuszeile erscheinen als konfigurierte Integrationen. Große Quellen haben sichtbare Scan-Grenzen. Verlinkte Skills bleiben sichtbar, externe Inhalte werden nicht ungeprüft gelesen.

Grenzen: Die persönlichen Profile werden gespeichert, aber von den Agent-CLIs noch nicht automatisch geladen. Tatsächlich ausgeführte Skills werden noch nicht erfasst. Die App legt keine Erweiterungen automatisch in native CLI-Ordner um und installiert keine Plugins. Der Settings-Bereich ist im Entwicklungsstand geprüft; die bestehende App unter `/Applications` wurde nicht ersetzt.

Nachweise dieser Umsetzung: 195/195 Tests im aktuellen gemeinsamen Checkout grün (eigener Lauf, Sandbox-Socketgrenze beim eingeschränkten Lauf); isolierter Electron-Test mit echtem Renderer, Preload und IPC bestanden; Screenshot geprüft; App-Build erfolgreich. Parallel entstandene Browser-Dateien sind fremde Arbeit und brauchen ihre eigene Integration/Abnahme.

## Letzte Schritte

- Raster auf bis zu 30 Terminals pro Projekt erweitert; ab der dritten Reihe wird gescrollt.
- Flüsterflow-Diktat mit Mikrofonknopf je Terminal, Live-Modus und Abbrechen angebunden. Echtmikrofon-Test bleibt offen; die Integration ruht derzeit.
- App als „Multiterminal“ mit eigenem Icon unter `/Applications` installiert und im Dock abgelegt (laut Projektstatus).
- Kontenverwaltung für Claude und Codex, Verbrauchsanzeige sowie Terminal-Namen und Kachelfarben ergänzt. Der aktuelle Code enthält diese Funktionen; Konten-/Verbrauchsfunktionen brauchen noch die dokumentierten Alltagstests.
- Ctrl/⌘ + 1–9 und 0 zum Wechsel zwischen den ersten zehn Terminals ergänzt; diese Änderungen liegen noch lokal vor.

Historischer Planungsstand vor der Settings-Umsetzung: 140 bestandene Tests waren dokumentiert. Checkout: `0f322cc`; vorhandene lokale Änderungen wurden erhalten. Aktuelle Nachweise stehen oben und in `PROGRESS.md`.

## Bisherige Pakete 1–4 – Abschluss separat prüfen

| Priorität | Arbeitspaket | Fertig, wenn … |
| --- | --- | --- |
| 1 | Getrennte Profile wirksam an die Agenten anbinden | Claude, Codex und Kimi laden jeweils ausschließlich ihr eigenes Profil; bestehende native Hinweise bleiben erhalten; Test in einer tatsächlichen Agent-Sitzung belegt die Anwendung. |
| 2 | Erweiterungen gezielt verwalten | Aus einer Bibliothek lassen sich ausgewählte Skills/Plugins kontrolliert dem richtigen Agenten zuordnen; Aktivierung und Rücknahme sind überprüfbar. Vorhandene globale Bibliotheken bleiben nachvollziehbare Quellen. |
| 3 | Nutzung sichtbar machen | Tatsächlich verwendete Skills werden aus einer verlässlichen, agent-spezifischen Quelle erfasst; Fund, Aktivierung und Ausführung bleiben klar unterscheidbar. Neue Hooks nicht allein aus diesem Plan installieren. |
| 4 | Persönliche Kontingentübersicht vervollständigen | Reale Claude-/Codex-Konten liefern aktuelle Daten; eine verifizierte Kimi-Quelle ergänzt dessen Übersicht. Fehlende oder alte Daten bleiben sichtbar. |

Die Pakete pro Agent begrenzen und mit eigener Abnahme bearbeiten. Die persönlichen Markdown-Dateien dienen als Ausgangspunkt. Neue automatische Eingriffe in CLI-Konfigurationen oder Hooks vor ihrer konkreten Aktivierung klären; keine Zeitangaben ohne Prüfung der jeweiligen Anbindung ableiten.

## Neue Nutzungsfeatures – Agentenaufteilung

### Modellwahl und Rollen

Joshua hat für diese neuen, von ihm zu startenden Aufträge ausdrücklich **Claude Opus 5.5** und **Codex 6.1 / Sol 6.1** genannt. Das ist eine auf diese Aufträge begrenzte neuere Vorgabe; globale Agentendateien und laufende Sitzungen werden nicht geändert. Kein automatisches Ausweichmodell, Anbieterwechsel oder zusätzlicher Modellaufruf. Ist das vorgesehene Modell in der gewählten Oberfläche nicht verfügbar, die Grenze nennen. Die Zuordnung ist eine Einschätzung nach Aufgabenart und Integrationsaufwand, kein gemessener Leistungsvergleich der Modelle.

| Rolle für eine Sitzung | Modell | Schwerpunkt | Eigene Pakete in empfohlener Auswahlreihenfolge |
| --- | --- | --- | --- |
| CLAUDE-A | Claude Opus 5.5 | Ereignisse, Sitzungsidentität und Wiederaufnahme; mehrere bestehende Komponenten müssen zusammenspielen. | F01 → F02 |
| CLAUDE-B | Claude Opus 5.5 | Getrennte Arbeitskopien und Browserinteraktion; anspruchsvolle Zustands- und Integrationsgrenzen. | F07 → F05 |
| CODEX-A | Codex 6.1 / Sol 6.1 | Klar abnehmbare Bedienfunktionen mit gemeinsam nutzbarer Promptvorschau. | F06 → F03 → F08 |
| CODEX-B | Codex 6.1 / Sol 6.1 | Prozessübersicht, Code-Review, Kontextübergabe und begrenzter Aufgabenabgleich. | F11 → F04 → F09 → F10 |

Jede Rolle bearbeitet **genau ein** freies, startfähiges Paket pro Auftrag. Die übrigen Pakete sind Auswahlvorrat, kein automatischer Folgeauftrag. Weiteres Abarbeiten erst durch einen weiteren Nutzerauftrag. Mehrere Sitzungen derselben Rolle müssen unterschiedliche Paket-IDs übernehmen. Ein Eintrag in dieser Tabelle reserviert noch keine Dateien.

### Auswahl und Zusammenarbeit

1. Vor Beginn `AGENTS.md`, `PROJECT_STATUS.md`, `WORK_IN_PROGRESS.md`, `PROGRESS.md`, diesen Plan und den passenden Abschnitt der Recherche lesen; Arbeitsordner, Branch und lokale Änderungen prüfen.
2. Eine freie Paket-ID aus der eigenen Rolle auswählen, Abhängigkeiten mit tatsächlichen Ergebnissen abgleichen und in `WORK_IN_PROGRESS.md` mit Sitzung, Zeit, Dateibereichen und genau einer nächsten Aktion reservieren. Dortige Fremdreservierungen gelten weiter. Auch eine bereits im Code vorhandene Teilfunktion vor erneuter Arbeit prüfen.
3. **Eigenständige Module dürfen parallel entstehen.** Gemeinsame Dateien wie `src/main/main.js`, `src/main/preload.js`, `src/main/session-store.js`, `src/renderer/app.js`, `terminal-pane.js`, `index.html`, `styles.css`, `package.json` und Lockdatei bekommen eine ausdrücklich abgestimmte Integrationsphase. Diese Dateien nicht pauschal für die ganze Aufgabenlaufzeit blockieren. Vor ihrer Änderung Belegung erneut lesen, benötigte Bereiche reservieren und Freigabe abwarten, falls belegt.
4. Für gleichzeitig integrationsbereite Pakete gilt die Reihenfolge **F01, F06, F07, F11, F02, F03, F04, F05, F08, F09, F10**. Noch nicht bereite Pakete werden übersprungen. Eine bestehende bestätigte Reservierung hat Vorrang. Nach einer Integration Dateien und Anschlussstand ausdrücklich freigeben; andere Agenten lesen den neuen Stand vor ihrer Integration neu.
5. Unterschiedliche Branches im selben Arbeitsordner isolieren keine Dateien. Ein neuer Worktree enthält vorhandene uncommittete Produktänderungen nicht automatisch. Für isolierte Implementierungscheckouts zuerst einen abgestimmten Ausgangsstand herstellen; keine eigenmächtige Komplettkopie, Stash-/Reset-Aktion oder Teil-Commits fremder Arbeit. Falls das nicht geklärt ist, im gemeinsamen Checkout nur abgestimmte getrennte Module und nacheinander die Integration bearbeiten.
6. Koordinationsdateien unmittelbar vor Änderungen neu lesen und nur eigene Einträge ergänzen. Die Paketbeschreibungen bleiben die gemeinsame Spezifikation; Fortschritt und Belegung stehen in `PROGRESS.md` bzw. `WORK_IN_PROGRESS.md`.

### Gemeinsame Schnittstellen und Abnahme

Die folgenden Namen sind **zu implementierende Verträge**, keine Behauptung vorhandener Funktionen. Muss ein Vertrag fachlich geändert werden, abhängige Pakete zuerst informieren und Änderung quittieren lassen.

- **F01 liefert Agentenereignisse:** `src/main/agent-events.js` normalisiert `terminalId`, `projectId`, `provider`, `accountId`, optional `nativeSessionId`, `state`, `observedAt`, `source`. `state` ist `working`, `needs-input`, `turn-complete`, `error` oder `unknown`. Ein Shellstatus bleibt separat. F02 konsumiert belegte Identitätsereignisse, F09 kann später die Zuordnung lesen. Kein Erraten fehlender Gesprächs-IDs aus dem zuletzt geänderten Gespräch.
- **F06 liefert gemeinsame Promptvorschau:** `src/renderer/prompt-draft.js` stellt im vorhandenen Renderer-Namensraum `window.DeckApp.promptDraft.open({ terminalId, text, files })` bereit; `files` ist eine Liste aus `{ path, kind: 'file' | 'image' }`. Vorschau zeigt Ziel und Inhalt, erlaubt Bearbeiten und Abbruch. Erst die Nutzeraktion „Ins Terminal einfügen“ schreibt ohne abschließendes Enter in die gewählte Kachel. Dateiverweis und tatsächlich geladener Bildanhang werden unterschieden. F04, F05 und F09 verwenden diesen Weg, statt eigene Sendelogik zu erfinden.
- **F07 liefert Arbeitskopie-Zuordnung:** `src/main/worktree-service.js` verwaltet je eigener Arbeitskopie `workspaceId`, `projectId`, `cwd`, `branch`, `baseRef`, `managed`. Das bestehende Projekt bleibt erhalten. Bei Einführung zusätzlicher Felder Sessiondaten rückwärtsverträglich lesen. F04/F11 nutzen eine integrierte Zuordnung, müssen aber zuerst auch mit normalen Projektordnern funktionieren.
- Neue eigene UI-Styles möglichst in paketbezogenen CSS-Dateien halten. Einbindung über `index.html` und andere gemeinsame Dateien nur in der vereinbarten Integrationsphase.
- Jedes Umsetzungspaket braucht sinnvolle eigene Funktionsprüfungen und einen isolierten Electron-Lauf mit temporärem Datenordner für das tatsächlich eingebaute Verhalten. CLI-Ereignisse mit lokalen Fixtures/Attrappen prüfen; echte Agentfähigkeit ohne realen CLI-Nachweis ausdrücklich offen lassen. Vor Integration/Übergabe die betroffenen Prüfungen und bei integrierten Produktänderungen `npm test` ausführen. Keine laufenden Tests einer anderen Sitzung stören oder deren Ergebnis als eigenes ausgeben.
- Abschluss nennt Dateien, tatsächlich ausgeführte Prüfungen, sichtbares Ergebnis, offene Abnahme und genau einen nächsten Schritt. Ein Modul allein ohne Oberfläche ist „umgesetzt – ungeprüft“ bzw. eine Teilübergabe, kein fertiges Feature. Eigene Reservierung danach freigeben.
- Neue Hooks/Änderungen nativer Agentkonfigurationen nur hinter konkreter Nutzeraktion und unter den bestehenden Freigaberegeln. Keine bezahlten Provider-Tests, Installation nach `/Applications`, Commit/Push oder automatische Folgeläufe aus diesem Plan ableiten.

### Paketübersicht

Alle elf Recherchepunkte sind genau einem Paket zugeordnet. **Frei** bedeutet hier nicht begonnen; die tatsächliche Verfügbarkeit steht immer in `WORK_IN_PROGRESS.md`.

| ID | Feature aus der Recherche | Rolle | Schwierigkeit | Startbedingung / erste kleine Lieferung |
| --- | --- | --- | --- | --- |
| F01 | 1 – Agentenstatus und Aufmerksamkeit | CLAUDE-A | hoch | Frei; belastbare Ereignisquelle für zunächst einen Agenten, ungelesene Hinweise und Kachelsprung. |
| F02 | 2 – Eindeutiges Fortsetzen | CLAUDE-A | hoch | Nach F01-Identitätsvertrag und abgestimmter Berührung der aktiven Claude-QA; feste Gesprächs-ID je Kachel. |
| F03 | 3 – Suche und Command Palette | CODEX-A | mittel | Frei; Projekt-/Kachelsuche und Suche innerhalb einer Terminalausgabe. |
| F04 | 4 – Diffs und Rückmeldung | CODEX-B | mittel bis hoch | Lesender Diff-Teil unabhängig möglich; vollständiger Abschluss nach F06-Promptvorschau. |
| F05 | 5 – Browser-Feedback und Interaktion | CLAUDE-B | hoch | Nach F06-Promptvorschau; Element markieren und kommentieren, anschließend begrenztes Klicken/Tippen. |
| F06 | 6 – Datei-/Bildübergabe | CODEX-A | mittel | Frei; gemeinsame Promptvorschau, Dateidrop und Bilddatei-Verweis mit klarer Zielkachel. |
| F07 | 7 – Optionale Worktrees | CLAUDE-B | hoch | Frei als Featureentwicklung; Tests ausschließlich in temporären Repos, echter Checkout bleibt erhalten. |
| F08 | 8 – Benannte Aufbauten | CODEX-A | mittel | Nach F02 und F07-Schema; Vorlage erstellt neue Kacheln und übernimmt keine fremden Gesprächs-IDs. |
| F09 | 9 – Agentenübergabe | CODEX-B | mittel | Nach F06; editierbare Übergabe mit sichtbarem Ziel, ohne Modellaufruf zur Zusammenfassung. |
| F10 | 10 – Persönliche Aufgabenliste | CODEX-B | mittel | Zuerst begrenztes Konzeptpaket zum Abgleich mit Second Brain, keine zweite Aufgabenoberfläche ungeklärt einbauen. |
| F11 | 11 – Devserver und Ports | CODEX-B | mittel | Frei; lesende Prozess-/Portübersicht mit Sprung zu Terminal und Browser. |

### F01 – Agentenstatus und Aufmerksamkeit

**Eigentümer:** CLAUDE-A. **Quelle:** Recherche 1. **Eigene neue Dateien:** `src/main/agent-events.js`, `src/renderer/attention-panel.js`, `src/renderer/attention.css`, `tests/agent-events.test.js`, `tests/attention-panel.test.js`. **Abgestimmte Integration:** `main.js`, `preload.js`, `app.js`, `terminal-pane.js`, `index.html`.

- [ ] Für zunächst einen bereits unterstützten Agenten die vorhandene lokale Ereignisquelle und ihre Zuordnung zu Terminal/Konto prüfen; fehlende Signale als `unknown` behandeln. Ohne verlässliche Quelle keine automatische „arbeitet/fertig“-Behauptung.
- [ ] Den Ereignisvertrag oben liefern und ungelesene Abschluss-/Eingabehinweise je Kachel anzeigen; Auswahl öffnet Projekt, scrollt zur Kachel und setzt Fokus. Geräusch-/Desktopmeldung konfigurierbar und bei sichtbarer Zielkachel zurückhaltend.
- [ ] Prüfen: unbekannte Quelle, wartend, Antwort beendet, veraltetes Ereignis, doppelte Ereignisse, geschlossenes Terminal, anderes Projekt und korrekter Sprung. Ausbleibende Ausgabe darf keinen Abschluss erzeugen. Die echte Agentintegration separat vom Fixture-Erfolg nachweisen.

**Fertig, wenn:** Eine reale oder klar als Test ausgewiesene Ereigniskette die richtige Kachel erreicht; fehlende Providerunterstützung sichtbar bleibt und die Oberfläche Antwortende von fachlicher Abnahme trennt.

### F02 – Eindeutiges Fortsetzen derselben Unterhaltung

**Eigentümer:** CLAUDE-A. **Quelle:** Recherche 2. **Eigene neue Dateien:** `src/main/agent-session-service.js`, `tests/agent-session-service.test.js`. **Abgestimmte Integration:** `session-store.js`, `presets.js`, `agent-profile.js`, `main.js`, `preload.js`, `terminal-pane.js`, `app.js`, `tests/session-store.test.js`. Aktive `scripts/qa-claude-profile*.js` bleiben bei ihrer bisherigen Sitzung; keine Übernahme ohne bestätigte Übergabe.

- [ ] Belegte native Gesprächs-ID mit Provider, Konto, Projekt und Kachel speichern; alte Sitzungsdateien ohne ID weiter lesen. Wiederaufnahmebefehl anhand aktueller CLI-Hilfe und tatsächlicher Agentdaten bestimmen.
- [ ] Zwei Gespräche desselben Providers im selben Projekt auseinanderhalten. Wenn keine eindeutige ID vorliegt, „Zuordnung fehlt“ zeigen und die Auswahl/den Neustart bewusst anbieten; nicht still die letzte Unterhaltung als exakte Wiederaufnahme ausgeben.
- [ ] Prüfen: zwei Kacheln, App-Neustart, anderes Konto, gelöschtes Gespräch, ungültige/fehlende ID und Profilflag aus/ein. Argumente ohne Shellinjektion übergeben; native Hinweise und rohe Terminaleingabe erhalten.

**Fertig, wenn:** Beide Kacheln nach Neustart nachweislich ihr eigenes Gespräch öffnen; unbelegte Providerfälle sichtbar offen bleiben. Gespeicherter Scrollback ist kein Ersatz für diesen Nachweis.

### F03 – Kachel-/Projektsuche und Terminalsuche

**Eigentümer:** CODEX-A. **Quelle:** Recherche 3. **Eigene neue Dateien:** `src/renderer/command-palette.js`, `src/renderer/terminal-search.js`, `src/renderer/search.css`, `tests/command-palette.test.js`, `tests/terminal-search.test.js`. **Abgestimmte Integration:** `app.js`, `terminal-pane.js`, `hotkeys.js`, `main.js` (Menükürzel), `index.html`; `package.json`/Lockdatei nur, wenn ein passendes xterm-Suchaddon nötig ist.

- [ ] Palette mit Projekten, Kacheln und vorhandenen Aktionen bauen; Auswahl aktiviert Projekt/Kachel. Kürzel auf bestehende macOS-/Appbelegung prüfen.
- [ ] Suche im verfügbaren Kachelverlauf mit nächstem/vorigem Treffer, Trefferzustand und sichtbarer Begrenzung des Suchumfangs ergänzen. Kein Projektdatei-Vollindex und kein Modellaufruf.
- [ ] Prüfen: gleiche Kachelnamen, leere Suche, Unicode, geschlossene Kachel, anderes Projekt, Esc/Fokusrückkehr und wiederhergestellter begrenzter Verlauf. Bestehende Nummernkürzel und Shellinput erhalten.

**Fertig, wenn:** Beide Suchwege in der App funktionieren und klar ist, welcher Verlauf durchsucht wird.

### F04 – Lokale Diffs ansehen und kommentieren

**Eigentümer:** CODEX-B. **Quelle:** Recherche 4. **Eigene neue Dateien:** `src/main/diff-service.js`, `src/renderer/diff-panel.js`, `src/renderer/diff.css`, `tests/diff-service.test.js`, `tests/diff-panel.test.js`. **Abgestimmte Integration:** `main.js`, `preload.js`, `index.html`, bei Bedarf `github-panel.js`; vorhandenen `git-service.js` nur abgestimmt erweitern.

- [ ] Geänderte/staged/untracked Dateien mit eindeutigem Vergleichsstand lesend anzeigen; Binärdateien, neue/gelöschte Dateien und große Diffs ausdrücklich behandeln. Kein Commit, Reset oder Staging aus dieser ersten Version.
- [ ] Zeilen-/Dateiauswahl mit Kommentar und Zielkachel an F06 übergeben. Im gemeinsamen Ordner „Projektänderungen“ anzeigen, keine unbelegte Agentenzuschreibung. Bereits integrierte F07-Arbeitskopien berücksichtigen.
- [ ] In temporären Repos staged/unstaged/untracked, Dateinamen mit Leerzeichen, Umbenennung, Binärdatei und leeres Diff prüfen; Appauswahl und korrektes Feedbackziel testen.

**Fertig, wenn:** Änderungen ohne Dateiveränderung geprüft und Kommentare mit richtigem Dateikontext als editierbarer Prompt übernommen werden können.

### F05 – Browser-Element kommentieren und UI-Aktionen prüfen

**Eigentümer:** CLAUDE-B. **Quelle:** Recherche 5. **Eigene neue Dateien:** `src/main/browser-feedback.js`, `src/renderer/browser-feedback.js`, `src/renderer/browser-feedback.css`, `tests/browser-feedback.test.js`. **Abgestimmte Integration:** `browser-view.js`, `browser-control.js`, `mt-browser-cli.js`, `terminal-pane.js`, `main.js`, `preload.js`, `index.html`; bestehende Browser-Isolation erhalten.

- [ ] Erst Elementauswahl mit Abbruch, URL, begrenztem Elementkontext, Kommentar und Screenshot bauen; Vorschau über F06 an bewusst gewählte Kachel übergeben. Ohne React-Metadaten muss der Grundablauf funktionieren.
- [ ] Danach die vorhandene Browser-CLI um klar begrenzte Klick-/Texteingabeaktionen ergänzen; nur Browser der eigenen Kachel. Keine beliebige Appsteuerung oder neue Browserinstallation. Aktives Ziel und Fehler bei unsichtbarer/navigierter Seite klar behandeln.
- [ ] Auf lokaler Testseite Markieren/Abbruch, Navigation zwischen Auswahl und Versand, lange Inhalte, Formular-Klick und Texteingabe sowie Cross-Kachel-Ablehnung prüfen. Screenshot im Hintergrundprojekt gezielt prüfen oder Grenze sichtbar lassen.

**Fertig, wenn:** Ein Elementkommentar mit überprüfbarem Kontext ankommt und die begrenzten UI-Aktionen auf der eigenen Testseite funktionieren; vorhandene Navigation/Console/Screenshots bleiben erhalten.

### F06 – Gemeinsame Promptvorschau und Datei-/Bildübergabe

**Eigentümer:** CODEX-A. **Quelle:** Recherche 6; liefert auch den Vertrag für F04/F05/F09. **Eigene neue Dateien:** `src/renderer/prompt-draft.js`, `src/renderer/attachments.js`, `src/renderer/attachments.css`, `tests/prompt-draft.test.js`, `tests/attachments.test.js`. **Abgestimmte Integration:** `terminal-pane.js`, `app.js`, `index.html`, bei nötiger Bildablage ein eng begrenzter Main-/Preload-Kanal.

- [ ] Bestehenden Renderer-Namensraum nachlesen und den obigen Vorschauvertrag verbindlich bestätigen. Editierbare Vorschau mit Zielkachel, Dateiliste, Einfügen und Abbrechen liefern; Einfügen ohne Enter und ohne unbeabsichtigten Shellbefehl.
- [ ] Dateien auf Kachel ziehen, Pfade mit Leerzeichen/Sonderzeichen robust einfügen; Kacheltausch vom Dateidrop unterscheiden. Eingefügte Zwischenablagebilder lokal als Bilddatei bereitstellen, wenn der vorhandene Electron-Weg das erlaubt; explizit als Pfad/Dateiverweis anzeigen, bis tatsächliche Bildaufnahme des jeweiligen CLI belegt ist.
- [ ] Prüfen: mehrere Dateien, Unicode/Leerzeichen, Zeilenumbrüche und Shellzeichen im Namen, abgebrochene Vorschau, geschlossene Zielkachel, falsche Kachel und unveränderter Kacheltausch. Mindestens ein temporäres Bild durch Vorschau und Einfügen führen; CLI-Anhang nicht aus einem eingefügten Pfad ableiten.

**Fertig, wenn:** Die App kontrolliert genau die gewählte Kachel befüllt und F04/F05/F09 denselben geprüften Weg nutzen können.

### F07 – Optionale getrennte Git-Arbeitskopie

**Eigentümer:** CLAUDE-B. **Quelle:** Recherche 7. **Eigene neue Dateien:** `src/main/worktree-service.js`, `src/renderer/worktree-picker.js`, `src/renderer/worktree.css`, `tests/worktree-service.test.js`. **Abgestimmte Integration:** `main.js`, `preload.js`, `session-store.js`, `app.js`, `terminal-pane.js`; Git-/Projektservice nur bei konkretem Bedarf.

- [ ] Normales Projekt und bewusst neu angelegten Git-Worktree als Auswahl anbieten; Vertrag oben liefern und `cwd` bis zum PTY-Start durchreichen. Branch/Ordner sichtbar halten; normale gespeicherte Sitzungen weiter laden.
- [ ] Bestehende uncommittete Änderungen weder mitnehmen noch verlieren, ohne es kenntlich zu machen. Löschen einer Kachel löscht keinen schmutzigen Worktree. Keine automatische Merge-/Aufräumaktion.
- [ ] Mit temporären Repos zwei Arbeitskopien, unabhängige Änderungen, ungültige Branch-/Pfadnamen, vorhandene Pfade, dirty/untracked Daten, Neustart und fehlenden Worktree prüfen. Echten Projektcheckout nicht als Testobjekt verwenden.

**Fertig, wenn:** Zwei Agentkacheln nachweislich unterschiedliche Dateistände bearbeiten können und die Zuordnung nach Neustart erhalten bleibt. Ports/Datenbanken sind damit nicht isoliert.

### F08 – Benannte Arbeitsaufbauten und Startbefehle

**Eigentümer:** CODEX-A. **Quelle:** Recherche 8. **Eigene neue Dateien:** `src/main/workspace-template-store.js`, `src/renderer/workspace-templates.js`, `src/renderer/workspace-templates.css`, `tests/workspace-template-store.test.js`. **Abgestimmte Integration:** `main.js`, `preload.js`, `app.js`, `index.html`; Session-Schema von F02/F07 konsumieren.

- [ ] Aktuellen Aufbau als benannte Vorlage speichern; Rollen, ausgewählte Startbefehle, Browser und Anordnung anbieten. Profil-/Kontogeheimnisse und native Gesprächs-IDs nicht in kopierte Kacheln übernehmen.
- [ ] Vor Ausführen die Befehle zeigen; Devserver separat starten/stoppen, keine gespeicherten Befehle schon beim bloßen Vorschauöffnen ausführen. Bestehende Presets weiter verwenden.
- [ ] Prüfen: Vorlage nach Neustart, fehlendes Konto/Preset, gelöschter Projektpfad, Kachelgrenze 30, kein ID-Duplikat und Abbruch ohne gestartete Prozesse.

**Fertig, wenn:** Ein Aufbau reproduzierbar als neue Kacheln startet und Vorlagen keinen fremden Gesprächsstand vortäuschen.

### F09 – Editierbare Übergabe zwischen Agenten

**Eigentümer:** CODEX-B. **Quelle:** Recherche 9. **Eigene neue Dateien:** `src/renderer/handoff-panel.js`, `src/renderer/handoff.css`, `tests/handoff-panel.test.js`. **Abgestimmte Integration:** `progress-panel.js`, `app.js`, `index.html`; F06 verwenden.

- [ ] Ziel, geprüfte Ergebnisse, relevante Dateien, offene Fragen und genau einen nächsten Schritt als editierbare Vorlage anbieten; ausgewählten Text und bewusst gewählten PROGRESS.md-Auszug übernehmen.
- [ ] Quelle und Ziel sichtbar machen, vor Einfügen bearbeitbar halten. Nicht automatisch den gesamten Terminalverlauf übertragen und keinen Modellaufruf für Zusammenfassung starten. Transfer ist keine native Gesprächskopie.
- [ ] Prüfen: zwei Kacheln/Provider, Quellen-/Zielschließen, kein PROGRESS.md, langer Auszug, Abbruch und Einfügen ohne automatische Ausführung.

**Fertig, wenn:** Eine kontrollierte Übergabe an die richtige Kachel erfolgt und deren Inhalt vorab sichtbar ist.

### F10 – Aufgabenliste mit Second Brain abgleichen

**Eigentümer:** CODEX-B. **Quelle:** Recherche 10. **Erste Lieferung ausschließlich Konzept:** neuer Abschnitt „F10 – Aufgabenablage“ in diesem Plan, mit eigener Reservierung für genau diesen Abschnitt. Keine neue Statusdatei und zunächst keine Produkt-/Vaultänderung.

- [ ] Bereits vorhandene App- und Projektmechanismen innerhalb dieses Repos prüfen; bekannte Second-Brain-Referenzen als vorhandene Hinweise kennzeichnen, ohne Auftrag auf den Vault auszuweiten.
- [ ] Zwei konkrete kleine Varianten ausarbeiten: reine Verknüpfung zu bestehenden Aufgaben oder appinterne Kachelnotiz mit Titel/Status. Für jede Variante genau festlegen, welche Datei die verbindliche Quelle ist und wie Doppelpflege vermieden wird.
- [ ] Eine Empfehlung samt UI-Skizze in Worten und fehlender Entscheidung vorlegen. Danach kann Joshua die passende Variante auswählen; die Aufgabenoberfläche ist kein stillschweigender Teil dieses Konzeptpakets.

**Fertig, wenn:** Ablage und Grenzen entscheidbar beschrieben sind. Ein umgesetztes Aufgabenmanagement darf daraus noch nicht behauptet werden.

### F11 – Devserver- und Portübersicht

**Eigentümer:** CODEX-B. **Quelle:** Recherche 11. **Eigene neue Dateien:** `src/main/port-service.js`, `src/renderer/ports-panel.js`, `src/renderer/ports.css`, `tests/port-service.test.js`. **Abgestimmte Integration:** `main.js`, `preload.js`, `app.js`, `index.html`; Browser-Öffnung wiederverwenden.

- [ ] Lokale lauschende Ports lesend ermitteln; nur bei belastbarer Prozess-/PTY-Zuordnung einer Kachel zuordnen, sonst „nicht zugeordnet“. URL-Erkennung aus Terminalausgabe als Hinweis behandeln, nicht als Beleg eines laufenden Servers.
- [ ] Zum bekannten Terminal springen oder URL im Mini-Browser öffnen. Vorerst keine Prozesse beenden oder Ports automatisch neu vergeben. Vorhandene F07-Arbeitskopien berücksichtigen, aber normale Projekte zuerst unterstützen.
- [ ] Prüfen: Start/Ende eines lokalen temporären Servers, belegter Port durch fremden Prozess, fehlende Leserechte, mehrere Projekte und veralteter Eintrag. Polling beim Schließen stoppen, fremde Prozesse unangetastet lassen.

**Fertig, wenn:** Laufende Testserver korrekt erscheinen/verschwinden, unbekannte Zuordnungen ehrlich bleiben und Sprung/Browseröffnung zur richtigen Kachel führen.

## Später

- Kimi und Gemini in die Kontenverwaltung aufnehmen, wenn ein konkreter Mehrkonto-Bedarf besteht.
- Flüsterflow wieder aufnehmen, sobald Joshua die Arbeit dort abgeschlossen hat; dann echtes Mikrofon und Rechte der gebauten App prüfen.
- Weitere Provider für F01/F02 erst ergänzen, wenn verlässliche Ereignis-/Identitätsquellen nachgewiesen sind. Eine laufende Shell allein belegt keinen Agentenstatus.

## Genau ein nächster Schritt

Mit einem Startprompt aus `AGENTEN_AUFTRAEGE.md` eine freie, startfähige Aufgabe der jeweiligen Rolle in `WORK_IN_PROGRESS.md` reservieren. Der nächste bestehende Projektschritt zur aktiven Claude-Profil-Prüfung bleibt in `PROJECT_STATUS.md` separat erhalten.

## Quellen

`FEATURE_RECHERCHE.md`, `AGENTEN_AUFTRAEGE.md`, `PROJECT_STATUS.md`, `PROGRESS.md`, `WORK_IN_PROGRESS.md`, aktueller Checkout, `src/main/settings-service.js`, `src/renderer/settings-panel.js`, `tests/settings-service.test.js` und `scripts/qa-settings.js`.

## Skill-Auswahl

`writing-plans` für den ursprünglichen kompakten Entwurf ausgelassen. Für die Settings-Oberfläche `frontend-design` verwendet und auf den vorhandenen App-Stil angewandt. Backend und UI in getrennten Dateien an zwei native Sol-6.1-Unteragenten delegiert; Hauptagent hat Integration und App-Prüfung übernommen.

14.10.2026: `writing-plans` für klare Aufgabengrenzen, Dateibereiche, Schnittstellen, Abnahmekriterien und Selbstprüfung angewandt. Der aktuelle Auftrag ist ein Auswahl- und Übergabeplan für andere Agentensitzungen; deshalb keine vollständigen Codepatches, minutenweisen TDD-Skripte, automatischen Commits oder zusätzliche Ausführungsabfrage. Planort bleibt die bestehende `ENTWICKLUNGSPLAN.md`. Keine Unteragenten für diese eng zusammenhängende Dokumentationsarbeit gestartet.
