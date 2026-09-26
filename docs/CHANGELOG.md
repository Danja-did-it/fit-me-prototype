# Versionen & Speicherstände

Jede Version ist ein **Git-Tag** (auf GitHub) und liegt zusätzlich als Quellcode-ZIP in `saves/` (lokal).
Zurück zu einer Version: `git checkout v7` (danach `npm install && npm run dev`).
Screenshots: `docs/screenshots/`.

| Version | Datum | Inhalt | Screenshot |
|---|---|---|---|
| v1 (Live) | 23.09.2026 | 4-cm-Voxel-Figur aus Röhren, Foto-/Kamera-Scan (MediaPipe), Fett/Muskel-Regler, Stehen/Gehen/Kniebeuge, Handy + HTTPS | v1-template.png |
| v2 | 24.09.2026 | Würfel bis 0,5 cm, 23 Muskeln in 13 Gruppen, Fasertypen, Trainingsart | v2-views.png, test-iphone-v2-groups.png |
| v3 | 24.09.2026 | Körper aus verschmolzenen Anatomie-Formen (SDF), Studiolicht + Schatten | v3-views.png |
| v4 | 24.09.2026 | Detaillierter Kopf + Hände mit 0,5-cm-Detailwürfeln | – |
| v5 | 24.09.2026 | Gesichts-/Haar-Scan: Gesichtsform, Farben, Frisur, Bart, Umfänge | v5-looks.png, test-iphone-v5-scan-avatar.png |
| v6 | 24.09.2026 | Proportions-Grenzen, glatte Oberflächen-Beleuchtung | test-iphone-v6-face.png |
| v7 | 24.09.2026 | Natürlicheres Gesicht | v7-face.png |
| v8 | 25.09.2026 | Pose „heavy“, Kleidungs-/Haut-Erkennung, Scan-Tipps + Anleitung | v8-outfits.png, test-iphone-v8-profile.png |
| **v9** | 25.09.2026 | **Realistischer Körper aus MakeHuman-Daten (CC0)**, Modell-Anpassung an den Scan („Analyse durch Synthese“), Mehrfach-Scans (Front/Rücken/Seite, Median), Gesichts-Varianten aus dem Gesichts-Scan, Haarvolumen je Frisur, GPU-Skinning (keine Risse an Gelenken) | v9-overview.png, v9-animation.png, v9-looks.png, v9-front-side-face.png |
| **v10** | 25.09.2026 | **Scan-Präzision**: Prüf-Werkzeug mit virtuellen Menschen, geführte Aufnahme mit Live-Posenprüfung + Serienbild, dichte Umriss-Profile, kalibrierte Messpunkte, exakte Querschnitte, Weißabgleich übers Augenweiß, Kleidung herausrechnen, ± pro Maß – Hüfte 4,5 → 1,1 cm, Oberschenkel 3,5 → 1,0 cm, Wade 1,4 → 0,2 cm (siehe docs/ACCURACY.md) | – |
| v11 | 25.09.2026 | Farbtreue: robuster Weißabgleich (Augenweiß), neutrale Tonwertkurve + neutrales Licht – Haut wird nicht mehr grauweiß | – |
| v12 | 25.09.2026 | Lebendige Augen (Iris, Pupille, Glanzpunkt, Wimpernlinie), Kopf in 0,33-cm-Würfeln, saubere Tanktop-Kanten | v12-face-eyes.png, v11-tanktop.png |
| v13 | 25.09.2026 | Haaransatz (Mitte + Schläfen) und Haarlänge an den Seiten aus der Haar-Maske gemessen – Stirnhöhe individuell | – |
| v14 | 25.09.2026 | Gesichtsform per Analyse durch Synthese: Modellkopf wird gerendert, mit demselben Gesichtsmodell vermessen und an das Foto angepasst – Gesichtsproportionen-Fehler 5 % → ≤ 1 % (Test), Lippen/Kiefer über passendere Formen | – |
| v15 | 25.09.2026 | Augenbrauen (Form, Dicke, Bogen) und Lippen (Mundwinkel, Lippenhöhe, Amorbogen) aus dem Gesichts-Scan; Brauenfarbe aus den dunkelsten Brauen-Pixeln – Brauen gut lesbar | – |
| v16 | 25.09.2026 | Ohren in Hautfarbe (vorher teils Haarfarbe), natürliche Haarkante über und hinter dem Ohr | – |
| v17 | 26.09.2026 | Beinlänge: Fehler 2,8 → 0,4 cm (Hüftpunkt je Geschlecht kalibriert, Längen nicht mehr von Breiten-Profilen verzogen); Schulter, Hüfte, Hals ebenfalls genauer | – |
| v18 | 26.09.2026 | Armlänge: Fehler 1,4 → 0,2 cm (MediaPipe-Armpunkte liegen 2,2 % innerhalb der Gelenkkette – korrigiert) | – |
| v19 | 26.09.2026 | Oberarmbreite: Fehler 1,6 → 0,5 cm, Oberschenkel 0,8 cm; Gewicht wird nicht mehr zu hoch geschätzt (seitliche Kalibrierung der Gelenkpunkte) | – |
| v20 | 26.09.2026 | Brusttiefe: Fehler 1,2 → 0,7 cm (Perspektive des Seitenfotos wird am Modell nachgebildet) – alle Körpermaße jetzt ≤ 1 cm | – |
| v21 | 26.09.2026 | Geschlossenere Knie und Ellbogen beim Beugen (Würfel werden beim Skinning nicht mehr gestaucht) | v21-squat-knee.png |
| v22 | 26.09.2026 | 11 Frisuren (Glatze, Buzzcut, Kurz, Fade, Tolle, Mittel, Bob, Lang, Zopf, Dutt, Afro) – Scan erkennt 8 davon; realistischere Haare: einzelne Strähnen, natürliche Spitzen, lange Haare fallen auf den Rücken | v22-hairstyles.png, v22-hair-long-bun.png |
| v23 | 26.09.2026 | Gesichtszüge aus 21 Messungen (Kieferkontur, Stirn, Brauen, Mund, Nasen- und Kinntiefe, absolute Gesichtsgröße) und 22 Formen – Oberflächenfehler im Test 13,9 → 8,7 mm | – |

Details zu jeder Version: `PROGRESS.md`. Recherche und Entscheidungen: `docs/RESEARCH.md`.
