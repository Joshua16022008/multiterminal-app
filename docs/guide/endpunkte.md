---
title: Endpunkte
order: 160
keywords: endpunkt, api, schlüssel, schlüsselbund, anbieter, deepseek, z.ai, moonshot, openrouter, ollama, vorlage, base-url, konfigordner
---

# Endpunkte

Ein **Endpunkt-Profil** sagt einem Harness, bei welchem Anbieter es sich anmelden soll: eine Adresse (Base-URL), optional ein Schlüssel und ein Standardmodell. So kannst du zum Beispiel Claude Code gegen DeepSeek laufen lassen, ohne etwas im System umzustellen. Du verwaltest die Profile im Bereich „Harnesses & Modelle“ (siehe [Harnesses und Modelle](harnesses-modelle.md)), unter „Endpunkt-Profile“.

## Ein Profil anlegen

1. Wähle bei „Anbieter-Vorlage“ eine Vorlage oder klicke auf „Endpunkt hinzufügen“.
2. Prüfe Bezeichnung, Typ und Base-URL.
3. Gib den API-Schlüssel ein (falls der Anbieter einen braucht).
4. Optional: ein Standardmodell.
5. „Endpunkt speichern“.

### Vorlagen

| Vorlage | Typ | Base-URL |
|---|---|---|
| DeepSeek | anthropic | `https://api.deepseek.com/anthropic` |
| Z.ai | anthropic | `https://api.z.ai/api/anthropic` |
| Moonshot | openai | `https://api.moonshot.ai/v1` |
| OpenRouter | openai | `https://openrouter.ai/api/v1` |
| Ollama | ollama | `http://127.0.0.1:11434` |

Eine Vorlage füllt nur das Formular. Gespeichert wird erst, wenn du auf „Endpunkt speichern“ klickst. Die Adressen sind Vorschläge; stimmt etwas beim Anbieter nicht mehr, ändere die URL im Formular.

### Der Typ

Der Typ bestimmt, welche Harnesses ein Profil verwenden können. In der Auswahl auf einer Karte erscheinen nur passende Profile:

- **anthropic**: für Claude Code.
- **openai**: für Codex.
- **ollama**: für Claude Code und Codex, mit einem lokalen Ollama-Server. Bei Codex ist derzeit nur der Standardserver auf deinem Rechner (Port 11434) belegt, andere Ollama-Adressen lehnt die App ab.
- **deepseek**: ein weiterer Typ, den die Profile kennen. Aktuell nutzt ihn kein mitgeliefertes Harness.

Moonshot und OpenRouter gelten laut Vorlage also für Codex, DeepSeek und Z.ai für Claude Code. Harnesses mit „Unbestätigt“ nehmen keinen Endpunkt an.

### Weitere Felder

- **Base-URL**: `http` oder `https`, ohne Zugangsdaten, Suchparameter oder `#` in der Adresse.
- **Standardmodell**: wird genommen, wenn du auf der Karte nichts eintippst.
- **Modellzuordnung** (JSON, optional): Für Claude Code ordnest du dessen Kurznamen deinen Modellen zu, etwa `{"haiku":"modellname"}`. Möglich sind `opus`, `sonnet`, `haiku` und `subagent`.

## Der Schlüssel liegt nur im Schlüsselbund

Der API-Schlüssel wird ausschließlich im **macOS-Schlüsselbund** gespeichert, unter dem Dienst `de.multiterminal.endpoint` und der ID des Profils. Er steht nie in einer Datei der App, in den Profilen, in Fehlermeldungen oder in der Oberfläche.

- Nach dem Speichern zeigt das Profil nur „Schlüssel gespeichert“. Das Passwortfeld bleibt leer; **leer lassen behält den bisherigen Schlüssel**.
- Beim Start holt sich die Shell des Terminals den Schlüssel direkt aus dem Schlüsselbund und setzt ihn nur für den gestarteten Agenten. Im Befehl, den die App tippt, steht nur die Abfrage, nie der Schlüssel selbst. Gelingt das Laden nicht oder ist der Schlüssel leer, bricht der Start mit „Endpunkt-Schlüssel konnte nicht geladen werden.“ ab.
- Ein Profil ohne Schlüssel startet nicht, außer bei Ollama: Dort setzt die App den von Ollama vorgesehenen Platzhalterwert.
- „Endpunkt entfernen“ löscht auch den Schlüsselbund-Eintrag.
- Schlüssel dürfen keine Zeilenumbrüche enthalten. macOS kann beim ersten Zugriff nachfragen, ob die Schlüsselbundabfrage erlaubt ist.

Die Profile selbst (ohne Schlüssel) liegen in einer Datei, die nur dein Benutzer lesen kann. Ist sie beschädigt, sichert die App sie unter einem neuen Namen und fängt leer an, statt sie zu überschreiben.

## Isolierter Claude-Konfigordner

Claude Code liest normalerweise Einstellungen und Anmeldung aus deinem Ordner `~/.claude`. Das würde mit einem fremden Anbieter kollidieren. Deshalb gibt die App jedem Endpunkt-Profil einen **eigenen Konfigordner** für Claude Code (Haken „Claude-Konfiguration pro Endpunkt isolieren (empfohlen)“, standardmäßig an):

- Anmeldungen und Verlauf dieses Profils bleiben von deinem normalen Claude getrennt.
- Ihre `settings.json` wird dabei nicht übernommen. Sonst könnten dort stehende `ANTHROPIC_*`-Werte den Endpunkt überschreiben.
- Weitere Ressourcen wie Skills und eigene Befehle werden aus deinem normalen Ordner verlinkt.
- Zusätzlich leert die App `ANTHROPIC_API_KEY` für diesen Start, damit kein Kontoschlüssel versehentlich zum falschen Anbieter geht.
- Eine **Kontowahl entfällt** für solche Starts: Der Start nutzt das Profil, nicht eines deiner [Konten](einstellungen.md).

Schaltest du die Isolation aus, nutzt Claude deinen normalen Ordner samt `settings.json`. Stehen dort `ANTHROPIC_*`-Werte, können sie den Endpunkt überstimmen; siehe [Fehlerbehebung](fehlerbehebung.md).

## Ein Profil benutzen

Auf der Karte des Harness wählst du bei „Endpunkt“ dein Profil. Ist ein Standardmodell hinterlegt, trägt die App es ins Modellfeld ein. Dann legst du einen **Schnellstart** an oder wählst das Profil im Dialog „Agent mit Kontext starten…“. Wird ein Profil später gelöscht, zeigt der Chip der Kachel „Endpunkt fehlt“ und der Start meldet „Endpunkt nicht gefunden.“

## Eigene Harnesses und Endpunkte

Ein Katalogeintrag kann je Endpunkt-Typ festlegen, welche Umgebungsvariablen und Argumente gesetzt werden und in welcher Variable der Schlüssel erwartet wird. Dort steht nur der **Name** der Variablen, nie ein Schlüssel. Wie du einen Eintrag exportierst und beiträgst, steht unter [Harnesses und Modelle](harnesses-modelle.md).
