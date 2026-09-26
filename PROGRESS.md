# Progress

## Tasks
- [x] Vite + Three.js project, voxel cube renders
- [x] Voxel human template (head, torso, arms, legs) from cubes
- [x] Webcam/photo input with MediaPipe pose + segmentation
- [x] Map measured proportions (height, shoulder/hip width) onto template; support front + side photo
- [x] Fat/muscle sliders -> per-region scaling + color
- [x] Animations: idle, walk, squat
- [x] Works in phone browser (HTTPS deploy)
- [x] README: run steps + known limitations

## Learnings / Blockers
- Task 1: Vite 8 + three 0.186. Playwright MCP browser was locked by another session, so added `scripts/check.mjs` (playwright-core + installed Chrome, headless) to load the page, list console errors/HTTP failures and screenshot. "GPU stall due to ReadPixels" warnings come from headless screenshots, filtered out. Added inline favicon to avoid a 404.
- Task 2: `src/avatar.js`. Joint tree (hips > spine > chest > neck > head, shoulders > elbows, hips > knees > ankles); each segment = elliptic tube of 4 cm voxels in one InstancedMesh, only the shell is generated (~820 cubes total, cheap on phones). Body = `avatar.body` numbers + `avatar.build()`, so later tasks only change numbers. Colors via "bands" along each segment (sleeves, shorts, hair).
- Task 3: `src/scan.js`. PoseLandmarker (full model, IMAGE mode, segmentation masks on), GPU delegate with CPU fallback. Wasm + model are self-hosted in `public/mediapipe/` by `scripts/setup-mediapipe.mjs` (runs on `npm install`, not in git). Camera uses a 5 s self-timer and grabs a frame; photos load via file input (object URL, no upload). Tested with two public-domain Wikimedia photos + Chrome fake camera: both detected. MediaPipe prints 2 internal glog warnings ("OpenGL error checking is disabled", "NORM_RECT without IMAGE_DIMENSIONS") - harmless library noise, not app errors.
- Task 4: `src/measure.js`. User height (cm input) = scale; m/px = height / silhouette height. Front: shoulder/waist/hip/thigh widths from mask runs, leg + arm length from landmarks; side: chest + belly depth. Learned: arms touching the torso and touching legs inflate widths -> runs are clipped at elbows/wrists and at the body center line. Values clamped to plausible ranges. Avatar keeps arms outside the waist and spreads them if hips > shoulders. Skin/shirt/shorts/hair colors sampled from the front photo. Loose clothing (dress, suit) still inflates widths/depths - README limitation.
- Task 5: sliders -100..+100 % (0 = as scanned). `GROWTH` table in avatar.js = radius growth per region at +100 % as [fat, muscle]; negative side counts half. Tint (orange fat, red muscle, blue less) per region, toggle in UI. Rebuild throttled to 1x per frame. Learned: at 4 cm voxels a thin limb can collapse to 1 voxel and look broken (forearm wider than upper arm) -> growth floor 0.7 and forearm <= upper arm radius.
- Task 6: `src/anim.js`, procedural (sine curves, no mocap files). Each mode returns target joint angles; exponential blend toward them makes mode switches smooth. `placeOnFloor()` computes hip height from leg angles (lowest foot on the ground) and, for the squat, shifts hips back so the feet stay planted. Walk is on the spot (treadmill). Avoided `THREE.Clock` (deprecated in recent three) -> `performance.now()`.
- Task 7 (phone part done, deploy BLOCKED): relative base path, touch-friendly layout (stage sticky on top, bigger buttons, safe-area), selfie/back camera switch, MediaPipe lazy-loaded (first load 145 kB gzip JS instead of 190). Production build tested at 390x844 with touch: scan + animations, no errors. `npm run deploy` builds and pushes `dist/` to branch `gh-pages`. BLOCKER: creating the public GitHub repo (needed for free GitHub Pages) was denied by the permission check -> needs the user's OK. gh token also lacks `workflow` scope, so no GitHub Action; deploy is local instead.
- Task 8: README.md (German, beginner-friendly): install/run/deploy commands, usage, file map, known limitations.
- Task 7 unblocked: user approved. Public repo https://github.com/Danja-did-it/fit-me-prototype, `npm run deploy` -> branch gh-pages -> https://danja-did-it.github.io/fit-me-prototype/ (HTTPS enforced). Live test at 390x844: secure context, photo scan front+side, fake camera, sliders, squat - no app errors.

## Test 2026-09-24 (user, iPhone 12 Pro Max, Safari)
- Figure renders and runs smoothly; rotate/zoom, fat/muscle sliders, idle/walk/squat all work.
- Camera scan works.

