// Face + hair analysis for an individual avatar (runs locally, nothing is uploaded).
//
// The front photo shows the whole body, so the face is small. We therefore cut a
// square around the head (found with the body pose points), scale it up to 512 px
// and run two MediaPipe models on it:
//   - Face Landmarker: 478 points on the face (incl. the irises)
//   - Hair Segmenter:  which pixels are hair
// From that we measure the face (relative to the face width), pick real colors
// (skin, eyes, lips, brows, hair) and guess the hairstyle and facial hair.
import { FilesetResolver, FaceLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL + 'mediapipe';
const CROP = 512;
let modelsPromise = null;

// MediaPipe prints harmless status lines ("INFO: Created TensorFlow Lite XNNPACK
// delegate") through console.error. Pass those on as info so real errors stay visible.
function quietInfoLogs() {
  const orig = console.error;
  console.error = (...args) => {
    if (typeof args[0] === 'string' && /^(INFO:|I\d{4} )/.test(args[0])) return console.info(...args);
    orig(...args);
  };
}

function loadModels() {
  if (!modelsPromise) {
    quietInfoLogs();
    modelsPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const make = async (Cls, opts) => {
        try { return await Cls.createFromOptions(vision, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'GPU' } }); }
        catch { return Cls.createFromOptions(vision, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'CPU' } }); }
      };
      const face = await make(FaceLandmarker, {
        baseOptions: { modelAssetPath: `${BASE}/face_landmarker.task` }, runningMode: 'IMAGE', numFaces: 1,
      });
      const hair = await make(ImageSegmenter, {
        baseOptions: { modelAssetPath: `${BASE}/hair_segmenter.tflite` }, runningMode: 'IMAGE',
        outputCategoryMask: true, outputConfidenceMasks: false,
      });
      return { face, hair };
    })();
    modelsPromise.catch(() => (modelsPromise = null));
  }
  return modelsPromise;
}

// ---- small helpers ----
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lum = (c) => 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);

// Average color of the pixels around point p (crop pixel coordinates);
// `keep` can reject pixels (e.g. reflections in the eye)
function sample(data, p, r, keep) {
  let R = 0, G = 0, B = 0, n = 0;
  for (let y = Math.round(p.y - r); y <= p.y + r; y++) for (let x = Math.round(p.x - r); x <= p.x + r; x++) {
    if (x < 0 || y < 0 || x >= CROP || y >= CROP || (x - p.x) ** 2 + (y - p.y) ** 2 > r * r) continue;
    const i = (y * CROP + x) * 4, rgb = [data[i], data[i + 1], data[i + 2]];
    if (keep && !keep(rgb)) continue;
    R += rgb[0]; G += rgb[1]; B += rgb[2]; n++;
  }
  if (!n) return null;
  return (Math.round(R / n) << 16) | (Math.round(G / n) << 8) | Math.round(B / n);
}

// Head square from the body pose (nose, ears, shoulders), in image pixels
function headBox(pose, w, h) {
  const P = (i) => ({ x: pose[i].x * w, y: pose[i].y * h });
  const nose = P(0), earL = P(7), earR = P(8), shL = P(11), shR = P(12);
  const size = Math.max(dist(earL, earR) * 4.2, dist(shL, shR) * 1.25, 64);
  return { x: nose.x - size / 2, y: nose.y - size * 0.5, size };
}

