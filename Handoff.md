# Handoff – Fit-me Prototyp

Stand: 28.09.2026 · Branch `feature/scan-precision` · Tag `v40` (Commit 272aebf)
Repo: https://github.com/Danja-did-it/fit-me-prototype
Vorschau: GitHub Pages, Unterordner `preview/` (Deploy mit `npm run deploy:preview`)
Live-Version (`master`, Deploy mit `npm run deploy`): **noch auf altem Stand** – v13–v40 sind nur auf dem Branch + in der Vorschau.

---

## Goal

Fitness-App-Prototyp: Aus Handyfotos (Front / Seite / Rücken) entsteht ein 3D-Voxel-Avatar – das
„Voxel-Double“ der Person. Alles läuft im Browser auf dem Gerät (Vite + Three.js + MediaPipe),
**kein Foto-Upload**. Nutzer verändern Körperfett und Muskeln, sehen Muskelgruppen, Animationen
(Stehen / Gehen / Kniebeuge), Accessoires und ihren Fortschritt (Anfang / Jetzt / Ziel).

Ziel-Look = Konzeptbild `docs/screenshots/target-voxel-double-concept.png`: Voxel-Game-Figur mit großem
Kopf, Afro, Wayfarer-Sonnenbrille, Kette, Sixpack, weiter schwarzer Hose mit Kreuz-Logo, weißen Sneakern.

Randbedingungen:
- Nur kostenlose Werkzeuge, keine kostenpflichtigen Generierungen ohne Kostenschätzung + Erlaubnis.
- Messgenauigkeit halten (`scripts/validate.mjs`, alle Maße ≤ ~1,5 cm).
- UI-Sprache Deutsch, Zielgerät iPhone (Safari) + Desktop.

---

## Done

**Scan & Messung**
- MediaPipe Pose (heavy) + Gesichtspunkte (478) + Haar-Maske, Personen-Maske mit Guided Filter.
- Körper aus MakeHuman-Daten (CC0), per „Analyse durch Synthese“ an die Fotos angepasst.
- Genauigkeit (6 virtuelle Personen): alle Maße ≤ 1,4 cm (Bein 0,6, Arm 0,2, Taille 0,4 …).
- Gesichts-Fit aus 21 Messungen / 22 Formen; echtes Gesicht und Kleidung können aufs Modell projiziert werden
  (nur im Stil „Realistisch“; im Game-Stil bleibt der Look sauber).
- KFA-Schätzung (Navy-Formel + Modell-Schätzung), Gewicht aus Mesh-Volumen.

**Kamera**
- Geführter Scan (Front → Seite → Rücken) mit Sprachansage (deutsche Frauen-/Roboterstimme).
- Live-Tracking, Plausibilitätsprüfung, Gegenprobe vor dem Auslösen, geglättete Meldungen;
  löst nur bei richtiger + ruhiger Pose aus, nie per Timeout, Abbrechen-Knopf.

**Avatar „Voxel-Double“ (Standard-Stil)**
- Held-Look als Standard- und Demo-Avatar, 2,8-cm-Würfel, Chibi-Proportionen, Gesichtsblock,
  6-reihige Wayfarer, matter schwarzer Afro, blockiges Sixpack, Kette, weite Hose, Kasten-Sneaker,
  Sonnenuntergangs-/Gym-Bühne. Stil „Realistisch“ (feine Würfel) bleibt wählbar und ist pixelgleich zu v37.
- Frisuren-Katalog (11), Accessoires (Sonnenbrille, Kette, Uhr), Muskeldefinition + Adern je nach KFA.

**App-Oberfläche**
- 5 Tabs (Avatar, Scan, Körper, Style, Details) – Tab-Leiste unten auf dem Handy, Tab-Streifen am Desktop.
- Werte-Chips (Gewicht, Körperfett, Muskelmasse), Accessoire-Leiste, Legende auf der Bühne.
- Fortschritt-Ansicht Anfang / Jetzt / Ziel mit Fortschrittsbalken; Demo-Tour (~30 s).

**Multi-Agenten-Mission (v38–v40)**
- Neutrale Benotung v40: **Ø 4,3 / 5** (Funktionalität 4,5 · Design 4,5 · UX 4,5 · Performance 3,5 ·
  Konzept-Treue 4,5), Start war 3,1.
- Konzept-Ähnlichkeit laut Design-Prüfer: 2,2 → **4,0 / 5**. Alle Rollen zufrieden.

---