## Planned (next iteration, not started)
- [x] Voxel size 2 cm instead of 4 cm (done: selectable 4 cm ... 0.5 cm, default 1 cm)
  - `VOXEL` in src/avatar.js; ~4x more shell cubes (est. 3-5k) - still fine for InstancedMesh.
  - Rebuild on slider drag gets heavier: measure on iPhone; if needed resize instances instead of full rebuild.
  - Re-check thin limbs (growth floor 0.7 was for 4 cm) and head/face proportions.
- [x] Structured fat/muscle distribution per muscle group (done, see below)
  - Replace per-segment radius factor with per-group "bumps" on the segment surface:
    each group = position along the segment (t range) + side (front/back/outside/inside angle) + strength.
  - Groups: trapezius, deltoids, pecs, lats, abs, obliques, biceps, triceps, forearms,
    glutes, quads, hamstrings, calves. Fat: belly/love handles, hips, thighs, back of upper arm, chest.
  - Per-group tint (optional), maybe per-group sliders later.

## Iteration 2: anatomy (branch feature/anatomy)
- `src/anatomy.js`: 23 muscles in 13 groups placed as bumps (position along segment, angle, width, thickness),
  slow-twitch share per muscle from literature (approx.), fat depots (belly, love handles, hips, buttocks,
  inner thigh, back of arm, chest, chin), training style weights (strength grows fast-twitch most).
- `src/avatar.js` rewritten: radius table per slice x 72 directions -> fast cube test. Cube sizes 4 cm to 0.5 cm,
  default 1 cm (~15-18k cubes, ~20 ms rebuild in headless Chrome; 0.5 cm ~65-77k cubes, ~130 ms).
- Tissue type per cube: fat depot / muscle slow (type I) / muscle fast (type II) / tendon-bone. Fiber type picked
  deterministically per cube (hash), constant along ~4 cm -> looks like fiber bundles, no flicker on rebuild.
- Views: Aussehen / Muskelgruppen / Fasertypen. Per-group sliders, training select, stats line.
- Learned: labeling by strongest thickness left big "tendon" gaps -> label by coverage instead; uniform fat layer
  must not count as "fat" tissue; upper belly lives in the chest segment and needs its own fat depot or a ring appears;
  muscle gain x1.2 was invisible -> x2.2.
- Preview deploy: `npm run deploy:preview` -> /preview/ (live site untouched).

## Iteration 3: realistic body (user feedback: "too unhuman", reference = realistic voxel characters)
- New engine in `src/avatar.js`: body = smooth union of 3D shapes (signed distance field) instead of stacked tubes.
  Base shapes (pelvis, rib cage, collarbones, skull, jaw, nose, ears, hands with thumb, feet), 24 muscle bellies
  from origin to insertion, fat depots as thickness fields. Voxelized coarse-to-fine (4 cm cells, refine near skin),
  left half only + mirror. Each cube bound to the bone of the nearest shape -> animations still work.
- Realistic proportions: arm = upper 53.5 % / forearm 46.5 % of shoulder-wrist + hand 10.8 % of height
  (fingertips mid-thigh). Face: eyes (white + iris), brows, mouth. Clothes: hems, waistband, socks, soles.
- Rendering: ACES tone mapping, warm key light with shadows, cool fill, rim light, floor disc,
  per-cube crease shading (ambient occlusion from filled neighbors).
- While dragging a slider the body is built with 2 cm cubes, full detail on release.
- Learned: coarse/fine band check vs brute force: 1.5x band = exact (28 cubes diff at 1x).
  Muscle blend radius 1.2 cm made the surface lumpy -> 2.2 cm (+ more when muscular).
  Strong growth made "balloons" -> thickness growth 0.5x, width 0.18x, gain factor 1.15.
  three r186: PCFSoftShadowMap removed -> PCFShadowMap. Vite HMR reloads broke tests -> check.mjs retries.
- Build time (headless Chrome, 1 cm): ~80-170 ms, ~13-16k cubes.

## Iteration 4: head + hands (user: "Kopf und Hände noch realistischer")
- Head from ~25 shapes: cranium, back of head, forehead, mid face, jaw (angle -> chin), chin, cheekbones,
  cheeks, brow ridge, eye sockets (carved), eyeballs (white / iris / pupil), upper + lower lids, nose bridge,
  tip, nostril wings, nostrils (carved), upper/lower lip + mouth line (carved), ears with hollow, hair volume.
- Hands: wrist, palm, thumb ball, pinky ball, 4 fingers x 2 segments with real lengths and slight curl,
  knuckles, 2-segment thumb, fingernails (painted on the back of the tips).
