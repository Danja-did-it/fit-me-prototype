// Realistic human body from MakeHuman data (CC0), mixed in the browser.
//
// The MakeHuman base mesh is one artist-made human; "targets" move its points to
// make it female/male, young/old, thin/heavy, muscular, and change single features
// (waist, nose, lips ...). We mix them with weights, exactly like MakeHuman / Anny:
//   macro targets: piecewise multi-linear interpolation of gender x age x muscle x weight
//   local targets: value -1..+1 -> "decr" or "incr" target
// Then the mesh is posed into our rest pose (arms hanging down) with the skin weights
// of the MakeHuman "game_engine" rig, and converted to meters.
const BASE = import.meta.env?.BASE_URL ?? '/';
let dataPromise = null;

// Load human.bin + human.json once
export function loadHuman(url = BASE + 'human/') {
  if (!dataPromise) {
    dataPromise = (async () => {
      const [meta, buf] = await Promise.all([
        fetch(url + 'human.json').then((r) => r.json()),
        fetch(url + 'human.bin').then((r) => r.arrayBuffer()),
      ]);
      return unpack(meta, buf);
    })();
  }
  return dataPromise;
}

export function unpack(meta, buf) {
  const N = meta.N;
  const H = {
    N, meta,
    base: new Float32Array(buf, meta.verts, N * 3),
    faces: new Uint16Array(buf, meta.faceData, meta.faces),
    faceGroup: new Uint8Array(buf, meta.faceGroup, meta.faces / 3),
    skinIdx: new Uint8Array(buf, meta.skinIdx, N * 4),
    skinW: new Uint8Array(buf, meta.skinW, N * 4),
    joints: meta.joints,
    bones: meta.bones,
    targets: {},
  };
  for (const t of meta.targets) {
    H.targets[t.name] = { idx: new Uint16Array(buf, t.idx, t.count), d: new Int16Array(buf, t.d, t.count * 3) };
  }
  return H;
}

// ---- macro weights (MakeHuman conventions, all values 0..1, 0.5 = average) ----
// age: 0 = 1 year, 0.1875 = 11, 0.5 = 25, 1 = 90 years
export const ageToMH = (years) =>
  years < 11 ? 0.1875 * Math.max(0, years - 1) / 10
    : years < 25 ? 0.1875 + (0.3125 * (years - 11)) / 14
      : 0.5 + (0.5 * Math.min(65, years - 25)) / 65;

function ageWeights(v) { // no baby targets packed: clamp to child
  v = Math.max(0.1875, v);
  if (v < 0.5) { const t = (v - 0.1875) / 0.3125; return { child: 1 - t, young: t }; }
  const t = (v - 0.5) / 0.5; return { young: 1 - t, old: t };
}
function triWeights(v, lo, mid, hi) {
  return v < 0.5 ? { [lo]: 1 - 2 * v, [mid]: 2 * v } : { [mid]: 2 - 2 * v, [hi]: 2 * v - 1 };
}

// All macro targets with their weight
// race: shares of african / asian / caucasian (MakeHuman default 1/3 each)
export function macroWeights({ gender = 0.5, age = 25, muscle = 0.5, weight = 0.5, race = { african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3 } }) {
  const G = { female: 1 - gender, male: gender };
  const A = ageWeights(ageToMH(age));
  const M = triWeights(muscle, 'minmuscle', 'averagemuscle', 'maxmuscle');
  const Wt = triWeights(weight, 'minweight', 'averageweight', 'maxweight');
  const out = [];
  // gender x age x race: the main body + face shape
  for (const [r, wr] of Object.entries(race)) for (const [g, wg] of Object.entries(G)) for (const [a, wa] of Object.entries(A)) {
    const k = wr * wg * wa;
    if (k > 1e-4) out.push([`macrodetails/${r}-${g}-${a}`, k]);
  }
  for (const [g, wg] of Object.entries(G)) for (const [a, wa] of Object.entries(A))
    for (const [m, wm] of Object.entries(M)) for (const [w, ww] of Object.entries(Wt)) {
      const k = wg * wa * wm * ww;
      if (k > 1e-4) out.push([`macrodetails/universal-${g}-${a}-${m}-${w}`, k]);
    }
  return out;
}

// local modifier (-1..+1) -> weighted target list. `name` is e.g. "torso/measure-waist-circ"
export function localWeights(name, v, a = 'decr', b = 'incr') {
  if (!v) return [];
  return v < 0 ? [[`${name}-${a}`, -v]] : [[`${name}-${b}`, v]];
}

// Mix: base + sum(weight * target). Returns Float32Array of N*3 (decimeters)
export function mix(H, weighted) {
  const out = new Float32Array(H.base);
  for (const [name, w] of weighted) {
    const T = H.targets[name];
    if (!T) continue;
    const s = w * 0.001; // stored in 1/1000 dm
    const { idx, d } = T;
    for (let i = 0; i < idx.length; i++) {
      const o = idx[i] * 3;
      out[o] += d[i * 3] * s; out[o + 1] += d[i * 3 + 1] * s; out[o + 2] += d[i * 3 + 2] * s;
    }
  }
  return out;
}

// Joint position = center of its helper cube
export function jointPos(H, pos, cube) {
  const vs = H.joints[cube];
  let x = 0, y = 0, z = 0;
  for (const v of vs) { x += pos[v * 3]; y += pos[v * 3 + 1]; z += pos[v * 3 + 2]; }
  return [x / vs.length, y / vs.length, z / vs.length];
}

