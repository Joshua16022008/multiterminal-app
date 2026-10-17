<!-- Entwurf des Planungs-Workflows vom 17.10.2026. Verbindlich bei Abweichungen: docs/dev/ipc-contract.md und docs/dev/oss-gesamtplan.md. -->

# Vorhaben 3: User Guide (Teilplan)

Grundlage ist nur gelesener Code und Git-Stand, ohne Änderungen. Der Checkout steht auf `main` @ `d8b11d5`, dazu kommen die fremden, uncommitteten Änderungen anderer Agenten.

## 1. Ziel
- Es gibt **eine einzige Doku-Quelle** unter `docs/guide/*.md`. Sie ist auf GitHub direkt lesbar, und `README.md` verlinkt sie.
- In der App öffnet sich dieselbe Quelle als **Hilfe-Panel**. Es hat eine Suche, ein Tastenkürzel, Einträge in der Befehlspalette und ein natives Menü „Hilfe“.
- **Kontextbezogene „?“-Links** springen direkt an die passende Stelle des Guides, zum Beispiel aus den Einstellungen, der Arbeitskopie-Auswahl oder dem Kontextstart.
- Es kommt keine neue Laufzeitabhängigkeit dazu, und die CSP bleibt unverändert.

## 2. Nutzerablauf
1. Der Nutzer öffnet die Hilfe über ⌘⇧H, den Menüpunkt „Hilfe → Multiterminal-Hilfe“, die Befehlspalette (⌘K, „hilfe …“) oder einen Knopf „? Hilfe“ in der Topbar bzw. im ☰-Menü.
2. Das Panel öffnet sich rechts als `aside`, wie Fortschritt und Ports. Links steht das Inhaltsverzeichnis, darüber ein Suchfeld, rechts die gerenderte Seite.
3. Die Suche findet Seiten und Überschriften. Ein Treffer springt zum passenden Abschnitt.
4. Links verhalten sich so:
   - Interne Links `[..](worktrees.md#anlegen)` wechseln die Seite im Panel.
   - Externe `https://`-Links öffnen im Systembrowser. Dafür sorgen die vorhandenen `setWindowOpenHandler` und `will-navigate` in `src/main/main.js:765-769`.
5. Ein „?“-Knopf in einem Dialog öffnet das Panel direkt an der passenden Seite und dem passenden Abschnitt.
6. Esc schließt das Panel, danach liegt der Fokus wieder auf der vorher aktiven Kachel.

## 3. Datenmodell
- **Dateien:** `docs/guide/<slug>.md`. Der Slug besteht aus `[a-z0-9-]`.
- **Kopf jeder Seite:** ein minimales Front-Matter.
  ```
  ---
  title: Arbeitskopien (Worktrees)
  order: 50
  keywords: worktree, branch, arbeitskopie
  ---
  ```
- **Anker:** Sie werden aus den Überschriften erzeugt, mit derselben `slugify`-Regel wie GitHub (Kleinschreibung, Umlaute bleiben, Leerzeichen werden zu `-`). Dadurch funktionieren `#anker`-Links auf GitHub und in der App gleich.
- **Index:** Der Main-Prozess liefert ihn an den Renderer:
  `{ slug, title, order, keywords, headings:[{id,text,level}], text }[]`
  `text` ist reiner Fließtext und dient nur der Suche. Der ganze Guide ist klein (geschätzt unter 200 KB), deshalb wird der Index komplett übertragen.
- **Kontext-Schlüssel:** Im Code steht ein String `'<slug>#<anker>'`, zum Beispiel `D.help.link('worktrees#anlegen')`. Ein Test prüft, dass jeder dieser Schlüssel existiert.
- **Zustand:** Die zuletzt gelesene Seite liegt in `localStorage` unter `mt.help.last`, nach dem Muster von `qol-panel.js`. Sonst wird nichts gespeichert.

