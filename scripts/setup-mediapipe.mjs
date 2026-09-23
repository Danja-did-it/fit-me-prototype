// Runs automatically after `npm install` (see "postinstall" in package.json).
// 1. Copies the MediaPipe WebAssembly runtime into public/ so the app serves it itself.
// 2. Downloads the pose model once (free, from Google). Photos are NEVER uploaded:
//    the model runs inside the browser.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';

const WASM_SRC = 'node_modules/@mediapipe/tasks-vision/wasm';
const OUT = 'public/mediapipe';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';
const MODEL = `${OUT}/pose_landmarker_full.task`;

mkdirSync(`${OUT}/wasm`, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm',
                 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  cpSync(`${WASM_SRC}/${f}`, `${OUT}/wasm/${f}`);
}
console.log('MediaPipe wasm copied to', OUT);

if (!existsSync(MODEL)) {
  console.log('Downloading pose model ...');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error('Model download failed: ' + res.status);
  writeFileSync(MODEL, Buffer.from(await res.arrayBuffer()));
}
console.log('Pose model ready:', MODEL);
