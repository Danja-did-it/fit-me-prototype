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

// narrowest person run between two heights (for the neck)
function neckMin(mask, y0, y1, cx, lim) {
  let m = Infinity;
  for (let t = 0.3; t <= 0.85; t += 0.05) {
    const w = runWidth(mask, y0 + t * (y1 - y0), cx, cx - lim, cx + lim);
    if (w > 0) m = Math.min(m, w);
  }
  return m === Infinity ? 0 : m;
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


  // Arm = shoulder -> elbow -> wrist (average of both sides)
  const armPx = (dist(px(scan, 11), px(scan, 13)) + dist(px(scan, 13), px(scan, 15)) +
                 dist(px(scan, 12), px(scan, 14)) + dist(px(scan, 14), px(scan, 16))) / 2;

  // Limb girths (widths seen from the front), cut at +-9 cm around the limb so a
  // touching body part is not counted
  // Limb width measured from its OUTER edge (always next to air): twice the distance
  // from the outer edge to the limb's center line. A torso or other leg touching the
  // inner side does not matter then.
  const limb = (a, b, t) => outerWidth(scan, a, b, t, cx, k);
  const avg2 = (f) => (f(0) + f(1)) / 2;
  const mouthY = (px(scan, 9).y + px(scan, 10).y) / 2;

  // pose on the photo (the model is measured in the same pose, fit.js)
  const ang = (a, b) => Math.atan2(Math.abs(px(scan, b).x - px(scan, a).x), Math.abs(px(scan, b).y - px(scan, a).y));
  const armAngle = (ang(11, 13) + ang(12, 14)) / 2, legAngle = (ang(23, 27) + ang(24, 28)) / 2;

  const s = height / 1.75;
  return {
    height, armAngle, legAngle,
    // neck: narrowest row between 30 % and 85 % of the way from the shoulders to the mouth
    // (same definition as on the model, fit.js)
    neckWidth: clamp(neckMin(mask, sh.y, mouthY, px(scan, 0).x, 0.08 / k) * k, 0.06 * height, 0.085 * height),
    upperArmWidth: clamp(avg2((i) => limb(11 + i, 13 + i, 0.55)), 0.045 * height, 0.075 * height),
    forearmWidth: clamp(avg2((i) => limb(13 + i, 15 + i, 0.3)), 0.038 * height, 0.058 * height),
    calfWidth: clamp(avg2((i) => limb(25 + i, 27 + i, 0.3)), 0.05 * height, 0.078 * height),
    shoulderWidth: clamp(runWidth(mask, sh.y + 0.03 * (bottom - top), cx) * k, 0.22 * height, 0.30 * height),
    waistWidth: clamp(waistPx * k, 0.13 * height, 0.24 * height),
    hipWidth: clamp(hipPx * k, 0.17 * height, 0.26 * height),
    thighWidth: clamp(avg2((i) => limb(23 + i, 25 + i, 0.3)), 0.07 * height, 0.12 * height),
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
    chestDepth: clamp(runWidth(mask, sh.y + 0.25 * torso, hip.x) * k, 0.10 * height, 0.18 * height),
    bellyDepth: clamp(runWidth(mask, sh.y + 0.75 * torso, hip.x) * k, 0.09 * height, 0.20 * height),
  };
}

