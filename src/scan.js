// Body scan with MediaPipe Pose Landmarker.
// Everything runs locally in the browser (WebAssembly). No image leaves the device.
//
// analyze(image) returns:
//   landmarks: 33 body points, x/y normalized 0..1 in the image (see MediaPipe docs)
//   mask:      person segmentation, one float (0..1) per pixel: 1 = person
//   width/height of the analyzed image
import { FilesetResolver, PoseLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';

// Files served from public/mediapipe (copied there by scripts/setup-mediapipe.mjs)
const BASE = import.meta.env.BASE_URL + 'mediapipe';

let landmarkerPromise = null;

// Load the model once (takes a few seconds the first time)
export function loadPose() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      // "heavy" = most accurate pose model (30 MB); "full" as fallback
      const options = (delegate, model = 'heavy') => ({
        baseOptions: { modelAssetPath: `${BASE}/pose_landmarker_${model}.task`, delegate },
        runningMode: 'IMAGE',
        numPoses: 1,
        outputSegmentationMasks: true,
      });
      for (const [delegate, model] of [['GPU', 'heavy'], ['CPU', 'heavy'], ['CPU', 'full']]) {
        try { return await PoseLandmarker.createFromOptions(vision, options(delegate, model)); }
        catch (e) { console.info(`pose model ${model}/${delegate} unavailable`, e); }
      }
      throw new Error('Pose model could not be loaded');
    })();
    landmarkerPromise.catch(() => (landmarkerPromise = null)); // allow retry
  }
  return landmarkerPromise;
}

// Run pose + segmentation on an <img> or <canvas>. Returns null if no person found.
export async function analyze(image) {
  const landmarker = await loadPose();
  const result = landmarker.detect(image);
  try {
    if (!result.landmarks.length) return null;
    const m = result.segmentationMasks[0];
    // copy the mask: MediaPipe frees its memory when the result is closed
    const mask = { data: m.getAsFloat32Array().slice(), width: m.width, height: m.height };
    const landmarks = result.landmarks[0];
    // sharper silhouette for the measurements (falls back to the pose mask)
    let fineMask = null;
    try { fineMask = await refineMask(image, mask); } catch (e) { console.warn('mask refinement failed', e); }
    let outfit = null;
    try { outfit = await analyzeOutfit(image, landmarks, mask); } catch (e) { console.warn('outfit analysis failed', e); }
    const colors = sampleColors(image, landmarks, mask);
    if (outfit) Object.assign(colors, outfit.colors);
    // the photo itself, scaled down (stays on this device): its colors are projected onto the
    // clothes of the avatar (bodymap.js)
    const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height, ps = Math.min(1, 960 / ih);
    const pc = document.createElement('canvas');
    pc.width = Math.round(iw * ps); pc.height = Math.round(ih * ps);
    const pctx = pc.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(image, 0, 0, pc.width, pc.height);
    const photo = { pixels: pctx.getImageData(0, 0, pc.width, pc.height).data, width: pc.width, height: pc.height };
    return {
      landmarks,
      photo,
      mask: fineMask || mask,
      coarseMask: mask,
      outfit,
      colors,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    };
  } finally {
    result.close?.();
  }
}

// Average color of a small square around (x, y), given in 0..1 image coordinates
function averageColor(ctx, w, h, x, y, r) {
  const x0 = Math.round(Math.min(w - 2 * r, Math.max(0, x * w - r)));
  const y0 = Math.round(Math.min(h - 2 * r, Math.max(0, y * h - r)));
  const d = ctx.getImageData(x0, y0, 2 * r, 2 * r).data;
  let R = 0, G = 0, B = 0;
  for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
  const n = d.length / 4;
  return (Math.round(R / n) << 16) | (Math.round(G / n) << 8) | Math.round(B / n);
}

