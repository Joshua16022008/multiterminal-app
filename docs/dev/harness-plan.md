<!-- Recherche- und Entwurfsstand des Planungs-Workflows vom 17.10.2026. Verbindlich ist bei Abweichungen docs/dev/ipc-contract.md und docs/dev/CODEX-AUFTRAG-HARNESS.md. -->

# Teilplan Vorhaben 2: Alle Harnesses und Modelle

## 1. Ziel

Aus Multiterminal heraus lässt sich jedes bekannte Agenten-CLI starten (Harness = das Programm, das den Agenten im Terminal ausführt, z. B. Claude Code oder OpenCode). Für jeden Start sind Modell und Anbieter-Endpunkt (fremde API-Adresse plus Schlüssel) wählbar. Grundlage ist ein mitgelieferter, datengetriebener Katalog. Er erkennt installierte CLIs, zeigt den Installationsbefehl, bietet Modelllisten an, nimmt eigene Einträge auf und ist per PR erweiterbar.

Alles Bestehende bleibt unverändert: Claude/Codex/Kimi-Schnellstarts, Profil-Injektion, Memory, Full Access für Codex, Konten, Verbrauchsanzeige, Kontextstart sowie alte `presets.json` und `session.json`.

## 2. Recherche-Stand (17.10.2026)

Belegstufen: **B-lokal** = mit `--help` oder Paketdatei auf diesem Mac geprüft, **B-doc** = offizielle Doku, **B-3rd** = nur Fremdquelle, **unbestätigt** = nicht oder widersprüchlich belegt.

