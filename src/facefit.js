// Face shape by "analysis by synthesis" (same idea as the body fit in fit.js):
// render the smooth model head from the front, let the SAME MediaPipe face model find its
// 478 points, measure the same proportions as on the photo (face.js faceRatios) and move
// the face targets until model and photo agree. Runs locally, nothing is uploaded.
//
// Why: the old way mapped "photo ratio / average ratio" straight to target values. But the
// model's own ratios depend on gender, age, weight and on the other targets (a longer nose
// target also changes the face height). Measuring the model removes that guesswork.
import * as THREE from 'three';
import { faceRatios, detectLandmarks } from './face.js';
import { FACE_MAP, faceTargets } from './fit.js';

const SIZE = 640;
let R = null; // offscreen renderer, scene, camera, mesh (made once)

function setup(H) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8a9099);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4440, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(0.3, 0.5, 1);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(15, 1, 0.1, 10);
  // body + eye faces only (no joint helper cubes)
  const idx = [];
  const eyeVert = new Uint8Array(H.N);
  for (let f = 0; f < H.faces.length / 3; f++) {
    const g = H.faceGroup[f];
    for (let k = 0; k < 3; k++) { idx.push(H.faces[f * 3 + k]); if (g > 0) eyeVert[H.faces[f * 3 + k]] = g; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(H.N * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(H.N * 3), 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
  scene.add(mesh);
  R = { renderer, scene, camera, mesh, eyeVert };
}

// Render the model head with the given face target values -> raw face ratios (or null)
async function measureHead(avatar, face) {
  const saved = avatar.fit.face;
  avatar.fit.face = face;
  const { pos, W } = avatar.shape();
  avatar.fit.face = saved;
  R.lastPos = pos; // for the surface prior in fitFace
  const { mesh, eyeVert, camera, renderer, scene } = R;
  const P = mesh.geometry.attributes.position, C = mesh.geometry.attributes.color;
  P.array.set(pos.subarray(0, P.array.length));
  // colors: skin, eyes white with a dark iris looking forward (the face model needs eyes)
  const skin = new THREE.Color(avatar.body.colors?.skin ?? 0xd9a88a);
  for (let v = 0; v < avatar.H.N; v++) {
    let c = skin;
    if (eyeVert[v]) {
      const e = eyeVert[v] === 1 ? W.eyeL : W.eyeR;
      const dx = pos[v * 3] - e[0], dy = pos[v * 3 + 1] - e[1], dz = pos[v * 3 + 2] - e[2];
      const cz = dz / (Math.hypot(dx, dy, dz) || 1);
      c = cz > 0.97 ? PUPIL : cz > 0.88 ? IRIS : WHITE;
    }
    C.array[v * 3] = c.r; C.array[v * 3 + 1] = c.g; C.array[v * 3 + 2] = c.b;
  }
  P.needsUpdate = C.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
  // camera straight in front of the face, head fills ~half the picture (like the photo crop)
  const ex = (W.eyeL[0] + W.eyeR[0]) / 2, ey = (W.eyeL[1] + W.eyeR[1]) / 2, ez = (W.eyeL[2] + W.eyeR[2]) / 2;
  const cy = ey - 0.035;
  camera.position.set(ex, cy, ez + 1.25);
  camera.lookAt(ex, cy, ez);
  renderer.render(scene, camera);
  const L = await detectLandmarks(renderer.domElement);
  if (!L) return null;
  const r = faceRatios(L);
  // absolute face width (m) / body height: pixel size at the cheek plane (~3 cm behind the eyes)
  const mPerPx = (2 * (1.25 + 0.03) * Math.tan((camera.fov * Math.PI) / 360)) / SIZE;
  r.faceSize = (Math.hypot(L[234].x - L[454].x, L[234].y - L[454].y) * mPerPx) / avatar.body.height;
  return r;
}
const WHITE = new THREE.Color(0xf2eee8), IRIS = new THREE.Color(0x5a3a22), PUPIL = new THREE.Color(0x111111);

// What is compared (face.js faceRatios) ...
const KEYS = [...FACE_MAP.map((m) => m[0]), 'cheekLow', 'jawMid', 'jawLow', 'chinW', 'foreheadH', 'browH', 'mouthH', 'noseDepth', 'chinDepth', 'faceSize'];
// ... and what is moved: the simple face groups (fit.js FACE_MAP) + finer shape targets.
// [name, targets, range]
export const PARAMS = [
  ...FACE_MAP.map(([k, targets]) => [k, targets, k === 'eyeSize' ? [-0.35, 1] : [-1, 1]]), // playful: eyes hardly shrink
  ['cheekBones', ['cheek/l-cheek-bones', 'cheek/r-cheek-bones'], [-1, 1]],
  ['cheekVolume', ['cheek/l-cheek-volume', 'cheek/r-cheek-volume'], [-1, 1]],
  ['chinWidth', ['chin/chin-width'], [-1, 1]],
  ['chinForward', ['chin/chin-prominent'], [-1, 1]],
  ['noseDepth', ['nose/nose-scale-depth'], [-1, 1]],
  ['nosePoint', ['nose/nose-point-width'], [-1, 1]],
  ['browHeight', ['eyebrows/eyebrows-trans'], [-1, 1]],
  ['mouthHeight', ['mouth/mouth-scale-vert'], [-1, 1]],
  ['forehead', ['forehead/forehead-scale-vert'], [-1, 1]],
  ['headFat', ['head/head-fat'], [-1, 1]],
  ['headWidth', ['head/head-scale-horiz'], [-1, 1]],
  ['headSquare', ['head/head-square'], [0, 1]],
];
const limit = (v) => v.map((x, i) => Math.max(PARAMS[i][2][0], Math.min(PARAMS[i][2][1], x)));
const toFace = (v) => {
  const out = {};
  PARAMS.forEach(([, targets], i) => { for (const t of targets) out[t] = v[i]; });
  return out;
};
// mismatch per measure (model vs photo), relative. The lips are only a few pixels tall on a
// phone photo (1 px = ~15 %) and the depths come from MediaPipe's estimate: they count less.
const TRUST = { lipUpper: 0.3, lipLower: 0.3, noseDepth: 0.5, chinDepth: 0.5, browH: 0.7 };
const residual = (model, photo) => KEYS.map((k) => ((photo[k] - model[k]) / Math.max(Math.abs(photo[k]), 0.1)) * (TRUST[k] ?? 1));
const rms = (e) => Math.sqrt(e.reduce((s, x) => s + x * x, 0) / e.length);
// Prior: many face shapes give the same 2D measures. Prefer the one that changes the face
// SURFACE least (per parameter: mm moved per unit, measured once per fit). MU: 1 mm of
// unexplained surface change costs as much as a 1 % mismatch of one measure.
const MU = 0;
// Extreme target values (+-1) are caricatures: a value of 1 costs like a V_PRIOR-sized squared
// mismatch, so the fit only goes there when the measures clearly ask for it.
const V_PRIOR = 0.0015;

// Solve (A + lambda I) x = b for a small dense system (Gauss elimination)
function solve(A, b, lambda) {
  const n = b.length, M = A.map((row, i) => [...row.map((x, j) => x + (i === j ? lambda : 0)), b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = i + 1; r < n; r++) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c]; x[i] = s / M[i][i]; }
  return x;
}

// Fit the face targets to the photo ratios. Returns { face, error, error0, ms } or null
// (then the caller keeps the simple estimate).
export async function fitFace(avatar, photo, measures, { rounds = 3 } = {}) {
  if (!photo || !avatar.H) return null;
  const t0 = performance.now();
  if (!R) setup(avatar.H);
  if (KEYS.some((k) => photo[k] === undefined)) return null; // old scan without the new measures
  // start: the simple estimate for the basic groups, average for the finer shapes
  const start = faceTargets(measures);
  const v0 = limit(PARAMS.map(([, targets]) => start[targets[0]] ?? 0));
  let model = await measureHead(avatar, toFace(v0));
  if (!model) return null;
  const e0 = residual(model, photo), error0 = rms(e0);
  // face surface points (head, in front of the ears) for the prior
  const p0 = R.lastPos, eye = avatar.shape().W.eyeL;
  const idx = [];
  for (let q = 0; q < 13380; q++) if (avatar.vertJoint[q] === 'head' && p0[q * 3 + 2] > eye[2] - 0.05 && p0[q * 3 + 1] < eye[1] + 0.07) idx.push(q);
  let S = null, P2 = null;
  const cost = (e, vv) => e.reduce((a, x) => a + x * x, 0) + vv.reduce((a, x, i) => a + P2[i] * x * x, 0);
  let best = { v: v0, err: error0, e: e0, m: model, c: 0 };
  // Gauss-Newton: the face shapes are not linear, so the Jacobian is measured again after the
  // first round (at the new face); each round: steps with line search
  for (let round = 0; round < rounds; round++) {
    const v = best.v, base = best.m, pBase = R.lastPos.slice ? null : null;
    const h = 0.3, J = KEYS.map(() => new Array(PARAMS.length).fill(0)), Sj = new Array(PARAMS.length).fill(0);
    const ref = await measureHead(avatar, toFace(v)), refPos = R.lastPos;
    const moved = (a) => { let t = 0; for (const q of idx) t += Math.hypot(a[q * 3] - refPos[q * 3], a[q * 3 + 1] - refPos[q * 3 + 1], a[q * 3 + 2] - refPos[q * 3 + 2]); return t / idx.length; };
    for (let j = 0; j < PARAMS.length; j++) {
      const d = v[j] + h > PARAMS[j][2][1] ? -h : h, vj = [...v];
      vj[j] += d;
      const m = await measureHead(avatar, toFace(vj));
      Sj[j] = moved(R.lastPos) / Math.abs(d); // meters of surface movement per unit
      if (!m) continue;
      KEYS.forEach((k, i) => (J[i][j] = ((m[k] - (ref || base)[k]) / Math.max(Math.abs(photo[k]), 0.1) / d) * (TRUST[k] ?? 1)));
    }
    if (!S) { S = Sj; P2 = S.map((x) => MU * x * x + V_PRIOR); best.c = cost(best.e, best.v); }
    for (let it = 0, scale = 1; it < 5; it++) {
      const e = best.e, bv = best.v;
      const JtJ = PARAMS.map((_, a) => PARAMS.map((_, b) => J.reduce((s, row) => s + row[a] * row[b], 0) + (a === b ? P2[a] : 0)));
      const Jte = PARAMS.map((_, a) => J.reduce((s, row, i) => s + row[a] * e[i], 0) - P2[a] * bv[a]);
      const step = solve(JtJ, Jte, 0.002);
      const vt = limit(bv.map((x, i) => x + step[i] * scale));
      const m = await measureHead(avatar, toFace(vt));
      if (!m) break;
      const et = residual(m, photo), c = cost(et, vt);
      if (c < best.c - 1e-6) best = { v: vt, err: rms(et), e: et, m, c };
      else if ((scale /= 2) < 0.2) break;
    }
  }
  return { face: toFace(best.v), values: Object.fromEntries(PARAMS.map(([k], i) => [k, best.v[i]])), error: best.err, error0, ms: performance.now() - t0 };
}

// for tests: raw ratios of the model head with given face targets
export async function modelRatios(avatar, face) {
  if (!R) setup(avatar.H);
  return measureHead(avatar, face);
}