## 4. Was der Code tatsächlich bietet (Grundlage für die Inhaltsseiten)
Belegt aus `src/renderer/hotkeys.js` (Aktionen), dem Menü in `src/main/main.js:602-665`, der Topbar in `index.html:41-66` und den Einstellungen-Tabs in `settings-panel.js:6`:

| Slug | Inhalt | Belegt in |
|---|---|---|
| `erste-schritte` | Installation, `npm start`/`npm run build`, Voraussetzungen (claude/codex/kimi CLI, `gh`, optional `uv`) | README, `scripts/build.js` |
| `projekte` | Seitenleiste, „+ Projekt“, „Von GitHub…“, Git-Status/Sync, Projekt-Tooltips | `github-panel.js`, `git-service.js`, `sidebar-tooltips.js`, `project-seed.js` |
| `kacheln` | bis 30 Terminals, Raster, Umbenennen, Maximieren, Snapshot, Tauschen per Ziehen, Wiederherstellung, Terminalsuche ⌘F | `terminal-pane.js`, `layout.js`, `reorder.js`, `terminal-search.js`, `session-store.js` |
| `agenten-starten` | Schnellstarts/eigene Presets, Kontextstart, Fortsetzen, Agentenprofil | `presets.js`, `agent-launch.js`, `launch-context.js`, `agent-profile.js` |
| `worktrees` | Terminal in Arbeitskopie, anlegen/entfernen, Kachel-Chip | `worktree-service.js`, `worktree-picker.js` |
| `mini-browser` | Browser je Kachel, `mt-browser`, Element kommentieren (⌘⇧E) | `browser-view.js`, `browser-feedback.js`, `mt-browser-cli.js` |
| `anhaenge` | Büroklammer, Drag & Drop, Bild aus Zwischenablage, Promptvorschau | `attachments.js`, `prompt-draft.js`, `attachment-store.js` |
| `uebergabe` | ⇄ Übergabe (⌘⇧U) | `handoff-panel.js` |
| `rueckmeldungen` | Agentenstatus, Rückmeldungen (⌘J, ⌘⇧J), Komfort/Sortierung | `attention-panel.js`, `agent-events.js`, `agent-wrapper.js`, `qol-panel.js`, `activity.js` |
| `aenderungen` | Diff-Panel mit Kommentaren (⌘⇧D) | `diff-panel.js`, `diff-service.js` |
| `ports` | Devserver/Ports (⌘⇧P) | `ports-panel.js`, `port-service.js` |
| `projektmanager` | PM-Fenster, `mt-pm`, Lagebild (⌘\\) | `pm-*.js`, `pm-role.md`, `mt-pm-cli.js` |
| `fortschritt` | PROGRESS.md-Panel (⌘⇧G) | `progress-panel.js`, `progress-files.js` |
| `arbeitsaufbauten` | Aufbau starten/speichern (⌘⇧B, ⌘⌥B) | `workspace-templates.js`, `workspace-template-store.js` |
| `memory` | gemeinsames Memory, `mt-memory`, Settings-Tab Memory | `memory-*.js`, `mt-memory-cli.js` |
| `einstellungen` | Tabs Profil, Kontingente, Skills, Plugins, Mods, Bibliotheken, Memory, Hotkeys | `settings-panel.js`, `settings-service.js`, `extension-manager.js` |
| `konten-nutzung` | Konten, Verbrauch/Kontingente, Statusline | `accounts-panel.js`, `account-store.js`, `usage-*.js` |
| `tastenkuerzel` | Befehlspalette und alle Kürzel, eigene Belegung | `hotkeys.js`, `hotkey-store.js`, `command-palette.js` |
| `diktat` | optional, setzt Flüsterflow voraus | `dictation.js` (beide) |
| `updates` | „App aktualisieren…“ im PM-Fenster, Prüfsummenpaket | `update-service.js`, `update-helper.sh`, `pm-update.js` |
| `second-brain` | optionaler Aufgaben-Chip (`MULTITERMINAL_SECOND_BRAIN_URL`) | `second-brain-tasks.js`, `task-link.js` |
| `fehlerbehebung` | FAQ (Agentenstatus wirkt erst nach Neustart des Agenten, `gh` nicht angemeldet, Mikrofonrechte …) | Hinweistexte in `qol-panel.js:55` u. a. |