| ID | Binary | Installation | Modell | Fortsetzen | Fremde Endpunkte / Env | Status |
|---|---|---|---|---|---|---|
| claude | `claude` | `curl -fsSL https://claude.ai/install.sh \| bash` (aus Vorwissen, nicht neu recherchiert; lokal installiert unter `~/.local/bin`) | `--model <m>` (B-lokal) | `--continue`, `--resume <id>` (B-lokal) | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL` (B-doc DeepSeek) | belegt |
| ↳ DeepSeek | – | – | aktuelles Beispiel in der Doku: `deepseek-flash[1m]` (Namen wechseln) | – | `https://api.deepseek.com/anthropic` (B-doc) | belegt |
| ↳ Z.ai GLM | – | – | Standard laut Doku `GLM-4.7` über `ANTHROPIC_DEFAULT_*` | – | `https://api.z.ai/api/anthropic`, `API_TIMEOUT_MS=3000000` (B-doc) | belegt |
| ↳ Kimi/Moonshot | – | – | `kimi-k3[1m]` laut Fremdquelle | – | `https://api.moonshot.ai/anthropic` (B-3rd, quellenübergreifend gleich) | teilbelegt |
| ↳ OpenRouter | – | – | Anthropic-Modelle empfohlen | – | `https://openrouter.ai/api`, `ANTHROPIC_API_KEY=""` muss leer gesetzt sein (B-doc) | belegt |
| ↳ Ollama | – | – | lokales Modell | – | `http://localhost:11434`, Token `ollama`, ab v0.14 (B-doc); `ollama launch claude --model x` (B-3rd) | belegt / teilbelegt |
| codex | `codex` | `npm i -g @openai/codex` (aus Vorwissen, nicht neu recherchiert) | `-m`, `--oss --local-provider ollama\|lmstudio`, `-c key=value`, `-p profile` (B-lokal) | `codex resume --last`, `codex resume <id>` (bestehender Code) | `[model_providers.<id>] base_url, env_key, wire_api` (B-3rd, offizielle Seite nur teilweise gelesen) | teilbelegt |
| kimi | `kimi` | `curl -fsSL https://code.kimi.com/kimi-code/install.sh \| bash` oder npm `@moonshot-ai/kimi-code` (B-doc) | `-m` (B-lokal) | `-c`, `-S <id>` (B-lokal) | Endpunkt-Konfiguration unbestätigt | teilbelegt |
| opencode | `opencode` | `curl -fsSL https://opencode.ai/install \| bash`; npm, brew-Tap widersprüchlich (B-3rd) | `-m provider/model`; `opencode models [provider]` (B-doc) | `-c`, `-s <id>`; `--prompt` (B-doc) | `OPENCODE_CONFIG_CONTENT` (Inline-JSON), `OPENCODE_CONFIG` (B-doc). `{env:VAR}` im Config ist **unbestätigt** | belegt |
| gemini | `gemini` | `npm i -g @google/gemini-cli` | `-m` | `--resume latest\|<n>` | nur eigener Schlüssel; fremde Endpunkte unbestätigt | B-3rd |
| qwen | `qwen` | `npm i -g @qwen-code/qwen-code@latest` | `OPENAI_MODEL` | Flags unbestätigt | `OPENAI_API_KEY`, `OPENAI_BASE_URL` | B-3rd |
| aider | `aider` | `python -m pip install aider-install && aider-install` | `--model openrouter/<p>/<m>`, `--list-models` (B-doc) | `--restore-chat-history` unbestätigt | `OPENAI_API_BASE` unbestätigt | teilbelegt |
| crush | `crush` | `brew install charmbracelet/tap/crush` (B-doc) | im TUI-Start kein `--model` belegt, nur `crush run -m` (B-3rd) | `-C/--continue`, `-s <id>` (B-doc) | unbestätigt | teilbelegt |
| goose | `goose` | `brew install block-goose-cli`; Skript-URLs widersprüchlich | `GOOSE_PROVIDER`, `GOOSE_MODEL` | `goose session --resume`, Syntax widersprüchlich | unbestätigt | B-3rd |
| copilot | `copilot` | `npm install -g @github/copilot`, Node ≥ 22 (B-doc) | Flags unbestätigt | unbestätigt | – | teilbelegt |
| cline | `cline` | `npm install -g cline` (B-doc) | `cline auth -p -k -m -b` (B-doc) | unbestätigt | `-b` Base-URL über `cline auth`, nicht pro Start | teilbelegt |
| amp | `amp` | `curl -fsSL https://ampcode.com/install.sh \| bash` / npm `@sourcegraph/amp` (B-3rd) | Modellwahl unbestätigt | unbestätigt | `AMP_API_KEY` | unbestätigt |
| cursor | `agent` (alt `cursor-agent`) | `curl https://cursor.com/install -fsS \| bash` | `--model`, `agent models` | `--continue`, `--resume=<id>` (Doku über Mirror) | – | B-3rd |
| zcode | `zcode` | laut AIML-API-Doku aus Quellcode bauen | GLM-5.2 voreingestellt, Bring-your-own-Key | unbestätigt | unbestätigt | unbestätigt |
| dsh | `dsh` | `npm i -g @deepseek-ai/dsh` (lokal installiert: 0.1.0-rc.7, Repo `github.com/deepseek-ai/deepseek-harness`) | Modell unbestätigt | `dsh --profile tui --resume <id>` (README, setzt installiertes tui-Profil voraus) | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` (B-3rd) | teilbelegt, Developer Preview |

Klärungen zu Joshuas Begriffen:
- **„Z-Code“ ist ZCode von Z.ai**, nicht der Editor Zed. Seit 01.07.2026 vor allem eine Desktop-App, `zcode` öffnet eine TUI, `--web` einen Browser-Arbeitsbereich. Im Katalog nur Erkennung, Einstufung „unbestätigt“.
- **Den DeepSeek-Harness gibt es:** `dsh` (`@deepseek-ai/dsh`, offizielles DeepSeek-Repo, auf diesem Mac schon installiert). Er arbeitet über „Profile“: `web` öffnet `http://127.0.0.1:3080`, `headless "job"` arbeitet einen Auftrag ab, `tui` ist optional. Im Katalog erhält er eine eigene Startart `kind: "web"`.
- Auf diesem Mac auf dem PATH: claude, codex, kimi, dsh, ollama. Nicht gefunden: opencode, gemini, qwen, aider, crush, goose, copilot, cline, amp, agent, zcode.

