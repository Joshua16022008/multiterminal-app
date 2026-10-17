---
title: Übergaben, Anhänge und Aufbauten
order: 100
keywords: übergabe, handoff, anhang, datei, bild, zwischenablage, promptvorschau, aufbau, vorlage, template
---

# Übergaben, Anhänge und Aufbauten

Diese Seite beschreibt, wie Text und Dateien kontrolliert zwischen Kacheln und Agenten wandern, und wie du Kachel-Anordnungen als Vorlage speicherst.

## Promptvorschau

Die Promptvorschau ist die gemeinsame Sicherung für alles, was die App in ein Terminal einfügen will. Sie erscheint bei Anhängen, Übergaben, Diff-Kommentaren, Browser-Kommentaren und Aufträgen des Projektmanagers. Der Dialog heißt „Text und Dateien einfügen“ und zeigt:

- das Ziel („Ziel: Projekt · Kachel“),
- dein Textfeld „Dein Auftrag“,
- die Dateiverweise, jeweils mit „Entfernen“,
- „So wird eingefügt“: der genaue Text, der ins Terminal kommt.

Mit „Ins Terminal einfügen“ übernimmst du den Text. Er wird **ohne Enter** eingefügt, du schickst ihn selbst ab. „Abbrechen“ lässt die Terminaleingabe unverändert. Zeilenumbrüche im Text werden beim Einfügen zu Leerzeichen.

## Anhänge

Der Knopf 📎 im Kachelkopf („Dateien oder Bildverweise einfügen“) öffnet die Vorschau für diese Kachel. Dateien kommen auf drei Wegen hinein:

- „Dateien hinzufügen…“ im Dialog,
- Dateien aus dem Finder direkt auf die Kachel ziehen,
- ein Bild aus der Zwischenablage mit „Bild aus Zwischenablage“ oder per Einfügen (⌘V) in der Kachel oder im Dialog.

Die App fügt **Dateipfade** ein, nicht den Inhalt. Ob ein Agent daraus ein Bild oder Dokument lädt, hängt von seinem Programm ab. Die App kann das nicht bestätigen.

Grenzen:

- Bis zu 20 Dateien gleichzeitig.
- Bilder aus der Zwischenablage bis 20 MB. Sie werden als PNG im Datenordner der App unter `attachments/` gespeichert.
- Dateinamen mit Steuerzeichen oder Zeilenumbrüchen werden mit einer Meldung abgelehnt.
- Eine Datei ohne lokalen Pfad musst du erst speichern.

Das Ziehen der Dateien ist unabhängig vom Tauschen zweier Kacheln über den Kachelkopf.

## Übergabe an ein anderes Terminal

Wenn ein Agent aufhört und ein anderer weitermachen soll, bereitest du eine Übergabe vor. Öffne sie mit ⌘⇧U oder über „☰ Menü → ⇄ Übergabe“. Die Quelle ist die aktive Kachel.

Im Dialog „Übergabe an anderes Terminal“:

1. Wähle unter **Ziel-Kachel** die Kachel, die weitermachen soll. Es gibt nur laufende Kacheln desselben Projekts.
2. Fülle die Felder: **Ziel der Übergabe**, **Geprüfte Ergebnisse**, **Relevante Dateien**, **Offene Fragen** und **Genau ein nächster Schritt**.
3. Optional: **Auszug aus PROGRESS.md anhängen**. Der Auszug ist ein Abschnitt „Aktueller Stand“ aus der Datei. Du kannst ihn vor dem Absenden bearbeiten. Findet die App die Datei oder den Abschnitt nicht, sagt sie es dir.
4. „In Promptvorschau“ öffnet die [Promptvorschau](#promptvorschau). Erst dort fügst du den Text in die Zielkachel ein.

Der Projektmanager arbeitet ähnlich, siehe [Projektmanager](projektmanager.md).

## Arbeitsaufbauten (Vorlagen)

Ein Aufbau ist eine gespeicherte Anordnung von Kacheln, zum Beispiel „Entwicklung“ mit einem Agenten, einem Devserver und einem Browser.

### Speichern

„+ Projekt → Aufbau speichern…“ oder ⌘⌥B. Der Dialog zeigt alle Kacheln des aktiven Projekts:

- Gib einen **Namen** an (bis 60 Zeichen).
- Wähle, welche Kacheln dazugehören und ob jeweils ihr **Startbefehl** gemerkt wird.
- Gibt es den Namen schon, kannst du den vorhandenen Aufbau ersetzen.

Gespeichert werden Titel, Schnellstart, Farbe, Browseradresse und Reihenfolge. **Nicht** gespeichert werden Gespräche, Konten und Arbeitskopien.

### Starten

„+ Projekt → Aufbau starten…“ oder ⌘⇧B. Du wählst eine Vorlage und siehst zuerst eine Vorschau mit allen Befehlen. Nichts läuft, bevor du „Starten“ klickst. Pro Kachel steuert das Häkchen „Startbefehl ausführen“, ob ihr Befehl wirklich ausgeführt wird. Bei Devservern ist es zunächst aus, weil sie dauerhaft laufen und du das bewusst einschalten sollst.

Der Aufbau legt **neue** Kacheln an. Vorhandene Terminals bleiben unberührt. Das Limit von 30 Terminals pro Projekt gilt weiter. Fehlt ein Schnellstart der Vorlage, wird die Kachel als normale Shell angelegt, und die App sagt dir das.

Im Startdialog löschst du Vorlagen mit „Löschen“ (nach einer Rückfrage „Wirklich?“). Laufende Terminals bleiben dabei unberührt.
