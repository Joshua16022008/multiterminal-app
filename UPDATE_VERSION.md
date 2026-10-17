# Update-Version 0.3.1 – 18.10.2026 (Entwicklerversion)

**Gemeinsam integriert, gebaut und paketbezogen geprüft; noch nicht gepusht oder installiert.** Auftrag `UPDATE-PUSH-CODEX-20261018-01`: alle fertigen neuen Features bündeln und auf das bestehende `origin/main` pushen. Der autorisierte Push wurde versucht, scheitert aber an der nicht verfügbaren GitHub-Anmeldung dieser Umgebung.

## Noch offener Push

Geprüfter Stand einschließlich Update-Dokumentation lokal in `829759e` gesichert; der folgende lokale Protokollcommit hält den Anmeldeblocker fest. `git push origin main` endete mit Exit 128: `failed to get: -50`, `could not read Username for 'https://github.com': Device not configured`. Vorhandener Git-Helper: `osxkeychain`. `gh auth status` meldet die Anmeldung hier als ungültig; keine SSH-Agent-Verbindung und kein lokaler SSH-Benutzer für UID 502. GitHub-Zugangsdaten wurden weder ausgegeben noch verändert.

Remote `main` ist weiterhin `f77f01e847db76d9907c423446830333deefd967`; der Push hat nichts veröffentlicht. Nächster Schritt aus Joshuas nativem, angemeldetem macOS-Terminal:

```bash
cd '/Volumes/M4MegaDiva/Projekte/Lokale-Projekte/Desktop/Second_Brain/Arbeit/Ai Builds and projekts/Claude_code_tasks/Projekte/multiterminal-app'
git push origin main
```

Falls auch dort die Anmeldung fehlschlägt, zuerst die vorhandene GitHub-Anmeldung erneuern (`gh auth login --hostname github.com`), anschließend denselben Push erneut ausführen. Kein Force-Push nötig. Die Installation ist ein separater späterer Schritt.

## Umfang und Prüfungen

Enthalten sind Worktree-Stammbaum, User Guide und Hilfe-Links, Harness-/Modellkatalog mit Endpunkt-Profilen, Kontoumbenennung, Update-Helfer, gemeinsames Memory, Sidebar-Popups, Edition-Schalter und OSS-Export-Pipeline sowie jetzt auch **Agentenaufgaben**: Aufgaben/Teilaufgaben/Ergebnisse zwischen Claude-/Codex-Terminals und begrenzte neue Arbeitsagenten nach sichtbarer Quellfreigabe. Entwickler-Diktat und Second-Brain-Aufgaben bleiben in der Entwicklerversion erhalten. Nicht freigegebene/unfertige Zusatzvorhaben wurden nicht übernommen.

Nachweise vom aktuellen Produktstand `e15b946` (Agentenaufgaben in main `1e02ac9`): eigener Gesamtlauf **963/963**, Unterauftrag zusätzlich **64/64** lokale Aufgaben-/Main-/IPC-/Socket-/CLI-/Kontextprüfungen; unabhängiger Review ohne offenen Codebefund. Build Exit 0. Öffentlicher Probe-Export aus demselben Stand **298 Dateien, 930/930 Tests, Datenschutz-Wächter grün**; kein echtes Export-Repository angelegt.

- Paket: `dist/updates/Multiterminal-0.3.1/Multiterminal.app`.
- **932 reguläre Dateien**, vollständige `CHECKSUMS.sha256`; strikter Update-Service-Validator und `bash scripts/install-update.sh --check` bestanden.
- **158 Quell-/Guide-/Asset-Dateien bytegleich**, Paketidentität, Version, Einstiegspunkt und Laufzeitabhängigkeiten geprüft. Packager entfernt erwartungsgemäß Entwickler-Skripte/-Abhängigkeiten aus der Paketmetadatei. `export/`, Tests und lokale Arbeitsdaten sind nicht im App-Paket.
- Prüfsummenlisten-SHA256: `6e09d49b4d7c1c22d2c14fb9c12d209f1699c1af09ab0fd3a0f89c93af41938a`.
- Logs: `/private/tmp/mt-update-031-source-tests.log`, `/private/tmp/mt-update-031-build.log`, `/private/tmp/mt-update-031-package-check.log`, `/private/tmp/mt-update-031-public-probe.log`.

