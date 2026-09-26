// Fit the human model to the scan ("analysis by synthesis").
//
// We measure the model exactly like the photo is measured (same body positions, see
// measure.js) and adjust MakeHuman's measurement targets (+ overall weight and muscle)
// until the model matches the scan. Because the model is always a plausible human body,
// the result keeps realistic proportions even when single photo measurements are noisy.

// Which target changes which measurement (value -1..+1 per parameter)
const PARAMS = [
  { key: 'weight', macro: true, affects: ['waistWidth', 'hipWidth', 'thighWidth', 'bellyDepth'] },
  { key: 'muscle', macro: true, affects: ['shoulderWidth', 'upperArmWidth', 'calfWidth', 'chestDepth'] },
  { key: 'shoulder', targets: ['torso/measure-shoulder-dist'], affects: ['shoulderWidth'] },
  { key: 'bust', targets: ['torso/measure-bust-circ'], affects: ['chestDepth', 'shoulderWidth'] },
  { key: 'waist', targets: ['torso/measure-waist-circ'], affects: ['waistWidth'] },
  { key: 'belly', targets: ['stomach/stomach-pregnant'], affects: ['bellyDepth'] },
  { key: 'hips', targets: ['torso/measure-hips-circ'], affects: ['hipWidth'] },
  { key: 'thigh', targets: ['legs/measure-thigh-circ'], affects: ['thighWidth'] },
  { key: 'calf', targets: ['legs/measure-calf-circ'], affects: ['calfWidth'] },
  { key: 'neck', targets: ['neck/measure-neck-circ'], affects: ['neckWidth'] },
  { key: 'upperarm', targets: ['arms/measure-upperarm-circ'], affects: ['upperArmWidth'] },
  { key: 'forearm', targets: ['arms/l-lowerarm-muscle', 'arms/r-lowerarm-muscle'], affects: ['forearmWidth'] },
  { key: 'legs', targets: ['legs/measure-upperleg-height', 'legs/measure-lowerleg-height'], affects: ['legLength'] },
  { key: 'arms', targets: ['arms/measure-upperarm-length', 'arms/measure-lowerarm-length'], affects: ['armLength'] },
  // finer shape controls, driven by the dense outline profiles
  { key: 'torsoW', targets: ['torso/torso-scale-horiz'], affects: ['pTorso'] },
  { key: 'torsoD', targets: ['torso/torso-scale-depth'], affects: ['pTorsoD'] },
  { key: 'underbust', targets: ['torso/measure-underbust-circ'], affects: ['pTorso', 'pTorsoD'] },
  { key: 'hipW', targets: ['hip/hip-scale-horiz'], affects: ['pTorso'] },
  { key: 'hipD', targets: ['hip/hip-scale-depth'], affects: ['pTorsoD'] },
  { key: 'butt', targets: ['buttocks/buttocks-volume'], affects: ['pTorsoD'] },
  { key: 'knee', targets: ['legs/measure-knee-circ'], affects: ['pThigh', 'pCalf'] },
  { key: 'thighFat', targets: ['legs/l-upperleg-fat', 'legs/r-upperleg-fat'], affects: ['pThigh', 'pThighD'] },
  { key: 'calfMuscle', targets: ['legs/l-lowerleg-muscle', 'legs/r-lowerleg-muscle'], affects: ['pCalf', 'pCalfD'] },
];
export const FRONT_PROFILES = ['pTorso', 'pThigh', 'pCalf'];
export const SIDE_PROFILES = ['pTorsoD', 'pThighD', 'pCalfD'];
const TORSO_T = [0.05, 0.12, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76]; // same as measure.js
const LEG_T = [0.3, 0.45, 0.6, 0.75]; // same as measure.js (skips the crotch)
export const FRONT_KEYS = ['shoulderWidth', 'waistWidth', 'hipWidth', 'thighWidth', 'legLength', 'armLength',
  'neckWidth', 'upperArmWidth', 'forearmWidth', 'calfWidth'];
export const SIDE_KEYS = ['chestDepth', 'bellyDepth'];
// how much each measurement counts (neck and forearm are the least reliable on photos)
const WEIGHT = { neckWidth: 0.3, forearmWidth: 0.5, legLength: 6, armLength: 3, pTorso: 2, pTorsoD: 1.5, pThigh: 1, pCalf: 1, pThighD: 0.7, pCalfD: 0.7 };