Die Tastenkürzel-Tabelle steht nicht von Hand im Markdown. Das Panel rendert sie live aus `DeckHotkeys.actions` und der aktuellen Belegung, sobald es den Platzhalter `<!-- mt:hotkeys -->` findet. Auf GitHub zeigt die Seite stattdessen die Standardtabelle, und ein Test prüft, dass sie mit `hotkeys.defaults('darwin')` übereinstimmt.

## 5. Technische Befunde
- **Markdown-Renderer:** Es gibt keinen. `package.json` enthält nur xterm, node-pty, Electron und den Packager. Gerendert wird überall per DOM über `D.h` (`terminal-pane.js:7`) bzw. `textContent`, ohne `innerHTML`.
  **Empfehlung:** ein eigener, kleiner Subset-Renderer `guide-markdown.js` (etwa 200 Zeilen). Er zerlegt den Text zuerst in Tokens (rein und in Node testbar) und baut daraus DOM-Knoten über `h()`, nie über `innerHTML`.
  - Unterstützt: Überschriften, Absätze, `-`/`1.`-Listen (eine Ebene Einrückung), Codeblöcke, `inline code`, `**fett**`, `*kursiv*`, Links, Tabellen, Blockzitate, `<kbd>`-freie Tastendarstellung (`⌘K` bleibt Text) und Bilder aus `docs/guide/img/`.
  - Ein Inhalts-Test meldet nicht unterstützte Syntax. Damit ist das Subset die Spezifikation.
- **Panel-Muster:** Vorbild sind `progress-panel.js` (`D.xPanel = { init, isOpen, toggle, refresh }`, `<aside id=… hidden>` in `index.html:69-73`) und `qol-panel.js` (exportierbare reine Funktionen für Tests, `window.DeckX` plus `module.exports`).
  Das gegenseitige Schließen der Panels regelt `app.js:680-710` (`showPorts`/`showSettings`). Das Hilfe-Panel klinkt sich dort ein.
- **Laden der Dateien:** Der Renderer läuft mit `sandbox: true` und CSP `default-src 'self'` (`main.js:755-758`, `index.html:5`), deshalb kein `fetch` auf `file://`. Stattdessen IPC wie bei `progress:read` (`main.js:473-477`, `preload.js:119-122`):
  - `guide:index` und `guide:read(slug)`, registriert über `handle()` (`main.js:119`), das die Herkunft prüft.
  - Der Slug wird gegen den Index geprüft, damit kein Pfad aus dem Ordner herausführen kann.
  - Basispfad ist `path.join(__dirname, '..', '..', 'docs', 'guide')`. Das funktioniert in Dev und im Paket, weil dort `asar: false` gilt (`scripts/build.js`).
- **Paket-Bundle:** Der Packager übernimmt alles außer der `ignore`-Liste (`build.js`). `docs/guide` landet also automatisch im Bundle, aber auch `docs/superpowers/` und alle Koordinations-`.md` im Wurzelordner (siehe Abschnitt 11). Die Liste muss deshalb ergänzt werden: `/^\/docs\/(?!guide($|\/))/` und die Wurzel-Koordinationsdateien ausschließen, `docs/guide` ausdrücklich behalten.
- **Suche:** Wiederverwendet werden `DeckCommandPalette.rank()` und `normalize()` (`command-palette.js:9-60`). Die Treffer sind Seiten und Überschriften, Fließtext zählt schwächer über `keywords`/`subtitle`. Eine eigene Suchlogik entfällt.
- **Hotkey:** neue Aktion `help` in `hotkeys.js` mit Standard `Cmd+Shift+H` (Mac) bzw. `Ctrl+Alt+H`.
  - Belegte Cmd+Shift-Buchstaben sind D, P, J, G, U, E, L, B, K, S, O, also ist H frei. ⌘H selbst ist „Ausblenden“, deshalb mit Umschalt.
  - `hotkey-store.js:withNewDefaults` ergänzt die neue Aktion in bestehenden Belegungsdateien automatisch.
  - Zusätzlich ein natives Menü `{ role: 'help', submenu:[Multiterminal-Hilfe, Tastenkürzel, Fehlerbehebung] }`. macOS hängt dort von selbst das Menü-Suchfeld an.