- Engine: new shape type "cut" (smooth subtraction), per-shape blend size (fingers 3 mm so they do not melt
  into a mitten), material tags (hair, eye, lip, ear, finger) for coloring.
- Detail cubes: head + hands are voxelized in a second pass with half-size cubes (1 cm body -> 0.5 cm face/hands).
- Learned: objects with different property sets made the hot loop ~5x slower (V8 megamorphic access) ->
  all shapes normalized to one layout. Detail pass must only touch cells right at head/hand shapes.
- Build 1 cm incl. detail: ~180-210 ms headless; drag preview (2 cm) ~35-70 ms.

## Iteration 5: individuality (user: "detaillierter für echte Individualität")
- `src/face.js`: head crop from pose points, scaled to 512 px, MediaPipe Face Landmarker (478 pts incl. iris)
  + Hair Segmenter (both local, models via setup script). Measures relative to face width (1 = average):
  face length, jaw, eye spacing/size/openness, nose width/length, mouth width, lips, chin.
  Colors: skin (cheeks), iris, lips, brows, hair (mask average). Hairstyle: none/short/medium/long from where
  side hair ends vs chin, volume on top/sides, fringe. Beard/mustache: darker than cheeks at chin/jaw/upper lip.
- Head shapes are parameterized by those measures; hair volumes per style; beard shapes (full, goatee,
  mustache) + painted stubble. Iris/brows use the scanned colors and eye position.
- Body: limb girths from the front photo (neck, upper arm, forearm, calf) scale each limb around its bone.
- UI "Individuell": hairstyle, fringe, beard, mustache, colors (skin, hair, eyes, lips, top, shorts);
  prefilled from the scan, manual changes win; face measures shown as % of average.
- Learned: MediaPipe logs "INFO: Created TensorFlow Lite XNNPACK delegate" via console.error -> routed to
  console.info. Beard detection by brightness fails on dark/low-contrast photos -> manual override.
  bodyFromScans scaled every key incl. objects -> now numbers only.

## Iteration 6: less abstract (user: "Voxel Pixel Verteilung noch zu abstrakt", phone screenshot of own scan)
- Seen on the user's scan: giant shoulders/arms (loose clamps, arms touching the body inflate widths),
  blue tint blotches from negative sliders, visible voxel steps and stripes.
- Measurements clamped to human proportions as share of body height (shoulders 22-30 %, waist 13-24 %,
  hips 17-26 %, thigh 7-12 %, neck/arm/calf girths, chest/belly depth); waist <= 0.9x shoulders,
  hips <= 1.1x shoulders; limb girth factors limited to 0.85-1.25. Change tint now off by default.
- Smooth lighting: each cube stores the body surface normal (from the empty neighbors in the crease-shading
  loop) as an instanced attribute; the shader blends it 72 % into the cube face normal, so light follows the
  body instead of every voxel step. Softer blend between rib cage and belly (no "flames" at the upper belly).
- Bug: stray cube "tabs" at the waist with negative fat. Brute-force check showed the same result, so it was the
  shape: the ellipsoid distance formula overestimates inside depth for thin long ellipsoids (flat muscles);
  when fat shrinks the body these spots stayed inside. Fix: inside depth clamped to the smallest radius.

## Iteration 7: face (user: hands + body OK now, face not)
- From the user's phone screenshot: small sunken eyes with heavy lids (angry look), thick low brows, lips
  sticking out + dark "mustache" shadow, dirty-looking crease shading on chin/jaw, coarse neck.
- Fixes: shallower eye sockets, eyeball further forward, thinner lids placed higher/lower (open eyes); brows
  thinner, higher, tapering, blended 30 % into skin; lips flatter, color 80 % lip / 20 % skin, shallow mouth line,
  smaller nostrils; new shape below the mouth removes the deep groove (chin no longer a separate plate);
  softer jaw/chin blend; nose base fills the gap under the tip (profile no longer a beak); crease shading 60 %
  weaker on face, neck and hands; neck now built with the fine detail cubes.

## Iteration 8: best tools + scan guide (user: how to scan? shirtless? use the most detailed tools)
- Pose Landmarker "heavy" (30 MB, most accurate) with fallback to "full".
- Selfie multi-class segmenter (hair / body skin / face skin / clothes / accessories) on a 512 px person crop:
  detects top (none / shirt), sleeves (none / short / long), bottoms (short / knee / long), shoes; takes
  skin color from body skin and real clothing colors. Avatar wears what was scanned (shirtless incl.
  nipples + navel, long sleeves on the forearm, long pants down to the ankle, barefoot feet).
- Scan quality tips after each photo: whole body visible, distance, frontal / 90 deg side, upright,
  arms away from the hips, clothing advice.
