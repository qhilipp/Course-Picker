# Kurswahl

Ein kleiner Planer für die Wahlmodule im Master Informatik an der TUM. Du trägst ein, wie gerne du welche Vorlesung belegen willst. Die App sucht Kombinationen, die deine Credit-Vorgaben erfüllen und möglichst gut zu diesen Wünschen passen.

Der mitgelieferte Katalog ist ein Beispiel aus den Bereichen Maschinelles Lernen und Datenanalyse, Algorithmen, Computergrafik und Vision sowie Sicherheit und Datenschutz. Ersetzen kannst du ihn vollständig über eine einzige Datei: [`courses.json`](courses.json).

## Starten

Voraussetzung ist [Node.js](https://nodejs.org/).

```bash
npm install
npm run dev
```

Die Oberfläche liegt dann unter [http://localhost:5173/](http://localhost:5173/). Nach einer Änderung an `courses.json` reicht ein Neuladen der Seite.

```bash
npm test
```

prüft den Optimierer. `npm run build` erzeugt eine statische Version in `dist/`.

## Was die App einhält

Die Vorgaben stehen oben in `courses.json` und sind auf eine übliche Wahlmodul-Regel im Master Informatik zugeschnitten:

| Vorgabe | Bedeutung |
| --- | --- |
| 53 ECTS | Untergrenze für den ganzen Plan. Mehr ist erlaubt, kostet aber Strafpunkte. |
| 10 ECTS Theorie | Untergrenze für Module mit `"theoretical": true`. Jeder Credit darüber wird genauso bestraft wie ein Credit über 53. |
| 18, 8 und 8 ECTS | Drei Blöcke aus **verschiedenen** Bereichen. Welcher Bereich welchen Block übernimmt, sucht die App selbst. Ein Bereich kann nur einen Block tragen. Weitere Credits aus demselben oder einem vierten Bereich zählen nur zur Gesamtsumme. |

In der Seitenleiste stehen die fünf besten Pläne. Ein Klick wechselt die Auswahl in der Kursliste.

Die Bewertung läuft von 0 bis 5:

| Wert | Bedeutung |
| --- | --- |
| 0 | Der Kurs wird nicht eingeplant. |
| 1–2 | Ungern bis eher nicht. Er kommt nur in den Plan, wenn er eine Lücke schließt. |
| 3 | Neutral. Das ist der Startwert, wenn du nichts einträgst. |
| 4–5 | Gerne bis am liebsten. |
| Fix | Der Kurs bleibt immer im Plan, auch bei Präferenz 0. |

Der **Nutzen** eines Plans ist die Summe der Präferenzen minus die Strafe für Extra-Credits. Der Regler in der Seitenleiste setzt diese Strafe pro Credit über 53 und pro Theorie-Credit über 10. Bei 0 nimmt der Plan möglichst viele positiv bewertete Kurse auf. Höhere Werte halten ihn näher an den Grenzen.

Präferenzen, Fixierungen, Semester-Schalter und die Strafe speichert der Browser lokal. Die Werte in `courses.json` sind nur die Startwerte. **Angaben zurücksetzen** stellt sie wieder her.

## Katalog anpassen

Alles, was du für deine eigene Wahl brauchst, steht in `courses.json`. Modulnummern aus TUMonline eignen sich als `id`. Dieselbe Nummer erscheint in der Oberfläche.

```json
{
  "meta": {
    "title": "Kurswahl"
  },
  "requirements": {
    "totalCredits": 53,
    "theoreticalCredits": 10,
    "overagePenalty": 0.75,
    "maxOverage": 24,
    "areaQuotas": [18, 8, 8],
    "areas": [
      { "id": "mla", "name": "Maschinelles Lernen und Datenanalyse", "short": "MLA" }
    ]
  },
  "courses": [
    {
      "id": "IN2346",
      "name": "Introduction to Deep Learning",
      "credits": 6,
      "semester": "winter",
      "preference": 3,
      "theoretical": false,
      "area": "mla"
    }
  ]
}
```

### Vorgaben

- `totalCredits` ist die ECTS-Untergrenze des gesamten Plans.
- `theoreticalCredits` ist die Untergrenze für theoretische Module. Credits darüber werden bestraft, fehlen sie, ist der Plan ungültig.
- `areaQuotas` listet die Blöcke. `[18, 8, 8]` heißt: ein Bereich liefert mindestens 18 ECTS, zwei andere Bereiche jeweils mindestens 8. Die Reihenfolge der Bereiche in `areas` legt nicht fest, wer welchen Block bekommt.
- `areas` benennt die Wahlbereiche. `id` ist der kurze Schlüssel, auf den die Kurse zeigen. `short` ist das Kürzel in der Liste. Es sind bis zu acht Bereiche möglich.
- `overagePenalty` ist die Startstrafe pro Extra-Credit. In der Oberfläche lässt sie sich zwischen 0 und 2 verstellen.
- `maxOverage` begrenzt, wie viele Credits über dem Gesamtziel die Suche noch vergleicht. Reicht das nicht für einen gültigen Plan, sucht die App einmalig bis 60 Extra-Credits weiter.

Andere Prüfungsordnungen trägst du hier ein, nicht im Code. Ein Nebenfach mit zwei Blöcken ist zum Beispiel `"areaQuotas": [12, 8]` und eine passende Liste unter `areas`.

### Kurse

| Feld | Wert |
| --- | --- |
| `id` | Modulnummer, zum Beispiel `IN2346` oder `CIT4230003`. Muss eindeutig sein. |
| `name` | Name aus TUMonline. |
| `credits` | ECTS, auch halbe Credits wie `7.5`. Höchstens 60. |
| `semester` | `"winter"` oder `"summer"`. Erlaubt sind auch `WiSe`, `SoSe`, `WS` und `SS`. `null` lässt das Semester offen: der Kurs bleibt in der Suche, egal welcher Semester-Schalter aktiv ist. |
| `preference` | Startwert von 0 bis 5. Weglassen heißt 3. |
| `theoretical` | `true`, wenn der Kurs auf die Theorie-Credits zählt. |
| `area` | `id` eines Eintrags aus `requirements.areas`. |

Einen Kurs entfernst du, indem du seinen Block aus der Liste löschst. Einen neuen Bereich legst du unter `areas` an und verwendest seine `id` bei den Kursen.

Fehler in der Datei zeigt die App beim Laden an. Ein ungültiger Kurs wird übersprungen, eine ungültige Vorgabe blockiert die ganze Seite.

## Hinweis zur Theorie-Kennzeichnung

Ob ein Modul in deiner Prüfungsordnung als theoretisch gilt, steht im Modulhandbuch, nicht im Titel. Die Markierung `"theoretical": true` im Beispielkatalog folgt der mitgelieferten Liste und kann von deinem Studienplan abweichen. Prüfe sie, bevor du dich auf einen Plan verlässt.
