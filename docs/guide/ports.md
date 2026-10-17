---
title: Ports
order: 70
keywords: ports, devserver, localhost, tcp, lauschen, prozess
---

# Ports

Wenn mehrere Agenten gleichzeitig Devserver starten, verliert man schnell den Überblick, welcher Prozess welchen Port belegt. Das Panel „Devserver & Ports“ zeigt es dir.

## Öffnen

Mit ⌘⇧P oder über „☰ Menü → Ports“. Das Panel liest die lokal lauschenden TCP-Ports und aktualisiert sich alle 3 Sekunden, solange es offen ist. „⟳“ liest sofort neu. Die Zeile „Stand“ nennt die Uhrzeit der letzten Messung.

Das Panel liest nur. Es beendet keine Prozesse.

## Was ein Eintrag zeigt

- die Portnummer, den Prozessnamen und die Prozess-ID (PID),
- die Adresse, auf der der Port lauscht,
- die Kachel, in der der Prozess läuft, und den Arbeitsordner. Einträge mit Kachel stehen oben, danach folgen die übrigen Ports nach Nummer sortiert.
- „Nicht zugeordnet“, wenn die App den Prozess keiner laufenden Kachel zuordnen kann. Dann sind beide Aktionen gesperrt.

## Aktionen

| Knopf | Wirkung |
|---|---|
| Zum Terminal | springt zur zugeordneten Kachel |
| HTTP im Browser | öffnet die Adresse im [Mini-Browser](mini-browser.md) dieser Kachel |

Ein offener Port belegt nicht automatisch einen Webserver. „HTTP im Browser“ probiert die Adresse nur aus. Ist die Zuordnung zwischenzeitlich veraltet, bittet die App dich, das Panel zu aktualisieren.