## 3. Nutzerablauf

1. **Einstellungen → neuer appweiter Bereich „Harnesses & Modelle“** (wie Memory und Hotkeys). Die Liste zeigt jeden Katalogeintrag mit „installiert (Pfad, Version auf Klick)“ oder „fehlt“, Belegstufe und Doku-Link. Bei fehlenden CLIs gibt es „Installationsbefehl kopieren“ und „In neuem Terminal anzeigen“: Der Befehl wird sichtbar eingetippt, aber **nicht** mit Enter abgeschickt.
2. Je Harness: Standardmodell aus Liste oder Freitext, Modellliste aktualisieren, „Als Schnellstart anlegen“.
3. **Endpunkt-Profile:** Bezeichnung, Typ (`anthropic` / `openai` / `ollama` / `deepseek`), Base-URL, Schlüssel. Der Schlüssel steht in einem Passwortfeld, geht an den Schlüsselbund und ist danach nur noch als „gespeichert“ sichtbar. Vorlagen für DeepSeek, Z.ai, Moonshot, OpenRouter und Ollama sind eingetragen.
4. **Schnellstart-Menü:** Neben den eingebauten Einträgen stehen Startprofile wie „Claude Code · DeepSeek · deepseek-flash“. Die Kachel zeigt einen Chip mit Harness, Modell und Endpunkt.
5. **Kontextstart-Dialog:** Agent-Auswahl aus allen installierten Harnesses mit Prompt-Fähigkeit, dazu optional Modell und Endpunkt.
6. **Eigene Einträge:** Formular mit dem bekannten Feldern plus Harness-Felder. Exportierbar als Katalog-JSON für einen Community-PR.

## 4. Datenmodell

**Katalogeintrag** `src/main/harness-catalog/<id>.json`: JSON, kein JS, also kein Code aus PRs. Alle Vorlagen sind argv-Arrays, keine Shell-Strings.

```json
{
  "schema": 1, "id": "opencode", "label": "OpenCode", "binary": "opencode",
  "kind": "tui", "evidence": "doc", "verifiedWith": "2026-10-17",
  "docsUrl": "https://opencode.ai/docs/cli",
  "install": [{ "method": "script", "display": "curl -fsSL https://opencode.ai/install | bash" }],
  "start": ["opencode"],
  "model": { "args": ["-m", "{model}"], "format": "provider/model", "static": [], "query": { "argv": ["opencode", "models"], "parse": "lines" } },
  "resume": { "last": ["opencode", "--continue"], "byId": ["opencode", "--session", "{sessionId}"] },
  "prompt": { "args": ["--prompt", "{prompt}"] },
  "endpoints": { "openai": { "env": { "OPENCODE_CONFIG_CONTENT": "{opencodeProviderJson}" }, "secretEnv": "MT_ENDPOINT_KEY" } },
  "profileInjection": null, "supportsHooks": false, "accounts": null
}
```

Weitere Felder:
- `profileInjection`: `"claude-append" | "codex-developer" | "kimi-agent-file" | null`. Verweist auf die vorhandenen Funktionen, keine freien Vorlagen.
- `fullAccess`: nur `codex` erhält `["--dangerously-bypass-approvals-and-sandbox"]`.
- `kind`: `tui | web | headless`.
- `evidence`: `local | doc | third-party | unconfirmed`.
- `endpoints.anthropic.env` für claude:

```json
{ "ANTHROPIC_BASE_URL": "{baseUrl}", "ANTHROPIC_API_KEY": "", "ANTHROPIC_MODEL": "{model}" }
```

  mit `"secretEnv": "ANTHROPIC_AUTH_TOKEN"`.
- `endpoints.openai` für codex als `-c`-Argumente:

