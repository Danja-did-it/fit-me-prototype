# Goal
Build a browser prototype (Vite + Three.js + MediaPipe) of a fitness app avatar:
1. Camera/photo scan -> 3D voxel ("pixel") avatar of the user
2. Sliders for body fat and muscle -> avatar visibly grows/shrinks per body region
3. Movement animation (idle, walk, squat)

# Rules
- Read PROGRESS.md first. Do ONLY the next unchecked task, then test it (run the app, check console errors).
- After each task: tick it in PROGRESS.md, note learnings/blockers, git commit.
- If a task fails 3 times, log the blocker in PROGRESS.md and move to the next task.
- Free tools only. All image processing runs locally in the browser, no photo upload.
- Before every install command, explain in one sentence what it does (I am a beginner).
- Keep code simple, few files, commented.

# Tasks (create PROGRESS.md with these if missing)
- [ ] Vite + Three.js project, voxel cube renders
- [ ] Voxel human template (head, torso, arms, legs) from cubes
- [ ] Webcam/photo input with MediaPipe pose + segmentation
- [ ] Map measured proportions (height, shoulder/hip width) onto template; support front + side photo
- [ ] Fat/muscle sliders -> per-region scaling + color
- [ ] Animations: idle, walk, squat
- [ ] Works in phone browser (HTTPS deploy)
- [ ] README: run steps + known limitations

# Done when
All boxes are ticked and the app runs without console errors. Then output DONE.
