// Turn MediaPipe scan results into body measurements in meters.
//
// A photo has no absolute scale, so the user's real height is the ruler:
//   meters per pixel = real height / height of the person silhouette in pixels.
// Widths are measured on the segmentation mask: at a given row we take the
// continuous run of "person" pixels around the body center (so arms that hang
// with a small gap next to the body are not counted).
//
// MediaPipe landmark indices used here:
//   0 nose, 11/12 shoulders, 13/14 elbows, 15/16 wrists, 23/24 hips, 25/26 knees
import { DEFAULT_BODY } from './avatar.js';

const isPerson = (mask, x, y) => mask.data[y * mask.width + x] > 0.5;

// Top and bottom row of the silhouette (rows with at least a few person pixels)
function verticalExtent(mask) {
  let top = -1, bottom = -1;
  for (let y = 0; y < mask.height; y++) {
    let n = 0;
    for (let x = 0; x < mask.width; x++) if (isPerson(mask, x, y)) n++;
    if (n > 2) { if (top < 0) top = y; bottom = y; }
  }
  return { top, bottom };
}

// Width (in pixels) of the person run that contains column cx on row y.
// Optional minX/maxX cut the run (e.g. at the body center or at the arms).
function runWidth(mask, y, cx, minX = 0, maxX = mask.width - 1) {
  y = Math.round(Math.min(mask.height - 1, Math.max(0, y)));
  cx = Math.round(cx);
  // if the center pixel is not person (e.g. gap between legs), look nearby
  let start = -1;
  for (let d = 0; d < mask.width * 0.05 && start < 0; d++) {
    if (isPerson(mask, cx + d, y)) start = cx + d;
    else if (isPerson(mask, cx - d, y)) start = cx - d;
  }
  if (start < 0) return 0;
  let l = start, r = start;
  while (l > 0 && isPerson(mask, l - 1, y)) l--;
  while (r < mask.width - 1 && isPerson(mask, r + 1, y)) r++;
  return Math.max(0, Math.min(r, maxX) - Math.max(l, minX) + 1);
}