- Scan guide in the app (collapsible) and in the README. Models on first scan now ~60 MB (cached afterwards).
- Known: sleeve detection can be wrong when a hand rests on something (sample photo: suit read as short sleeves).

## Iteration 9: realistic body (user: face + proportions still abstract; research, perfectionist, "picture perfect";
## more scans for more accurate proportions; document all save states)
- Research (docs/RESEARCH.md): hand-built shapes are the root cause. Statistical / artist-calibrated body models
  are the state of the art. SMPL-X = research license; Anny (NAVER, 2025, Apache-2.0) is built on MakeHuman
  data (CC0, 2.4 mm to real scans). Decision: MakeHuman/MPFB2 data (CC0) + own JS mixer (no AGPL code).
- `scripts/build-human.mjs` (postinstall): base mesh (19,158 pts, 27k triangles, 125 joint cubes), 257 targets
  (ethnic gender x age, universal muscle x weight, body measures, local muscle/fat, face), game_engine skin
  weights -> public/human (8.7 MB, not in git).
- `src/human.js`: MakeHuman macro interpolation (race x gender x age, + muscle x weight), local targets,
  joints = centers of joint cubes, per-bone limb posing with skin weights (arms down, legs straight).
- `src/voxelize.js`: surface voxelization + outside flood fill -> closed shell, exact normals, crease shading.
  1 cm body 66 ms, 0.5 cm 170 ms (Node).
- `src/avatar.js` rewritten on the mesh: 1 cm body + 0.5 cm head/neck/hands, muscle groups from MakeHuman's own
  muscle targets (split front/back/inner by normal), fat from fat targets, clothes/face/beard painting, hair
  volume per style, GPU skinning (4 joint weights per cube, skinned shadows).
- `src/fit.js`: model measured like the photo; coordinate descent in phases (lengths -> widths -> all).
  Synthetic test: 12 measures, 2.2 % RMS in < 1 s. Neck = narrowest row (same on photo + model).
- Multi-scan: front + back photos (widths, lengths) and side photos (depths), several per view, median;
  file inputs accept multiple photos; table shows photo value (n photos) -> model value + fit error.
- Person inputs: gender (m / f / diverse) and age.
- Learned: MakeHuman gender/age live in the ethnic targets (universal ones only muscle/weight);
  fixed-height neck measure coupled all params -> use narrowest row; rigid cubes crack at knees -> GPU skinning;
  shadow lookup must be skinned too (worldpos_vertex), else dark blotches.

## Iteration 10: scan precision (user: focus on perfecting the scan; can friends use the link? -> yes, public HTTPS, all on-device)
- Accuracy harness `scripts/validate.mjs` (virtual people with known measures, phone-like renders, full pipeline) -> docs/ACCURACY.md.
- Mask: tiled multi-class segmentation FAILED (selfie model does not recognize body crops without a face) -> replaced by
  a guided filter (edge-aware refinement) on the pose mask; sanity check keeps the pose mask if the area changes > 10 %.
- Dense outline profiles (torso 10 heights, thigh/calf 4 each, front + side), outlier filter, arm-line clipping, hands below wrists.
- Limb widths from the outer edge (photo = model definition); model measured in the photo pose; calibrated virtual
  MediaPipe points; exact triangle cross-sections (vertex bands missed 2-4 cm mesh rows -> zeros in calf profile).
- Fit: 5 alternating phases; leg/arm length weights 6/3.
- Guided capture: live pose check on the camera image (same tips as photo check, green/orange frame), 3-2-1, burst of 4 photos.
- Corrections: white balance from the eye whites (all colors), clothing thickness taken off (shirt 1.2 cm, long pants 0.8 cm),
  +- spread per measure from several photos in the table.
- Results (6 virtual people, mean abs error): waist 0.5, hip 1.1, thigh 1.0, calf 0.2, upper arm 1.3, leg length 2.8 cm.

## Loop round 1 (v11): true colors
- User screenshot v10: skin grey-white, hair greenish. Two causes found:
  1. White balance over-corrected (sclera samples caught lids/skin). Now: only bright, nearly colorless pixels,
     both eyes must agree (r/g, b/g within 0.08), target = natural warm eye white, applied half-way, capped +-10 %.
  2. Rendering desaturated light skin (ACES + cool fill light): d9b8a3 rendered S 0.42 -> 0.27. Now NeutralToneMapping,
     neutral white lights, exposure 1.25: d9b8a3 -> d3b099 (S 0.40), c68e6e -> c08563, 8d5a3b -> 87502a, hue exact.
- Loop round 2: sleeveless tops frayed at the shoulder (bone ownership interleaves there). Arm hole now by position:
  above the armpit, skin outside the strap line (70 % of shoulder x), plus a wider scoop neck -> clean straps.