**Offen:** Native sichtbare Abnahme und echte Anbieter-/Kontenabläufe sind nicht belegt; erneuter `qa-env-check` scheitert mit SIGABRT vor Bootstrap. Die vorherige native DMG-Probe war durch `Device not configured` blockiert. Dies ist das lokale Entwickler-Update-Paket, kein veröffentlichtes oder gestartetes DMG. Die installierte App wurde lediglich lesend als **0.2.0** identifiziert, nicht verändert oder beendet.

Installation später durch Joshua: Multiterminal mit **⌘Q schließen**, danach im macOS-Terminal:

```bash
bash '/Volumes/M4MegaDiva/Projekte/Lokale-Projekte/Desktop/Second_Brain/Arbeit/Ai Builds and projekts/Claude_code_tasks/Projekte/multiterminal-app/scripts/install-update.sh'
```

Der Installer verweigert den Austausch einer laufenden App, prüft das Paket, sichert die alte App und installiert/startet erst bei diesem ausdrücklichen manuellen Aufruf. Nutzer-/Sitzungsdaten liegen außerhalb des App-Bundles.

---

# Historisch: Update-Version 0.3.0 – 17.10.2026 (Entwicklerversion)

**Fertig gebaut und geprüft, noch nicht installiert** (OSS-E0-OPUS-20261017-01). Paket `dist/updates/Multiterminal-0.3.0/Multiterminal.app`, 920 Dateien mit SHA-256 in `CHECKSUMS.sha256`, `bash scripts/install-update.sh --check` Exit 0. Installer liest die Version jetzt aus `package.json`.

Neu gegenüber 0.2.0: Worktree-Stammbaum (⑂-Knopf, ⌘⇧Y, Branch-Chip), User Guide + Hilfe-Panel (⌘⇧H, „?“-Links), Harness-/Modellkatalog mit Endpunkt-Profilen (Einstellungen → Harnesses & Modelle), Kontoumbenennung, Update-Helfer „App aktualisieren…“ im Projektmanager, gemeinsames Memory, Sidebar-Popups. Agentenaufgaben (AGENT-TASKS) sind **nicht** enthalten.

Prüfung: `npm test` 885/885 (+1 skip, 1 todo) auf dem Quellstand des Pakets; `src/` und `docs/guide/` bytegleich im Paket; Electron-QA aus der Quelle (qa-harness, qa-agent-launch, qa-worktree-tree, qa-help, qa-settings) Exit 0. Kein Start des gepackten Bundles, weil die laufende Nutzer-App nicht gestört werden soll.

Installation (Joshua): Multiterminal mit **⌘Q schließen**, dann im macOS-Terminal:

```bash
bash '/Volumes/M4MegaDiva/Projekte/Lokale-Projekte/Desktop/Second_Brain/Arbeit/Ai Builds and projekts/Claude_code_tasks/Projekte/multiterminal-app/scripts/install-update.sh'
```

Ab 0.3.0 geht jedes weitere Update auch über Projektmanager → „App aktualisieren…“.

---

# Gemeinsame Update-Version 0.2.0 – 16.10.2026

Auftrag: Alle bereits bearbeiteten Features zu einer gemeinsamen macOS-arm64-Version bündeln. Joshua arbeitet weiter in der installierten App. **Jetzt weder installieren noch Nutzer-App beenden oder neu starten.** Installation und Start erfolgen später ausschließlich durch Joshuas Terminal-Befehl.

## Stand

