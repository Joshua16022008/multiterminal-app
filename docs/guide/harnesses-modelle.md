---
title: Harnesses und Modelle
order: 150
keywords: harness, modell, katalog, anbieter, agent, belegstufe, installation, schnellstart, kontextstart, claude, codex, kimi, aider, opencode, beitragen
---

# Harnesses und Modelle

Ein **Harness** ist ein Agentenprogramm für die Kommandozeile, zum Beispiel Claude Code, Codex oder Aider. Die App führt eine Liste (den **Katalog**) von Harnesses, die sie kennt. Der Katalog sagt ihr, wie ein Harness gestartet wird, ob es ein Modell, einen Auftrag oder ein Fortsetzen unterstützt und wie man es installiert. Du findest ihn in den Einstellungen (⌘,) im Bereich „Harnesses & Modelle“ oder über die Befehlspalette mit „Harnesses & Modelle“. Er gilt für die ganze App, nicht für ein einzelnes Projekt.

Wichtig vorab: Die App installiert nichts selbst und startet nichts im Hintergrund. Sie zeigt, was sie weiß, und führt nur aus, was du ausdrücklich anstößt.

## Welche Harnesses es gibt

Mitgeliefert sind 15 Einträge:

| Harness | Belegstufe | Was die App damit kann |
|---|---|---|
| Claude Code | Lokal geprüft | Start, Modell, Fortsetzen, Startauftrag, Endpunkte, Konten |
| Codex | Lokal geprüft | Start, Modell, Fortsetzen, Startauftrag, Endpunkte, Konten |
| Kimi Code | Lokal geprüft | Start, Modell, Fortsetzen (kein Startauftrag) |
| DeepSeek Harness | Lokal geprüft | nur Start; öffnet einen lokalen Webdienst, siehe unten |
| Aider | Dokumentiert | Start und Modell |
| OpenCode | Drittquelle | Start, Modell mit Modellliste, Fortsetzen, Startauftrag |
| Amp, Cline, GitHub Copilot CLI, Crush, Cursor Agent, Gemini CLI, Goose, Qwen Code, ZCode | Unbestätigt | nur der nackte Startbefehl |

### Die Belegstufen

Jede Karte trägt ein Etikett, das zeigt, wie sicher die App über dieses Harness ist:

- **Lokal geprüft**: Die Angaben wurden an einer echten Installation ausprobiert.
- **Dokumentiert**: Sie stammen aus der offiziellen Dokumentation des Anbieters.
- **Drittquelle**: Sie stammen aus einer anderen Quelle und wurden nicht selbst nachgeprüft.
- **Unbestätigt**: Die App kennt nur den Programmnamen. Sie startet das Harness mit dem Grundbefehl, ohne Modell-, Fortsetzen- und Auftragsoptionen. Bei diesen Karten sind Modellfeld und Endpunktauswahl gesperrt. Die App rät keine Optionen.

Je niedriger die Stufe, desto weniger erledigt die App für dich. Das ist Absicht: Lieber ein ehrlicher Grundstart als ein erfundener Schalter.

Das DeepSeek Harness ist ein Webdienst. Es startet im Terminal und gibt eine Adresse aus, die du selbst im Browser öffnest. Eine eingebettete Ansicht gibt es nicht.

## Ist es installiert?

Jede Karte zeigt „Installiert“ oder „Fehlt“. Mit „Installation / Version prüfen“ fragt die App neu nach: Sie sucht das Programm in deiner Login-Shell (also mit deinem gewohnten `PATH`) und zeigt Pfad und Version. Bei Programmen mit mehrdeutigem Namen (etwa `agent` bei Cursor oder `kimi`) prüft sie zusätzlich die Hilfeausgabe, damit sie nicht ein fremdes Programm gleichen Namens erwischt. Ein Ergebnis gilt kurz (rund 30 Sekunden) als Zwischenspeicher.

Wird ein Programm nicht gefunden, obwohl es installiert ist, steht die Lösung unter [Fehlerbehebung](fehlerbehebung.md).

## Installationsbefehl kopieren oder eintippen

Bei einem fehlenden Harness zeigt die Karte den Installationshinweis aus dem Katalog, zum Beispiel einen `npm`-Befehl. Drei Dinge sind möglich:

- **Installationsbefehl kopieren** legt den Befehl in die Zwischenablage.
- **Ohne Enter im Terminal anzeigen** öffnet ein neues, normales Terminal in deinem aktiven Projekt und tippt den Befehl dort **ein, ohne Enter zu drücken**. Du siehst ihn, kannst ihn prüfen oder ändern und führst ihn erst mit Enter selbst aus. Dafür braucht es ein geöffnetes Projekt. Die App nutzt dafür immer ein frisches Terminal und tippt nie in einen laufenden Agenten.
- **Dokumentationshinweis kopieren** erscheint, wenn es keinen Befehl gibt, sondern nur eine Seite mit Anleitung (Methode „manuell“).