// Analyze the face on the front photo. Returns null if no face was found.
export async function analyzeFace(image, pose) {
  const { face, hair } = await loadModels();
  const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
  const box = headBox(pose, w, h);
  const crop = document.createElement('canvas');
  crop.width = crop.height = CROP;
  const ctx = crop.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, box.x, box.y, box.size, box.size, 0, 0, CROP, CROP);
  const pixels = ctx.getImageData(0, 0, CROP, CROP).data;

  const fr = face.detect(crop);
  if (!fr.faceLandmarks?.length) return null;
  const L = fr.faceLandmarks[0].map((p) => ({ x: p.x * CROP, y: p.y * CROP }));

  const hr = hair.segment(crop);
  const hairMask = hr.categoryMask.getAsUint8Array().slice();
  hr.close?.();

  // ---- measurements (ratios, 1 = average face) ----
  const fw = dist(L[234], L[454]);            // face width (cheek to cheek)
  const fh = dist(L[10], L[152]);             // forehead to chin
  const eyeW = (dist(L[33], L[133]) + dist(L[362], L[263])) / 2;
  const m = {
    faceLong: clamp(fh / fw / 1.18, 0.85, 1.18),
    jaw: clamp(dist(L[172], L[397]) / fw / 0.8, 0.82, 1.18),
    eyeSpacing: clamp(dist(L[133], L[362]) / fw / 0.235, 0.85, 1.18),
    eyeSize: clamp(eyeW / fw / 0.2, 0.85, 1.2),
    eyeOpen: clamp(((dist(L[159], L[145]) + dist(L[386], L[374])) / 2) / eyeW / 0.3, 0.6, 1.4),
    noseWidth: clamp(dist(L[64], L[294]) / fw / 0.25, 0.8, 1.25),
    noseLength: clamp(dist(L[168], L[2]) / fh / 0.33, 0.85, 1.2),
    mouthWidth: clamp(dist(L[61], L[291]) / fw / 0.36, 0.8, 1.25),
    lipUpper: clamp(dist(L[0], L[13]) / fh / 0.045, 0.6, 1.6),
    lipLower: clamp(dist(L[14], L[17]) / fh / 0.055, 0.6, 1.6),
    chin: clamp(dist(L[17], L[152]) / fh / 0.21, 0.8, 1.25),
  };

  // ---- white balance: the white of the eye is (almost) neutral white. Its color on
  // the photo tells us the color of the light; we correct all colors by it.
  const sclera = [];
  for (const [iris, a, b] of [[468, 133, 33], [473, 362, 263]]) {
    for (const corner of [a, b]) {
      const p = { x: L[iris].x + (L[corner].x - L[iris].x) * 0.55, y: L[iris].y + (L[corner].y - L[iris].y) * 0.55 };
      const c = sample(pixels, p, Math.max(1.5, dist(L[iris], L[corner]) * 0.12), ([R, G, B]) => R + G + B > 300);
      if (c !== null) sclera.push(c);
    }
  }
  let wb = [1, 1, 1];
  if (sclera.length >= 2) {
    const avgCh = (sh) => sclera.reduce((t, c) => t + ((c >> sh) & 255), 0) / sclera.length;
    const rgb = [avgCh(16), avgCh(8), avgCh(0)], gray = (rgb[0] + rgb[1] + rgb[2]) / 3;
    if (gray > 90) wb = rgb.map((v) => clamp(gray / v, 0.8, 1.25));
  }
  const fixWB = (c) => c == null ? c : (Math.min(255, Math.round(((c >> 16) & 255) * wb[0])) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * wb[1])) << 8) | Math.min(255, Math.round((c & 255) * wb[2]));

  // ---- colors ----
  const r = Math.max(3, fw * 0.035);
  const skin = sample(pixels, L[50], r) ?? 0xe0ac8a;           // left cheek
  const skin2 = sample(pixels, L[280], r) ?? skin;
  const skinMix = mixColors(skin, skin2);
  const irisR = Math.max(1.5, dist(L[468], L[469]) * 0.8);
  const notGlint = ([R, G, B]) => R + G + B < 600 && R + G + B > 40; // skip reflections + pupil
  const eyeCol = mixColors(sample(pixels, L[468], irisR, notGlint), sample(pixels, L[473], irisR, notGlint)) ?? 0x5a4030;
  const lip = mixColors(sample(pixels, mid(L[0], L[13]), r * 0.6), sample(pixels, mid(L[14], L[17]), r * 0.6)) ?? 0xc07f70;
  const brow = mixColors(sample(pixels, L[105], r * 0.6), sample(pixels, L[334], r * 0.6)) ?? 0x3a2a20;

  // hair color = average of hair pixels (without bright highlights)
  let HR = 0, HG = 0, HB = 0, hn = 0, minY = CROP, sideBottom = 0, bangs = 0, bandN = 0, maxW = 0;
  const faceL = L[234].x, faceR = L[454].x, top = L[10].y, browY = (L[105].y + L[334].y) / 2;
  for (let y = 0; y < CROP; y++) {
    let rowMin = CROP, rowMax = -1;
    for (let x = 0; x < CROP; x++) {
      const isHair = hairMask[y * CROP + x] > 0;
      const fx0 = faceL + (faceR - faceL) * 0.2, fx1 = faceR - (faceR - faceL) * 0.2; // middle of the forehead
      if (y > top && y < browY && x > fx0 && x < fx1) { bandN++; if (isHair) bangs++; }
      if (!isHair) continue;
      rowMin = Math.min(rowMin, x); rowMax = Math.max(rowMax, x);
      minY = Math.min(minY, y);
      if ((x < faceL || x > faceR) && y > sideBottom) sideBottom = y;
      const i = (y * CROP + x) * 4;
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 660) { HR += pixels[i]; HG += pixels[i + 1]; HB += pixels[i + 2]; hn++; }
    }
    if (rowMax > rowMin) maxW = Math.max(maxW, rowMax - rowMin);
  }
  const faceArea = fw * fh;
  const bald = hn < faceArea * 0.08;
  const hairColor = hn ? (Math.round(HR / hn) << 16) | (Math.round(HG / hn) << 8) | Math.round(HB / hn) : brow;
  // hair length: where the side hair ends, relative to the chin (in face heights)
  const endBelowChin = (sideBottom - L[152].y) / fh;
  const hairStyle = bald ? 'none' : endBelowChin > 0.9 ? 'long' : endBelowChin > -0.15 ? 'medium' : 'short';
  const hairInfo = {
    style: hairStyle,
    top: clamp((top - minY) / fh / 0.22, 0.4, 2),     // volume on top
    width: clamp(maxW / fw / 1.15, 0.8, 1.6),          // volume at the sides
    bangs: bandN > 0 && bangs / bandN > 0.55,
  };

  // facial hair: chin / jaw / upper lip clearly darker than the cheeks
  const sk = lum(skinMix);
  const dark = (p) => { const c = sample(pixels, p, r * 0.8); return c !== null && lum(c) < sk * 0.72; };
  const chinDark = dark(mid(L[17], L[152]));
  const jawDark = dark(mid(L[172], L[152])) && dark(mid(L[397], L[152]));
  const mustache = dark(mid(L[2], L[0]));
  const beard = chinDark && jawDark ? 'full' : chinDark ? 'goatee' : 'none';

  return {
    measures: m,
    wb, fixWB,
    colors: { skin: fixWB(skinMix), eye: fixWB(eyeCol), lip: fixWB(lip), brow: fixWB(brow), hair: fixWB(hairColor), beard: fixWB(mixColors(brow, hairColor)) },
    hair: hairInfo,
    beard, mustache,
    debug: { crop, landmarks: L, hairMask },
  };
}

function mixColors(a, b) {
  if (a == null) return b ?? null;
  if (b == null) return a;
  const ch = (c, s) => (c >> s) & 255;
  return (((ch(a, 16) + ch(b, 16)) >> 1) << 16) | (((ch(a, 8) + ch(b, 8)) >> 1) << 8) | ((ch(a, 0) + ch(b, 0)) >> 1);
}

// Draw the head crop with face points and hair (for the preview)
export function drawFace(canvas, f) {
  const { crop, landmarks, hairMask } = f.debug;
  canvas.width = canvas.height = CROP;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(crop, 0, 0);
  const img = ctx.getImageData(0, 0, CROP, CROP);
  for (let i = 0; i < hairMask.length; i++) if (hairMask[i]) {
    img.data[i * 4] = img.data[i * 4] * 0.5 + 120; img.data[i * 4 + 2] = img.data[i * 4 + 2] * 0.5 + 100;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = '#4fc3f7';
  for (const p of landmarks) ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
}
