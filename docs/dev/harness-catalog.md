# Harness-Katalog

Der Katalog besteht aus reinem JSON in `src/main/harness-catalog/<id>.json`.
Die verbindlichen Factory- und IPC-Signaturen stehen in
[`ipc-contract.md`, Abschnitt 2](ipc-contract.md). Ein Eintrag erweitert die
Startvorlagen; er installiert kein Programm und führt keinen Installationsbefehl aus.

## Schema 1

```json
{
  "schema": 1,
  "id": "opencode",
  "label": "OpenCode",
  "binary": "opencode",
  "kind": "tui",
  "evidence": "third-party",
  "verifiedWith": "2026-10-17: Rechercheplan; keine aktuelle lokale Prüfung",
  "docsUrl": "https://opencode.ai/docs/en/cli/",
  "install": [{ "method": "script", "display": "curl -fsSL https://opencode.ai/install | bash" }],
  "start": ["opencode"],
  "model": {
    "args": ["-m", "{model}"],
    "format": "provider/model",
    "static": [],
    "query": { "argv": ["opencode", "models"], "parse": "lines" }
  },
  "resume": {
    "last": ["opencode", "--continue"],
    "byId": ["opencode", "--session", "{sessionId}"]
  },
  "prompt": { "args": ["--prompt", "{prompt}"] },
  "endpoints": {},
  "profileInjection": null,
  "supportsHooks": false,
  "accounts": null,
  "detect": { "version": { "argv": ["opencode", "--version"] } }
}
```

Pflichtfelder sind `schema`, `id`, `label`, `binary`, `kind`, `evidence`,
`verifiedWith`, `docsUrl`, `install`, `start`, `endpoints`, `profileInjection`,
`supportsHooks` und `accounts`. `model`, `resume` und `prompt` dürfen fehlen oder
`null` sein. `defaultModel`, `hint`, `webUrl`, `detect` und `fullAccess` sind optional.
Unbekannte Felder werden auf jeder Schemaebene abgewiesen. `builtin` ist ein vom
Loader erzeugtes Lesefeld und gehört nicht in die JSON-Datei.

| Feld | Werte / Bedeutung |
| --- | --- |
| `id` | Kleinbuchstabe, danach Kleinbuchstaben, Ziffern oder Bindestriche; höchstens 64 Zeichen. Dateiname muss der ID entsprechen. |
| `binary` | Einfacher Programmname, höchstens 80 Zeichen; keine Pfade, Leerzeichen, Shellzeichen oder führende Option. |
| `kind` | `tui`, `web` oder `headless`. Web-Harnesses starten im Terminal und zeigen gegebenenfalls eine URL. |
| `evidence` | `local`, `doc`, `third-party` oder `unconfirmed`. Gilt zusammen mit der konkreten Beschreibung in `verifiedWith`. |
| `install` | Höchstens acht Anzeigehinweise mit `method`: `npm`, `brew`, `pip`, `script` oder `manual`. Eine leere Liste bedeutet: kein hinreichend belegter Installationshinweis. |
| `model.format` | `name` oder `provider/model`; `static` ist eine Liste gültiger Modellnamen. |
| `model.query.parse` | `lines`: eine Modell-ID je Ausgabezeile; `ollama` und `openrouter`: fest eingebaute öffentliche HTTP-Quellen. |
| `resume.last`, `resume.byId` | Vollständige argv-Arrays; `byId` enthält `{sessionId}`. |
| `prompt.args` | Anzuhängende Argumente. Bei positionalen Prompts einen belegten Optionsabschluss `--` verwenden. |
| `endpoints` | Nur `anthropic`, `openai`, `ollama`, `deepseek`; je Typ optional `env`, `args`, `secretEnv`. `secretEnv` enthält den Variablennamen, niemals einen Schlüssel. |
| `profileInjection` | `claude-append`, `codex-developer`, `kimi-agent-file` oder `null`; keine frei ausführbare Profilvorlage. |
| `accounts` | `claude`, `codex` oder `null`. |
| `fullAccess` | Ausschließlich bei `codex`: `["--dangerously-bypass-approvals-and-sandbox"]`. |
| `detect.verify` | `argv` plus `pattern`: wörtlicher, von Groß-/Kleinschreibung unabhängiger Teil der Hilfeausgabe; kein regulärer Ausdruck. Für `agent` und `kimi` vorgeschrieben. |
| `detect.version` | Optionales argv-Array für die ausdrückliche Versionsabfrage. |

