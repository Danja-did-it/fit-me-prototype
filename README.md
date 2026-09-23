# Fit-me Prototyp

Browser-Prototyp einer Fitness-App: Foto/Kamera-Scan → 3D-Voxel-Avatar („Pixel-Figur“) von dir,
Regler für Körperfett und Muskeln, Animationen (Stehen, Gehen, Kniebeuge).

Technik: [Vite](https://vite.dev) + [Three.js](https://threejs.org) + [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker).
Alle Bilder werden **nur im Browser auf deinem Gerät** ausgewertet – es gibt keinen Upload und keinen Server.

## Starten (lokal)

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install     # lädt alle Bibliotheken; lädt danach automatisch das Pose-Modell (~9 MB) nach public/mediapipe
npm run dev     # startet den Entwicklungs-Server -> http://localhost:5173 im Browser öffnen
```

Weitere Befehle:

| Befehl | Was er macht |
|---|---|
| `npm run build` | baut die fertige Seite in den Ordner `dist/` |
| `npm run preview` | zeigt die gebaute Seite aus `dist/` lokal an |
| `npm run deploy` | baut und lädt `dist/` auf den Branch `gh-pages` (GitHub Pages, HTTPS) |
| `node scripts/check.mjs <url>` | Test: öffnet die Seite in Chrome (unsichtbar), listet Konsolen-Fehler, macht Screenshot |

## Bedienung

1. **Körper scannen** – „Front-Foto wählen“ und „Seiten-Foto wählen“, oder „Kamera starten“ →
   „Front aufnehmen“ / „Seite aufnehmen“ (5 Sekunden Selbstauslöser zum Zurücktreten).
   „Kamera wechseln“ schaltet auf die Rückkamera, wenn jemand anderes fotografiert.
   Tipps: ganzer Körper im Bild, eng anliegende Kleidung, Arme leicht vom Körper weg, ruhiger Hintergrund.
2. **Maße** – deine echte Körpergröße eintragen. Sie ist der Maßstab, um Pixel in Zentimeter umzurechnen.
   Die Tabelle zeigt, welche Werte aus welchem Foto stammen.
3. **Körper verändern** – Körperfett und Muskeln von −100 % bis +100 %. Jede Region wächst unterschiedlich
   (Fett: Bauch, Hüfte, Oberschenkel, Oberarm; Muskeln: Schultern, Brust, Arme, Waden).
   Einfärbung: orange = mehr Fett, rot = mehr Muskeln, blau = weniger.
4. **Bewegung** – Stehen, Gehen (auf der Stelle), Kniebeuge. Figur mit Maus/Finger drehen, zoomen mit Mausrad/zwei Fingern.

## Auf dem Handy

Die Kamera funktioniert im Browser nur über **HTTPS** (oder `localhost`). Wege aufs Handy:

- **GitHub Pages** (kostenlos): Repo auf GitHub anlegen (öffentlich), `npm run deploy`, dann in den
  Repo-Einstellungen unter *Pages* den Branch `gh-pages` wählen. Adresse: `https://<name>.github.io/fit-me-prototype/`.
- Ohne Deploy: Foto-Auswahl klappt auch über `http://<IP-deines-Macs>:5173` im gleichen WLAN
  (`npm run dev` zeigt die Adresse), nur die Live-Kamera nicht.

## Dateien

```
index.html              Seite mit Bedien-Panel
src/main.js             3D-Szene, Render-Schleife, Verdrahtung der Bedienelemente
src/avatar.js           Voxel-Figur: Gelenke, Körperteile aus Würfeln, Fett/Muskel-Wachstum (GROWTH)
src/scan.js             MediaPipe: Pose + Personen-Maske, Kamera, Farben aus dem Foto
src/measure.js          Maske + Pose -> Maße in Metern (Breiten, Längen, Tiefen)
src/anim.js             Animationen Stehen / Gehen / Kniebeuge
scripts/setup-mediapipe.mjs  kopiert MediaPipe-Wasm + lädt Modell (läuft bei npm install)
scripts/check.mjs       automatischer Browser-Test
PROGRESS.md             Aufgabenliste, Erkenntnisse, Blocker
```

## Bekannte Grenzen

- **Keine echte Körperfett-Messung.** Die Regler sind eine Visualisierung („so ungefähr sähe es aus“),
  kein medizinisches Modell. Die Wachstums-Gewichte pro Region sind geschätzt.
- **Genauigkeit der Maße:** Größenordnung ±2–4 cm. Weite Kleidung (Kleid, Anzug, Pulli) wird mitgemessen,
  Arme oder Beine, die sich berühren, werden nur grob herausgerechnet. Schräge Kamera / Weitwinkel verzerrt.
- **Nur Front + Seite:** Der Querschnitt jedes Körperteils ist eine Ellipse. Rücken, Po, Brust-Form usw.
  werden nicht einzeln erfasst.
- **Voxel-Auflösung 4 cm:** kleine Veränderungen (1–2 cm) sind erst sichtbar, wenn ein Würfel dazukommt.
- **Animation prozedural** (Sinus-Kurven), keine echten Bewegungsdaten; Gehen findet auf der Stelle statt.
  Bei sehr großen Fett-/Muskelwerten können sich Körperteile in Bewegungen überschneiden.
- **Pose-Modell** (~9 MB) wird beim ersten Scan geladen; auf älteren Handys dauert die Analyse ein paar Sekunden.
  Ohne WebGL-/GPU-Unterstützung rechnet MediaPipe auf der CPU (langsamer).
- MediaPipe schreibt zwei harmlose interne Hinweise in die Konsole
  („OpenGL error checking is disabled“, „NORM_RECT without IMAGE_DIMENSIONS“) – keine App-Fehler.
- Scans werden nicht gespeichert; nach Neuladen der Seite ist der Avatar wieder Standard.