- Loop round 3 (v12): eyes looked like slits (lid gap only ~2 cubes, eyeball hidden behind lid cubes).
  First try (open lids via target + painted lash line) made a dark smudge -> reverted. Now: eyes as a clean almond-shaped
  drawing on the face surface (white, iris in scanned color, pupil, catch light, lash line), 12 % larger than real
  (playful, readable), no crease shading + lifted brightness in the eye socket. Head + neck now 0.33 cm cubes
  (hands 0.5 cm, body 1 cm): 42.5k cubes, 186 ms.
- Loop round 4 (v13): hairline + hair length from the hair mask. Before: fixed hairline height for everyone.
  Now the hair segmenter is scanned upward from the brows: hairline at the face center and at the temples (+-22 % face
  width, never lower than the center -> no "inverted triangle"), stored as share of eye-chin distance; side hair end
  (for medium/long hair) from the lowest hair pixel beside the face. Avatar uses both for the scalp edge and bangs.
- Loop round 5 (v14): face shape by analysis by synthesis (src/facefit.js). The smooth model head is rendered offscreen
  (640 px, eyes painted), the same MediaPipe face model finds its 478 points, the same ratios are measured (face.js
  faceRatios) and the 10 face target groups are solved with a finite-difference Jacobian + damped Gauss-Newton with line
  search (~15 renders, ~1 s on GPU). Findings: the old "average face" constants were off (model nose length 0.27 vs 0.33
  assumed, upper lip 0.032 vs 0.045); lip volume and chin width hardly move their landmarks -> lip height and chin bones
  targets; lips weighted 0.3 (only a few pixels tall). Eyes may hardly shrink (-0.35), else lids close to slits.
  Test with known faces: ratio error 4.6-5.1 % -> 0.1-1.1 %, target error 0.19-0.44 -> 0.04-0.16. Sample photo 6.5 -> 4.4 %.