Alle ausführbaren Vorlagen sind argv-Arrays mit höchstens 64 Elementen.
Bei `start`, `resume.*`, `model.query.argv` und `detect.*.argv` muss das erste
Element genau `binary` sein. Modell- und Erkennungsabfragen enthalten keine
Platzhalter. Umgebungsvariablen haben das Format `[A-Z][A-Z0-9_]*`.
Vorlagen und Anzeigetexte enthalten keine Steuerzeichen. URLs verwenden HTTP(S)
ohne eingebettete Zugangsdaten.

Die vollständige Platzhalterliste lautet:

- `{model}`: Modell-ID nach `^[A-Za-z0-9._:/@\[\]+-]{1,200}$`.
- `{sessionId}`: vorhandene Gesprächs-ID nach derselben engen Regel wie der bestehende Resume-Dienst.
- `{prompt}`: ein einzelner Textwert ohne Steuerzeichen.
- `{baseUrl}`: validierte Anbieteradresse.
- `{opencodeProviderJson}`: vom Startdienst erzeugtes JSON; derzeit verwendet kein mitgelieferter Eintrag diese unbestätigte OpenCode-Anbindung.

Ein nichtleeres `model`-Objekt benötigt `{model}` in `model.args`; ein
`prompt`-Objekt benötigt `{prompt}` in `prompt.args`. Eine leere Argumentliste
oder eine Vorlage, die den übergebenen Wert stillschweigend verliert, ist ungültig.

`expandArgv()` ersetzt Werte innerhalb eines einzelnen argv-Elements. Es zerlegt
keine Strings und erzeugt keine Shellzeile. Der Startdienst quotiert anschließend
jedes Argument. Bei bereits in TOML-Anführungszeichen eingeschlossenen Codex-
Konfigurationswerten muss er den eingesetzten Wert zusätzlich als TOML-Stringinhalt
escapen; Shellquoting allein genügt dafür nicht.

Einträge mit `evidence: "unconfirmed"` haben ausschließlich `start: [binary]`.
Modell, Resume, Prompt, Endpunkte, Profilinjektion, Hooks, Konten und Full Access
sind dafür gesperrt. Damit werden unbestätigte Flags nicht versehentlich benutzt.

Auch ein belegter Eintrag kann `model: null` haben, beispielsweise `dsh`.
Dann darf der Startdienst keinen Modellparameter erfinden: Ein ausdrücklich
angefordertes Modell wird mit verständlicher Fehlermeldung abgewiesen. Die leere
Modellliste ist kein Nachweis für Modellwahl. `HarnessView` bekommt dafür kein
zusätzliches Feld; seine bestehende IPC-Signatur bleibt bestehen.

## Erkennung und Modellabfragen

`createHarnessDetect({ catalog, env, run })` erkennt Programme per `command -v`
in einer Login-Shell. Der Integrator hat am 17.10.2026 in `WORK_IN_PROGRESS.md`
die eng begrenzte Ausnahme von der allgemeinen Shellregel ausdrücklich bestätigt:
`execFile` erhält ausschließlich `/bin/zsh` und genau die Argumente
`['-lc', 'command -v -- "$1"', 'mt-harness-detect', binary]`.
Der Programmname wird als Positionsargument übergeben und niemals in Shellcode
eingesetzt. Der Programmname wird unmittelbar davor erneut gegen die Katalogregel
geprüft. `env.SHELL` verändert diese feste Ausnahme nicht. Die übrigen
Prozessaufrufe verwenden direkt die gefundene Programmdatei mit argv.

`detect()` führt eine benötigte Identitätsprüfung über `--help` durch, aber keine
Versionsabfrage. `version(id)` fragt die Version ausdrücklich ab. Ergebnisse sind
30 Sekunden zwischengespeichert, gleichzeitige Erkennungen werden zusammengefasst.
Nicht gefundene Programme, falsche Identität und Zeitüberschreitungen liefern
`installed: false`; sie werfen keinen Fehler an den Renderer.