```text
-c model_provider="mt" -c model_providers.mt.base_url="{baseUrl}" -c model_providers.mt.env_key="MT_ENDPOINT_KEY"
```

  `wire_api` ist im Schema als „zu prüfen“ markiert.

Validierungsregeln:
- Modell: `^[A-Za-z0-9._:/@\[\]+-]{1,200}$` (mit `[1m]`).
- Platzhalter nur aus fester Liste.
- Binary ohne `/`.
- Installationsbefehle sind reiner Anzeige-Text.

**Endpunkt-Profil** `<dataDir>/endpoints.json` mit Modus 0600 und ohne Schlüssel:

```json
{ "version": 1, "endpoints": [{ "id": "ep-1a2b3c4d", "label": "DeepSeek", "type": "anthropic", "baseUrl": "https://api.deepseek.com/anthropic", "defaultModel": "deepseek-flash[1m]", "modelMap": { "haiku": "deepseek-flash" }, "isolateClaudeConfig": true }] }
```

Der Schlüssel liegt im Schlüsselbund unter Service `de.multiterminal.endpoint`, Account = `ep-…`.

**Startprofil:** Eine eigene Preset-Zeile wird abwärtskompatibel erweitert, alle neuen Felder sind optional:

```json
{ "id": "…", "label": "…", "command": "…", "resumeCommand": "…", "harnessId": "claude", "model": "deepseek-flash[1m]", "endpointId": "ep-…" }
```

Alte Presets ohne `harnessId` bleiben unverändert eigene Befehle. Eine Kachel speichert `launch: { harnessId, model, endpointId }` in `session.json`, nie den fertigen Befehl mit Endpunktdaten.

**Schlüssel ohne Klartext:**
- **Lesen:** `harness-launch` erzeugt ein Präfix nach dem Muster

  ```sh
  ANTHROPIC_AUTH_TOKEN="$(/usr/bin/security find-generic-password -s de.multiterminal.endpoint -a ep-… -w)" ANTHROPIC_BASE_URL='…' claude --model '…'
  ```

  Die Variable gilt nur für diesen Prozess, nicht für die Shell. Zeile, Shell-History und Prozessliste enthalten nur den Lookup, nie den Schlüssel.
- **Schreiben:** Main ruft `security -i` auf und schreibt `add-generic-password -U -s … -a … -w <key>` über **stdin**. Damit steht der Schlüssel nie in argv. `man security` bestätigt, dass `-i` Befehle von stdin liest. Der Schlüssel wird nie geloggt, nie an den Renderer zurückgegeben und nie in Fehlermeldungen übernommen.

## 5. Betroffene und neue Dateien

**Neu**

| Datei | Zweck |
|---|---|
| `src/main/harness-catalog.js` | Loader, Schema-Validierung, Merge mit eigenen Einträgen (`<dataDir>/harnesses.json`), Platzhalter-Expansion zu argv |
| `src/main/harness-catalog/*.json` | Die 15 Einträge aus §2, z. B. `claude`, `codex`, `kimi`, `opencode`, `dsh`, `zcode`, `cursor` |
| `src/main/harness-detect.js` | `command -v` im Login-Shell-Env, Cache, Timeout 5 s; `--version` nur auf Klick |
| `src/main/model-sources.js` | Statische Liste, Katalog-Query (argv mit `execFile`, kein Shell), Ollama `GET http://127.0.0.1:11434/api/tags`, OpenRouter `GET https://openrouter.ai/api/v1/models` (öffentlich, ohne Schlüssel) |
| `src/main/keychain.js` | `set` / `has` / `delete` / `lookupExpression`, Schreiben nur über `security -i` und stdin |
| `src/main/endpoint-store.js` | CRUD für `endpoints.json`, atomares Schreiben nach dem Muster von `presets.js:117` |
| `src/main/harness-launch.js` | Baut die Start-, Resume- und Prompt-Zeile aus Katalog, Modell, Endpunkt, Profil, Memory und Full Access; Längengrenze 2000 |
| `src/renderer/harness-panel.js`, `src/renderer/harness.css` | Inhalt des neuen Einstellungsbereichs |
| `docs/harness-catalog.md` | Schema und PR-Anleitung (Teil der späteren CONTRIBUTING) |
| Tests | `harness-catalog`, `harness-detect`, `model-sources`, `keychain`, `endpoint-store`, `harness-launch`; `scripts/qa-harness.js` |

