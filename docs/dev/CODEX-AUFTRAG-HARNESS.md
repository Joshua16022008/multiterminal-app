# Codex-Auftrag: Harness- und Modellkatalog (Strang H)

Auftraggeber: Joshua, 17.10.2026. Koordination/Integration: Claude Code (Aufgabe OSS-E0-OPUS-20261017-01).
Aufgaben-ID für dich: **HARNESS-CODEX-20261017-01**.

## Ziel

Multiterminal soll jedes verbreitete Agenten-CLI starten können (Claude Code, Codex, Kimi, OpenCode,
DeepSeek-Harness `dsh`, ZCode, Gemini CLI, Qwen Code, Aider, Crush, Goose, Copilot CLI, Cline, Amp,
Cursor `agent` …), mit Modellwahl und frei konfigurierbaren Anbieter-Endpunkten (DeepSeek, Z.ai,
Moonshot, OpenRouter, Ollama). Der Katalog ist reines JSON und wird nach dem Open-Source-Release von der
Community per PR erweitert.

## Pflichtlektüre (in dieser Reihenfolge)

1. `AGENTS.md`, `PROJECT_STATUS.md`, `WORK_IN_PROGRESS.md`, `PROGRESS.md` (Koordinationsregeln gelten).
2. **`docs/dev/ipc-contract.md`, Abschnitt 2: verbindliche Signaturen.** Nicht abweichen. Wenn es nicht anders geht, frag vorher per Nachricht in `WORK_IN_PROGRESS.md` an Claude.
3. `docs/dev/harness-plan.md`: Recherche (CLI-Flags mit Quellen), Datenmodell, Tests, Risiken. Bei Widerspruch gilt der IPC-Vertrag.

## Arbeitskopie

- Basis: aktueller `main` (mindestens der Commit, der `docs/dev/CODEX-AUFTRAG-HARNESS.md` enthält).
- Eigener Worktree: `git worktree add /Volumes/M4MegaDiva/Projekte/.agent-worktrees/multiterminal-harness-20261017 -b codex/harness-catalog main`
- Vorher die Reservierung in `WORK_IN_PROGRESS.md` des **gemeinsamen** Checkouts eintragen. Nur deinen Abschnitt bearbeiten, unmittelbar davor neu lesen.

## Dein exklusiver Dateibereich

Neu:
- `src/main/harness-catalog.js`, `src/main/harness-catalog/*.json` (≈15 Einträge, jeder mit `evidence` + `verifiedWith`)
- `src/main/harness-detect.js`, `src/main/model-sources.js`
- `src/main/keychain.js`, `src/main/endpoint-store.js`
- `src/main/harness-launch.js`
- `src/renderer/harness-panel.js`, `src/renderer/harness.css`
- `tests/harness-*.test.js`, `tests/keychain.test.js`, `tests/endpoint-store.test.js`, `tests/model-sources.test.js`
- `scripts/qa-harness.js` (schreiben; laufen lassen erst nach der Integration, siehe unten)
- `docs/dev/harness-catalog.md` (Schema-Doku + „Wie füge ich ein Harness hinzu“ für Contributors)

Ändern erlaubt (nur Herauslösen von Schnittstellen, **ohne Verhaltensänderung**):
- `src/main/agent-profile.js`: neues `argsFor(provider, { resume })`; `decorate`/`decorateCommand`/`builtinLine` bleiben unverändert im Verhalten
- `src/main/memory-launch.js`: `writePrivate` exportierbar machen, `contextArgs({ harnessId, resume, projectId })`
- `src/main/agent-session-service.js`: `resumeFromCatalog(entry, id)`
- `src/main/account-store.js`: `linkShared` exportieren; bei isoliertem Claude-Konfigordner wird `settings.json` **nicht** verlinkt
- die zugehörigen bestehenden Tests

## Verboten (gehört dem Integrator, Etappe 3)

`src/main/main.js`, `src/main/preload.js`, `src/main/presets.js`, `src/main/session-store.js`,
`src/main/launch-context.js`, `src/renderer/app.js`, `src/renderer/index.html`,
`src/renderer/settings-panel.js`, `src/renderer/agent-launch.js`, `src/renderer/terminal-pane.js`,
`src/renderer/styles.css`, `src/main/worktree-*.js`, alles unter `docs/guide/`.
Wenn du dort etwas brauchst, beschreib die genaue Änderung als Integrationshinweis in deinem
PROGRESS-Eintrag (Datei, Stelle, Code-Schnipsel). Claude baut sie ein.

## Feste Entscheidungen

- Katalogeinträge sind **nur JSON**. `binary` ohne `/`. Platzhalter nur aus einer festen Liste. Alle Vorlagen sind argv-Arrays.
  `query.argv[0] === binary`, und Modelllisten werden nur auf Klick abgefragt.