`createModelSources({ catalog, endpoints?, run, fetch })` fragt beim Erzeugen oder Auflisten
nichts ab. Erst `models(id, endpointId?)` startet eine Abfrage. CLI-Abfragen laufen
mit direktem argv und maximal fünf Sekunden. HTTP-Abfragen verwenden gespeicherte
Ollama-Profile oder die festen öffentlichen Quellen
`http://127.0.0.1:11434/api/tags` beziehungsweise
`https://openrouter.ai/api/v1/models`, ohne Schlüssel, Cookies oder Weiterleitungen.
Echte Fetch-Antworten werden über `body.getReader()` stückweise gelesen. Schon
während des Lesens wird das Bytebudget von zwei MiB geprüft; bei Überschreitung
werden Reader und Request abgebrochen. Die fünf Sekunden gelten auch für einen
hängenden Body-Read. Nur injizierte Testantworten ohne Reader verwenden `text()`
mit nachträglicher Größenprüfung. Gültige Modell-IDs werden auf höchstens 2000 Modelle begrenzt.
Fehlertexte von Prozessen/HTTP werden nicht weitergereicht; statische Modelle und
ein Hinweis auf freie Modelleingabe bleiben verfügbar.

Der Integrator hat die zusätzliche Factory-Option `endpoints` am 17.10.2026
ausdrücklich bestätigt. Auf einen Klick wird eine gültige opaque Profil-ID mit
`await endpoints.get(endpointId)` als gespeicherte Metadaten aufgelöst; die Modellquelle
fragt keinen Schlüssel ab. Bei Typ `ollama` wird `/api/tags` an der gespeicherten
HTTP(S)-Origin abgefragt, auch bei ausdrücklich gespeicherten LAN-Adressen. URLs
mit Zugangsdaten, Steuerzeichen, Queryparametern oder Fragmenten werden verworfen.
Ein OpenRouter-Profil wird nur bei exakt `https://openrouter.ai` als Origin erkannt
und verwendet immer die feste öffentliche Modell-URL. Unbekannte IDs und andere
Anbieter verwenden die eigene Katalogabfrage beziehungsweise statische Liste.
Eine übergebene URL wird niemals als Endpunkt-ID oder unmittelbares HTTP-Ziel
interpretiert. Metadatenfehler liefern ausschließlich einen bereinigten Fehlerhinweis.

Ohne Endpunkt-Store bleiben die ausdrücklich bekannten Quellselektoren `ollama`
und `openrouter` sowie ein Katalogadapter mit `model.query.parse` verfügbar.
Anbieteradressen, Endpunkt-IDs und Schlüssel werden nicht an OpenRouter gesendet.

Der injizierte Runner hat die Signatur
`run(file, argv, options) -> Promise<{ stdout, stderr?, exitCode?|status?|code? }>`.
Die Module übergeben `timeout`, `maxBuffer` und UTF-8; die Erkennung zusätzlich
`env`. Kein Aufruf setzt `shell: true`. Auch ein injizierter Runner, der den Timeout
ignoriert, wird nach fünf Sekunden als fehlgeschlagen behandelt.

Beim Start aus dem Dock darf die Modellabfrage nicht auf das schmale Electron-
`PATH` angewiesen sein. Der Integrator gibt deshalb einen Runner mit dem gleichen
Login-Environment wie bei der Erkennung und dem erkannten absoluten Programmpfad
an `createModelSources`. Beispiel ohne weitere Shellaufrufe:

```js
const execFileAsync = require('node:util').promisify(require('node:child_process').execFile);
const detect = createHarnessDetect({ catalog, env: loginEnv });
const modelSources = createModelSources({
  catalog,
  endpoints,
  run: async (binary, argv, options) => {
    const entry = catalog.list().find((item) => item.binary === binary);
    const [found] = entry ? await detect.detect(entry.id) : [];
    if (!found?.installed || !found.path) throw new Error('CLI nicht gefunden.');
    return execFileAsync(found.path, argv, { ...options, env: loginEnv });
  },
});
```

`loginEnv` stammt aus dem bestehenden Login-Shell-/Terminal-Environment der App.
Ein erfolgreicher `command -v` in einem Kindprozess verändert nicht automatisch
das `PATH` des Electron-Hauptprozesses. Ohne Adapter bleibt der Standardrunner
für direkte Node-Nutzung verfügbar, belegt aber keine Dock-Integration.

## Eigene Einträge und Beiträge

1. Einen ähnlichen Eintrag kopieren und die ID sowie den Dateinamen ändern.
2. Flags anhand der offiziellen Dokumentation und möglichst `--help` prüfen.
   Datum, Version, Befehl und Prüfgrenze in `verifiedWith` festhalten. Ein
   erfolgreicher Konfigurationsparser belegt keinen echten Anbieteraufruf.
3. Unklare Fähigkeiten weglassen. Bei unbestätigtem Programm nur `[binary]`
   anbieten. Installationshinweise werden ausschließlich angezeigt/kopiert oder
   ohne Enter in ein Terminal eingegeben.