Nach der Installation klickst du auf „Installation / Version prüfen“. Bestehende Terminals kennen ein neu installiertes Programm eventuell noch nicht; öffne dann ein neues.

## Modell wählen

Jede Karte hat ein Feld **Modell**. Es ist Freitext, denn Modellnamen wechseln oft. Erlaubt sind Buchstaben, Ziffern und die Zeichen `. _ : / @ [ ] + -` (bis 200 Zeichen). Bleibt das Feld leer, entscheidet das Harness selbst. Hat das Harness keine belegte Modellwahl (zum Beispiel das DeepSeek Harness), lehnt die App ein Modell mit einer Meldung ab, statt eine Option zu erfinden.

### Modellliste

„Modellliste aktualisieren“ füllt die Vorschläge im Feld. Die App fragt **nur auf diesen Klick** nach, nie von selbst. Woher die Liste kommt, steht unter der Karte („Modellquelle: …“):

- Bei einem **Ollama**-Endpunkt fragt sie dessen lokalen Server nach den installierten Modellen.
- Bei einem **OpenRouter**-Endpunkt fragt sie die öffentliche Modellliste von OpenRouter ab.
- Bei Harnesses mit eigener Abfrage (OpenCode) führt sie dessen Befehl `opencode models` aus.
- Sonst zeigt sie die kurze feste Liste aus dem Katalog (bei Claude Code drei Einträge).

Schlägt die Abfrage fehl oder dauert sie zu lange, bleibt die feste Liste, und du kannst den Namen trotzdem von Hand eingeben. Fehlertexte der Anbieter zeigt die App bewusst nicht an.

## Schnellstart anlegen

Auf der Karte wählst du Modell und (falls gewünscht) einen Endpunkt, dann klickst du **Als Schnellstart anlegen**. Der Knopf ist nur aktiv, wenn das Harness installiert ist. Danach erscheint ein neuer Eintrag im Menü „▾“ neben dem „+“ in der Kopfleiste, mit einem Namen wie „Claude Code · DeepSeek · Modellname“. Er startet das Harness mit genau diesen Angaben, wie die [Schnellstarts](terminals-und-agenten.md) sonst auch. Die Angaben werden beim Anlegen geprüft; der eigentliche Startbefehl wird erst beim Start gebaut.

Beim Fortsetzen verwendet die App den Fortsetzen-Befehl aus dem Katalog, wenn er belegt ist. Ohne diesen Befehl bietet die Kachel „Neu starten“ an.

## Der Chip im Kachelkopf

Kacheln, die über so einen Schnellstart entstanden sind, zeigen im Kopf einen Chip mit dem Harness, dem Endpunkt und dem Modell. Er enthält nur öffentliche Namen aus Katalog und Profil, nie einen Befehl oder einen Schlüssel. Fehlt der Endpunkt inzwischen, steht dort „Endpunkt fehlt“; kennt die App das Harness nicht mehr, steht dort der Name mit „(unbekannt)“.

## Kontextstart mit anderen Harnesses

Der Dialog „Agent mit Kontext starten…“ (siehe [Terminals und Agenten](terminals-und-agenten.md)) kennt neben Claude Code und Codex auch installierte Harnesses mit belegtem Startauftrag, im Moment zum Beispiel OpenCode. Dort kannst du ebenfalls ein Modell und einen passenden Endpunkt wählen. **Kimi Code gehört nicht dazu**: Es hat keinen belegten Startauftrag und startet nur über den normalen Schnellstart.

## Mehr zu Endpunkten und eigenen Einträgen

Wie du ein Harness an einen anderen Anbieter hängst, steht unter [Endpunkte](endpunkte.md).

### Eigenen Katalogeintrag teilen

Fehlt dir ein Harness, kannst du es selbst beschreiben:

1. Unten im Bereich „Eigener Katalogeintrag“ fügst du einen vollständigen Eintrag als JSON ein und klickst „JSON importieren“. Die App prüft ihn streng: Unbekannte Felder, Shells und Interpreter als Programm oder Platzhalter an falscher Stelle werden abgelehnt. Mitgelieferte Einträge lassen sich nicht überschreiben; höchstens 100 eigene sind möglich.
2. Eigene Einträge erkennst du an „Eigenen Eintrag entfernen“ auf der Karte.
3. „Katalog-JSON exportieren“ zeigt den Eintrag jedes Harness als Text, den du mit „Export kopieren“ in die Zwischenablage legst. Das gilt auch für mitgelieferte Einträge, als Vorlage für eigene.

Möchtest du deinen Eintrag mit anderen teilen, schlage ihn per Pull Request im Projekt vor: Die Datei heißt `src/main/harness-catalog/<id>.json`. Das Schema und die Regeln stehen in `docs/dev/harness-catalog.md` im Quellcode. Eine eigene Anleitung zum Beitragen (CONTRIBUTING) folgt später. Gib im Eintrag ehrlich an, wie er geprüft wurde; neue Einträge ohne eigene Prüfung gehören auf die Stufe „Unbestätigt“.