## 6. Betroffene und neue Dateien
**Neu:**
- `docs/guide/*.md` (Seiten aus Abschnitt 4) und `docs/guide/README.md` als Inhaltsverzeichnis für GitHub, `docs/guide/img/`
- `src/main/guide-service.js`: Index bauen, Front-Matter lesen, Anker erzeugen, Slug prüfen. Rein, mit `dir` als Parameter.
- `src/renderer/guide-markdown.js`: Tokens und DOM-Bau, dazu `slugify` für den Renderer
- `src/renderer/help-panel.js`: Panel, Suche, Navigation, `D.help.open(key)`, `D.help.link(key)` liefert den „?“-Knopf
- `src/renderer/help.css`
- Tests: `tests/guide-service.test.js`, `tests/guide-markdown.test.js`, `tests/help-panel.test.js`, `tests/guide-content.test.js`
- `scripts/qa-help.js`

**Geändert (Integration):**
- `src/main/main.js`: IPC, Help-Menü
- `src/main/preload.js`: `guide.index`/`guide.read`
- `src/renderer/index.html`: `aside#help-panel`, Knopf, Script- und CSS-Tags
- `src/renderer/app.js`: Init, `runFeatureAction('help')`, `paletteActions`, Panel-Ausschluss
- `src/renderer/hotkeys.js`: Aktion und Standard
- `src/renderer/command-palette.js`: `kind:'help'`, `KIND_LABEL.help='Hilfe'`, `buildEntries({helpTopics})`
- `scripts/build.js`: ignore-Liste
- `README.md`: Link
- bestehende Tests `hotkeys.test.js`, `command-palette.test.js`, `hotkey-store.test.js`

**Kontext-Links (später):** `settings-panel.js`, `worktree-picker.js`, `agent-launch.js`, `accounts-panel.js`, `ports-panel.js`, `diff-panel.js`, `workspace-templates.js`, `handoff-panel.js`, `attachments.js`. Für das PM-Fenster kommen `pm.html`/`pm.js`/`pm-preload.js`/`pm-main.js` dazu: ein `pm:openHelp` leitet ins Hauptfenster weiter.

## 7. Arbeitspakete (getrennte Dateibereiche)
- **AP1 Inhalte**, parallel möglich. Nur `docs/guide/**`. Seiten nach Abschnitt 4, Texte aus den UI-Beschriftungen übernehmen, nichts erfinden. Jede Behauptung mit Codepfad im Review prüfen.
- **AP2 Guide-Service**, parallel möglich. Nur `src/main/guide-service.js` und `tests/guide-service.test.js`. API: `createGuideService({dir}) → { index(), read(slug) }`, mit Cache und mtime-Invalidierung im Dev-Betrieb.
- **AP3 Markdown-Renderer**, parallel möglich. Nur `src/renderer/guide-markdown.js` und `tests/guide-markdown.test.js`. `parse(md) → tokens`, `toDom(tokens, h, {onLink})`, `slugify`. XSS-Tests: Roh-HTML wird als Text angezeigt, `javascript:`-Links werden verworfen.
- **AP4 Hilfe-Panel**, parallel möglich, gegen Attrappen von AP2/AP3. Nur `src/renderer/help-panel.js`, `help.css` und `tests/help-panel.test.js`. Reine Teile (`buildSearchEntries(index)`, `resolveKey('worktrees#anlegen')`, `normalizeLink(href, currentSlug)`) exportieren und ohne DOM testen.
- **AP5 Integration**, seriell nach AP2 bis AP4, ein einzelner Agent. Dateien: `main.js`, `preload.js`, `index.html`, `app.js`, `hotkeys.js`, `command-palette.js`, `build.js`, die betroffenen bestehenden Tests und `scripts/qa-help.js`.
  Achtung: `main.js`, `preload.js`, `app.js` und `index.html` sind im gemeinsamen Checkout gerade fremd geändert, vorher in `WORK_IN_PROGRESS.md` abstimmen.