4. `node --test tests/harness-catalog.test.js tests/harness-detect.test.js tests/model-sources.test.js`
   ausführen. Der erste Test validiert jede mitgelieferte JSON-Datei und dient
   als CI-Schutz für Beiträge. Für neue Programme Anzahl und Verhalten gezielt
   ergänzen; keine kostenpflichtigen Agentenaufträge als Test ausführen.
5. PR mit Quelle, tatsächlicher Prüfung und verbleibenden Unsicherheiten öffnen.

Eigene Einträge speichert der Loader in `<dataDir>/harnesses.json` als
`{ "version": 1, "harnesses": [...] }`, atomar mit Modus 0600. Höchstens 100 eigene
Einträge und eine MiB Dateigröße sind erlaubt. Mitgelieferte IDs können nicht
überschrieben oder entfernt werden. Defekte/ungültige Dateien werden mit einer
verständlichen Fehlermeldung abgewiesen und unverändert erhalten.

Claude und Kimi zeigen die offiziellen Installerskript-Adressen aus dem vorhandenen
Rechercheplan; dsh zeigt den in lokalen Paketmetadaten bestätigten npm-Namen.
Diese Hinweise wurden nicht ausgeführt. Programme ohne belegten Installationsbefehl
zeigen stattdessen einen manuellen Link zur Dokumentation. Ein lokal vorhandenes
Binary belegt allein keinen Installationsbefehl.

## Prüfstand vom 17.10.2026

- Claude Code 2.1.302, codex-cli 0.163.0, Kimi 2.1.1: lokale Hilfe vom Hauptagenten
  geprüft. Bestehende Profil-/Memory-/Resume-Schnellstarts bleiben Sache der
  gesonderten Golden-Tests des Startdienstes.
- Codex: `wire_api="responses"`, Providername, `base_url` und `env_key` wurden mit
  `codex ... features list` am lokalen Konfigurationsparser geprüft. Kein Modell
  wurde aufgerufen. Das lokale Binary nennt `wire_api="chat"` nicht mehr unterstützt.
- dsh 0.1.0-rc.7: lokale Hilfe bestätigt `web`. Kein Webdienst und kein Auftrag
  wurden gestartet. Modell-/Resume-Flags bleiben aus dem Katalog heraus.
- OpenCode: lokal nicht installiert. Der aktuelle Dokumentabruf war wegen des
  lokalen Browserstarts blockiert. Die konservative Langform `--session` und
  weitere Flags stammen aus dem vorhandenen Rechercheplan und bleiben ausdrücklich
  `third-party`; keine lokale OpenCode-Prüfung und kein Provider-JSON behauptet.
- Weitere unsichere Programme starten ohne Zusatzflags. Installationen, echte
  Anmeldungen, Schlüsselbundabfragen und bezahlte Endpunkttests sind hier nicht
  erfolgt; diese Prüfung ist keine produktive Anbieterabnahme.

## Startdienst und bestehende Schnittstellen

`createHarnessLaunch({ catalog, endpoints, keychain, agentProfile, memoryLaunch,
dataDir }).build({ harnessId, model?, endpointId?, prompt?, resume?, fullAccess? })`
ist asynchron und liefert `{ command, env, provider, label }`. `env` enthält nur
öffentliche Konfiguration. Der Schlüsselwert wird weder gelesen noch zurückgegeben.
Der Befehl bleibt einzeilig und höchstens 2000 Zeichen lang. Ungültige Modelle,
nicht belegte Fähigkeiten und unbekannte Endpunkte erzeugen deutsche Fehler.
Unbestätigte Einträge starten unabhängig von optionalen Modell-/Resume-/Prompt-
Wünschen nur ihre nackte Binary; deshalb muss die Oberfläche diese Wünsche dort
ausblenden. Dsh und ZCode erhalten keine Browser-Einbettung.

Für gespeicherte Schlüssel wird ein fest erzeugter Subshell-Block verwendet:
`(set +x; VAR="$(/usr/bin/security find-generic-password … -w)" && [ -n "$VAR" ] …)`.
Die tatsächliche Zeile bricht bei nicht erfolgreichem oder leerem Lookup sichtbar
ab, exportiert die Variable nur im Unterprozess und deaktiviert dort vorher
Shell-Tracing. Keine persistierte Startzeile, kein Klartext im zurückgegebenen
`env`. Der Schlüsselbunddienst ist `de.multiterminal.endpoint`.

