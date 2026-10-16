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
