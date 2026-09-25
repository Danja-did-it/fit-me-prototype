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