- **AP6 Kontext-Links**, seriell nach AP5 und **nach** Vorhaben 1 (Harness, also `agent-launch.js`/`settings-panel.js`) und Vorhaben 2 (Worktrees, also `worktree-picker.js`). Nur einzeilige Einbauten `D.help.link('…')` plus Liste der Schlüssel. Das vermeidet Merge-Konflikte mit den anderen Vorhaben.
- **AP7 Inhalts-Prüfung und README**, nach AP1 und AP6. Dateien: `tests/guide-content.test.js` und `README.md` (Kurzbeschreibung, Link auf `docs/guide/README.md`). Release-Dateien wie LICENSE gehören nicht hierher, siehe Abschnitt 11.

## 8. Tests
- **`guide-service.test.js`:**
  - Front-Matter wird gelesen, Sortierung nach `order`.
  - Unbekannter Slug oder `../x` führt zu einem Fehler.
  - Fehlender Ordner ergibt einen leeren Index statt eines Absturzes.
  - Anker sind auch bei Duplikaten eindeutig (`-1`, `-2` wie auf GitHub).
- **`guide-markdown.test.js`:** jede unterstützte Syntax, Tabelle, verschachtelter Inline-Text, `<script>` als Text, `javascript:`/`data:`-Links verworfen, Code ohne Formatierung.
- **`help-panel.test.js`:** Such-Ranking über `rank` (zum Beispiel findet „arbeitskopie“ die Seite `worktrees`), Schlüssel-Auflösung, Link-Normalisierung (intern, Anker, extern).
- **`guide-content.test.js`:**
  - Alle Dateien nutzen nur unterstützte Syntax.
  - Alle internen Links und Anker existieren.
  - Alle `D.help.link('…')`/`data-help`-Schlüssel in `src/` existieren, per grep.
  - Die Tastenkürzel-Tabelle entspricht `hotkeys.defaults('darwin')`.
  - Keine persönlichen Pfade (`/Users/`, `Second_Brain`).
- **Bestehende Tests:** `hotkeys.test.js` (neue Aktion ohne Konflikt), `command-palette.test.js` (Hilfe-Einträge), `hotkey-store.test.js` (alte Datei bekommt den Standard `help` ergänzt).
- **`scripts/qa-help.js`** nach dem Muster von `scripts/qa-topbar.js`: temporäres `userData`/`home`, lokale Terminal-Attrappe, `require(process.argv[2] || '../src/main/main')`. Damit läuft es auch gegen das gebaute Bundle. Ablauf:
  1. ⌘⇧H per `sendInputEvent` öffnet das Panel.
  2. Inhaltsverzeichnis zählt mindestens N Seiten.
  3. Suche „Arbeitskopie“ springt zu `worktrees`.
  4. Interner Link wechselt die Seite, der Anker scrollt.
  5. Externer Link lässt die URL des Hauptfensters unverändert.
  6. ⌘K, „hilfe“ ergibt einen Treffer, Enter öffnet ihn.
  7. Einstellungen öffnen, „?“ führt zur Seite `einstellungen#…`.
  8. Esc schließt, der Fokus liegt wieder auf der Kachel.
  9. Keine Konsolenfehler, Screenshot.
  10. Paketlauf: `docs/guide/*.md` sind in `Multiterminal.app/Contents/Resources/app/docs/guide/` vorhanden, `docs/superpowers` und `PROGRESS.md` fehlen.

