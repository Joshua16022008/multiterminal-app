---
title: Memory
order: 90
keywords: memory, gedächtnis, notizen, checkpoint, kontext, mt-memory, projektstand
---

# Memory

Das Memory ist ein lokaler Notizspeicher, den alle Agenten eines Projekts teilen. Er hilft, wenn ein Agent dort weitermachen soll, wo ein anderer aufgehört hat, auch bei einem anderen Anbieter. Das Memory setzt keine Unterhaltung eines Anbieters in einem anderen fort. Es gibt nur Notizen und Stände weiter.

Alle Daten bleiben auf deinem Mac.

## Wo du es findest

„Einstellungen“ in der Seitenleiste, dann der Bereich „Memory“. Er gilt für die gesamte App.

## Bausteine

- **Gemeinsames Memory**: Notizen für alle Projekte und alle Anbieter.
- **Projekt-Memory**: Notizen für das aktive Projekt. Alle [Arbeitskopien](worktrees.md) eines Projekts teilen sich dieses Memory.
- **Checkpoints**: kurze Stände mit Ziel, Zusammenfassung, Entscheidungen, offenen Fragen, nächstem Schritt und Dateien. Sie entstehen auf zwei Wegen: ein Agent legt sie ausdrücklich an, oder die App sichert automatisch einen Auszug der Terminalausgabe. Zu jedem Checkpoint zeigt die Ansicht die Quelle, den Startanbieter, den Startordner und die Arbeitskopie.

Die Notizen kannst du im Bereich selbst bearbeiten: speichern (auch mit ⌘S im Editor), neu laden oder leeren.

## Schalter

| Schalter | Wirkung |
|---|---|
| Memory bei Agentenstarts laden | Beim Start eines Claude-, Codex- oder Kimi-Agenten aus der App wird der gespeicherte Kontext mitgegeben, dazu ein kurzer Hinweis, wie man Checkpoints sichert. |
| Terminalauszüge automatisch sichern | Die App legt automatisch Checkpoints aus der Terminalausgabe an. |

Ist das Memory ausgeschaltet, wird nichts geladen und nichts automatisch ergänzt. Vorhandene Daten bleiben zum Bearbeiten erhalten. Beide Schalter sind standardmäßig an.

## Der gespeicherte Kontext

Am Ende des Bereichs zeigt „Gespeicherter Kontext für dieses Projekt“, was ein Agent bekommen würde. „Kontext kopieren“ legt den Text in die Zwischenablage, „Kontext aktualisieren“ liest ihn neu. Das brauchst du für Agenten, die den Kontext nicht automatisch erhalten: Kimi behält beim Fortsetzen seine ursprünglichen Anweisungen, und eigene Befehle bekommen keinen Kontext von allein. Dann kopierst du den Text und gibst ihn bewusst als Prompt weiter.

Auch beim [Kontextstart](terminals-und-agenten.md#agent-mit-kontext-starten) fließt das Memory in den Startkontext ein.

## mt-memory

In den Terminals der App gibt es den Befehl `mt-memory`. Ein Agent liest damit das Memory und sichert einen Checkpoint:

```bash
mt-memory read
mt-memory save --summary 'Tests bestanden' --next 'Bedienung prüfen'
```

`save` kennt die Felder `--goal`, `--summary`, `--decisions`, `--questions`, `--next` und `--files`. Mindestens ein Feld ist nötig. `mt-memory save` braucht eingeschaltetes Memory. Es funktioniert auch bei ausgeschalteten automatischen Auszügen.

## Grenzen und Vorsicht

- Automatische Auszüge sind ungeprüft und unvollständig.
- Häufige Zugangsdaten-Muster werden geschwärzt. Sensible Inhalte können trotzdem im Auszug stehen.
- Tastatureingaben werden nicht gezielt gespeichert.
- Pro Projekt gibt es höchstens 8 Checkpoints (davon bis zu 4 automatische). Ein Auszug umfasst höchstens 8000 Zeichen, eine Notiz höchstens 20000 Zeichen.
- Gespeicherte Angaben sind keine Freigabe. Ein gespeicherter „nächster Schritt“ ist ein Hinweis, kein Auftrag.
- Bestehende Chats werden nicht importiert.
