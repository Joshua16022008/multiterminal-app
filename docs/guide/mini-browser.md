---
title: Mini-Browser
order: 50
keywords: browser, webview, localhost, devserver, element, kommentieren, mt-browser, screenshot
---

# Mini-Browser

Jede Kachel hat einen eigenen kleinen Browser. Er ist für das gedacht, woran ein Agent gerade arbeitet: eine Seite auf `localhost`, eine Vorschau, eine Dokumentation. Du siehst die Seite direkt neben dem Terminal.

## Öffnen und schließen

- Der Knopf 🌐 im Kachelkopf schaltet den Browser der Kachel ein und aus.
- Gibt der Agent oder ein Devserver im Terminal eine lokale Adresse aus (zum Beispiel `http://localhost:5173`), öffnet die App sie von selbst im Mini-Browser. Der Fokus bleibt dabei im Terminal. Schließt du den Browser absichtlich, öffnet er sich nicht von allein wieder, bis eine neue Adresse auftaucht.
- Ein Klick auf einen Link in der Terminalausgabe öffnet ihn ebenfalls dort.
- Welche lokalen Server laufen, zeigt das Panel [Ports](ports.md).

## Bedienung

Die Leiste über der Seite hat Knöpfe für Zurück (←), Vor (→), Neu laden (⟳) und Schließen (✕) sowie ein Adressfeld. Dort kannst du eine Adresse eingeben, zum Beispiel `localhost:3000`.

Solange der Browser offen ist, erscheint im Kachelkopf ein Schalter mit drei Ansichten:

| Ansicht | Zeigt |
|---|---|
| Nur Agent | nur das Terminal |
| Agent und Browser | beides nebeneinander |
| Nur Browser | nur den Browser. Der Knopf „← Agent“ bringt das Terminal zurück. |

## Element kommentieren

Mit dem Knopf ⌖ in der Browserleiste oder mit ⌘⇧E markierst du ein Element der Seite und schickst einen Kommentar dazu an den Agenten:

1. Klicke auf ⌖. Die App fordert dich auf, ein Element anzuklicken. Esc bricht ab.
2. Klicke das Element in der Seite an.
3. Schreibe einen Kommentar, zum Beispiel „Der Abstand fehlt“.
4. „In Promptvorschau“ öffnet die Vorschau mit Adresse der Seite, Element, Kommentar und, wenn möglich, einem Bildausschnitt. „Verwerfen“ schließt das Feld.

In die Kachel eingefügt wird erst, wenn du in der Vorschau „Ins Terminal einfügen“ klickst, und auch dann ohne Enter. Mehr zur Vorschau steht unter [Übergaben, Anhänge und Aufbauten](uebergaben-und-anhaenge.md#promptvorschau).

## Der Agent steuert den Browser: mt-browser

In jedem Terminal der App steht der Befehl `mt-browser` bereit. Ein Agent kann damit den Mini-Browser seiner eigenen Kachel bedienen, während du zusiehst. Er funktioniert nur innerhalb einer Kachel der App.

```bash
mt-browser open localhost:5173
mt-browser screenshot ./home.png
mt-browser console --limit 20
```

Weitere Befehle: `reload`, `back`, `forward`, `url`, `text`, `click <selector>`, `type <selector> <text>`, `show` und `hide`. `mt-browser --help` listet alles auf. Es werden nur `http`- und `https`-Adressen geöffnet. Auf der Seite sind nur Klicken und Texteingabe möglich.