Claude-Endpunkte erhalten standardmäßig einen eigenen privaten Ordner
`<dataDir>/endpoint-configs/claude/<endpointId>`, ohne verlinkte `settings.json`.
Wrapper-Hooks bleiben über den weiterhin aufgerufenen `claude`-Befehl erhalten.
Eigene Einträge mit `binary: "claude"` und `profileInjection: "claude-append"`
verwenden denselben Adapter. Bei isoliertem Endpunkt muss der Integrator die
Kontowahl ausblenden und Account-Env/Account-Metadaten für Claude überspringen.
Codex-OpenAI-Endpunkte verwenden TOML-gequotete `model_providers.mt.*` inklusive
`wire_api="responses"`. Codex mit Ollama unterstützt derzeit ausschließlich
`http://127.0.0.1:11434` beziehungsweise `http://localhost:11434`; andere Adressen
werden explizit abgewiesen, bis die CLI-Konfiguration hierfür belegt ist.

Die vier vorhandenen Module besitzen additive Schnittstellen:

- `agentProfile.argsFor(provider, { resume })` liefert rohe argv-Daten nur für
  das persönliche Profil, ohne automatisch Full Access hinzuzufügen. Die bisherigen
  `decorate`/`decorateCommand`/`builtinLine` bleiben unverändert im Verhalten.
- `memoryLaunch.contextArgs({ harnessId, resume, projectId })` liefert rohe argv:
  normalerweise `[Memory-Dateihinweis]`, Kimi-Neustart `['--agent-file', datei]`,
  Codex `resume: 'last'` `['-c', 'developer_instructions=…']`, sonst gegebenenfalls
  `[]`. Native Kimi-Resumes erhalten keinen Zusatz. Der Startdienst benutzt für
  bisherige Starts ohne expliziten Prompt direkt den alten Memory-Dekorator.
  `writePrivate(dataDir, suffix, text)` ist auch als Modulexport verfügbar.
- `resumeFromCatalog(entry, sessionId)` liefert `{ argv, line }` oder `null` und
  verwendet dieselbe ID-Validierung wie das bisherige `buildResume`.
- `linkShared(provider, target, { homeDir?, isolateClaudeConfig? })` ist als
  Modulexport und über den Account-Store verfügbar; die bisherige Kontenanlage
  behält ihr Verhalten. Bei Isolation wird `settings.json` ausgelassen.

Die 108 Golden-Kombinationen prüfen Claude/Codex/Kimi über Profil an/aus,
Memory an/aus, Neustart/letztes/exaktes Gespräch und Full Access
`undefined`/`false`/`true`. Die bisher eingebauten Codex-Starts behalten dabei
ihren obligatorischen Full Access auch bei `false`, wie vor der Katalogänderung.

## Integrationsanleitung für Etappe 3

Diese Änderungen gehören dem Integrator und sind in diesem Branch bewusst nicht
implementiert. Nur dieser Abschnitt beschreibt die erforderliche Verdrahtung.

In `main.js` beim Initialisieren der Dienste Katalog, Erkennung, Modellquellen,
Schlüsselbund und Endpunkt-Store anlegen. Die Herkunftsprüfung aller IPC-Kanäle
läuft durch das vorhandene `handle`. `harness:list` bildet die Rohdatensätze auf
den vertraglichen `HarnessView` ab: `canPrompt` aus `entry.prompt`, `canResume`
aus `entry.resume`, `endpointTypes` aus `Object.keys(entry.endpoints)`; Erkennung
zusammenführen, keine automatischen Modell- oder Versionsabfragen.

```js
const keychain = createKeychain({});
const endpoints = createEndpointStore({
  file: path.join(dataDir, 'endpoints.json'), keychain,
});
const catalog = createHarnessCatalog({
  userFile: path.join(dataDir, 'harnesses.json'),
});
const detected = createHarnessDetect({ catalog, env: loginEnv });
const modelSources = createModelSources({ catalog, endpoints, run });
handle('harness:models', (id, endpointId) => modelSources.models(id, endpointId));
handle('harness:detect', async id => {
  const rows = await detected.detect(id);
  if (id !== undefined && rows[0]?.installed) rows[0].version = await detected.version(id);
  return rows;
});
handle('endpoints:save', (profile, secret) => endpoints.save(profile, secret));
```

