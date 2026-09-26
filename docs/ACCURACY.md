# Scan-Genauigkeit (Prüf-Werkzeug)

`scripts/validate.mjs` erzeugt virtuelle Menschen mit **bekannten** Maßen (zufällige Taille, Hüfte,
Schultern, Oberschenkel, Bauch, Oberarm, Gewicht, Muskeln, Mann/Frau, 1,60–1,90 m), fotografiert sie wie
ein Handy (Front + Seite, Kamera auf Hüfthöhe, 3 m, A-Pose laut Scan-Anleitung), schickt die Bilder durch
den kompletten Scan (MediaPipe → Messung → Modell-Anpassung) und vergleicht das Ergebnis mit der Wahrheit.

```bash
npm run dev                      # in einem Terminal
node scripts/validate.mjs http://localhost:5173/ 6
```

## Mittlerer Fehler in cm (6 Personen)

| Maß | v9 (Start) | v10 |
|---|---|---|
| Schulterbreite | 0,5 | 1,4 |
| Taillenbreite | 1,9 | **0,5** |
| Hüftbreite | 4,5 | **1,1** |
| Oberschenkel | 3,5 | **1,0** |
| Wade | 1,4 | **0,2** |
| Oberarm | 3,9 | **1,3** |
| Hals | 0,6 | 1,7 |
| Beinlänge | 3,9 | **2,8** |
| Armlänge | 0,2 | 1,1 |
| Brusttiefe | 1,5 | 1,2 |
| Bauchtiefe | 0,9 | 0,8 |

Zum Vergleich: SHAPY (Forschungsstand, 1 Foto) 5–7 cm bei Brust/Taille/Hüfte.
Einschränkung: virtuelle Fotos sind ideal (perfektes Licht, enge Kleidung, gerade Pose). Echte Fotos
haben zusätzlich Kamera-, Licht- und Kleidungsfehler – deshalb mehrere Aufnahmen + Median + Tipps.

## Was die Verbesserung gebracht hat (v9 → v10)

1. **A-Pose-Fotos im Test** (wie in der Anleitung) statt hängender Arme.
2. **Glieder-Breiten von der Außenkante** (2 × Abstand Knochenlinie → Außenkante), identisch an Foto und Modell.
3. **Modell in der Pose des Fotos vermessen** (Arm-/Beinwinkel aus den Körperpunkten).
4. **Kalibrierte virtuelle MediaPipe-Punkte** am Modell (Schulter −0,3 %, Ellbogen −0,9 %, Hüfte +0,5 %,
   Knie +1,75 %, Knöchel +4,9 % der Körpergröße gegenüber den anatomischen Gelenken).
5. **Exakte Querschnitte** durch das Netz statt Punkte in einem Streifen (Netzzeilen liegen 2–4 cm auseinander).
6. Anpassung in 5 Phasen (Längen ↔ Breiten abwechselnd), dichte Umriss-Profile (10 Rumpf-, 4+4 Bein-Höhen).
7. Kante der Personen-Maske per Guided Filter an die Bildkanten angelegt.

## Face fit (v14)

Virtual faces with known face targets (random +-0.7), rendered, measured with MediaPipe and fitted again:

| Face | ratio error before | after | target error (0..1) |
|---|---|---|---|
| 1 | 4.6 % | 0.1 % | 0.04 |
| 2 | 5.1 % | 0.7 % | 0.12 |
| 3 | 2.8 % | 1.1 % | 0.16 |

Before = the old direct estimate (photo ratio / assumed average). Real sample photo: 6.5 % -> 4.4 % (eye size limited
to keep the playful eyes open).

## v17: leg length

Mean absolute error (cm), 6 virtual people:

| | shoulder | waist | hip | thigh | calf | upper arm | neck | leg | arm | chest d. | belly d. |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v16 | 1.3 | 0.5 | 1.0 | 1.0 | 0.3 | 1.5 | 1.3 | 2.8 | 1.4 | 1.2 | 0.8 |
| v17 | 1.0 | 0.6 | 0.6 | 1.2 | 0.3 | 1.4 | 1.0 | **0.4** | 1.4 | 1.2 | 0.5 |

Causes: hip landmark offset differs by sex (male -0.7 %, female +1.2 % of height); the length fit phases were also
pulled by width profiles. See PROGRESS.md loop round 8.

## v18: arm length

| | shoulder | waist | hip | thigh | calf | upper arm | neck | leg | arm | chest d. | belly d. |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v18 | 1.1 | 0.6 | 0.5 | 1.2 | 0.4 | 1.7 | 0.9 | 0.5 | **0.2** | 1.3 | 0.6 |

The landmark arm (shoulder -> elbow -> wrist) is 2.2 % shorter than the joint chain; corrected in measure.js.

## v19: limb widths (sideways landmark offset)

| | shoulder | waist | hip | thigh | calf | upper arm | neck | leg | arm | chest d. | belly d. |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v19 | 0.9 | 0.4 | 0.8 | 0.8 | 0.4 | **0.5** | 0.9 | 0.5 | 0.2 | 1.3 | 0.6 |

MediaPipe's shoulder / elbow points sit ~1.5-2 cm inside the joints; the limb center line is corrected sideways.

## v20: chest depth (side photo perspective)

| | shoulder | waist | hip | thigh | calf | upper arm | neck | leg | arm | chest d. | belly d. |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v20 | 1.0 | 0.4 | 0.9 | 0.8 | 0.4 | 0.6 | 1.0 | 0.5 | 0.2 | **0.7** | 0.7 |

Remaining +0.6 cm chest bias: the camera at hip height looks up at the chest (not modelled).

## v23: face surface

8 random virtual faces, mean distance of the face surface (front view, mm): average face 13.9, old estimate 15.3,
new fit (21 measures, 22 shapes, 3 Gauss-Newton rounds, mild prior) 8.7.
