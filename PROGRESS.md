# Progress

## Tasks
- [x] Vite + Three.js project, voxel cube renders
- [x] Voxel human template (head, torso, arms, legs) from cubes
- [x] Webcam/photo input with MediaPipe pose + segmentation
- [x] Map measured proportions (height, shoulder/hip width) onto template; support front + side photo
- [ ] Fat/muscle sliders -> per-region scaling + color
- [ ] Animations: idle, walk, squat
- [ ] Works in phone browser (HTTPS deploy)
- [ ] README: run steps + known limitations

## Learnings / Blockers
- Task 1: Vite 8 + three 0.186. Playwright MCP browser was locked by another session, so added `scripts/check.mjs` (playwright-core + installed Chrome, headless) to load the page, list console errors/HTTP failures and screenshot. "GPU stall due to ReadPixels" warnings come from headless screenshots, filtered out. Added inline favicon to avoid a 404.
- Task 2: `src/avatar.js`. Joint tree (hips > spine > chest > neck > head, shoulders > elbows, hips > knees > ankles); each segment = elliptic tube of 4 cm voxels in one InstancedMesh, only the shell is generated (~820 cubes total, cheap on phones). Body = `avatar.body` numbers + `avatar.build()`, so later tasks only change numbers. Colors via "bands" along each segment (sleeves, shorts, hair).
- Task 3: `src/scan.js`. PoseLandmarker (full model, IMAGE mode, segmentation masks on), GPU delegate with CPU fallback. Wasm + model are self-hosted in `public/mediapipe/` by `scripts/setup-mediapipe.mjs` (runs on `npm install`, not in git). Camera uses a 5 s self-timer and grabs a frame; photos load via file input (object URL, no upload). Tested with two public-domain Wikimedia photos + Chrome fake camera: both detected. MediaPipe prints 2 internal glog warnings ("OpenGL error checking is disabled", "NORM_RECT without IMAGE_DIMENSIONS") - harmless library noise, not app errors.
- Task 4: `src/measure.js`. User height (cm input) = scale; m/px = height / silhouette height. Front: shoulder/waist/hip/thigh widths from mask runs, leg + arm length from landmarks; side: chest + belly depth. Learned: arms touching the torso and touching legs inflate widths -> runs are clipped at elbows/wrists and at the body center line. Values clamped to plausible ranges. Avatar keeps arms outside the waist and spreads them if hips > shoulders. Skin/shirt/shorts/hair colors sampled from the front photo. Loose clothing (dress, suit) still inflates widths/depths - README limitation.