UPDATE-REBUILD-OPUS-20261017-01 (17.10.2026): **Update-Paket aus `7f944ad`/`33a7718` neu erstellt, jetzt einschließlich Full Access.** Zuvor fehlte genau `src/main/agent-profile.js`. Build schließt lokale Arbeitsdaten (`.claude`, `.claude-flow`, `.gstack`, `.multiterminal`, `.qa-*`) nicht mehr ein; dadurch 855 statt 881 Paketdateien, Prüfsummen neu. `npm test` 566/566, alle `src/`-Dateien bytegleich im Paket, `install-update.sh --check` bestanden, `qa-ports`, `qa-settings`, `qa-agent-launch` direkt gegen das Paket bestanden. Installationsbefehl unten unverändert.

RELEASE-COMMIT-CODEX-20261016-06 (16.10.2026): Quellstand einschließlich freigegebener Full-Access-Ergänzung lokal in **`7f944ad`** gesichert; eigener abschließender Gesamtlauf **566/566 bestanden**. Paketprüfung erfolgreich, 91 Quelldateien vor Full Access bytegleich. Full Access ist noch nicht im Update-Paket; dafür sind Neubuild und GUI-Prüfung erforderlich. Kein Push und keine Installation. Die folgenden Build-/GUI-Nachweise stammen weiterhin aus der vorherigen Vorbereitungsrunde.

**Fertig gebaut und geprüft, noch nicht installiert** (UPDATE-CODEX-20261016-05; 16.10.2026, 12:04 +02:00). Alle oben beauftragten Features einschließlich Kontextstart liegen gemeinsam im separaten Update-Paket 0.2.0. Nutzer-App weiterhin unverändert. Nächste Aktion: Joshua installiert das geprüfte Paket mit dem unten stehenden Befehl, sobald er seine laufende Arbeit beendet hat.

## Umfang dieser Version

- Senkrechtes Menü unter dem Menüknopf und Agentenpfeil neben Plus (Claude Code, Codex, Kimi und eigene Befehle).
- Einstellungen mit Bereichen links und Anbietern oben; direkter Einstellungen-Knopf über „+ Projekt“.
- Aktivitätsanzeigen/Animationen, automatische Kachelsortierung und Aktivität je Projekt in der Seitenleiste; Komfortschalter.
- Projektmanager im eigenen Fenster, Lagebild ein-/ausblendbar und neue umbindbare Funktions-Hotkeys.
- Optionaler Agentenstart mit Projekt-/Aufgabenkontext und eigener Arbeitskopie, zusätzlich zu den bisherigen Direktstarts.
- Bereits integrierter Funktionsstand: Profile/Konten und Nutzungsansicht, Projektplanung, Datei-/Promptvorschau, Arbeitskopien, Ports, Rückmeldungen, Fortsetzen, Suche/Befehlspalette, Änderungen, Browser-Kommentare, Arbeitsaufbauten, Übergabe und Second-Brain-Aufgabenverknüpfung.

Vorhandene Produktgrenzen bleiben dokumentiert: kein neuer Nachweis mit echten Modellanbietern, physische Nutzerabnahme offen; bekannte Grenzen bei Pluginverwaltung und Kimi-Verbrauchsdaten werden durch Paketierung nicht behoben.

## Ergänzungen für dieselbe Update-Version

ACCOUNT-RENAME-CODEX-20261017-01 (17.10.2026): Umbenennen aller Konten einschließlich eingebauter Claude-/Codex-Standardkonten für **dieselbe Version 0.2.0** vormerken. `src/main/account-store.js`, `src/renderer/accounts-panel.js`, `tests/account-store.test.js`, neuer `tests/accounts-panel.test.js`. Eigene Prüfung: 16/16 Konten-/DOM-Tests und Gesamtlauf **655/655 grün**, Syntax/Diff sauber. Namen dauerhaft gespeichert, bisherige Kontodateien kompatibel. **Noch nicht paketiert oder installiert**; sichtbare Prüfung im Sammelbuild offen, da Electron schon bei `--version` mit SIGABRT abbricht.