// Pick skin, shirt, shorts and hair color from the photo so the avatar looks like the user
function sampleColors(image, lm, mask) {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const r = Math.max(2, Math.round(w / 120)); // sample size ~1 % of the image
  const lerp = (a, b, t) => ({ x: lm[a].x + (lm[b].x - lm[a].x) * t, y: lm[a].y + (lm[b].y - lm[a].y) * t });
  const chest = lerp(11, 24, 0.5);  // diagonal shoulder -> opposite hip crosses the chest
  const thigh = lerp(23, 25, 0.4);  // upper thigh
  // hair: first person pixel above the nose, a little lower
  let top = 0;
  const col = Math.round(lm[0].x * mask.width);
  while (top < mask.height - 1 && mask.data[top * mask.width + col] <= 0.5) top++;
  const hairY = (top / mask.height) + 0.01;
  return {
    skin: averageColor(ctx, w, h, lm[0].x, (lm[0].y + (lm[9].y + lm[10].y) / 2) / 2, r), // below nose
    shirt: averageColor(ctx, w, h, chest.x, chest.y, r * 2),
    shorts: averageColor(ctx, w, h, thigh.x, thigh.y, r * 2),
    hair: averageColor(ctx, w, h, lm[0].x, hairY, r),
  };
}

// Draw image + blue person mask + skeleton lines into a canvas (for the preview)
export function drawScan(canvas, image, scan) {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, w, h);
  if (!scan) return;

  // mask -> semi-transparent blue overlay
  const { data, width: mw, height: mh } = scan.mask;
  const overlay = new ImageData(mw, mh);
  for (let i = 0; i < data.length; i++) {
    if (data[i] > 0.5) {
      overlay.data.set([79, 195, 247, 110], i * 4);
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = mw;
  tmp.height = mh;
  tmp.getContext('2d').putImageData(overlay, 0, 0);
  ctx.drawImage(tmp, 0, 0, w, h);

  // skeleton
  const lm = scan.landmarks;
  ctx.lineWidth = Math.max(2, w / 250);
  ctx.strokeStyle = '#ffd54f';
  for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(lm[start].x * w, lm[start].y * h);
    ctx.lineTo(lm[end].x * w, lm[end].y * h);
    ctx.stroke();
  }
  ctx.fillStyle = '#ff7043';
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, ctx.lineWidth * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- Camera ----
let stream = null;

// facing: 'user' = selfie camera, 'environment' = back camera (someone else takes the photo)
export async function startCamera(video, facing = 'user') {
  stopCamera(video);
  // the browser asks the user for permission
  stream = await navigator.mediaDevices.getUserMedia({
    // as sharp as the phone streams (iPhone: 1080 x 1920 upright): the face in a full-body photo is
    // small, its details (projected onto the voxel face) need every pixel
    video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

export function stopCamera(video) {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}

// Copy the current video frame into a canvas (the "photo")
export function captureFrame(video) {
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  return c;
}

// Load a user-selected file into an <img> (stays local, no upload)
export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ---------------------------------------------------------------------------
// Clothes vs skin with MediaPipe's multi-class segmenter
// (0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 accessories)
// ---------------------------------------------------------------------------
let segPromise = null;
function loadSegmenter() {
  if (!segPromise) {
    segPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: `${BASE}/selfie_multiclass_256x256.tflite`, delegate },
        runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: true,
      });
      try { return await ImageSegmenter.createFromOptions(vision, opts('GPU')); }
      catch { return ImageSegmenter.createFromOptions(vision, opts('CPU')); }
    })();
    segPromise.catch(() => (segPromise = null));
  }
  return segPromise;
}

const SKIN = 2, CLOTHES = 4, OTHER = 5;