## 9. Sprache (Empfehlung)
- Der Guide startet **auf Deutsch**, weil die UI-Beschriftungen deutsch sind. Ein englischer Text, der „Einstellungen“ oder „Arbeitskopie“ beschreibt, wäre schwerer zu benutzen als ein deutscher.
- Die Ordnerstruktur ist trotzdem schon für eine Übersetzung vorbereitet: `docs/guide/` gilt als `de`, eine spätere Übersetzung kommt nach `docs/guide/en/`. Der Guide-Service nimmt schon jetzt einen optionalen `lang`-Parameter an, liefert aber nur `de`.
- Das `README.md` auf GitHub sollte **zweisprachig** beginnen: ein englischer Kurzabschnitt mit dem Hinweis „UI currently German“, danach der deutsche Text.
- **Für später notiert, hier nicht lösen:** UI-i18n. Alle Texte sind fest im Code (Renderer und Main, Fehlermeldungen). Ein englischer Guide lohnt sich erst zusammen mit einer UI-Übersetzung.

## 10. Risiken
- **Konflikte:** Die Integrationsdateien (`app.js`, `main.js`, `index.html`, `preload.js`) haben viele fremde, uncommittete Änderungen. AP5 muss reserviert werden und braucht einen abgestimmten Zeitpunkt.
- **Veralteter Inhalt:** Die Doku kann hinter dem Code zurückfallen. Abhilfe sind der Inhaltstest (Schlüssel, Kürzel, Links) und eine Regel in `AGENTS.md` (ändern erst nach Freigabe): Wer eine Funktion ändert, aktualisiert die Guide-Seite.
- **Abweichungen beim Markdown:** Das eigene Subset kann von GitHub abweichen. Der Lint-Test erlaubt nur das Subset, es gibt keine Sonder-Syntax außer dem HTML-Kommentar `<!-- mt:hotkeys -->`, der auf GitHub unsichtbar bleibt.
- **Ankerform:** Bei Umlauten weicht GitHubs Anker-Slugify ab. Die Regel muss im Test an echten Beispielen festgehalten werden (`ä` bleibt `ä`, Satzzeichen entfallen).
- **Abhängigkeit von `asar: false`:** Der Bundle-Pfad funktioniert nur ohne asar. Wird asar später aktiviert, funktioniert `fs` in asar zwar weiterhin, der QA-Paketlauf deckt das aber ab.
- **Platz im Panel:** Bei schmalen Fenstern teilt sich das Hilfe-Panel mit den Kacheln. Wie bei den anderen Panels gilt: Es schließt die übrigen rechten Panels.

## 11. Open-Source-Release-Blocker (nur aufgelistet, nicht behoben)
**Fehlende Projektdateien und Metadaten**
- `LICENSE` fehlt, ebenso `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` und `SECURITY.md`.
- `README.md` ist vorhanden (75 Zeilen, deutsch), aber voll mit internen Agenten-Koordinationsregeln (Abschnitt „Zusammenarbeit der Agenten“).
- `package.json`: `"private": true`, keine Felder `license`, `repository`, `author` oder `homepage`.

**Persönliche Namen und Pfade im Code**
- `src/main/main.js:45-47`: `SECOND_BRAIN_PROJECTS = ~/Desktop/Second_Brain/Arbeit/Ai Builds and projekts/Claude_code_tasks/Projekte`. Davon hängen ab:
  - `main.js:873` (Klonordner)
  - `main.js:917` (Diktat `serviceDir …/Flüsterflow`)
- Bundle-ID `de.joshua.multiterminal` in:
  - `scripts/build.js:36`
  - `src/main/update-service.js:9`
  - `src/main/update-helper.sh:80`
- „Joshua“ in Agenten-Texten:
  - `src/main/project-seed.js:24,27,28,34`
  - `src/main/pm-role.md:6,14`
  - `src/main/pm-bridge.js:115`
  - `src/main/mt-pm-cli.js:28`
  - abhängiger QA-Abgleich: `scripts/qa-project-manager.js:232`
