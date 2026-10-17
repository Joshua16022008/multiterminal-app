# Befund S2: Electron-QA bricht mit SIGABRT ab

Stand 17.10.2026, macOS 15.5 (24F74), Electron 44.7.0 (arm64).

## Ergebnis

Die Ursache liegt **nicht im Projekt und nicht im Electron-Binary**, sondern in der
**Agent-/Codex-Sandbox**: Dort hat der Prozess keinen Zugriff auf den macOS-WindowServer
bzw. darf keine eigene Seatbelt-Sandbox mehr installieren. Dieselben Binaries laufen in
einer normalen Aqua-Sitzung fehlerfrei.

## Belege

- Crash-Reports `~/Library/Logs/DiagnosticReports/Electron-2026-10-13/-14/-16*.ips`:
  `EXC_CRASH / SIGABRT`, Stack identisch:
  `NSApplication sharedApplication` -> `_NSInitializeAppContext` ->
  `_NSGetAggregateUIMode` -> `GetCurrentProcess` -> `HIServices _RegisterApplication` -> `abort()`.
  `_RegisterApplication` bricht ab, wenn die Verbindung zum WindowServer/LaunchServices
  fehlt. Das passiert vor jedem Produktcode (daher auch bei `--version`-nahen Starts
  und in allen `qa-*`-Skripten). Die Reports nennen als `responsibleProc` Multiterminal
  (`de.joshua.multiterminal`). Das ist nur ein Hinweis, dass der Start aus einem
  Multiterminal-Terminal kam; es belegt für sich allein keine Seatbelt-Sandbox.
- Gegenprobe in dieser Sitzung (normale Aqua-Sitzung, `launchctl managername` = `Aqua`,
  nicht eingeschränkt): `electron --version` -> `v44.7.0`; minimale Probe-App meldet
  `READY`; `node_modules/.bin/electron scripts/qa-topbar.js` -> alle PASS, `status: passed`.
- Nachstellung: Unter `sandbox-exec` mit gesperrtem `mach-lookup` auf
  `com.apple.windowserver.active` scheitert Electron mit `Failed to initialize sandbox`,
  GPU-Prozess Exit 6, `SIGTRAP`; mit `--no-sandbox --disable-gpu` hängt es stattdessen
  (kein Fenster-Server). Das entspricht den gemeldeten Symptomen.
- **Nicht verifiziert / Analogie:** gstack-Chromium `sandbox_parameters_mac.mm:67` /
  `Input/output error (5)` wurde hier nicht selbst gestartet. Plausible Deutung: Chromium
  setzt seine eigene Seatbelt-Sandbox, was innerhalb einer bereits aktiven Sandbox
  (verschachteltes `sandbox_init`) verboten ist. Das wäre dieselbe Wurzel, ist aber nur
  eine Vermutung aus der Ähnlichkeit der Symptome.
- Binary ist unauffällig: Ad-hoc-signiert (Standard bei npm-electron), nur
  `com.apple.provenance` als xattr, keine Quarantäne. `codesign --verify --deep` meldet
  "code has no resources" - bei npm-Electron normal und nicht die Ursache. Keine
  `ELECTRON_RUN_AS_NODE`-Variable gesetzt.

## Betrifft nur die Agent-Umgebung?

Nach aktuellem Wissensstand ja: Die Gegenprobe (normale Aqua-Sitzung) lief fehlerfrei.
Die installierte App wurde **nicht** gestartet; dass sie nicht betroffen ist, ist
**nicht verifiziert**, sondern eine Folgerung aus der Ursache. Betroffen sind
vermutlich nur Prozesse, die aus einem Agenten ohne GUI-Zugriff gestartet werden.

## Abhilfe

1. Native QA aus **Terminal.app / iTerm in der eigenen Login-Sitzung** starten, nicht aus
   der Agent-Shell: `node scripts/qa-env-check.js && node_modules/.bin/electron scripts/qa-topbar.js`
   (analog für `qa-memory`, `qa-settings`, `qa-hotkeys`, ...).
2. Alternativ den Agenten mit echter Ausführung außerhalb der Sandbox starten (Codex:
   Befehl mit "außerhalb der Sandbox" bestätigen; Claude Code: Befehl ohne Sandbox).
   Prüfen mit `node scripts/qa-env-check.js` (Exit 0 = geht, 2 = Sandbox, 1 = anderer Fehler, 3 = kein macOS).
3. `--no-sandbox` ist **kein** Fix (hängt ohne WindowServer) und sollte nicht in
   Produktskripte.

`scripts/qa-env-check.js` startet eine minimale Electron-Probe und liefert Exit 0/2/1/3
(3 = nicht macOS, bewusst nicht 0, damit `&&`-Ketten das nicht als „QA möglich“ lesen;
ein Timeout wird als „möglicherweise Sandbox“ gemeldet, Dauer per `QA_ENV_TIMEOUT_MS`
einstellbar, Standard 30 s). Ein npm-Script `qa:env` gibt es nicht; der Check wird direkt
mit `node scripts/qa-env-check.js` aufgerufen (der Integrator kann `qa:env` separat ergänzen).
Er ist ein Vorab-Check, um bei Sandbox-Abbrüchen sofort die richtige Meldung zu geben.