// Measure the posed model like the photo (meters)
// Where MediaPipe puts its body points relative to the model's joints (share of body
// height, measured with scripts/validate.mjs on rendered virtual people). The model is
// measured at these "virtual MediaPipe points" so photo and model compare the same spots.
export const LANDMARK_OFFSET = { shoulder: -0.003, elbow: -0.009, hand: -0.001, hip: 0.005, knee: 0.0175, ankle: 0.049 };
// The leg points depend on the sex: MediaPipe's hip point sits ~0.7 % of the height BELOW the male
// hip joint but ~1.2 % ABOVE the female one (pelvis shape; 8 virtual people). One shared value
// made male legs ~3-4 cm too short. [female, male], blended with the gender slider.
const LEG_OFFSET = { hip: [0.0118, -0.007], knee: [0.0155, 0.0125], ankle: [0.0447, 0.051] };
// Sideways: MediaPipe's limb points sit INSIDE the joints (toward the body center), share of
// height. Without this the limb center line on the photo is too far in and the upper arm
// (2 x center line -> outer edge) came out ~2 cm too wide. Measured in the photo pose: shoulder
// -0.0084, elbow -0.0119, hip -0.0056, knee -0.0056, ankle -0.0034; applied in full they
// over-corrected (arms 1.8 cm too thin, calves 1.6), so the values below are the ones that
// validate best (half for the arm, none below the knee where the calf was already right).
const X_OFFSET = { shoulder: -0.0042, elbow: -0.006, hand: -0.003, hip: -0.0056 };
export const landmarkOffset = (key, gender = 0.5) =>
  LEG_OFFSET[key] ? LEG_OFFSET[key][0] + (LEG_OFFSET[key][1] - LEG_OFFSET[key][0]) * gender : LANDMARK_OFFSET[key];