// Look at the person region (square crop, 512 px) and decide what is worn where
async function analyzeOutfit(image, lm, mask) {
  const seg = await loadSegmenter();
  const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
  // bounding box of the person mask -> square crop
  let x0 = mask.width, x1 = 0, y0 = mask.height, y1 = 0;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    if (mask.data[y * mask.width + x] > 0.5) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  const sx = w / mask.width, sy = h / mask.height;
  const size = Math.max((x1 - x0) * sx, (y1 - y0) * sy) * 1.05;
  const cx = ((x0 + x1) / 2) * sx, cy = ((y0 + y1) / 2) * sy;
  const N = 512;
  const crop = document.createElement('canvas');
  crop.width = crop.height = N;
  const ctx = crop.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, cx - size / 2, cy - size / 2, size, size, 0, 0, N, N);
  const px = ctx.getImageData(0, 0, N, N).data;
  const res = seg.segment(crop);
  const cm = res.categoryMask, cat = cm.getAsUint8Array().slice(), mw = cm.width, mh = cm.height;
  res.close?.();

  // landmark -> crop pixel
  const P = (i) => ({ x: ((lm[i].x * w - (cx - size / 2)) / size) * N, y: ((lm[i].y * h - (cy - size / 2)) / size) * N });
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const r = N * 0.012;
  // share of each class + average color of one class around points
  function region(points) {
    const count = [0, 0, 0, 0, 0, 0];
    const col = { [SKIN]: [0, 0, 0, 0], [CLOTHES]: [0, 0, 0, 0], [OTHER]: [0, 0, 0, 0] };
    for (const p of points) for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
      const X = Math.round(p.x + dx), Y = Math.round(p.y + dy);
      if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
      const c = cat[Math.floor((Y / N) * mh) * mw + Math.floor((X / N) * mw)];
      count[c]++;
      if (col[c]) { const i = (Y * N + X) * 4; col[c][0] += px[i]; col[c][1] += px[i + 1]; col[c][2] += px[i + 2]; col[c][3]++; }
    }
    const total = count.reduce((a, b) => a + b, 0) || 1;
    const avg = (k) => col[k][3] ? (Math.round(col[k][0] / col[k][3]) << 16) | (Math.round(col[k][1] / col[k][3]) << 8) | Math.round(col[k][2] / col[k][3]) : null;
    return { skin: count[SKIN] / total, clothes: (count[CLOTHES] + count[OTHER]) / total, avg };
  }
  const side = (a, b, ts) => ts.map((t) => lerp(P(a), P(b), t));
  // torso: points between shoulders and hips
  const torsoPts = [];
  for (const t of [0.25, 0.5, 0.75]) for (const u of [0.3, 0.5, 0.7]) {
    torsoPts.push(lerp(lerp(P(11), P(23), t), lerp(P(12), P(24), t), u));
  }
  const torso = region(torsoPts);
  const upperArm = region([...side(11, 13, [0.3, 0.6]), ...side(12, 14, [0.3, 0.6])]);
  const forearm = region([...side(13, 15, [0.4, 0.7]), ...side(14, 16, [0.4, 0.7])]);
  const thighTop = region([...side(23, 25, [0.15, 0.35]), ...side(24, 26, [0.15, 0.35])]);
  const thighLow = region([...side(23, 25, [0.75, 0.9]), ...side(24, 26, [0.75, 0.9])]);
  const calf = region([...side(25, 27, [0.4, 0.7]), ...side(26, 28, [0.4, 0.7])]);
  const feet = region([...side(27, 31, [0.3, 0.7]), ...side(28, 32, [0.3, 0.7])]);

  const top = torso.clothes > 0.5 ? 'shirt' : 'none';
  const sleeves = top === 'none' ? 'none' : forearm.clothes > 0.5 ? 'long' : upperArm.clothes > 0.5 ? 'short' : 'none';
  const bottoms = calf.clothes > 0.5 ? 'long' : thighLow.clothes > 0.5 ? 'knee' : 'short';
  const shoes = feet.clothes > 0.4;
  const colors = {};
  // skin: prefer the face color (face.js); from the body only as fallback (glossy highlights skew it)
  const skinCol = torso.avg(SKIN) ?? upperArm.avg(SKIN) ?? forearm.avg(SKIN);
  if (skinCol !== null) colors.skin = skinCol;
  if (top === 'shirt' && torso.avg(CLOTHES) !== null) colors.shirt = torso.avg(CLOTHES);
  const pants = thighTop.avg(CLOTHES) ?? thighTop.avg(OTHER);
  if (pants !== null) colors.shorts = pants;
  const shoeCol = feet.avg(CLOTHES) ?? feet.avg(OTHER);
  if (shoes && shoeCol !== null) colors.shoe = shoeCol;
  return { top, sleeves, bottoms, shoes, colors };
}