UPDATE-HELPER-CODEX-20261017-01 (17.10.2026): unabhängigen lokalen Update-Helfer für **dieselbe Version 0.2.0** vormerken. PM-Aktion „App aktualisieren…“ mit Paketwahl/Versionsvorschau und nativer Bestätigung; kopierter Bash-Helfer arbeitet nach App-Ende weiter, sichert/ersetzt/startet bzw. rollt zurück. Neue `src/main/update-{service.js,helper.sh}`, `src/renderer/pm-update.js`, Update-Anbindung in `pm-main.js`/`pm-preload.js`/`pm.html`/`pm.css`, fünf Update-Testdateien und `scripts/qa-update-helper.js`. Finaler eigener Gesamtlauf **650/650 grün**, unabhängiger Review ohne wesentlichen Befund; vorhandenes Paket read-only mit 855 Dateien validiert. **Noch nicht im Paket oder installiert.** Sichtbare Prüfung vor Aufnahme offen: Electron vor Bootstrap SIGABRT. Die erste Version mit diesem Knopf muss einmal mit dem bisherigen externen Installer installiert werden; danach können vorbereitete lokale Pakete im PM gewählt werden. Keine Download-/automatische Buildfunktion, keine aktuelle Installation oder App-Beendigung.

MEMORY-CODEX-20261017-01 (17.10.2026): allgemeines lokales Memory für **dieselbe Version 0.2.0** vormerken. Gemeinsame/Projekt-Notizen, strukturierte Übergaben, automatische ungeprüfte Auszüge, anbieterunabhängige CLI und Memory-Settings sowie passende Start-/Fortsetzen-Adapter. Dateien: neue `memory-{service,capture,launch}.js`/`mt-memory-cli.js`, Integration in Main/Preload/Profil/Kontextstart/Settings, zugehörige Tests und `scripts/qa-memory.js`. Eigener gemeinsamer Gesamtlauf **608/608**, anschließende fünf DOM-Tests grün, unabhängige Reviews ohne Critical/Important-Befund. **Noch nicht im Paket oder installiert.** Native GUI-/Zwei-Prozess-Prüfung vor Aufnahme offen, weil Electron vor Produktcode SIGABRT liefert. Keine alten Erinnerungen importiert; Kimi-Fortsetzen/eigene Harnesses nutzen sichtbaren Kopier-/CLI-Weg. Details und Prüfgrenzen in `PROGRESS.md`.

SIDEBAR-TIPS-CODEX-20261017-01 (17.10.2026): zuverlässige eigene Erklär-Popups für die kleinen Projektanzeigen (Git-Pfeile, Änderungspunkt, Terminalanzahl, Projektmanager, Branch und Sync) für **dieselbe Version 0.2.0** vormerken. Dateien: `src/renderer/sidebar-tooltips.js`, Sidebar-Hunks in `app.js`/`github-panel.js`, Script in `index.html`, Popup-Stil in `styles.css`, `tests/sidebar-tooltips.test.js`, `scripts/qa-sidebar-tooltips.js`. Quell-/Ereignisprüfung: sechs gezielte Tests, final 572/572 Gesamttests grün. **Noch nicht im Paket oder installiert**; sichtbare Prüfung vor Aufnahme erforderlich, weil Electron und gstack Chromium in dieser Sitzung vor Bootstrap abbrechen. Details in `PROGRESS.md`.

Wenn vor Joshuas Installation weitere beauftragte Features fertig werden, **hier mit Aufgaben-ID, Dateien und Prüfstatus vormerken und ausdrücklich dieser Version zuordnen**. Erst nach Integration und erneuter Prüfung den Sammelbuild sowie das getrennte Update-Paket ersetzen. Nicht bloß den normalen Build überschreiben und eine Aufnahme behaupten. Keine automatische Installation, kein Neustart, keine neue Automation.

