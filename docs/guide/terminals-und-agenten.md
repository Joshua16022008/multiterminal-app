---
title: Terminals und Agenten
order: 30
keywords: terminal, agent, schnellstart, preset, claude, codex, kimi, fortsetzen, resume, status, wartet, arbeitet, kontextstart
---

# Terminals und Agenten

Jede Kachel ist ein echtes Terminal. Es läuft in deiner Login-Shell (aus der Umgebungsvariable `SHELL`, sonst `zsh`), deshalb gelten dein gewohnter `PATH` und deine Shell-Einstellungen. Agenten sind einfach Programme, die in so einem Terminal laufen.

## Neues Terminal

- „+“ in der Kopfleiste oder ⌘T öffnet ein normales Terminal im Projektordner.
- „▾“ daneben öffnet das Menü mit Schnellstarts und weiteren Einträgen.

Pro Projekt sind bis zu 30 Terminals möglich.

## Schnellstarts

Ein Schnellstart ist ein Befehl, der in einem neuen Terminal automatisch getippt und ausgeführt wird. Eingebaut sind drei:

| Name | Startbefehl | Fortsetzen-Befehl |
|---|---|---|
| Claude Code | `claude` | `claude --continue` |
| Codex | `codex` | `codex resume --last` |
| Kimi Code | `kimi` | `kimi --continue` |

Diese Programme musst du selbst installieren (siehe [Erste Schritte](erste-schritte.md#voraussetzungen)).

### Eigene Schnellstarts

Im Menü „▾“ wähle „Eigenen Befehl hinzufügen…“ und gib an:

- **Name**: so erscheint der Eintrag im Menü und als Kacheltitel,
- **Befehl**: was im Terminal ausgeführt wird,
- **Fortsetzen-Befehl** (optional): was der Fortsetzen-Knopf ausführt.

Eigene Einträge haben im Menü ein „✕“ zum Entfernen. Die drei eingebauten lassen sich nicht entfernen.

## Fortsetzen

Wenn du die App schließt und wieder öffnest, kommen deine Kacheln zurück: mit dem alten Verlauf (abgedunkelt, darunter die Zeile „wiederhergestellt“). Ein Agent läuft dann nicht mehr. Im Kachelkopf erscheint ein Knopf, der ihn wieder aufnimmt:

- **Fortsetzen**: Die App kennt das Gespräch dieser Kachel genau und setzt genau dieses fort.
- **Fortsetzen: letztes Gespräch**: Es gibt keine feste Zuordnung. Der Fortsetzen-Befehl des Anbieters nimmt das zuletzt geänderte Gespräch in diesem Ordner. Der Mauszeiger über dem Knopf nennt den Grund und den Befehl.
- **Neu starten: Name**: Für diesen Schnellstart gibt es keinen Fortsetzen-Befehl. Der Knopf startet den normalen Befehl neu.

Wenn ein Terminalprozess endet, zeigt die Kachel unten „beendet“ mit dem Knopf „Neu starten“.

## Agentenstatus

Die App kann für Claude Code anzeigen, was der Agent gerade tut. Dafür trägt sie Status-Hooks in neu gestartete Claude-Sitzungen ein. Deine eigenen Claude-Einstellungen bleiben dabei unverändert. Für Codex wird der Status noch nicht unterstützt.

Einschalten: Panel „Rückmeldungen“ (⌘⇧J) und dort „Agentenstatus anzeigen (Claude)“, oder im Panel „Komfort“ (⌘⇧K) „Agentenstatus empfangen“. Der Status wirkt erst bei Sitzungen, die danach neu gestartet werden. Beende laufende Sitzungen einmal mit `/exit` und setze sie fort.

Die Zustände:

| Anzeige | Bedeutung |
|---|---|
| arbeitet | Der Agent bearbeitet gerade eine Anfrage. |
| wartet auf dich | Er fragt nach einer Freigabe oder Eingabe, ist mit einem Fehler stehen geblieben oder hat eine fertige Antwort, die du noch nicht gesehen hast. |
| Antwort fertig | Die Antwort ist fertig. |
| Fehler | Der Agent meldet einen Fehler, zum Beispiel ein Limit oder ein Anmeldeproblem. |
| inaktiv | Der Agent ist bereit, und du hast die letzte Antwort gesehen. |

Wo du den Status siehst:

- als Punkt und farbige Markierung im Kachelkopf,
- als Markierung der Projektzeile in der Seitenleiste mit einer Zusammenfassung wie „1 wartet auf dich · 2 arbeiten“,
- im Panel „Rückmeldungen“ als Liste. Ein Klick springt zur Kachel, „Alle gelesen“ löscht die Markierung „ungelesen“.

⌘J springt zur nächsten Rückmeldung. Im Panel lassen sich außerdem eine Desktopmeldung und ein Ton einschalten. Die Markierungen und Animationen stellst du im Panel „Komfort“ einzeln ein. Wie die Kacheln danach sortiert werden, steht unter [Oberfläche](oberflaeche.md#aktivität-und-sortierung).

Eine Anzeige „Status unbekannt“ heißt: Die App hat kein Signal erhalten. Sie wertet Schweigen nie als „fertig“.

## Agent mit Kontext starten

Im Menü „▾“ gibt es „Agent mit Kontext starten…“. Der Dialog bereitet einen Auftrag vor, bevor der Agent loslegt. Er unterstützt Claude Code und Codex. Kimi startest du über den normalen Schnellstart.

1. Wähle den **Anbieter** und den **Arbeitsordner**: „Neue Arbeitskopie für diese Aufgabe“ (mit neuem Branch und optionaler Ausgangsbasis), „Projektordner verwenden“ oder „Vorhandene Arbeitskopie verwenden“. Was Arbeitskopien sind, steht unter [Worktrees](worktrees.md).
2. Beschreibe die **Aufgabe** (Pflichtfeld). Optional: **Erlaubte Dateien und Grenzen** und **Woran erkennst du das Ergebnis?**
3. „Kontext vorbereiten“ baut den Auftragstext und zeigt ihn zur Kontrolle. Er enthält Aufgabe, Umfang, Abnahmekriterien, den Git-Zustand (Branch, ungesicherte Änderungen), Auszüge aus vorhandenen Projektdateien wie `AGENTS.md`, `CLAUDE.md`, `README.md`, `PROJECT_STATUS.md`, `PLAN.md` und `PROGRESS.md`, bei eingeschaltetem [Memory](memory.md) auch dessen Inhalt. Hinweise und Warnungen stehen im Dialog. Den Text kannst du noch bearbeiten.
4. „Agent starten“ öffnet eine neue Kachel und startet den Agenten mit diesem Auftrag. „Zurück“ geht einen Schritt zurück.

Gestartet wird erst nach deinem Klick auf „Agent starten“.