- Loop round 6 (v15): brows + lips from the face scan instead of fixed default shapes. face.js faceFeatures() stores
  brow top/bottom edges (5 points outer -> inner) and mouth (corners, line, upper/lower lip edge, cupid's bow peaks)
  in half-eye-distance / eye-chin units, both sides averaged; avatar.js paints them there (brow ridge normals allowed
  down to n.z 0.05). Brow color = mean of the darkest 35 % of the pixels along both brows (a single spot mixed brow and
  skin: sample photo brow 94806d vs skin 988473), always <= 80 % of the skin brightness -> brows readable.
- Loop round 7 (v16): ears were painted with hair color (the back-of-head hair rule reached over them) -> speckled
  brown ears. Ear points now come from the MakeHuman ear-scale targets (points moved > 25 % of the max); ears and a box
  around them are never hair. Short hair side edge arcs above the ear and runs down behind it to the nape.
- Loop round 8 (v17): leg length (worst body error, 2.8 cm, legs always too short). Two causes:
  1. MediaPipe's hip point sits ~0.7 % of the height below the male hip joint but ~1.2 % above the female one
     (8 virtual people) -> leg landmark offsets per sex, blended with the gender slider.
  2. The fit used the leg length as a knob for the width profiles (shorter legs move the measuring heights to wider
     model rows): with the true legs the leg error was 0.0 but profile errors higher. Length phases now only look at
     the measured lengths. Result (6 people): leg 2.8 -> 0.4 cm, shoulder 1.5 -> 1.0, hip 1.1 -> 0.6, neck 1.7 -> 1.0,
     belly 0.8 -> 0.5; thigh 1.0 -> 1.2, waist 0.5 -> 0.6. Next: arm length always 0.7-1.9 cm short.
- Loop round 9 (v18): arm length always 0.7-1.9 cm short. The fit followed the photo exactly; the photo itself was short:
  MediaPipe's shoulder/wrist points sit inside the joint chain (landmark arm 2.2 % shorter, men and women alike) ->
  photo arm length / 0.978. Model arm length now also measured in the picture plane (x, y) like the photo landmarks.
  Result: arm 1.4 -> 0.2 cm, others unchanged (leg 0.5, hip 0.5, shoulder 1.1). Open: upper arm width 1.7, chest depth 1.3.
- Loop round 10 (v19): upper arm width 1.6-1.7 cm (photo 2.3-3.8 cm too wide, fit then made everyone too heavy:
  weight 0.9 vs true 0.4-0.6). validate.mjs now calibrates the landmarks against the joints in the PHOTO pose, also
  sideways: MediaPipe's limb points sit inside the joints (shoulder -0.84 %, elbow -1.19 % of height) -> photo limb
  center line too far in -> "2 x center line to outer edge" too wide. Applied in full it over-corrected (arms 1.8 cm too
  thin); half for the arm, full at the hip, none below the knee validates best. Result: upper arm 1.6 -> 0.5, thigh
  1.0 -> 0.8, shoulder 1.1 -> 0.9 cm, weight now close to the truth (5 of 6). Open: chest depth 1.3 cm.
- Loop round 11 (v20): chest depth 1.3 cm, always too deep. New photo columns in validate.mjs showed the SIDE PHOTO
  itself +0.3..+1.9 cm (belly right). Arms in the outline: tested, no effect. Cause: perspective - chest front/back
  (pecs, shoulder blades) sit off-center, closer to the camera (~5 % bigger at 2.75 m); navel/spine are centered.
  The fit now measures the model like the side photo: whole outline + depth x D/(D - |x|), D = 2.75 m (scan guide
  2.5-3 m); the true torso depth is still reported without. Chest 1.2 -> 0.7 cm. All body measures now <= 1.0 cm.
- Loop round 12 (v21): bent knees/elbows showed shingled cubes with gaps. Cause: linear blend skinning applied the
  blended matrix to the whole cube; blending two rotations also SHRINKS (~0.7 at 90 deg). Now the blended matrix only
  moves the cube center, the corners turn with the pure rotation (columns normalized) and grow by 1/sqrt(shrink)
  at strong bends. Knee in the deep squat much more closed (docs/screenshots/v21-squat-knee.png); stronger growth
  (1/shrink) did not help further - the last slits sit on the skin fold itself. Standing pose unchanged, accuracy
  unchanged (all <= 1.1 cm).

## Iteration 11: hairstyles + realistic hair (user: define hairstyles; hair should lie properly, especially long)
- Catalog avatar.js HAIR_STYLES (11): Glatze, Buzzcut, Kurz, Fade/Undercut, Tolle, Mittel, Bob mit Pony, Lang, Zopf,
  Dutt, Afro/Locken. The "Frisur" menu is built from it. Scan (face.js) picks one of: none, buzz (little volume on top),
  short, fade (little hair beside the temples: sideCover < 0.3), medium, bob (medium + fringe), long, afro (wide + high
  volume). Ponytail / bun cannot be seen from the front -> manual choice.
- Realism: hair is made of strands around the head, each with its own length (uneven natural ends, long hair a soft V
  in the back), thickness (clumps) and slight turn of its light normal (single strands catch the light), one shade per
  strand + a sheen ring on the curve of the head + a side parting. Long hair falls a little outward below the skull,
  lies on the back below the chin and gets thinner toward the tips. Fade: sides as stubble fading darker upward.
  Bun: ball on the back of the head with a hair tie. Screenshots: v22-hairstyles.png, v22-hair-long-bun.png.

## Iteration 12: facial features from more scan points (user: capture facial features more precisely)
- 21 measures instead of 11 (face.js faceRatios): + face outline at 4 heights (cheek -> chin = jaw shape), forehead
  height, brow height, mouth height, nose tip and chin depth (MediaPipe z), and the ABSOLUTE face size (face width /
  body height, from the full-body photo) - the ratios alone are scale-free, so a 5 % bigger head looked "right".
- 22 shape parameters instead of 10: + cheek bones, cheek volume, chin width, chin forward, nose depth, nose tip,
  brow height, mouth height, forehead, head fullness, head width, square head.
- Fit: measures x parameters Jacobian (not square any more), Gauss-Newton with 3 rounds (Jacobian measured again at the
  new face - the shapes are not linear), line search, mild prior against caricature values (V_PRIOR).
- New test: face SURFACE error in mm (front view) between true and fitted head, 8 random virtual faces:
  average face 13.9 mm, old estimate 15.3 mm, v21 fit n/a (scale-free), new fit 8.7 mm (6.9 without prior; the prior
  keeps real photos natural: without it the sample portrait got bloated cheeks at +-1 values).
- Known: the photo body outline includes the hair -> face size ~1 % low. ~4-9 s in the headless test (no GPU).

## Iteration 13: veins at low body fat (user: muscles with veins at low body fat %)
- Body fat % estimate: US Navy formula from tape-measure girths of the model (slice + convex hull perimeter):
  neck (narrowest), waist at the navel (men) / narrowest (women), hips (widest); gender slider blends both formulas.
  Default man ~12 %, woman ~26 %; follows the fat / muscle sliders. Shown under the fat slider.
- Veins painted on bare skin in limb frames (angle around the bone): forearm cephalic / basilic / median + diagonal
  median cubital vein in the elbow pit, back of the hand, cephalic vein in the outer biceps groove, a vein over the
  biceps, basilic vein, great + small saphenous at the calf, lower-belly "V" veins. Each has a threshold (men 7.5-15 %,
  women +8, more muscle = shows earlier) and gets stronger the leaner.
- Forearms now use the half-size cubes like the hands (veins as lines, not blotches): 42.6k -> 47.5k cubes, 187 -> 222 ms.
- Accuracy unchanged (all <= 1.0 cm). Screenshot: docs/screenshots/v24-veins.png.

## Loop 2 (user: near-perfect realistic voxel digitization; iPhone showed KFA 3.8 % and purple blotchy veins)
- Round 1 (v25): body fat: the Navy formula on the model overreacts to the neck (more muscle = thicker neck = "leaner").
  Now 50/50 with an estimate from the model's fat / weight / muscle settings, never below essential fat (men 5 %,
  women 12 %). Man default 13.5 %, fat -35 / muscle +30 11.7 % (was ~4 %), very lean 8.1 %; woman 25.7 %.
  Veins: fewer, anatomical, branched (forearm cephalic + branch, basilic, diagonal median cubital in the elbow pit,
  median, back of hand, cephalic in the biceps groove, biceps vein only very lean, calf); thin (1-2 fine cubes,
  tapering at the ends), meandering, subtle blue-grey (not purple) with a slightly lighter edge (raised look).
  Upper arms now also in 0.5 cm cubes (~55k cubes, ~215 ms). Accuracy all <= 1.2 cm. Screenshot v25-veins-fine.png.
