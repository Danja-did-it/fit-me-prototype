# Recherche: realistischer 3D-Voxel-Mensch + Scan-Verfahren

Stand: 25.09.2026 · Ziel: „Picture Perfect“ – nicht abstrakt, nicht unproportional, detailgetreu.

## 1. Warum v3–v8 noch abstrakt wirken

v3–v8 bauen den Körper **von Hand** aus ~150 Formen (Ellipsoide, Kegel, Muskelbäuche), die weich
verschmolzen werden. Jede Proportion, jede Kurve ist eine geschätzte Zahl. Das ergibt:

- Rumpf ohne natürliche S-Kurve der Wirbelsäule, flache Brust, Beule am Becken (Seitenansicht v8)
- Gesicht aus Einzelteilen (Nase, Lippen, Kinn) → Übergänge wirken modelliert, nicht gewachsen
- Proportionen nur an 5–9 Messstellen an den Scan angepasst

**Kernerkenntnis:** Realistische Systeme verwenden **statistische / künstlerisch kalibrierte
Körpermodelle** – ein fertig modelliertes Menschen-Netz plus viele „Formvarianten“ (Blendshapes),
die aus echten Scans bzw. anthropometrischen Daten stammen. Der Körper wird dann nur noch *gemischt*
und an die Person *angepasst*, nicht erfunden.

## 2. Körpermodelle im Vergleich

| Modell | Qualität | Lizenz | Browser-tauglich |
|---|---|---|---|
| **SMPL / SMPL-X** (MPI) | Standard der Forschung, aus Tausenden Scans | Forschung frei, **kommerziell nur mit Lizenz** (Meshcapade) | JS-Ports existieren, Lizenz problematisch |
| **Anny** (NAVER LABS, 2025) | 13.380 Punkte, 163 Knochen; 2,4 mm mittlere Abweichung zu echten 3D-Scans; laut Paper so gut wie oder besser als SMPL-X; alle Altersstufen, WHO-kalibriert | Code Apache 2.0, **Daten CC0** (MakeHuman/MPFB2) | PyTorch (nicht direkt), Daten aber frei |
| **MakeHuman / MPFB2** (Datenbasis von Anny) | Grundnetz hm08 + 1.259 Formvarianten: Makro (Geschlecht, Alter, Muskeln, Gewicht, Größe, Proportionen) + Details (42 Nase, 44 Mund, 68 Augen, 44 Ohren, Kinn, Wangen, Stirn, Brauen, Hals, Torso, Bauch, Hüfte, Po, Arme, Beine, Hände) + Rigs mit Skin-Gewichten | **CC0** (Daten), Code GPL/AGPL | Daten sind Textdateien → eigener JS-Mischer möglich |
| makehuman-js | Browser-Port | **AGPLv3** (würde das ganze Projekt binden) | ja, aber Lizenz ungeeignet |

**Entscheidung:** MakeHuman-/MPFB2-**Daten (CC0)** + **eigener JavaScript-Mischer** nach dem in Anny
dokumentierten Verfahren (stückweise multilineare Interpolation der Makro-Varianten). Kein fremder
AGPL-Code, keine Forschungslizenz, kommerziell unbedenklich.

## 3. Scan-Verfahren im Vergleich

| Verfahren | Genauigkeit | Aufwand / Hardware | Status im Prototyp |
|---|---|---|---|
| Umrissbreiten an wenigen Höhen (v1–v8) | grob, ±2–4 cm, empfindlich für Kleidung/Pose | Handy-Browser | ersetzt |
| **Analyse durch Synthese: Körpermodell an Front- + Seiten-Umriss anpassen** (Breiten + Tiefen an ~40 Höhen, Längen aus Pose-Punkten, Größe als Maßstab) | deutlich besser; Modell erzwingt menschliche Proportionen | Handy-Browser, MediaPipe | **v9 (neu)** |
| SHAPY (CVPR 2022): Form aus einem Foto | Größe 5,1 cm, Brust 6,5 cm, Taille 6,9 cm, Hüfte 5,7 cm mittlerer Fehler | GPU, Forschungslizenz | Referenzwert |
| HMR 2.0 / Multi-HMR (auch mit Anny trainiert) | sehr gute Pose, Form mittel | großes ViT-Netz (~600 M Parameter), nicht handytauglich | Ausblick (Server) |
| 360°-Video-Scan + Silhouetten-Hülle (Visual Hull) | cm-genau rundherum (Rücken, Po, Bauch) | Handy-Browser, Person dreht sich einmal | **nächste Erweiterung** |
| iPhone-LiDAR (12 Pro Max hat LiDAR) / ARKit Body Tracking | mm-genau Tiefe | native iOS-App (Safari hat keinen Tiefenzugriff) | Ausblick (native App) |
| Maßstab-Referenz (A4-Blatt / Kreditkarte im Bild) | ersetzt Größen-Eingabe, prüft Kamera-Verzerrung | Handy-Browser | Ausblick |

Zusätzlich im Prototyp (seit v5/v8): MediaPipe Pose **heavy**, Personen-Maske, Face Landmarker
(478 Punkte), Haar-Segmentierung, Mehrklassen-Segmentierung (Haut/Kleidung/Haare), Scan-Qualitätstipps.

## 4. Voxel-Darstellung: was „realistisch“ ausmacht

- **Quelle der Form**: glattes, anatomisch korrektes Netz → Würfel entstehen durch *Oberflächen-
  Voxelisierung* (jedes Dreieck markiert die Zellen, die es schneidet), dann Außen-Flutfüllung →
  geschlossene Hülle ohne Löcher.
- **Normalen**: echte Netz-Normalen pro Würfel (statt nur Würfelflächen) → Licht folgt der Körperform
  (seit v6 schon als Näherung, ab v9 exakt aus dem Netz).
- **Umgebungsverdeckung (AO)** gezielt schwach im Gesicht, damit keine „Schmutzflecken“ entstehen.
- **Auflösung**: 1 cm Körper, 0,5 cm Kopf/Hände (feine Details wie Augen, Lippen, Finger).
- **Farben**: Haut, Haare, Augen, Lippen, Kleidung aus dem Scan; keine Zufalls-Kleckse.

## Quellen

- Anny – NAVER LABS Europe: https://europe.naverlabs.com/blog/anny-a-free-to-use-3d-human-parametric-model-for-all-ages/
- Paper „Human Mesh Modeling for Anny Body“: https://arxiv.org/abs/2511.03589
- Code + Lizenzen: https://github.com/naver/anny
- MPFB2 (MakeHuman für Blender, Daten CC0): https://github.com/makehumancommunity/mpfb2
- MakeHuman Lizenz-Erklärung: http://www.makehumancommunity.org/content/license_explanation.html
- makehuman-js (AGPL): https://github.com/makehuman-js/makehuman-js
- SMPL-X Lizenz: https://smpl-x.is.tue.mpg.de/modellicense.html
- SHAPY: https://github.com/muelea/shapy · https://arxiv.org/abs/2206.07036
- Anthropometrie für Mesh-Schätzung (CVPRW 2025): https://arxiv.org/html/2409.17671v1