// Combine all photos: defaults <- median(front + back) <- median(sides) <- face.
const median = (list) => { const a = [...list].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
// half the range between the 25 % and 75 % values (robust +- of several photos)
function spreadOf(measures) {
  const out = {};
  if (measures.length < 2) return out;
  for (const key of Object.keys(measures[0])) {
    const a = measures.map((m) => m[key]).filter((v) => typeof v === 'number').sort((x, y) => x - y);
    if (a.length < 2) continue;
    out[key] = (a[Math.floor(a.length * 0.75)] - a[Math.floor(a.length * 0.25)]) / 2 || Math.abs(a[a.length - 1] - a[0]) / 2;
  }
  return out;
}
function medianOf(measures) {
  const out = {};
  for (const key of Object.keys(measures[0] || {})) out[key] = median(measures.map((m) => m[key]));
  return out;
}

export function bodyFromScans(scans, height) {
  const s = height / 1.75;
  const body = { ...DEFAULT_BODY };
  // scale all default widths/lengths (numbers only) to the user's height
  for (const key of Object.keys(body)) if (key !== 'height' && typeof body[key] === 'number') body[key] *= s;
  body.height = height;
  body.spread = {};
  if (scans.front.length) {
    const all = scans.front.map((sc) => measureFront(sc, height));
    Object.assign(body, medianOf(all));
    Object.assign(body.spread, spreadOf(all));
    const first = scans.front.find((sc) => sc.view === 'front') || scans.front[0];
    // colors from the photo, white-balanced with the eye whites (face.js)
    const wb = scans.face?.fixWB || ((c) => c);
    if (first.colors) for (const [k, c] of Object.entries(first.colors)) body.colors = { ...body.colors, [k]: wb(c) };
    // the face scan (later) sets skin/hair/eyes/lips from the face region - more reliable than the body
  }
  if (scans.side.length) {
    const all = scans.side.map((sc) => measureSide(sc, height));
    Object.assign(body, medianOf(all));
    Object.assign(body.spread, spreadOf(all));
  }
  body.height = height;
  // dense outline profiles (median over all photos of that view)
  body.profile = {
    ...(scans.front.length ? medianProfile(scans.front.map((sc) => profileFront(sc, height))) : {}),
    ...(scans.side.length ? medianProfile(scans.side.map((sc) => profileSide(sc, height))) : {}),
  };
  // human proportions: waist never wider than the shoulders, hips close to them
  body.waistWidth = Math.min(body.waistWidth, body.shoulderWidth * 0.9);
  body.hipWidth = Math.min(body.hipWidth, body.shoulderWidth * 1.1);
  body.thighWidth = Math.min(body.thighWidth, body.hipWidth * 0.55);
  body.look = { ...body.look };
  const f = scans.face;
  if (f) {
    body.face = f.measures;
    Object.assign(body.look, { hair: f.hair, beard: f.beard, mustache: f.mustache });
    body.colors = { ...body.colors, ...f.colors };
  }
  if (scans.outfit) {
    const o = scans.outfit;
    body.look.outfit = { top: o.top, sleeves: o.sleeves, bottoms: o.bottoms, shoes: o.shoes };
    // clothes add fabric + a small air gap to the silhouette: take it off again
    const off = (keys, cm) => { for (const k of keys) if (body[k]) body[k] = Math.max(0.05, body[k] - cm / 100); };
    const offP = (keys, cm) => { for (const k of keys) if (body.profile[k]) body.profile[k] = body.profile[k].map((v) => (v ? Math.max(0.05, v - cm / 100) : 0)); };
    if (o.top === 'shirt') { off(['waistWidth', 'chestDepth', 'bellyDepth'], 1.2); offP(['pTorso', 'pTorsoD'], 1.2); }
    if (o.sleeves !== 'none' && o.top === 'shirt') off(['upperArmWidth'], 0.6);
    if (o.bottoms === 'long') { off(['thighWidth', 'calfWidth'], 0.8); offP(['pThigh', 'pCalf', 'pThighD', 'pCalfD'], 0.8); off(['hipWidth'], 0.8); }
  }
  return body;
}

// ---------------------------------------------------------------------------
// Dense silhouette profiles: widths (front) and depths (side) at many heights,
// relative to the body landmarks. The model is measured at exactly the same
// relative heights (fit.js), so the whole outline is matched, not just 5 spots.
// ---------------------------------------------------------------------------
export const TORSO_T = [0.05, 0.12, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76]; // hip (0) -> shoulder (1)
export const LEG_T = [0.3, 0.45, 0.6, 0.75];                                      // along thigh / calf (skips the crotch)

// 2 x distance from the bone line (between landmarks a and b, at fraction t) to the limb's
// outer edge (the side facing away from the body center cx). Same definition as on the model.
function outerWidth(scan, a, b, t, cx, k) {
  const { mask } = scan;
  const pa = px(scan, a), pb = px(scan, b);
  const p = { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
  const y = Math.round(Math.min(mask.height - 1, Math.max(0, p.y)));
  const outward = p.x < cx ? -1 : 1, lim = 0.15 / k;
  const x = Math.round(p.x);
  if (!isPerson(mask, x, y)) return 0;
  let d = 0;
  while (d < lim && isPerson(mask, x + outward * (d + 1), y)) d++;
  return 2 * (d + 0.5) * k;
}

// x of the arm's center line (shoulder -> elbow -> wrist) at height y, or null
function armX(scan, y, side) {
  const [s, e, w] = side === 'L' ? [11, 13, 15] : [12, 14, 16];
  const pts = [px(scan, s), px(scan, e), px(scan, w)];
  for (let i = 0; i < 2; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((y - a.y) * (y - b.y) <= 0 && a.y !== b.y) return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
  }
  return null;
}

export function profileFront(scan, height) {
  const { mask } = scan;
  const { top, bottom } = verticalExtent(mask);
  const k = height / (bottom - top);
  const hip = mid(px(scan, 23), px(scan, 24)), sh = mid(px(scan, 11), px(scan, 12));
  const armR = 0.04 / k, handR = 0.045 / k;
  const torso = TORSO_T.map((t) => {
    if (t > 0.62) return 0; // near the armpits the arms hide the torso edge: not measurable
    const y = hip.y + (sh.y - hip.y) * t;
    // cut at the inner side of each arm (following the arm line) or hand (below the wrists)
    const cut = (side, idx) => {
      const x = armX(scan, y, side);
      if (x !== null) return x;
      const w = px(scan, idx);
      return y > w.y ? w.x : null; // hands hang next to the hips
    };
    const xs = [cut('L', 15), cut('R', 16)].filter((v) => v !== null).sort((a, b) => a - b);
    let lo = 0, hi = mask.width - 1;
    if (xs.length === 2) {
      const r = armX(scan, y, 'L') !== null ? armR : handR;
      lo = xs[0] + r; hi = xs[1] - r;
    }
    return runWidth(mask, y, hip.x, lo, hi) * k;
  });
  // leg widths like the model: 2 x distance from the bone line to the outer edge
  const leg = (a) => LEG_T.map((t) => {
    const w = [[23, 25, 27], [24, 26, 28]].map(([h, kn, an]) => outerWidth(scan, a === 'thigh' ? h : kn, a === 'thigh' ? kn : an, t, hip.x, k));
    return (w[0] + w[1]) / 2;
  });
  return { pTorso: clean(torso), pThigh: clean(leg('thigh')), pCalf: clean(leg('calf')) };
}

export function profileSide(scan, height) {
  const { mask } = scan;
  const { top, bottom } = verticalExtent(mask);
  const k = height / (bottom - top);
  const hip = mid(px(scan, 23), px(scan, 24)), sh = mid(px(scan, 11), px(scan, 12));
  const knee = mid(px(scan, 25), px(scan, 26)), ankle = mid(px(scan, 27), px(scan, 28));
  const torso = TORSO_T.map((t) => runWidth(mask, hip.y + (sh.y - hip.y) * t, hip.x + (sh.x - hip.x) * t) * k);
  const seg = (p, q) => LEG_T.map((t) => runWidth(mask, p.y + (q.y - p.y) * t, p.x + (q.x - p.x) * t) * k);
  return { pTorsoD: clean(torso), pThighD: clean(seg(hip, knee)), pCalfD: clean(seg(knee, ankle)) };
}

// drop outliers (hand on a chair, bag ...): a value more than 20 % away from its
// neighbors is set to 0 (= ignored by the fit)
function clean(arr) {
  return arr.map((v, i) => {
    const nb = [arr[i - 1], arr[i + 1]].filter((x) => x > 0);
    if (!v || !nb.length) return v;
    const m = nb.reduce((a, b) => a + b, 0) / nb.length;
    return Math.abs(v - m) > 0.2 * m ? 0 : v;
  });
}

// element-wise median of several profiles (zeros = missing)
export function medianProfile(list) {
  const out = {};
  for (const key of Object.keys(list[0] || {})) out[key] = list[0][key].map((_, i) => { const v = list.map((p) => p[key][i]).filter((x) => x > 0); return v.length ? median(v) : 0; });
  return out;
}
