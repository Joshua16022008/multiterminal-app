---
title: Einstellungen
order: 110
keywords: einstellungen, profil, konten, nutzung, kontingente, skills, plugins, mods, bibliotheken, hotkeys, verbrauch, statuszeile
---

# Einstellungen

Die Einstellungen öffnest du mit ⌘, oder mit dem Knopf „Einstellungen“ oben in der Seitenleiste. Links wählst du den Bereich, oben (bei den meisten Bereichen) den Anbieter: Claude Code, Codex oder Kimi. „Schließen“ oder Esc beendet die Ansicht. Ungespeicherte Entwürfe fragt die App vorher nach.

Die Bereiche:

| Bereich | Wofür |
|---|---|
| Profil | dein eigener Text mit Zielen und Arbeitsweise je Anbieter |
| Kontingente | Verbrauch je Konto |
| Skills, Plugins, Mods, Bibliotheken | Übersicht über lokale Ressourcen der Anbieter |
| Memory | gemeinsame Notizen, siehe [Memory](memory.md) |
| Hotkeys | Tastenkürzel ändern |

## Profil

Ein Profil ist ein Markdown-Text je Anbieter, zum Beispiel mit Abschnitten „Ziele“, „Arbeitsweise“ und „Anweisungen“. Das Profil jedes Anbieters ist von den anderen getrennt. „Profil speichern“ (oder ⌘S) sichert es in der App, „Gespeicherten Stand laden“ verwirft deinen Entwurf.

Mit dem Schalter **Profil beim Start aus Multiterminal laden** bekommt der Agent das Profil bei jedem Start über einen Schnellstart. Das gilt nur für Terminals, die du danach startest. Die App ändert keine Dateien der Anbieter-CLI. Die eigenen Anweisungen des Anbieters bleiben wirksam, das Profil kommt dazu. Ein leeres Profil wird nicht geladen.

Darunter listet die Ansicht „Vorhandene Anbieter-Anweisungen“, also Dateien wie die Anweisungsdatei des Anbieters, nur zur Ansicht.

Kimi ersetzt Platzhalter der Form `${name}` in Anweisungen durch eigene Inhalte. Die App warnt, wenn dein Profil so etwas enthält.

## Konten

Pro Anbieter kannst du mehrere Konten verwalten, etwa „privat“ und „Arbeit“. Das Panel „Konten“ öffnest du über „☰ Menü → Konten“ (bei geöffnetem Projekt) oder über „Konten verwalten“ im Bereich „Kontingente“.

- Der Auswahlknopf bestimmt das Konto, das **neue** Terminals benutzen. Laufende Terminals behalten ihr Konto.
- „Anmelden“ öffnet ein neues Terminal mit dem Anmeldebefehl des Anbieters für dieses Konto.
- Eigene Konten lassen sich mit ✎ umbenennen und mit ✕ entfernen. Beim Entfernen wandert der Kontoordner in den Papierkorb, laufende Terminals mit diesem Konto verlieren ihre Anmeldung.
- Unter „Konto hinzufügen“ legst du ein weiteres Konto mit einem Namen an.
- Ein Konto-Chip im Kachelkopf zeigt, mit welchem Konto die Kachel läuft. Er erscheint nur, wenn der Anbieter mehrere Konten hat.

## Nutzung und Kontingente

Der Bereich „Kontingente“ zeigt den Verbrauch je Konto und aktualisiert sich alle 60 Sekunden, solange er offen ist. „Aktualisieren“ liest sofort neu.

- **Claude Code**: Der Verbrauch kommt aus der Statuszeile von Claude. Dafür muss „Claude-Verbrauch aktivieren“ eingeschaltet sein. Das trägt eine Statuszeile in die Claude-Einstellungen (`~/.claude/settings.json`) ein und gilt für alle Claude-Konten. Hat Claude dort schon eine eigene Statuszeile, bleibt sie unverändert, und es gibt dann keine Verbrauchsanzeige. „Claude-Verbrauch deaktivieren“ entfernt den Eintrag wieder. Die Daten erscheinen, sobald ein neu gestartetes Claude-Terminal antwortet.
- **Codex**: Verbrauchsdaten zeigt die App, soweit lokal verfügbar. Fehlen sie, steht beim Konto der Grund.
- **Kimi**: Es gibt keine lokale Quelle für Kontingente, die App zeigt hier nichts an.

## Skills, Plugins, Mods und Bibliotheken

Diese vier Bereiche zeigen, was die Anbieter lokal gefunden haben. Es wird hier nichts installiert oder automatisch aktiviert.

- Die Ansicht hat eine Suche über Name, Quelle und Pfad.
- „Geprüfte Quellen“ nennt die Ordner, die die App durchsucht hat.
- Bei **Skills** gibt es drei getrennte Angaben: wo der Skill liegt, ob der Agent ihn verwendet und ob es einen Nutzungsbeleg gibt. Mit „Nach Nutzung sortieren“ ordnest du die Liste um. Skills anderer Agenten kannst du dem aktuellen zuordnen. Das legt einen Link an, kopiert wird nichts.
- **Plugins** werden über die CLI des Anbieters ein- und ausgeschaltet, zum Beispiel mit `claude plugin enable <name>`. Die App zeigt nur den Status.
- Eigene Dateien legst du in die passenden Ordner und klickst dann auf „Übersicht aktualisieren“.

## Hotkeys

Im Bereich „Hotkeys“ änderst du die Tastenkürzel der ganzen App:

1. Klicke auf ein Kürzel und drücke die neue Kombination. Esc bricht die Aufnahme ab.
2. Pro Aktion sind bis zu zwei Kürzel möglich. „+ Kürzel“ fügt eines hinzu, „×“ entfernt eines, „Standard“ stellt die Voreinstellung der Aktion wieder her.
3. „Hotkeys speichern“ macht die Änderung wirksam. „Alle auf Standard zurücksetzen“ stellt alles zurück.

Kürzel müssen ⌘ oder Strg enthalten. Nur Funktionstasten (F1 bis F24) gehen auch mit Umschalt oder Alt allein. Bearbeitungs- und Systemkürzel wie ⌘C, ⌘V oder ⌘Q bleiben reserviert. Doppelt vergebene Kürzel werden abgelehnt. Die Standardbelegung steht auf der Seite [Tastenkürzel](tastenkuerzel.md).

## Komfort

Das Panel „Komfort“ (⌘⇧K) ist getrennt von den Einstellungen. Dort schaltest du Markierungen („Wartet auf dich“, „Arbeitet“, „Inaktiv“), Animationen und die automatische Sortierung ein und aus. Mehr dazu unter [Oberfläche](oberflaeche.md#aktivität-und-sortierung).
