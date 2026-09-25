# Fit-me Prototyp

Browser-Prototyp einer Fitness-App: Foto/Kamera-Scan → 3D-Voxel-Avatar („Pixel-Figur“) von dir,
Regler für Körperfett und Muskeln, Animationen (Stehen, Gehen, Kniebeuge).

Technik: [Vite](https://vite.dev) + [Three.js](https://threejs.org) + [MediaPipe](https://ai.google.dev/edge/mediapipe) (Pose, Gesicht, Haare, Kleidung) +
realistisches Körpermodell aus [MakeHuman/MPFB2](https://github.com/makehumancommunity/mpfb2)-Daten (CC0).
Versionen, Speicherstände und Recherche: [docs/CHANGELOG.md](docs/CHANGELOG.md), [docs/RESEARCH.md](docs/RESEARCH.md).

**Live:** https://danja-did-it.github.io/fit-me-prototype/ (auf dem Handy öffnen, Kamera erlauben)

Alle Bilder werden **nur im Browser auf deinem Gerät** ausgewertet – es gibt keinen Upload und keinen Server.

## Starten (lokal)

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install     # lädt alle Bibliotheken, danach automatisch die MediaPipe-Modelle (public/mediapipe)
                # und baut das Körpermodell aus den MakeHuman-Daten (public/human, ~9 MB)
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
   **Training** (Kraft / Gemischt / Ausdauer) bestimmt, wie stark schnelle und langsame Fasern wachsen.
   **Einzelne Muskelgruppen** (aufklappen): 13 eigene Regler, z. B. nur Bizeps oder nur Waden.
   **Darstellung:** Ansicht *Aussehen*, *Muskelgruppen* (Farbe pro Gruppe, gelb = Fettdepot, grau = Sehne/Knochen)
   oder *Fasertypen* (dunkelrot = langsame Typ-I-Fasern, hellrot = schnelle Typ-II-Fasern).
   **Würfelgröße** 4 cm bis 0,5 cm (Standard 1 cm; 0,5 cm = ca. 70.000 Würfel, auf älteren Handys langsamer).
4. **Individuell** – nach dem Front-Scan wird das Gesicht vermessen (Länge, Kiefer, Augen, Nase, Mund, Lippen, Kinn),
   Farben übernommen (Haut, Augen, Lippen, Brauen, Haare) und Frisur + Bart geschätzt. Alles lässt sich hier korrigieren.
   Dafür muss das Gesicht auf dem Front-Foto gut sichtbar sein (Licht von vorn, keine Sonnenbrille/Kappe).
5. **Bewegung** – Stehen, Gehen (auf der Stelle), Kniebeuge. Figur mit Maus/Finger drehen, zoomen mit Mausrad/zwei Fingern.

## So scannst du richtig

- **Kleidung:** oben ohne oder enges Sporttop, enge kurze Hose / Leggings, barfuß oder flache Schuhe.
  Haare aus dem Gesicht, keine Kappe, keine Brille. (Gemessen wird der Umriss – weite Kleidung macht dich breiter.)
- **Front:** gerade stehen, Füße hüftbreit, Arme 20–30° vom Körper weg (dürfen die Hüfte nicht berühren),
  Blick in die Kamera, Mund entspannt geschlossen.
- **Seite:** 90° drehen, eine Schulter zeigt zur Kamera, Arme locker hängen lassen.
- **Kamera:** am besten fotografiert jemand anderes mit der Rückkamera. Handy auf Hüfthöhe, senkrecht,
  2,5–3 m Abstand, ganzer Körper mit etwas Rand. Allein: Handy abstellen + 5-Sekunden-Selbstauslöser.
- **Licht:** gleichmäßig von vorn, kein Gegenlicht; ruhiger, einfarbiger Hintergrund.
- **Größe** genau eintragen. Nach jedem Foto zeigt die App Tipps, falls etwas nicht passt.

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
src/avatar.js           Voxel-Avatar: Netz mischen, posieren, in Würfel zerlegen, färben, GPU-Skinning
src/human.js            MakeHuman-Mischer: Makro-/Detail-Varianten, Gelenke, Posen
src/voxelize.js         Netz -> Würfel (Oberfläche + Außen-Flutfüllung, Normalen, Falten-Schattierung)
src/fit.js              Modell an Scan-Maße anpassen (Analyse durch Synthese), Gesichts-Varianten
src/face.js             Gesichts-/Haar-Analyse (478 Gesichtspunkte, Haarmaske)
src/anatomy.js          Muskelgruppen, Muskeln mit Fasertyp-Anteil, Trainingsarten
scripts/build-human.mjs lädt MakeHuman-Daten (CC0) und packt sie für den Browser
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
- **Körpermodell:** MakeHuman-Grundnetz + Varianten; sehr ungewöhnliche Körper (z. B. extrem breite Schultern bei
  schmaler Taille) liegen teils außerhalb des Modells. Die Tabelle zeigt Foto- vs. Modellwert.
- **Anatomie vereinfacht:** 23 Hauptmuskeln als weiche Wölbungen auf der Oberfläche; tiefe Muskeln, Sehnenverläufe
  und Unterschiede zwischen Menschen fehlen. Fasertyp-Anteile sind Literatur-Durchschnitte (stark individuell).
  Die Fasern werden nur an der Oberfläche gezeigt, nicht im Inneren.
- **Animation prozedural** (Sinus-Kurven), keine echten Bewegungsdaten; Gehen findet auf der Stelle statt.
  Bei sehr großen Fett-/Muskelwerten können sich Körperteile in Bewegungen überschneiden.
- **Pose-Modell** (~9 MB) wird beim ersten Scan geladen; auf älteren Handys dauert die Analyse ein paar Sekunden.
  Ohne WebGL-/GPU-Unterstützung rechnet MediaPipe auf der CPU (langsamer).
- MediaPipe schreibt zwei harmlose interne Hinweise in die Konsole
  („OpenGL error checking is disabled“, „NORM_RECT without IMAGE_DIMENSIONS“) – keine App-Fehler.
- Scans werden nicht gespeichert; nach Neuladen der Seite ist der Avatar wieder Standard.
