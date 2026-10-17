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
  und in allen `qa-*`-Skripten). Die Reports nennen den Prozess als Kind der
  Multiterminal-Koalition (`de.joshua.multiterminal`), also eines Agentenstarts.
- Gegenprobe in dieser Sitzung (normale Aqua-Sitzung, `launchctl managername` = `Aqua`,
  nicht eingeschraenkt): `electron --version` -> `v44.7.0`; minimale Probe-App meldet
  `READY`; `node_modules/.bin/electron scripts/qa-topbar.js` -> alle PASS, `status: passed`.
- Nachstellung: Unter `sandbox-exec` mit gesperrtem `mach-lookup` auf
  `com.apple.windowserver.active` scheitert Electron mit `Failed to initialize sandbox`,
  GPU-Prozess Exit 6, `SIGTRAP`; mit `--no-sandbox --disable-gpu` haengt es stattdessen
  (kein Fenster-Server). Das entspricht den gemeldeten Symptomen.
- gstack-Chromium `sandbox_parameters_mac.mm:67` / `Input/output error (5)`: Chromium
  versucht seine eigene Seatbelt-Sandbox zu setzen; innerhalb einer bereits aktiven
  Sandbox (verschachteltes `sandbox_init`) ist das verboten. Gleiche Wurzel; auch
  "Full Access" des Agenten hebt das nicht immer auf, weil der Kindprozess weiter im
  Sandbox-/Koalitionskontext des Agenten startet.
- Binary ist unauffaellig: Ad-hoc-signiert (Standard bei npm-electron), nur
  `com.apple.provenance` als xattr, keine Quarantaene. `codesign --verify --deep` meldet
  "code has no resources" - bei npm-Electron normal und nicht die Ursache. Keine
  `ELECTRON_RUN_AS_NODE`-Variable gesetzt.

## Betrifft nur die Agent-Umgebung?

Ja. Die installierte App und manuelle Starts sind nicht betroffen. Nur Prozesse, die von
einem sandboxed Agenten (Codex-Shell ohne GUI-Zugriff) gestartet werden, brechen ab.

## Abhilfe

1. Native QA aus **Terminal.app / iTerm in der eigenen Login-Sitzung** starten, nicht aus
   der Agent-Shell: `node scripts/qa-env-check.js && node_modules/.bin/electron scripts/qa-topbar.js`
   (analog fuer `qa-memory`, `qa-settings`, `qa-hotkeys`, ...).
2. Alternativ den Agenten mit echter Ausfuehrung ausserhalb der Sandbox starten (Codex:
   Befehl mit "ausserhalb der Sandbox" bestaetigen; Claude Code: Befehl ohne Sandbox).
   Pruefen mit `node scripts/qa-env-check.js` (Exit 0 = geht, 2 = Sandbox).
3. `--no-sandbox` ist **kein** Fix (haengt ohne WindowServer) und sollte nicht in
   Produktskripte.

`scripts/qa-env-check.js` startet eine minimale Electron-Probe und liefert Exit 0/2/1;
es ist ein Vorab-Check, um bei Sandbox-Abbruechen sofort die richtige Meldung zu geben.