`run` verwendet die weiter oben gezeigte absolute Programmerkennung und Login-
Umgebung. `harness:typeInstall` wählt ausschließlich einen Anzeigeeintrag aus
dem validierten Katalog und tippt dessen `display` unverändert mit `ptys.write`
ein; niemals `runBuiltin`, Enter, CR oder LF ergänzen. Manuelle Doku-Links nicht
als Terminalbefehl behandeln. Import/Export und übrige Endpunktkanäle werden direkt
auf die entsprechenden Dienstmethoden abgebildet. `preload.js` spiegelt exakt die
Signaturen aus `ipc-contract.md` über `ipcRenderer.invoke`.

In `terminals:create` vor Tokens/PTY-Erzeugung optionales `launch` validieren,
gespeicherten Projekt-/Worktree-Ordner wie bisher auflösen und dann genau einmal
den Startdienst aufrufen. Projektbindung erfolgt ohne neues IPC-Feld:

```js
const scopedMemory = {
  decorateCommand: options => memoryLaunch.decorateCommand({ ...options, projectId: project.id }),
  contextArgs: options => memoryLaunch.contextArgs({ ...options, projectId: project.id }),
};
const built = await createHarnessLaunch({
  catalog, endpoints, keychain, agentProfile, memoryLaunch: scopedMemory, dataDir,
}).build(options.launch);
// launchCommand = built.command; meta.provider = built.provider;
// Öffentliche Konfiguration steckt bereits in command und ist zusätzlich env.
```

Der alte `!options.launch`-Pfad bleibt unverändert. Den neu erzeugten Befehl nicht
erneut dekorieren. `prompt`/`resume` kommen nur aus den dafür autorisierten
Start-/Resume-Aktionen, nicht aus ungeprüften gespeicherten Terminalbefehlen.
Bei isoliertem Claude-Endpunkt keine Kontowahl anwenden und keine fremde
Kontozuordnung in `meta` speichern. Schlüssel niemals als PTY-`extraEnv` laden.

`presets.js` akzeptiert zusätzlich validierte optionale Felder `harnessId`,
`model`, `endpointId`; die drei eingebauten Presets bleiben bytegleich.
`session-store.js` übernimmt ausschließlich diese drei `launch`-Felder per
Whitelist, keine `command`-Zeile, kein `env`, `secret`, Prompt oder Keychain-
Lookup. Ein ungültiges gespeichertes `launch` darf nicht zu einem stillen
Anbieterwechsel führen: betroffene Kachel sichtbar ohne Agentstart öffnen.
Beim Resume aus dem gespeicherten `launch` und einer belegten Gesprächs-ID bzw.
`resume: 'last'` den Befehl neu bauen; nie fertige Startzeilen speichern.

In `launch-context.js` die feste Providerliste durch Katalogeinträge mit
`prompt.args` ersetzen; Kimi bleibt ausgeschlossen. Private Auftragsdatei,
Vorschauidentität und Commit-/CWD-Abgleich bleiben. Nach deren Prüfung den kurzen
Dateihinweis als `prompt` an `build` geben; Memory und Auftrag werden so zu genau
einem Prompt verbunden. Rückgabe zusätzlich mit dem unverfänglichen `launch`
versehen. `agent-launch.js` lädt diese Fähigkeiten dynamisch und gibt Modell und
Endpunkt in der Vorschau/Startanforderung weiter; Direktstarts bleiben erhalten.

`settings-panel.js` hängt `DeckHarnessPanel.create({ document, api, h, notify,
guard })` als appweiten Bereich ein und ruft `render()` beim Öffnen auf.
`index.html` lädt `harness-panel.js` und `harness.css`. Die Events
`harness:quickstart` und `harness:install-terminal` sind oben im Panelmodul
dokumentiert: Event per `preventDefault` quittieren, validiertes Preset speichern
beziehungsweise ein Projektterminal anlegen und `detail.acceptTerminal(id)`
aufrufen. `app.js` reicht `launch` bei Schnellstart/Fortsetzen an Main und nutzt
den bestehenden bestätigten Kontextstartweg. Keine Doppelstarts erzeugen.
`terminal-pane.js` erhält den Chip über den vereinbarten Slot
`setLaunchInfo({ harnessLabel, model, endpointLabel })` bzw. `null`.

Erst nach diesem Einbau `scripts/qa-harness.js` mit nativem Electron ausführen.
Das Skript verwendet isolierte Fake-CLIs/Fake-security, einen RAM-Schlüsselbund
und zwei App-Prozesse für Neustart/Fortsetzen. Es wurde in diesem Auftrag nur
geschrieben und syntaktisch geprüft. Reale Schlüsselbund-ACLs, bezahlte Anbieter,
Paket-/Installationsstand und sichtbare Nutzerabnahme sind separate Nachweise.