**Geändert**

| Datei | Änderung |
|---|---|
| `src/main/agent-profile.js` | Neues `argsFor(provider, {resume})` liefert nur die Profil-Flags. `decorate`/`decorateCommand`/`builtinLine` bleiben als Hülle mit identischem Verhalten; `PROVIDERS` bleibt. |
| `src/main/memory-launch.js` | `contextArgs({ harnessId, resume, projectId })`. Für Fremd-Harnesses mit `prompt.args` wird der Memory-Hinweis als Prompt übergeben, sonst bleibt es beim sichtbaren CLI-Weg. `builtinProvider` bleibt. |
| `src/main/agent-session-service.js` | `buildResume` unverändert für die drei Anbieter. Neu: `resumeFromCatalog(entry, id)`. |
| `src/main/presets.js` | `DEFAULT_PRESETS` unverändert. `isValidOwnPreset`/`add` akzeptieren optional `harnessId`, `model`, `endpointId`. |
| `src/main/session-store.js` | Sanitizer für `launch` (Zeile ~46). |
| `src/main/main.js` | `terminals:create` (~309) nimmt `launch` an. Ist es gesetzt, baut `harness-launch` den Befehl. Der Wert für `meta.provider` (~352) kommt dann aus `launch.harnessId` statt aus Stringvergleich. Neue IPC-Handler `harness:*`, `endpoints:*`. |
| `src/main/preload.js` | `deck.harness`, `deck.endpoints` |
| `src/main/launch-context.js` | Die Whitelist `['claude','codex']` (~133) wird ersetzt: Katalogeinträge mit `prompt.args` sind erlaubt, Kimi bleibt gesperrt. `decorateCommand` wird durch `harness-launch` ersetzt. |
| `src/renderer/agent-launch.js` | Die festen Provider-Prüfungen (~54, ~172) kommen aus `deck.harness.list()`; dazu Felder für Modell und Endpunkt. |
| `src/renderer/app.js` | Schnellstart-Menü (~575) und Formular (~642) mit Harness-Feldern; `PRESET_PROVIDER` (~83) wird aus dem Katalogfeld `accounts` abgeleitet; `newTerminal` reicht `launch` weiter; Kontextstart (~890). |
| `src/renderer/terminal-pane.js` | Modell-/Endpunkt-Chip neben `wtChip` (~300) |
| `src/renderer/settings-panel.js` | Ein Eintrag in `tabs` (Zeile 6) und eine Weiterleitung an `harness-panel.js` |
| `src/renderer/index.html` | Script- und Style-Einbindung |

**Bewusst unverändert:** `account-store.js` (Konten bleiben claude/codex), `usage-service.js` (unbekannte Harnesses zeigen „keine lokale Quelle“ wie heute Kimi), `agent-wrapper.js` (Hooks nur für Claude, `supportsHooks` dokumentiert das), `extension-manager.js`.

## 6. Wiederverwendbare Funktionen

