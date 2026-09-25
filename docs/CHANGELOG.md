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

Details zu jeder Version: `PROGRESS.md`. Recherche und Entscheidungen: `docs/RESEARCH.md`.