- `scripts/qa-claude-profile.js:14`: `CLI = '/Users/joshua/.local/bin/claude'`
- `tests/project-store.test.js:79,82,93`: `/Users/joshua/...` als Fixture. Harmlos, aber persönlich.

**Second-Brain- und Diktat-Kopplung**
- `src/main/second-brain-tasks.js`: Standard ist `http://localhost:4321`.
- `main.js:252-255`, `src/renderer/task-link.js`.
- `qol-panel.js:13` blendet den Aufgaben-Chip standardmäßig ein (`taskChip: true`).
- Menüpunkt und Hotkey „Second-Brain-Aufgabe der Kachel“ (`main.js` Funktionen-Menü, `hotkeys.js`).
- Diktat setzt das nicht öffentliche Flüsterflow und `uv` voraus:
  - `src/main/dictation.js:24,83,119`
  - `src/renderer/terminal-pane.js:147,388`
  - `scripts/build.js:37-38` (Mikrofon-Begründung nennt Flüsterflow)
  - README-Abschnitt „Diktat“

**Interne Dokumente im Repo und im App-Paket**
- Getrackt sind `PROGRESS.md`, `PROJECT_STATUS.md`, `WORK_IN_PROGRESS.md`, `ENTWICKLUNGSPLAN.md`, `AGENTEN_AUFTRAEGE.md`, `FEATURE_RECHERCHE.md`, `UPDATE_VERSION.md`, `AGENTS.md` und `CLAUDE.md`.
- Inhalt: persönliche Sitzungs- und Koordinationsprotokolle; Treffer für `Second_Brain`, `/Users/joshua` und `Joshua` in fünf davon.
- `scripts/build.js` (ignore) schließt sie nicht aus, sie landen also auch im `.app`. Dasselbe gilt für das untrackte `docs/superpowers/`.

**`.gitignore`**
- Aktuell nur `node_modules/`, `dist/`, `.DS_Store`, `*.log`, `.claude-flow/`, `.gstack/`.
- Es fehlen `.multiterminal/` (liegt lokal, untrackt), `.claude/` (lokal vorhanden), `.qa-*-tmp` / `.qa-*` und `WORKTREE_START.patch`.

**Git-Historie (62 Commits)**
- Kein echtes Secret gefunden:
  - `-S 'sk-'` trifft nur Fixtures (`'sk-ant-local-fixture-not-a-secret'`) und Wörter wie `task-`.
  - `-S apiKey` trifft nur das Fixture `apiKey: 'SECRET'` (Commit `774b6ff`).
  - Kein Treffer für `ghp_`, `github_pat_`, `AKIA`, `xoxb-` oder private Schlüssel. Keine `.env`- oder Credential-Dateien in der Historie.
- Persönliche Daten in der Historie:
  - alle Commits mit `joshua <joshua@gulla.de>`
  - Pfade `/Users/joshua/.codex/worktrees/1580/...` (7 Treffer)
  - komplette Koordinationsprotokolle
- Entscheidungsfrage: Historie so veröffentlichen oder ein frisches Repo mit sauberem Erstcommit anlegen.
- Remote: `github.com/Joshua16022008/multiterminal-app` (Kontoname in der URL).

## 12. Offene Fragen an Joshua
1. **Lizenz:** MIT oder Apache-2.0 (Patentklausel)? Oder etwas anderes?
2. **Diktat und Second-Brain-Aufgaben:** Sollen sie im Open-Source-Release als optionale, konfigurierbare Integrationen (Pfad bzw. URL in den Einstellungen, standardmäßig aus) bleiben und im Guide unter „Optionale Integrationen“ stehen? Oder vorerst entfernen bzw. ausblenden?
3. **Sprache:** Guide zum Start nur auf Deutsch mit zweisprachigem README-Kopf (meine Empfehlung)? Oder gleich auf Englisch, obwohl die UI deutsch bleibt?