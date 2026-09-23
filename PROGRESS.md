# Progress

## Tasks
- [x] Vite + Three.js project, voxel cube renders
- [ ] Voxel human template (head, torso, arms, legs) from cubes
- [ ] Webcam/photo input with MediaPipe pose + segmentation
- [ ] Map measured proportions (height, shoulder/hip width) onto template; support front + side photo
- [ ] Fat/muscle sliders -> per-region scaling + color
- [ ] Animations: idle, walk, squat
- [ ] Works in phone browser (HTTPS deploy)
- [ ] README: run steps + known limitations

## Learnings / Blockers
- Task 1: Vite 8 + three 0.186. Playwright MCP browser was locked by another session, so added `scripts/check.mjs` (playwright-core + installed Chrome, headless) to load the page, list console errors/HTTP failures and screenshot. "GPU stall due to ReadPixels" warnings come from headless screenshots, filtered out. Added inline favicon to avoid a 404.