- CODEX-FULLACCESS-20261016-01: automatisch Full Access für eingebaute Codex-Neustarts, Kontextstarts und Fortsetzen; `src/main/agent-profile.js`, `tests/agent-profile.test.js`, `scripts/qa-agent-launch.js`. Quellstand geprüft: 566/566 Tests, tatsächliche Argumente mit lokalen Attrappen. **Noch nicht im vorhandenen Paket oder installiert**; Neubuild und GUI-/Permissions-Prüfung vor Aufnahme erforderlich (Electron-QA vor Bootstrap mit SIGABRT abgebrochen).

## Paket und späterer Terminal-Befehl

- Getrenntes Update-Paket: `dist/updates/Multiterminal-0.2.0/Multiterminal.app`.
- Prüfsummen: `dist/updates/Multiterminal-0.2.0/CHECKSUMS.sha256`.
- Installationsskript: `scripts/install-update.sh`. `--check` prüft ausschließlich das Paket und verändert/startet keine App.
- Das Skript verweigert die Installation, solange Multiterminal läuft. Es kopiert zuerst in einen Zwischenordner, prüft die Kopie, sichert die bisherige App unter einem eindeutigen Namen in `/Applications`, installiert und öffnet anschließend Version 0.2.0. Benutzerdaten außerhalb des App-Bundles bleiben erhalten.

Wenn Joshua bereit ist: Multiterminal regulär mit **⌘Q schließen**, dann im **macOS-Terminal außerhalb von Multiterminal** ausführen:

```bash
bash '/Volumes/M4MegaDiva/Projekte/Lokale-Projekte/Desktop/Second_Brain/Arbeit/Ai Builds and projekts/Claude_code_tasks/Projekte/multiterminal-app/scripts/install-update.sh'
```

## Prüfungen und Belege

- Eigene Gesamtsuite: `npm test` **565/565 bestanden**, keine Fehler, keine übersprungenen Tests.
- Eigene Electron-QA gegen gemeinsamen Quellstand: Einstellungen, Funktions-Hotkeys, Projektmanager, Projektaktivität, Kachelaktivität und obere Menüs jeweils Exit 0/`passed`; Kontextstart zusätzlich vom Sol-6.1-Unteragenten mit 22 gezielten Tests und eigener Quell-QA geprüft.
- Eigene Electron-QA direkt gegen das separate Update-Paket: `qa-settings`, `qa-topbar`, `qa-agent-launch`, `qa-ports` jeweils Exit 0/`passed`. Paket-Screenshots für Menü/schmale Ansicht und Kontextvorschau sowie Quell-Screenshot der Einstellungen selbst visuell geprüft. Isolierte Testdaten und lokale Agentenattrappen, keine echten Anbieteraufrufe.
- `npm run build` Exit 0; App-Version in Paket-Metadaten und `package.json` ist `0.2.0`. Alle **91 Quelldateien** in `src/` bytegleich im Update-Paket. Bekannte optionale Packager-Warnung zum `.icon`-Format; ausführbarer spawn-helper vorhanden.
- **878 Paketdateien** mit SHA-256 erfasst; `bash scripts/install-update.sh --check` Exit 0. Syntax/Diff sauber. Schutzfunktion separat ausgeführt: laufende App wird erkannt und Installation verweigert; Installationspfad selbst nicht ausgeführt.
- Laufende Nutzer-App zum Abschluss weiterhin PID **626**, Startzeit **16.10.2026, 11:17:22**. Keine Installation, kein App-Neustart, kein Commit/Push. Tatsächlicher Austausch/Neustart und physische Nutzerabnahme stehen absichtlich aus.
- Logs: `/tmp/multiterminal-update-0.2.0-tests.log`, `...-build.log`, `...-settings.log`, `...-qa-{feature-hotkeys,project-manager,project-activity,activity,topbar}.log`, `...-package-qa-{settings,topbar,agent-launch,ports}.log`. Vollständige Übergabe im kanonischen `PROGRESS.md`.