// Landmark in mask pixel coordinates
const px = (scan, i) => ({ x: scan.landmarks[i].x * scan.mask.width, y: scan.landmarks[i].y * scan.mask.height });
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Front photo -> widths + lengths
export function measureFront(scan, height) {
  const { mask } = scan;
  const { top, bottom } = verticalExtent(mask);
  const k = height / (bottom - top); // meters per pixel

  const sh = mid(px(scan, 11), px(scan, 12));
  const hip = mid(px(scan, 23), px(scan, 24));
  const torso = hip.y - sh.y;
  const cx = hip.x;
  const armRpx = 0.045 / k; // typical arm radius in pixels

  // Arms resting against the body would make the torso look wider:
  // cut the silhouette at the inner side of the elbows / wrists.
  const [e1, e2] = [px(scan, 13).x, px(scan, 14).x].sort((a, b) => a - b);
  const [w1, w2] = [px(scan, 15).x, px(scan, 16).x].sort((a, b) => a - b);

  // Waist = narrowest row between chest and hips
  let waistPx = Infinity;
  for (let t = 0.45; t <= 0.85; t += 0.05) {
    waistPx = Math.min(waistPx, runWidth(mask, sh.y + t * torso, cx, e1 + armRpx, e2 - armRpx));
  }
  const hipPx = runWidth(mask, hip.y, cx, w1 + armRpx * 0.8, w2 - armRpx * 0.8);

  // One thigh, 30 % down from hip to knee. Cut at the body center line,
  // so legs that touch each other are not measured as one.
  const hipL = px(scan, 23), kneeL = px(scan, 25);
  const leftSide = hipL.x < cx;
  const thighPx = runWidth(mask, hipL.y + 0.3 * (kneeL.y - hipL.y), hipL.x,
    leftSide ? 0 : cx, leftSide ? cx : mask.width - 1);

  // Arm = shoulder -> elbow -> wrist (average of both sides)
  const armPx = (dist(px(scan, 11), px(scan, 13)) + dist(px(scan, 13), px(scan, 15)) +
                 dist(px(scan, 12), px(scan, 14)) + dist(px(scan, 14), px(scan, 16))) / 2;

  // Limb girths (widths seen from the front), cut at +-9 cm around the limb so a
  // touching body part is not counted
  const limb = (a, b, t, side) => {
    const pa = px(scan, a), pb = px(scan, b);
    const p = { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
    const lim = 0.09 / k;
    let lo = p.x - lim, hi = p.x + lim;
    if (side !== undefined) { if (p.x < cx) hi = Math.min(hi, cx); else lo = Math.max(lo, cx); }
    return runWidth(mask, p.y, p.x, lo, hi) * k;
  };
  const avg2 = (f) => (f(0) + f(1)) / 2;
  const mouthY = (px(scan, 9).y + px(scan, 10).y) / 2;

  const s = height / 1.75;
  return {
    height,
    // neck: just below the chin (60 % from shoulders up to the mouth), never wider than the jaw
    neckWidth: clamp(runWidth(mask, sh.y - 0.6 * (sh.y - mouthY), px(scan, 0).x, px(scan, 0).x - 0.08 / k, px(scan, 0).x + 0.08 / k) * k, 0.09 * s, 0.16 * s),
    upperArmWidth: clamp(avg2((i) => limb(11 + i, 13 + i, 0.55)), 0.065 * s, 0.17 * s),
    forearmWidth: clamp(avg2((i) => limb(13 + i, 15 + i, 0.3)), 0.055 * s, 0.13 * s),
    calfWidth: clamp(avg2((i) => limb(25 + i, 27 + i, 0.3, true)), 0.075 * s, 0.18 * s),
    shoulderWidth: clamp(runWidth(mask, sh.y + 0.03 * (bottom - top), cx) * k, 0.28 * s, 0.65 * s),
    waistWidth: clamp(waistPx * k, 0.20 * s, 0.60 * s),
    hipWidth: clamp(hipPx * k, 0.24 * s, 0.65 * s),
    thighWidth: clamp(thighPx * k, 0.11 * s, 0.32 * s),
    legLength: clamp((bottom - hip.y) * k, 0.42 * height, 0.60 * height),
    armLength: clamp(armPx * k, 0.40 * s, 0.70 * s),
  };
}

// Side photo -> front-to-back depths of chest and belly
export function measureSide(scan, height) {
  const { mask } = scan;
  const { top, bottom } = verticalExtent(mask);
  const k = height / (bottom - top);
  const sh = mid(px(scan, 11), px(scan, 12));
  const hip = mid(px(scan, 23), px(scan, 24));
  const torso = hip.y - sh.y;
  const s = height / 1.75;
  return {
    chestDepth: clamp(runWidth(mask, sh.y + 0.25 * torso, hip.x) * k, 0.15 * s, 0.45 * s),
    bellyDepth: clamp(runWidth(mask, sh.y + 0.75 * torso, hip.x) * k, 0.14 * s, 0.50 * s),
  };
}

// Combine: defaults <- front <- side <- face. Missing photos keep default proportions.
export function bodyFromScans(scans, height) {
  const s = height / 1.75;
  const body = { ...DEFAULT_BODY };
  // scale all default widths/lengths (numbers only) to the user's height
  for (const key of Object.keys(body)) if (key !== 'height' && typeof body[key] === 'number') body[key] *= s;
  body.height = height;
  if (scans.front) {
    Object.assign(body, measureFront(scans.front, height));
    if (scans.front.colors) body.colors = { ...body.colors, ...scans.front.colors };
  }
  if (scans.side) Object.assign(body, measureSide(scans.side, height));
  const f = scans.front?.face;
  if (f) {
    body.face = f.measures;
    body.look = { hair: f.hair, beard: f.beard, mustache: f.mustache };
    body.colors = { ...body.colors, ...f.colors };
  }
  return body;
}