// silhouette: side depths like the side photo sees them (arms included - at chest height the upper
// arms are part of the outline). The fit uses it; the true torso depth is measured without.
export function measureModel(av, shape, { silhouette = false } = {}) {
  const { pos } = shape;
  const W = {};
  const Hh = av.body.height;
  for (const [j, w] of Object.entries(shape.W)) {
    const key = j.replace(/[LR]$/, '');
    const off = landmarkOffset(key, av.person?.gender), ox = (X_OFFSET[key] ?? 0) * Hh * Math.sign(w[0]);
    W[j] = off !== undefined ? [w[0] + ox, w[1] + off * Hh, w[2]] : w;
  }
  const J = av.vertJoint, N = 13380, H = av.body.height;
  const ys = (W.shoulderL[1] + W.shoulderR[1]) / 2, yh = (W.hipL[1] + W.hipR[1]) / 2;
  const torso = (v) => J[v] === 'hips' || J[v] === 'spine' || J[v] === 'chest';
  const side = silhouette ? () => true : torso; // the photo outline contains everything at that height
  // Exact cross-sections: every triangle crossing height y gives two contour points.
  // Triangles are sorted into 1 cm height buckets first, so a slice only checks a few.
  const F = av.H.faces, nT = F.length / 3, B = 0.01;
  const buckets = [];
  for (let t = 0; t < nT; t++) {
    const a = F[t * 3], b = F[t * 3 + 1], c = F[t * 3 + 2];
    if (a >= N || b >= N || c >= N) continue; // body only (no eyes)
    const y0 = Math.min(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]), y1 = Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]);
    for (let k = Math.floor(y0 / B); k <= Math.floor(y1 / B); k++) (buckets[k] ||= []).push(t);
  }
  const slice = (y, test, cb) => {
    for (const t of buckets[Math.floor(y / B)] || []) {
      const v0 = F[t * 3];
      if (!test(v0)) continue;
      const vs = [v0, F[t * 3 + 1], F[t * 3 + 2]];
      for (let e = 0; e < 3; e++) {
        const p = vs[e], q = vs[(e + 1) % 3];
        const yp = pos[p * 3 + 1], yq = pos[q * 3 + 1];
        if ((yp - y) * (yq - y) > 0 || yp === yq) continue;
        const f = (y - yp) / (yq - yp);
        cb(pos[p * 3] + (pos[q * 3] - pos[p * 3]) * f, pos[p * 3 + 2] + (pos[q * 3 + 2] - pos[p * 3 + 2]) * f);
      }
    }
  };
  // x (axis 0) or z (axis 2) extent of the cross-section at height y
  // Side photo perspective: points beside the body center are closer to the camera and look
  // bigger (scan guide: 2.5-3 m away). Chest front/back (pecs, shoulder blades) sit off-center,
  // so the side photo sees the chest ~5 % deeper than it is; the belly (navel, spine) not.
  const CAM = 2.75;
  const extent = (y, test, axis = 0) => {
    let lo = Infinity, hi = -Infinity;
    const persp = silhouette && axis === 2;
    slice(y, test, (x, z) => { const c = axis === 0 ? x : persp ? z * CAM / (CAM - Math.abs(x)) : z; if (c < lo) lo = c; if (c > hi) hi = c; });
    return hi > lo ? hi - lo : 0;
  };
  const lerpY = (a, b, t) => a[1] + (b[1] - a[1]) * t;
  // limb width = 2 x distance from the bone line (between the two joints) to the OUTER edge,
  // exactly like on the photo (measure.js)
  const limb = (jn, a, b, t) => {
    const y = lerpY(a, b, t), bx = a[0] + (b[0] - a[0]) * t, side = Math.sign(bx) || 1;
    let out = 0;
    slice(y, (v) => J[v] === jn && !av.vertHand[v], (x) => { out = Math.max(out, (x - bx) * side); });
    return 2 * out;
  };
  // neck = narrowest row between 30 % and 85 % of the way from the shoulders to the mouth
  const narrowest = (y0, y1, test) => {
    let m = Infinity;
    for (let t = 0.3; t <= 0.85; t += 0.05) { const w = extent(y0 + t * (y1 - y0), test, 0); if (w > 0) m = Math.min(m, w); }
    return m === Infinity ? 0 : m;
  };
  let waist = Infinity;
  for (let t = 0.45; t <= 0.85; t += 0.05) waist = Math.min(waist, extent(ys - t * (ys - yh), torso) || Infinity);
  // arm length in the picture plane (x, y), like the landmark distances on the front photo:
  // the elbow is slightly bent forward, a 3D length would be longer than what the photo sees
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const mouthY = (W.eyeL[1] + W.eyeR[1]) / 2 - 0.07 * (H / 1.75);
  const avg = (f) => (f('L') + f('R')) / 2;
  return {
    shoulderWidth: extent(ys - 0.03 * H, (v) => !av.vertHand[v]),
    waistWidth: waist,
    hipWidth: extent(yh, (v) => torso(v) || /^hip/.test(J[v])),
    thighWidth: avg((S) => limb('hip' + S, W['hip' + S], W['knee' + S], 0.3)),
    legLength: yh,
    armLength: avg((S) => dist(W['shoulder' + S], W['elbow' + S]) + dist(W['elbow' + S], W['hand' + S])),
    neckWidth: narrowest(ys, mouthY, (v) => (J[v] === 'neck' || J[v] === 'head') && Math.abs(pos[v * 3]) < 0.09),
    upperArmWidth: avg((S) => limb('shoulder' + S, W['shoulder' + S], W['elbow' + S], 0.55)),
    forearmWidth: avg((S) => limb('elbow' + S, W['elbow' + S], W['hand' + S], 0.3)),
    calfWidth: avg((S) => limb('knee' + S, W['knee' + S], W['ankle' + S], 0.3)),
    chestDepth: extent(ys - 0.25 * (ys - yh), side, 2),
    bellyDepth: extent(ys - 0.75 * (ys - yh), side, 2),
    // outline profiles at the same relative heights as on the photo
    pTorso: TORSO_T.map((t) => extent(yh + (ys - yh) * t, torso)),
    pTorsoD: TORSO_T.map((t) => extent(yh + (ys - yh) * t, side, 2)),
    pThigh: LEG_T.map((t) => avg((S) => limb('hip' + S, W['hip' + S], W['knee' + S], t))),
    pCalf: LEG_T.map((t) => avg((S) => limb('knee' + S, W['knee' + S], W['ankle' + S], t))),
    pThighD: LEG_T.map((t) => avg((S) => extent(lerpY(W['hip' + S], W['knee' + S], t), (v) => J[v] === 'hip' + S, 2))),
    pCalfD: LEG_T.map((t) => avg((S) => extent(lerpY(W['knee' + S], W['ankle' + S], t), (v) => J[v] === 'knee' + S, 2))),
  };
}

