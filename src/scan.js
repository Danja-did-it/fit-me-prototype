// Body scan with MediaPipe Pose Landmarker.
// Everything runs locally in the browser (WebAssembly). No image leaves the device.
//
// analyze(image) returns:
//   landmarks: 33 body points, x/y normalized 0..1 in the image (see MediaPipe docs)
//   mask:      person segmentation, one float (0..1) per pixel: 1 = person
//   width/height of the analyzed image
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// Files served from public/mediapipe (copied there by scripts/setup-mediapipe.mjs)
const BASE = import.meta.env.BASE_URL + 'mediapipe';

let landmarkerPromise = null;

// Load the model once (takes a few seconds the first time)
export function loadPose() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: `${BASE}/pose_landmarker_full.task`, delegate },
        runningMode: 'IMAGE',
        numPoses: 1,
        outputSegmentationMasks: true,
      });
      try {
        return await PoseLandmarker.createFromOptions(vision, options('GPU'));
      } catch (e) {
        console.info('GPU delegate unavailable, using CPU', e);
        return await PoseLandmarker.createFromOptions(vision, options('CPU'));
      }
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
    return {
      landmarks,
      mask,
      colors: sampleColors(image, landmarks, mask),
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
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
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