- Round 2 (v26): muscle definition at low body fat. Per point the distance to the nearest border between two muscle
  groups (from the MakeHuman muscle labels, 2 cm grid, once) -> fine grooves there (deltoid / chest, biceps / triceps,
  quads / adductors ...), muscle bellies a touch lighter; six-pack on the straight belly muscle: center line, 3 tendon
  lines, outer edge. Starts at ~20 % body fat (men; women +8; more muscle = earlier), full at ~8 %. Bare skin only.
  At 1 cm cubes the lines were blotchy -> default cube size now 0.75 cm (details 0.375 / 0.25 cm): 98.5k cubes,
  ~430 ms build on desktop; 1 cm stays selectable ("schneller"). Accuracy all <= 1.3 cm. v26-muscle-definition.png.
- Round 3 (v27): real face from the photo ("Snapchat filter" / face-swap technique, all on the device). After the face
  fit the model head is rendered once more and MediaPipe finds its 478 points; each voxel face cube is projected into
  that render and mapped to the photo (affine fit of all points + local correction from the 8 nearest points on a
  96x96 grid) -> photo color with white balance; the photo's large-scale light is divided out (blurred copy, softened)
  so the voxel light does not shade the face twice; soft edge at the face outline and toward the sides, max 90 %.
  Painted brows / lips are dropped where the photo covers them; the drawn eyes stay (lively). Sample portrait: glasses,
  wrinkles, moustache and brows appear, clearly recognizable. Cost: map ~0.3 s, build +10 ms.
- Round 4 (v28): clothes from the photos (src/bodymap.js). The scan keeps a downscaled copy of the photo (device
  only). The fitted mesh is put into the photo pose, aligned with the photo (pixels per meter from shoulder -> ankle
  height, center from the hips - robust to MediaPipe's left/right swap on back photos), a depth buffer (3 px cells)
  decides what the camera really sees, the person mask rejects background. Each cube takes the photo color of its
  mesh triangle: front-facing from the front photo, back-facing from the back photo, blended by how directly it faces
  the camera. Applied to clothes / shoes; bare skin keeps the scanned tone (veins, definition follow the sliders) -
  but where the outfit guess said "skin" and the photo clearly shows something else (long sleeves taken for short),
  the photo wins. Sample portrait: suit lapel, buttons, lighter shirt, dark sleeves appear. Known: arms posed very
  differently from the fit (arm on a chair) get some wrong patches.
- Round 5 (v29): hair outline from the hair mask: half width per height (3 eye-chin units above the eyes to 3.5 below)
  + highest hair point; the avatar's hair thickness per height is set so its front outline matches (70 % outline,
  30 % style default, never below 60 % of it), only for the scanned style and only when the mask looks complete
  (>= 12 rows, hair well above the forehead). Round-trip test with rendered voxel hair: MediaPipe's hair segmenter
  only partly sees voxel hair (afro detected as short) - so synthetic tests cannot verify this; the safety checks
  keep a partial mask from shrinking real hair.
