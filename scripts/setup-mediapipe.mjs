// Runs automatically after `npm install` (see "postinstall" in package.json).
// 1. Copies the MediaPipe WebAssembly runtime into public/ so the app serves it itself.
// 2. Downloads the models once (free, from Google). Photos are NEVER uploaded:
//    the models run inside the browser.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';

const WASM_SRC = 'node_modules/@mediapipe/tasks-vision/wasm';
const OUT = 'public/mediapipe';
const G = 'https://storage.googleapis.com/mediapipe-models';
const MODELS = {
  'pose_landmarker_full.task': `${G}/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task`, // body
  'pose_landmarker_heavy.task': `${G}/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task`, // body, most accurate
  'selfie_multiclass_256x256.tflite': `${G}/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite`, // hair/skin/clothes
  'face_landmarker.task': `${G}/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`,                  // 478 face points
  'hair_segmenter.tflite': `${G}/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite`,                // hair mask
};

mkdirSync(`${OUT}/wasm`, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm',
                 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  cpSync(`${WASM_SRC}/${f}`, `${OUT}/wasm/${f}`);
}
console.log('MediaPipe wasm copied to', OUT);

for (const [file, url] of Object.entries(MODELS)) {
  const path = `${OUT}/${file}`;
  if (existsSync(path)) continue;
  console.log('Downloading', file, '...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}
console.log('Models ready in', OUT);
