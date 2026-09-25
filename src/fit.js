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

export function measureModel(av, shape) {
  const { pos } = shape;
  const W = {};
  const Hh = av.body.height;
  for (const [j, w] of Object.entries(shape.W)) {
    const key = j.replace(/[LR]$/, '');
    W[j] = LANDMARK_OFFSET[key] !== undefined ? [w[0], w[1] + LANDMARK_OFFSET[key] * Hh, w[2]] : w;
  }
  const J = av.vertJoint, N = 13380, H = av.body.height;
  const ys = (W.shoulderL[1] + W.shoulderR[1]) / 2, yh = (W.hipL[1] + W.hipR[1]) / 2;
  const torso = (v) => J[v] === 'hips' || J[v] === 'spine' || J[v] === 'chest';
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
  const extent = (y, test, axis = 0) => {
    let lo = Infinity, hi = -Infinity;
    slice(y, test, (x, z) => { const c = axis === 0 ? x : z; if (c < lo) lo = c; if (c > hi) hi = c; });
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
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
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
    chestDepth: extent(ys - 0.25 * (ys - yh), torso, 2),
    bellyDepth: extent(ys - 0.75 * (ys - yh), torso, 2),
    // outline profiles at the same relative heights as on the photo
    pTorso: TORSO_T.map((t) => extent(yh + (ys - yh) * t, torso)),
    pTorsoD: TORSO_T.map((t) => extent(yh + (ys - yh) * t, torso, 2)),
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
  const cost = () => {
    apply();
    const m = measureModel(av, av.shape());
    let c = 0;
    for (const k of keys) {
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
  let best = cost(), evals = 1;
  // coordinate descent in phases: lengths first (they move all measuring heights),
  // then widths / depths, then everything together with small steps
  const LENGTHS = ['legs', 'arms'];
  const lengths = active.filter((P) => LENGTHS.includes(P.key)), shapes = active.filter((P) => !LENGTHS.includes(P.key));
  const phases = [
    { params: lengths, steps: [0.4, 0.2, 0.1, 0.05] },           // 1. lengths
    { params: shapes, steps: [0.4, 0.2, 0.1, 0.05] },            // 2. widths / depths with fixed lengths
    { params: lengths, steps: [0.1, 0.05, 0.025, 0.0125] },      // 3. re-adjust the lengths
    { params: shapes, steps: [0.05, 0.025, 0.0125] },            // 4. fine widths
    { params: lengths, steps: [0.0125, 0.00625] },               // 5. fine lengths
  ];
  for (const ph of phases) {
    for (const step of ph.steps) {
      for (let round = 0; round < 2; round++) {
        for (const P of ph.params) {
          const [lo, hi] = P.macro ? [0, 1] : [-1, 1];
          for (const dir of [1, -1]) {
            const old = p[P.key];
            const nv = Math.min(hi, Math.max(lo, old + dir * step));
            if (nv === old) continue;
            p[P.key] = nv;
            const c = cost(); evals++;
            if (c < best) { best = c; break; }
            p[P.key] = old;
          }
        }
      }
    }
  }
  apply();
  const model = measureModel(av, av.shape());
  av.composition = comp;
  [av.poseSpread, av.poseLegSpread] = pose;
  return { params: { ...p }, model, error: Math.sqrt(best / Math.max(1, keys.length)), evals, ms: performance.now() - t0 };
}

// Face measurements from the face scan (1 = average) -> MakeHuman face targets (-1..+1).
// The factor turns "10 % wider than average" into a target value.
const FACE_MAP = [
  ['noseWidth', ['nose/nose-scale-horiz'], 3],
  ['noseLength', ['nose/nose-scale-vert'], 3],
  ['mouthWidth', ['mouth/mouth-scale-horiz'], 3],
  ['lipUpper', ['mouth/mouth-upperlip-volume'], 1.5],
  ['lipLower', ['mouth/mouth-lowerlip-volume'], 1.5],
  ['eyeSize', ['eyes/l-eye-scale', 'eyes/r-eye-scale'], 3],
  ['eyeSpacing', ['eyes/l-eye-trans', 'eyes/r-eye-trans'], 3, 'in', 'out'],
  ['faceLong', ['head/head-scale-vert'], 2.5],
  ['chin', ['chin/chin-height'], 2.5],
  ['jaw', ['chin/chin-width'], 2.5],
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
