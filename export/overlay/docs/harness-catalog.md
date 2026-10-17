# Harness-Katalog

Der Katalog besteht aus reinem JSON in `src/main/harness-catalog/<id>.json`.
Ein Eintrag erweitert die Startvorlagen; er installiert kein Programm und führt keinen Installationsbefehl aus.

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

## Beiträge prüfen

Einträge liegen in `src/main/harness-catalog/<id>.json`. Prüfe die angegebenen
CLI-Argumente gegen die tatsächliche Programmversion und dokumentiere diese in
`verifiedWith`. Eine Quellenangabe ersetzt keine lokale Prüfung. Bei nicht
geprüften Fähigkeiten die konservativen `unconfirmed`-Grenzen verwenden.

```bash
node --test tests/harness-catalog.test.js
npm test
```

Endpunkte und Schlüssel sind getrennt: Profile enthalten nur Metadaten, Schlüssel
liegen im macOS-Schlüsselbund. Ein Katalogeintrag enthält niemals einen Schlüssel.
Die App führt Installationshinweise nicht selbst aus; sie übergibt den ausgewählten
Text in ein Terminal, wo der Nutzer ihn prüfen kann.

Erkennung, Modellabfragen und Starts sind im [Benutzerhandbuch](guide/harnesses-modelle.md)
erklärt. Die genaue Validierung liegt in `src/main/harness-catalog.js`, der
Startadapter in `src/main/harness-launch.js`. Änderungen müssen beide berücksichtigen.