- `shellQuote`, `tomlString` aus `src/main/agent-profile.js`
- `quote` aus `src/main/launch-context.js:9`; `buildResume`, `isValidSessionId` aus `src/main/agent-session-service.js:24,34`
- Atomares Schreiben und Sicherungskopie defekter Dateien: `src/main/presets.js:107-135`, `src/main/account-store.js:132-151`
- Privates Schreiben ohne Symlinks: `writePrivate` in `src/main/memory-launch.js:20`; `writeDerived` in `agent-profile.js:89`
- Symlinks für geteilte Einstellungen bei isoliertem Claude-Konfigordner: `linkShared` in `account-store.js:160`. Muss exportiert werden, und `settings.json` darf dabei **nicht** verlinkt werden (siehe Risiken).
- Login-Shell-Env und Präfix-Platz in der Startzeile: `shellEnv` in `src/main/pty-manager.js:35`, Spawn `-l -i` (~88)
- Muster für Electron-QA mit unschädlichen Fake-CLIs, die ihre argv protokollieren: `scripts/qa-agent-launch.js:31-36`
- Grundgerüst für Einstellungsbereiche: `h`, `button`, `note`, `select` in `settings-panel.js`

## 7. Arbeitspakete

Jedes Paket in eigener Arbeitskopie, Reservierung in `WORK_IN_PROGRESS.md`.

| AP | Inhalt | Dateibereich (exklusiv) | Abhängig von |
|---|---|---|---|
| **AP0** | Katalog-Schema, Loader, Platzhalter-Expansion, 15 JSON-Einträge mit `evidence`, Schema-Doku, **IPC-Vertrag** als Kommentar und Doku | `src/main/harness-catalog.js`, `src/main/harness-catalog/`, `tests/harness-catalog.test.js`, `docs/harness-catalog.md` | – (zuerst) |
| **AP1** | Installationserkennung und Modellquellen | `src/main/harness-detect.js`, `src/main/model-sources.js` + 2 Tests | AP0-Schema |
| **AP2** | Schlüsselbund und Endpunkt-Profile | `src/main/keychain.js`, `src/main/endpoint-store.js` + 2 Tests | – |
| **AP3** | Startzusammenbau; Argument-Schnittstellen herauslösen ohne Verhaltensänderung | `src/main/harness-launch.js` + Test; `agent-profile.js`, `memory-launch.js`, `agent-session-service.js` + deren Tests | AP0, AP2 (Schnittstelle) |
| **AP4** | Main-Integration, IPC, Persistenz | `main.js`, `preload.js`, `presets.js`, `session-store.js`, `launch-context.js` + Tests | AP1–AP3 |
| **AP5** | Einstellungsbereich „Harnesses & Modelle“ gegen gemockten `deck.harness` | `src/renderer/harness-panel.js`, `harness.css`, eine Zeile in `settings-panel.js`, `index.html` + `tests/harness-panel.test.js` | nur AP0-Vertrag, parallel zu AP3/AP4 |
| **AP6** | Schnellstart-Menü, Kachel-Chip, Kontextstart-Dialog | `app.js`, `terminal-pane.js`, `agent-launch.js` + Tests | AP4 |
| **AP7** | Electron-QA und Abschluss-Doku | `scripts/qa-harness.js`, Koordinationsdateien | AP4–AP6 |

Parallel laufen können AP1, AP2 und AP5 nach AP0, AP3 parallel zu AP1. AP4 und AP6 sind Integrationspunkte, jeweils von einem einzigen Agenten.

## 8. Tests

**Unit (node:test)**
- **Katalog:** Jede JSON-Datei ist gültig. Diese Prüfung ist der CI-Wächter für Community-PRs. Unbekannte Platzhalter, `/` im Binary oder Shell-Metazeichen im Modell werden abgelehnt.
- **`harness-launch`:** Golden-Lines für claude, codex und kimi. Die Ausgabe ist **bytegleich** zu heutigem `decorateCommand`/`memoryLaunch.decorateCommand` bei allen Schalterkombinationen (Profil, Memory, Resume, Full Access). Das ist der Abwärtskompatibilitäts-Test.
- **Startzeilen mit Endpunkt:**
  - claude + DeepSeek: Zeile enthält `$(…security … -w)` und keinen Schlüssel.
  - codex mit `-c model_providers…`, opencode mit `-m p/m`.
  - Grenze von 2000 Zeichen; Modell mit `'` wird abgelehnt.