// MakeHuman bone -> our animation joint (see avatar joint tree)
export function ourJoint(bone) {
  const side = bone.endsWith('_l') ? 'L' : bone.endsWith('_r') ? 'R' : '';
  const b = bone.replace(/_(l|r)$/, '');
  if (b === 'Root' || b === 'pelvis') return 'hips';
  if (b === 'spine_01' || b === 'spine_02') return 'spine';
  if (b === 'spine_03' || b === 'clavicle') return 'chest';
  if (b === 'neck_01') return 'neck';
  if (b === 'head') return 'head';
  if (b === 'upperarm') return 'shoulder' + side;
  if (b === 'lowerarm' || b === 'hand' || /^(thumb|index|middle|ring|pinky)/.test(b)) return 'elbow' + side;
  if (b === 'thigh') return 'hip' + side;
  if (b === 'calf') return 'knee' + side;
  if (b === 'foot' || b === 'ball') return 'ankle' + side;
  return 'hips';
}

// ---- posing (linear blend skinning) ----
// 3x3 rotation (row-major) that turns direction a into direction b (Rodrigues)
function rotBetween(a, b) {
  const na = Math.hypot(...a), nb = Math.hypot(...b);
  const u = a.map((x) => x / na), w = b.map((x) => x / nb);
  const k = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const s = Math.hypot(...k), c = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  if (s < 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const [x, y, z] = k.map((v) => v / s), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y,
          t * x * y + s * z, t * y * y + c, t * y * z - s * x,
          t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}
const mul3 = (A, B) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]));
const app3 = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
// affine transform: rotation R around pivot p -> { R, t } with x' = R x + t
const around = (R, p) => { const rp = app3(R, p); return { R, t: [p[0] - rp[0], p[1] - rp[1], p[2] - rp[2]] }; };
const compose = (B, A) => ({ R: mul3(B.R, A.R), t: app3(B.R, A.t).map((v, i) => v + B.t[i]) }); // B after A
const apply = (T, v) => app3(T.R, v).map((x, i) => x + T.t[i]);

// Pose the MakeHuman base pose (arms out in an "A", elbows bent, legs apart) into our
// rest pose: arms hanging with a small outward angle and a slight natural elbow bend,
// legs hip-wide and straight. Every bone of a limb is aligned separately.
export function poseBody(H, pos, { armSpread = 0.08, legSpread = 0.02 } = {}) {
  const J = (c) => jointPos(H, pos, c);
  const T = {}; // bone name -> transform
  for (const [side, sx] of [['l', 1], ['r', -1]]) {
    // arm: shoulder -> elbow, then elbow -> wrist
    const sh = J(`${side}-shoulder`), el = J(`${side}-elbow`), wr = J(`${side}-hand`);
    const up = around(rotBetween(el.map((v, i) => v - sh[i]), [sx * Math.sin(armSpread), -Math.cos(armSpread), 0]), sh);
    const el2 = apply(up, el), wr2 = apply(up, wr);
    const foreDir = [sx * Math.sin(armSpread * 0.8), -Math.cos(armSpread * 0.8), 0.09]; // ~5 deg forward at the elbow
    const low = compose(around(rotBetween(wr2.map((v, i) => v - el2[i]), foreDir), el2), up);
    T[`upperarm_${side}`] = up;
    for (const b of ['lowerarm', 'hand', 'thumb_01', 'thumb_02', 'thumb_03', 'index_01', 'index_02', 'index_03',
      'middle_01', 'middle_02', 'middle_03', 'ring_01', 'ring_02', 'ring_03', 'pinky_01', 'pinky_02', 'pinky_03']) T[`${b}_${side}`] = low;
    // leg: hip -> knee, then knee -> ankle (straight down)
    const hp = J(`${side}-upper-leg`), kn = J(`${side}-knee`), an = J(`${side}-ankle`);
    const th = around(rotBetween(kn.map((v, i) => v - hp[i]), [sx * Math.sin(legSpread), -Math.cos(legSpread), 0]), hp);
    const kn2 = apply(th, kn), an2 = apply(th, an);
    const calf = compose(around(rotBetween(an2.map((v, i) => v - kn2[i]), [sx * 0.005, -1, -0.02]), kn2), th);
    T[`thigh_${side}`] = th;
    for (const b of ['calf', 'foot', 'ball']) T[`${b}_${side}`] = calf;
  }
  const boneT = H.bones.map((b) => T[b.name] || null);
  const out = new Float32Array(pos.length);
  for (let v = 0; v < H.N; v++) {
    const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    let x = 0, y = 0, z = 0, wsum = 0;
    for (let k = 0; k < 4; k++) {
      const w = H.skinW[v * 4 + k] / 255;
      if (!w) continue;
      const t = boneT[H.skinIdx[v * 4 + k]];
      const q = t ? apply(t, p) : p;
      x += q[0] * w; y += q[1] * w; z += q[2] * w; wsum += w;
    }
    if (wsum < 1e-6) { out[v * 3] = p[0]; out[v * 3 + 1] = p[1]; out[v * 3 + 2] = p[2]; }
    else { out[v * 3] = x / wsum; out[v * 3 + 1] = y / wsum; out[v * 3 + 2] = z / wsum; }
  }
  return out;
}

// Dominant MakeHuman bone per point -> our joint name
export function dominantJoint(H) {
  const names = H.bones.map((b) => ourJoint(b.name));
  const out = new Array(H.N);
  for (let v = 0; v < H.N; v++) out[v] = names[H.skinIdx[v * 4]]; // weights are sorted, first = strongest
  return out;
}