- PRIVACY FIX: MediaPipe tasks-vision 1.0.1 sends usage statistics (model names, timings) to
  odml.pa.googleapis.com every minute - no photos, but the app promises nothing leaves the device. Now answered
  locally (fetch shim in src/mplog.js) and blocked by a Content-Security-Policy (connect-src 'self' only). Verified:
  no request, no console error after > 60 s.
- Round 6 (v30): voxel-game render look. Screen-space AO was ruled out (post passes do not know the GPU skinning ->
  the AO would sit next to the animated cubes). Instead: studio image based light (RoomEnvironment via PMREM,
  intensity 0.3, hemisphere light lowered), exposure 1.12, and a cube-edge shading in the fragment shader (each face
  slightly darker toward its edges, 11 %, scaled by cube size: visible on 0.75 cm body cubes, faint on fine detail) -
  single cubes read like in MagicaVoxel / Teardown renders. Screenshot v30-voxel-look.png. Validation (renders use
  the scene light): shoulder 1.5, hip 1.1, others <= 0.9 cm - only the virtual test photos are affected, not real
  phone photos.
- Round 7 (v31): shoes as their own voxel volume (before: paint on the bare foot, toes showed). Foot footprint widened
  ~0.6 cm, filled up to the top of the foot + 0.5 cm (collar 2 cm above the ankle), light sole, the cubes follow the
  ankle joint. Reads as a sneaker. Screenshot v31-shoes.png. Accuracy unchanged (validation runs without shoes).
- Round 8 (v32): concept demo for instant understanding. "▶ Demo: So funktioniert Fit-me" on the 3D view plays a ~25 s
  tour with captions: 2 photos -> voxel body on the device (avatar turns), less fat + more muscle (definition, veins,
  body fat %), more fat, muscle groups view, walking + squat, call to scan. Any touch on the 3D view (or the button)
  stops it and restores the sliders. Screenshot v32-demo-mobile.png.

## Iteration 14: camera fix + voice guide (user: camera keeps firing, testing alone hardly possible; add a robot female voice)
- Causes: the guided capture fired by itself after 25 s, needed only ~1 s of a good pose (fired while still walking
  back), had no lock (several taps = several capture loops firing again and again) and no re-check.
- Now: one capture at a time (buttons locked, "Abbrechen" button); fires only when the pose is right AND you stand still
  (landmark movement < 1.5 % of the height) for 1.5 s (time based: same on fast and slow phones); the pose is checked
  again at every countdown step (lost -> "Position verloren", restart); never fires on a timeout (after 90 s it gives
  up without a photo).
- Voice (src/voice.js): browser speech (offline on iPhone), German female voice, pitch 1.3 ("robot" style) + two-tone
  beep before each instruction, shutter sound; instructions, live tips (not repeated within 4 s), 3-2-1, "Foto
  aufgenommen". Switch "Sprachansage".
- "Geführter Scan (Front → Seite → Rücken)": hands-free sequence for scanning yourself.
- Test with a virtual person streamed as the camera (canvas.captureStream instead of getUserMedia): nobody in the
  picture -> no photo; person steps in -> "Bitte still stehen" -> "Gut so" -> 3-2-1 -> 4 photos -> "Foto aufgenommen";
  no suitable pose -> gives up with a spoken message.
- v34: camera requests 1920 px (iPhone streams 1080 x 1920 upright, before 1280): the face in a full-body photo gets
  ~135 px instead of ~90 px for the face projection. Face fit adapts to the device: if one head render + face points
  takes > 0.35 s, 2 Gauss-Newton rounds instead of 3 (sample: 9.4 -> 6.3 %).
- v35 (user: instructions repeated too often; detection flickers down to "Ich sehe dich nicht"):
  * Live tracking like camera apps: a separate pose model in VIDEO mode (full model, no mask) follows the person from
    frame to frame instead of detecting each frame on its own; plausibility check against ghost poses (key point
    visibility >= 0.55, head > shoulders > hips > knees > ankles, body >= 25 % of the picture height); before the photos
    a cross-check with the precise model on the real frame.
  * Hysteresis: the shown / spoken state is the clear majority (>= 60 %) of the last 4 frames; "not seen" only after
    >= 3 frames and 1 s without a person; "still" = < 2.5 % movement over >= 1 s; all windows count frames AND time, so
    fast and slow phones behave the same. Looser checks: visibility 0.3 (feet on dark floors), body >= 40 % height.
  * Voice: the same hint at most every 15 s and at most 3 times per capture, >= 3 s between hints.
  * Tests (virtual person streamed as camera, light page so tracking runs at its real pace): 60 s empty room -> no
    photo, "Ich sehe dich nicht" 3x (15 s apart) then silent; person with a dropout every 7th frame -> no false "not
    seen", "Gut so" -> 3-2-1 -> photo, 6 spoken lines in total.