- Modellname: `^[A-Za-z0-9._:/@\[\]+-]{1,200}$`.
- Erkennung: `command -v` im Login-Shell-Env. Bei mehrdeutigen Namen (`agent`, `kimi`) zusätzlich `detect.verify` (argv + Ausgabemuster).
- Installationsbefehle werden **nie ausgeführt**, nur angezeigt, kopiert oder ohne Enter eingetippt.
- Schlüssel: nur im macOS-Schlüsselbund (Service `de.multiterminal.endpoint`, Account = Endpunkt-ID).
  - Schreiben über `security -i` und stdin, mit korrektem Quoting. Testfall mit `"`, `\` und Leerzeichen ist Pflicht.
  - In der Startzeile steht nur `VAR="$(/usr/bin/security find-generic-password -s … -a … -w)"`.
  - Der Schlüssel taucht nie in argv, Datei, Log, Renderer, `session.json`, `endpoints.json` oder Fehlermeldungen auf.
  - `endpoints.json` mit Modus 0600, atomar geschrieben.
- Claude mit Fremd-Endpunkt: eigener `CLAUDE_CONFIG_DIR` je Endpunkt (`isolateClaudeConfig: true` ist Standard). In dem Fall keine Kontowahl. Hooks bleiben über den `--settings` des Wrappers erhalten.
- Codex mit eigenem Provider: `-c model_provider=… model_providers.mt.*` inklusive Pflichtfeld `wire_api`.
  - Wert und Syntax mit dem lokal installierten `codex --help` bzw. der Konfig-Doku verifizieren.
  - Unbelegtes bleibt `evidence: "third-party"`.
  - OpenCode `-s` vs. `--session` ebenfalls lokal klären.
- Unbestätigte Einträge starten nur mit dem nackten Befehl, ohne Modell- und Resume-Flags.
- `dsh web` und ZCode: nur Start im Terminal plus Hinweis auf die URL, keine Browser-Einbettung.
- Lokal vorhanden sind claude, codex, kimi, dsh und ollama. Echte Läufe dieser CLIs nur ohne bezahlte Aufrufe. Bezahlte Endpunkt-Tests macht Joshua.

## Pflicht-Tests

- **Golden-Tests:** Startzeilen von claude, codex und kimi **bytegleich** zum heutigen `decorateCommand`/`memoryLaunch.decorateCommand`, und zwar für alle Kombinationen aus Profil, Memory, Resume und Full Access.
- **Katalog-Validierung über alle JSON-Dateien.** Sie wird später der CI-Wächter für Community-PRs.
- **Keychain mit gemocktem spawn:** argv enthält nie den Schlüssel, Sonderzeichen werden korrekt gespeichert.
- **Endpunkt-Store:** Dateirechte 0600, kein Schlüsselfeld, defekte Datei wird gesichert.
- **`harness-launch`:** claude + DeepSeek (nur Lookup, kein Schlüssel), codex mit Provider, opencode `-m p/m`, Grenze von 2000 Zeichen, Modell mit `'` wird abgelehnt.
- **`harness-panel`:** DOM-Test gegen ein gemocktes `deck.harness`/`deck.endpoints`, nach dem Muster vorhandener Panel-Tests.
- **`npm test`** komplett grün im eigenen Worktree. Tests anderer Sitzungen nicht als eigene Prüfung ausgeben.
- `scripts/qa-harness.js` schreibst du nach dem Muster von `scripts/qa-agent-launch.js`: Fake-CLIs plus Fake-`security`, `FAKE_KEY` darf nirgends auftauchen.
  - Laufen kann das Skript erst nach der Integration.
  - Native Electron-QA bricht derzeit mit SIGABRT ab. Claude untersucht das parallel. Das Skript also nicht als bestanden melden, wenn es nicht wirklich lief.

## Abschluss

1. Commits nur auf `codex/harness-catalog` im eigenen Worktree. **Kein Merge nach main, kein Push, keine Installation.**
2. `PROGRESS.md` (gemeinsamer Checkout) bekommt einen Eintrag mit:
   - Commits und geänderten Dateien
   - tatsächlich gelaufenen Prüfungen
   - lokal verifizierten CLI-Flags (Version + Befehl)
   - **Integrationshinweisen** für `main.js`/`preload.js`/`presets.js`/`session-store.js`/`launch-context.js`/`app.js`/`agent-launch.js`/`terminal-pane.js`/`settings-panel.js`
   - offenen Punkten
3. Reservierung in `WORK_IN_PROGRESS.md` auf „Übergabe angefragt → Claude (Integration Etappe 3)“ setzen.
