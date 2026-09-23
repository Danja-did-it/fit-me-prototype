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