- **Keychain:** gemockter `spawn`. Geprüft wird, dass argv **nie** den Schlüssel enthält, stdin schon. Fehlermeldungen sind ohne Schlüssel.
- **Endpunkt-Store:** Datei hat 0600 und kein Schlüsselfeld; defekte Datei wird gesichert.
- **Presets und Session:** alte Dateien laden unverändert, neue Felder bleiben erhalten, ungültige `launch` werden verworfen.
- **Erkennung:** Fake-PATH mit Stub-Binaries, Timeout, kein Aufruf von `--version` ohne Anforderung.
- **Modellquellen:** gemockte HTTP- und `execFile`-Antworten, Freitext-Fallback.

**Electron-QA `scripts/qa-harness.js`** nach dem Muster von `qa-agent-launch.js`:
- Fake-Binaries `claude`, `codex`, `kimi`, `opencode`, `dsh` und ein Fake `security` (liefert `FAKE_KEY`) im Temp-PATH.
- Endpunkt per UI anlegen, Startprofil anlegen, Kachel starten.
- Recorder bestätigt argv und Env (`ANTHROPIC_AUTH_TOKEN=FAKE_KEY` nur im Kindprozess).
- `session.json`, `endpoints.json` und Terminal-Scrollback enthalten `FAKE_KEY` nicht.
- Neustart und Fortsetzen, Kontextstart mit opencode, alte Schnellstarts unverändert.
- Screenshot des Einstellungsbereichs.

Bekannter Blocker: native Electron-QA bricht hier derzeit mit SIGABRT ab (siehe WORK_IN_PROGRESS). Das darf nicht als bestanden gemeldet werden.

## 9. Risiken

1. **Anbieter werden heute über Stringgleichheit erkannt** (`agent-profile.decorate`, `memory-launch.builtinProvider`, `main.js:352`, `app.js:83`). Mit `--model` fällt ein Start sonst stillschweigend aus Profil, Memory und Konten heraus. Lösung: explizites `launch.harnessId` und Golden-Tests.
2. **Claude-`settings.json` mit eigenem `env`-Block** (das Z.ai-Installationsskript schreibt genau so einen) kann die Endpunkt-Variablen überschreiben. Eine vorhandene claude.ai-Anmeldung kollidiert mit `ANTHROPIC_AUTH_TOKEN`. Gegenmittel: `isolateClaudeConfig` mit eigenem `CLAUDE_CONFIG_DIR` ohne verlinkte `settings.json`. Zusätzlich warnt die UI, wenn `~/.claude/settings.json` `ANTHROPIC_*` setzt. Die Rangfolge Settings-env gegen Prozess-env ist im Paket mit Fake-CLI nicht prüfbar; einmal echt mit DeepSeek testen.
3. **Modellnamen und CLI-Flags ändern sich ständig.** Gegenmittel: `verifiedWith`, Belegstufe in der UI, Freitext bleibt immer möglich, unbestätigte Einträge starten nur ohne Modell- und Resume-Flags.
4. **Installationsbefehle mit `curl | bash` werden nie automatisch ausgeführt**, nur angezeigt oder ohne Enter eingetippt. Für Neulinge gibt es einen Paketnamen-Hinweis (Fremdquellen warnen vor Nachahmer-Paketen bei dsh und dem Doppelnamen `kimi`).
5. **Schlüsselbund-ACL:** Einträge über `/usr/bin/security` sind für das Tool selbst freigegeben. Abweichungen (Abfragedialog beim Start) einmal echt prüfen. Ist der Schlüssel nicht lesbar, bricht der Start sichtbar ab, mit Meldung ohne Geheimnis.
6. **Gemeinsamer Checkout:** `agent-profile.js`, `main.js`, `settings-panel.js`, `launch-context.js` enthalten frische, nicht committete Codex-Arbeit (Memory, Full Access). AP3, AP4 und AP6 erst nach Commit dieses Stands bzw. mit Reservierung beginnen.
7. **`dsh web` und ZCode sind keine reinen Terminal-TUIs.** Im ersten Wurf nur Start im Terminal plus Hinweis auf die URL; eine Einbettung in die Browser-Ansicht ist nicht Teil dieses Pakets.