// ---------------------------------------------------------------------------
// Scan quality: concrete tips when the photo will give poor measurements
// ---------------------------------------------------------------------------
export function scanQuality(scan, view) {
  const lm = scan.landmarks, tips = [];
  const vis = (i) => (lm[i].visibility ?? 1) > 0.5;
  if (!vis(0) || !vis(27) || !vis(28)) tips.push('Ganzer Körper von Kopf bis Fuß ins Bild (etwas Rand lassen).');
  const top = Math.min(...lm.map((p) => p.y)), bottom = Math.max(...lm.map((p) => p.y));
  if (bottom - top < 0.5) tips.push('Näher an die Kamera – der Körper sollte mehr als die halbe Bildhöhe füllen.');
  if (top < 0.03 || bottom > 0.99) tips.push('Etwas weiter weg: Kopf oder Füße sind am Bildrand abgeschnitten.');
  const shoulderDx = Math.abs(lm[11].x - lm[12].x), bodyH = Math.abs(lm[27].y - lm[11].y) || 1;
  if (view === 'front') {
    if (shoulderDx / bodyH < 0.18) tips.push('Frontal zur Kamera stellen (Schultern zeigen nach vorn).');
    const tilt = Math.abs(lm[11].y - lm[12].y) / (shoulderDx || 1);
    if (tilt > 0.12) tips.push('Gerade stehen – die Schultern sind schief.');
    const armGap = Math.min(Math.abs(lm[15].x - lm[23].x), Math.abs(lm[16].x - lm[24].x)) / bodyH;
    if (armGap < 0.05) tips.push('Arme etwas vom Körper weg (ca. 20–30°), sie dürfen die Hüfte nicht berühren.');
    if (scan.outfit?.top === 'shirt') tips.push('Für genauere Maße: oben ohne oder enges Sporttop.');
    if (scan.outfit?.bottoms === 'long') tips.push('Enge kurze Hose / Leggings statt langer Hose gibt genauere Beine.');
  } else if (shoulderDx / bodyH > 0.12) {
    tips.push('Für das Seitenfoto 90° drehen – eine Schulter zeigt zur Kamera.');
  }
  return tips;
}

// ---------------------------------------------------------------------------
// Sharper person mask: the pose model's mask is computed at 256 px and scaled up, so
// its edge is blurry. A "guided filter" (He et al.) snaps that soft mask to the real
// edges of the photo (edge-aware refinement, like in photo matting apps).
// ---------------------------------------------------------------------------
function boxFilter(src, W, H, r) {
  // mean over a (2r+1)^2 window using an integral image
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += src[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      const sum = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
      out[y * W + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

async function refineMask(image, coarse) {
  const W = coarse.width, H = coarse.height;
  let area0 = 0;
  for (let i = 0; i < coarse.data.length; i++) if (coarse.data[i] > 0.5) area0++;
  if (!area0) return null;
  // guide image: the photo in gray at mask resolution
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const I = new Float32Array(W * H);
  for (let i = 0; i < I.length; i++) I[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  const p = coarse.data;
  const r = Math.max(4, Math.round(Math.min(W, H) / 200)), eps = 1e-3;
  const mI = boxFilter(I, W, H, r), mP = boxFilter(p, W, H, r);
  const II = new Float32Array(W * H), IP = new Float32Array(W * H);
  for (let i = 0; i < I.length; i++) { II[i] = I[i] * I[i]; IP[i] = I[i] * p[i]; }
  const mII = boxFilter(II, W, H, r), mIP = boxFilter(IP, W, H, r);
  const A = new Float32Array(W * H), B = new Float32Array(W * H);
  for (let i = 0; i < I.length; i++) {
    const a = (mIP[i] - mI[i] * mP[i]) / (mII[i] - mI[i] * mI[i] + eps);
    A[i] = a; B[i] = mP[i] - a * mI[i];
  }
  const mA = boxFilter(A, W, H, r), mB = boxFilter(B, W, H, r);
  const data = new Float32Array(W * H);
  let area1 = 0;
  for (let i = 0; i < data.length; i++) {
    // only move the edge a little: keep the pose mask where it is certain
    const q = Math.min(1, Math.max(0, mA[i] * I[i] + mB[i]));
    data[i] = p[i] > 0.97 || p[i] < 0.03 ? p[i] : q;
    if (data[i] > 0.5) area1++;
  }
  const ratio = area1 / area0;
  if (ratio < 0.9 || ratio > 1.1) { console.info('fine mask rejected', ratio); return null; }
  return { data, width: W, height: H, refined: ratio };
}

// Fast pose check on a live camera frame (no masks) -> landmarks or null
export async function quickPose(image) {
  const landmarker = await loadPose();
  const r = landmarker.detect(image);
  const L = r.landmarks[0] || null;
  r.close?.();
  return L;
}