// Fit: coordinate descent over the parameters. keys = which measurements the scan has.
export function fitToScan(av, target, keys) {
  const t0 = performance.now();
  // the scan is the person as they are now: fit with neutral fat/muscle sliders
  const comp = av.composition;
  av.composition = { ...comp, fat: 0, muscle: 0, groups: {} };
  // measure the model in the pose of the photo (arm / leg angles), restore afterwards
  const pose = [av.poseSpread, av.poseLegSpread];
  if (target.armAngle) { av.poseSpread = target.armAngle; av.poseLegSpread = target.legAngle; }
  const p = { weight: 0.5, muscle: 0.5 };
  for (const P of PARAMS) if (!P.macro) p[P.key] = 0;
  const active = PARAMS.filter((P) => P.affects.some((k) => keys.includes(k)));
  const apply = () => {
    av.fit = { weight: p.weight, muscle: p.muscle, local: {} };
    for (const P of PARAMS) if (!P.macro) for (const t of P.targets) av.fit.local[t] = p[P.key];
  };
  const cost = (use = keys) => {
    apply();
    const m = measureModel(av, av.shape(), { silhouette: true });
    let c = 0;
    for (const k of use) {
      if (k.startsWith('p')) { // profile: average relative error over its points
        const T = target.profile?.[k], M = m[k];
        if (!T) continue;
        let e = 0, n = 0;
        T.forEach((t, i) => { if (t > 0 && M[i] > 0) { e += ((M[i] - t) / t) ** 2; n++; } });
        if (n) c += (WEIGHT[k] ?? 1) * e / n;
      } else if (target[k] > 0 && m[k] > 0) c += (WEIGHT[k] ?? 1) * ((m[k] - target[k]) / target[k]) ** 2;
    }
    return c;
  };
  let evals = 1;
  // coordinate descent in phases: lengths first (they move all measuring heights),
  // then widths / depths, then everything together with small steps.
  // Length phases only look at the measured lengths: otherwise the fit shortens the legs to
  // move the width profiles to where the model happens to be wider (validate.mjs: legs 3-4 cm too
  // short while the photo leg length was right within 1 cm).
  const LENGTHS = ['legs', 'arms'];
  const lengthKeys = keys.filter((k) => k === 'legLength' || k === 'armLength');
  const lengths = active.filter((P) => LENGTHS.includes(P.key)), shapes = active.filter((P) => !LENGTHS.includes(P.key));
  const phases = [
    { params: lengths, steps: [0.4, 0.2, 0.1, 0.05] },           // 1. lengths
    { params: shapes, steps: [0.4, 0.2, 0.1, 0.05] },            // 2. widths / depths with fixed lengths
    { params: lengths, steps: [0.1, 0.05, 0.025, 0.0125] },      // 3. re-adjust the lengths
    { params: shapes, steps: [0.05, 0.025, 0.0125] },            // 4. fine widths
    { params: lengths, steps: [0.0125, 0.00625] },               // 5. fine lengths
  ];
  for (const ph of phases) {
    const use = ph.params === lengths && lengthKeys.length ? lengthKeys : keys;
    let best = cost(use);
    for (const step of ph.steps) {
      for (let round = 0; round < 2; round++) {
        for (const P of ph.params) {
          const [lo, hi] = P.macro ? [0, 1] : [-1, 1];
          for (const dir of [1, -1]) {
            const old = p[P.key];
            const nv = Math.min(hi, Math.max(lo, old + dir * step));
            if (nv === old) continue;
            p[P.key] = nv;
            const c = cost(use); evals++;
            if (c < best) { best = c; break; }
            p[P.key] = old;
          }
        }
      }
    }
  }
  const best = cost();
  const model = measureModel(av, av.shape());
  av.composition = comp;
  [av.poseSpread, av.poseLegSpread] = pose;
  return { params: { ...p }, model, error: Math.sqrt(best / Math.max(1, keys.length)), evals, ms: performance.now() - t0 };
}

