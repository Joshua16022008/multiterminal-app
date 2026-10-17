---
title: App aktualisieren
order: 140
keywords: update, aktualisieren, version, installieren, paket, prüfsumme, build
---

# App aktualisieren

Multiterminal aktualisiert sich nicht von selbst aus dem Internet. Du baust eine neue Version selbst und installierst sie dann auf einem von zwei Wegen.

## 1. Neu bauen und ersetzen

Der einfachste Weg, vor allem solange du die App aus dem Quellcode benutzt:

1. Hole den neuen Stand des Quellcodes und führe `npm install` aus.
2. Baue die App mit `npm run build`. Das Ergebnis liegt in `dist/Multiterminal-darwin-arm64/Multiterminal.app` (auf Intel-Macs entsprechend anders).
3. Beende die laufende App mit ⌘Q. Dabei werden alle Terminals beendet.
4. Ersetze die installierte App, zum Beispiel mit:

```bash
ditto "dist/Multiterminal-darwin-arm64/Multiterminal.app" /Applications/Multiterminal.app
```

## 2. Aus der laufenden App: „App aktualisieren…“

Das geht nur in der installierten, gebauten App, nicht bei `npm start`. Sonst sagt die App: „App-Updates sind nur in der installierten macOS-App verfügbar.“

Du öffnest die Funktion im [Projektmanager](projektmanager.md)-Fenster über „App aktualisieren…“. Das Update gilt für die gesamte App und alle Projekte.

1. Klicke auf „Paket auswählen…“ und wähle einen **Ordner mit einem vorbereiteten Update-Paket**. Ein Paket ist ein Ordner, der zwei Dinge enthält: die gebaute `Multiterminal.app` und die Datei `CHECKSUMS.sha256`.
2. Die App prüft das Paket gründlich: Jede Datei der App muss in der Prüfsummenliste stehen und ihre SHA-256-Prüfsumme muss stimmen. Außerdem prüft sie App-Kennung und Version und lehnt Pakete ab, die sich mit der installierten App überlappen oder auf Dateien außerhalb der App zeigen. Bei Erfolg zeigt das Fenster installierte Version, neue Version, Paket und Ziel.
3. Klicke auf „Installieren…“. Ein Systemdialog fragt noch einmal nach („Installieren und neu starten“). Erst danach passiert etwas.
4. Die App beendet **alle Terminals und alle Manager-Agenten**, ersetzt sich durch die neue Version und startet neu. Das Ergebnis des letzten Updates zeigt das Fenster an.

Wird das Paket zwischen Auswahl und Installation verändert, bricht die App ab.

### Update-Paket vorbereiten

Nach `npm run build` legst du einen Ordner an, kopierst die gebaute `Multiterminal.app` hinein und erzeugst die Prüfsummenliste. Das Format ist je Zeile die SHA-256-Summe, zwei Leerzeichen und der Pfad relativ zum Paketordner. Beispiel im Paketordner:

```bash
find Multiterminal.app -type f -print0 | xargs -0 shasum -a 256 > CHECKSUMS.sha256
```

Symbolische Links innerhalb der App gehören nicht in die Liste, `-type f` lässt sie weg. Zeigt ein Link aus der App hinaus, lehnt die App das Paket ab.

## Welche Version läuft?

Die installierte Version steht im App-Menü unter „Über Multiterminal“. „App aktualisieren…“ zeigt sie nach der Paketauswahl als „Installierte Version“ neben der neuen Version.