## Broken / offen

Keine bekannten Funktionsfehler (0 Konsolenfehler in allen Testläufen). Offen:
- **Nicht auf echtem iPhone getestet** seit v33: Sprachstimme, Live-Tracking-Tempo, Gesichts-Fit-Dauer
  (headless ohne GPU 13–40 s), Ruckeln bei vielen Würfeln (Stil „Realistisch“ ~117k Würfel).
- **Live-Version (`master`)** ist alt und sendet noch MediaPipe-Nutzungsstatistik an Google
  (in der Vorschau seit v29 blockiert). → Branch nach iPhone-Test übernehmen.
- Kosmetik (optional):
  - Hose: helle, hautfarbene Querstreifen (Falten-Lichter) statt nur dunkler Falten, kleine Stufe am Knie.
  - Gesicht: Mund unter der Brille kaum sichtbar, Gesicht etwas flach/hell.
  - Einzelne braune Würfel oben auf dem Afro; Afro etwas schmal (1,17× Schulter statt ~1,3×).
  - 3 Zahlenfelder im Scan-Tab 34 px statt 44 px hoch.
  - Nach Stilwechsel „Realistisch → Game → Glatze“ bleibt die Bühne ~1 s leer, dann normal.
  - Körperveränderung auf der kleinen Handy-Bühne eher subtil.
- Haar-Umriss aus der Haar-Maske ist mit synthetischen Bildern nicht prüfbar (MediaPipe erkennt Voxel-Haar nicht).
- `validate.mjs` ist nicht deterministisch (±0,1–0,2 cm zwischen Läufen).

---

## Fixed (wichtigste Korrekturen)

- **Kamera** löste immer wieder aus → Sperre, Stillstand-Erkennung, kein Auto-Auslösen (v33); Flackern bis
  „Ich sehe dich nicht“ und zu häufige Ansagen → Live-Tracking, Hysterese, Ansagen max. 3× / 15 s (v35).
- **Datenschutz:** MediaPipe schickte jede Minute Nutzungsdaten an Google → lokal abgefangen + CSP (v29).
- **KFA** zeigte 3,8 % → Navy + Modell-Schätzung mit Untergrenze (v25).
- **Genauigkeit:** Beinlänge 2,8 → 0,4 cm (v17), Armlänge 1,4 → 0,2 (v18), Oberarm 1,6 → 0,5 (v19),
  Brusttiefe 1,2 → 0,7 (v20).
- **Farben:** Haut grauweiß / Haare grün → robuster Weißabgleich + neutrale Tonwertkurve (v11).
- Gescannter Avatar im Game-Stil ohne Haar (spitzer Hautkopf) → Haarkappe / Fallback „kurz“ (v38/v39).
- Überlappungen in Fortschritt-Ansicht, Legende über den Beinen, abgeschnittene Füße in der Demo,
  Tipp-Flächen < 44 px (v39).
- Würfel an gebeugten Gelenken gestaucht (v21), Ohren in Haarfarbe (v16).

---

## Documentation

| Datei | Inhalt |
|---|---|
| `README.md` | Start, Installation, Nutzung |
| `PROGRESS.md` | Chronik aller Iterationen, Entscheidungen, Messwerte |
| `docs/CHANGELOG.md` | Versionstabelle v1–v40 (Deutsch) mit Screenshots |
| `docs/ACCURACY.md` | Genauigkeitstests (Körper, Gesicht) |
| `docs/RESEARCH.md` | Recherche (MakeHuman, MediaPipe, Techniken) |
| `docs/screenshots/` | Screenshots je Version + Konzept-Zielbild |
| `PROMPT.md` | Ursprünglicher Auftrag |

**Befehle** (im Projektordner):
- `npm install` – Pakete + MediaPipe-Modelle + Körperdaten laden
- `npm run dev` – lokaler Server
- `node scripts/check.mjs <url> <out.png> "<js>"` – Headless-Test mit Screenshot (MOBILE=1, FRONT=<foto>)
- `node scripts/validate.mjs <url> 6` – Genauigkeitstest (~10 min)
- `npm run deploy:preview` – Vorschau veröffentlichen · `npm run deploy` – Live (master)

**Nächste Schritte**
1. v40-Vorschau auf dem iPhone testen (Demo, geführter Scan, Tabs, Fortschritt).
2. Wenn gut: `feature/scan-precision` in `master` übernehmen und `npm run deploy`.
3. Optional: Kosmetik aus „Broken / offen“.