## 10. Offene Fragen an Joshua

1. **Fremd-Endpunkte bei Claude:** standardmäßig mit **eigenem, isoliertem Claude-Konfigordner** starten? Das ist sicher gegen Anmelde- und Settings-Konflikte, dafür sind Verlauf und Anmeldung getrennt. Die Alternative ist der gemeinsame `~/.claude`. Empfehlung: isoliert.
2. **Installation:** Reicht „anzeigen/kopieren und ohne Enter eintippen“, oder soll ein ausdrücklicher Knopf den Installationsbefehl im Terminal auch ausführen?
3. **Welche Harnesses müssen für die Veröffentlichung echt geprüft sein** (Installation plus echter Lauf)? Vorschlag: claude (+ DeepSeek/Z.ai/Ollama), codex (+ `--oss`), kimi, opencode, dsh. Alle übrigen erscheinen mit Kennzeichnung „unbestätigt“.

Recherchiert wurde nur lesend: Code, Websuche, `command -v` und `--help`. Geändert wurde nichts.

## Quellen

- [DeepSeek: Claude Code](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/), [DeepSeek Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api)
- [Z.ai: Claude Code](https://docs.z.ai/scenario-example/develop-tools/claude), [Z.ai Devpack](https://docs.z.ai/devpack/quick-start)
- [OpenRouter: Claude Code Integration](https://openrouter.ai/docs/guides/guides/claude-code-integration)
- [Ollama Anthropic-Kompatibilität](https://docs.ollama.com/api/anthropic-compatibility), [Classmethod Ollama v0.15](https://dev.classmethod.jp/en/articles/claude-code-ollama-local/)
- [PromptLayer Kimi K3](https://www.promptlayer.com/blog/how-to-use-kimi-k3-moonshot-ai-with-claude-code/), [Kimi Code Getting started](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html)
- [OpenCode CLI](https://opencode.ai/docs/en/cli), [mdskills OpenCode](https://www.mdskills.ai/harnesses/opencode)
- [Codex Custom Providers](https://codex.danielvaughan.com/2026/04/23/codex-cli-custom-model-providers-configuration-guide/), [OpenAI Codex local config](https://developers.openai.com/codex/local-config), [LiteLLM Codex](https://docs.litellm.ai/docs/proxy/client_setup/codex_cli)
- [Gemini CLI Optionen](https://www.mintlify.com/google-gemini/gemini-cli/reference/cli-options)
- [Qwen Code (DataCamp)](https://datacamp.com/tutorial/qwen-code), [morphllm Qwen CLI](https://www.morphllm.com/qwen-cli)
- [Copilot CLI installieren](https://docs.github.com/en/copilot/how-tos/copilot-cli/install-copilot-cli)
- [Crush CLI](https://next-docs.charm.land/crush/cli/)
- [goose Installation](https://goose-docs.ai/docs/getting-started/installation)
- [Aider OpenRouter](https://aider.chat/docs/llms/openrouter.html)
- [Cline CLI Installation](https://docs.cline.bot/cline-cli/installation)
- [Cursor CLI Changelog](https://cursor.com/docs/cli/changelog.md), [innfactory Cursor Agent](https://innfactory.ai/en/ai-harness/cursor-agent/)
- [Amp TypeScript SDK](https://ampcode.com/docs/sdk/typescript)
- [ZCode (eesel)](https://www.eesel.ai/blog/zcode), [AIML API ZCode](https://docs.aimlapi.com/integrations/zcode), [jimmysong ZCode](https://landscape.jimmysong.io/zh/projects/zcode/)
- [DeepSeek Harness Installation (orcarouter)](https://www.orcarouter.ai/blog/how-to-install-deepseek-harness), [Verdent dsh](https://www.verdent.ai/guides/agents/install-deepseek-harness-dsh)