// Face measurements from the face scan (1 = average) -> MakeHuman face targets (-1..+1).
// The factor turns "10 % wider than average" into a target value.
export const FACE_MAP = [
  ['noseWidth', ['nose/nose-scale-horiz'], 3],
  ['noseLength', ['nose/nose-scale-vert'], 3],
  ['mouthWidth', ['mouth/mouth-scale-horiz'], 3],
  ['lipUpper', ['mouth/mouth-upperlip-height'], 1.5],
  ['lipLower', ['mouth/mouth-lowerlip-height'], -1.5], // taller lower lip target -> lip moves, ratio drops (measured)
  ['eyeSize', ['eyes/l-eye-scale', 'eyes/r-eye-scale'], 3],
  ['eyeSpacing', ['eyes/l-eye-trans', 'eyes/r-eye-trans'], 3, 'in', 'out'],
  ['faceLong', ['head/head-scale-vert'], 2.5],
  ['chin', ['chin/chin-height'], 2.5],
  ['jaw', ['chin/chin-bones'], 2.5], // chin-width hardly moves the jaw corners (measured with facefit.js)
];
export function faceTargets(face) {
  const out = {};
  if (!face) return out;
  for (const [key, targets, gain] of FACE_MAP) {
    const v = Math.max(-1, Math.min(1, ((face[key] ?? 1) - 1) * gain));
    for (const t of targets) out[t] = v;
  }
  return out;
}

// ---- body fat estimate (US Navy method) from tape-measure girths of the model ----
// A tape measure spans the convex outline of a cross-section, so: slice the mesh at a height,
// take the convex hull of the contour points (x, z), and its perimeter.
function hullPerimeter(pts) {
  if (pts.length < 3) return 0;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let per = 0;
  for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return per;
}
export function girth(av, pos, y, test) {
  const F = av.H.faces, pts = [];
  for (let t = 0; t < F.length / 3; t++) {
    const vs = [F[t * 3], F[t * 3 + 1], F[t * 3 + 2]];
    if (vs.some((v) => v >= 13380) || !test(vs[0])) continue;
    for (let e = 0; e < 3; e++) {
      const p = vs[e], q = vs[(e + 1) % 3], yp = pos[p * 3 + 1], yq = pos[q * 3 + 1];
      if ((yp - y) * (yq - y) > 0 || yp === yq) continue;
      const f = (y - yp) / (yq - yp);
      pts.push([pos[p * 3] + (pos[q * 3] - pos[p * 3]) * f, pos[p * 3 + 2] + (pos[q * 3 + 2] - pos[p * 3 + 2]) * f]);
    }
  }
  return hullPerimeter(pts);
}
// Body fat % (US Navy formula, girths in cm): men waist at the navel - neck; women waist (narrowest)
// + hips - neck. The gender slider blends both.
export function bodyFat(av, pos, W) {
  const J = av.vertJoint, H = av.body.height, s = H / 1.75;
  const torso = (v) => J[v] === 'hips' || J[v] === 'spine' || J[v] === 'chest';
  const ys = (W.shoulderL[1] + W.shoulderR[1]) / 2, yh = (W.hipL[1] + W.hipR[1]) / 2;
  // neck: narrowest girth between the shoulders and the mouth (like the neck width, measureModel)
  const mouthY = (W.eyeL[1] + W.eyeR[1]) / 2 - 0.07 * s;
  const nearNeck = (v) => (J[v] === 'neck' || J[v] === 'head' || J[v] === 'chest') && Math.abs(pos[v * 3]) < 0.09 * s;
  let neck = Infinity;
  for (let t = 0.3; t <= 0.85; t += 0.05) { const g = girth(av, pos, ys + t * (mouthY - ys), nearNeck); if (g > 0.2) neck = Math.min(neck, g); }
  const navel = girth(av, pos, yh + 0.1 * s, torso);
  let narrow = Infinity;
  for (let t = 0.45; t <= 0.85; t += 0.05) { const g = girth(av, pos, ys - t * (ys - yh), torso); if (g > 0) narrow = Math.min(narrow, g); }
  let hip = 0;
  for (let d = -0.02; d <= 0.08; d += 0.01) hip = Math.max(hip, girth(av, pos, yh - d * s, (v) => torso(v) || /^hip[LR]$/.test(J[v])));
  if (!Number.isFinite(neck) || !navel || !hip) return null;
  const cm = (m) => m * 100, h = cm(H);
  const men = 495 / (1.0324 - 0.19077 * Math.log10(cm(navel) - cm(neck)) + 0.15456 * Math.log10(h)) - 450;
  const women = 495 / (1.29579 - 0.35004 * Math.log10(cm(narrow) + cm(hip) - cm(neck)) + 0.221 * Math.log10(h)) - 450;
  const g = av.person?.gender ?? 0.5;
  return { percent: Math.max(3, Math.min(50, women + (men - women) * g)), neck, waist: navel, hip };
}
