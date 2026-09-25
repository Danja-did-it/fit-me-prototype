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
  return L ? faceRatios(L) : null;
}
const WHITE = new THREE.Color(0xf2eee8), IRIS = new THREE.Color(0x5a3a22), PUPIL = new THREE.Color(0x111111);

const KEYS = FACE_MAP.map((m) => m[0]);
// allowed target range. Playful figure: the eyes may grow but hardly shrink - small eye
// targets close the lids to slits and the face loses its expression.
const RANGE = { eyeSize: [-0.35, 1] };
const limit = (v) => v.map((x, i) => { const [lo, hi] = RANGE[KEYS[i]] ?? [-1, 1]; return Math.max(lo, Math.min(hi, x)); });
const toFace = (v) => {
  const out = {};
  FACE_MAP.forEach(([, targets], i) => { for (const t of targets) out[t] = v[i]; });
  return out;
};
// relative mismatch per ratio (model vs photo). The lips are only a few pixels tall on a
// phone photo (1 px = ~15 %), so they count less than the big proportions.
const TRUST = { lipUpper: 0.3, lipLower: 0.3 };
const residual = (model, photo) => KEYS.map((k) => ((photo[k] - model[k]) / photo[k]) * (TRUST[k] ?? 1));
const rms = (e) => Math.sqrt(e.reduce((s, x) => s + x * x, 0) / e.length);

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
export async function fitFace(avatar, photo, measures) {
  if (!photo || !avatar.H) return null;
  const t0 = performance.now();
  if (!R) setup(avatar.H);
  const start = faceTargets(measures); // simple estimate = starting point
  let v = limit(FACE_MAP.map(([, targets]) => start[targets[0]] ?? 0));
  let model = await measureHead(avatar, toFace(v));
  if (!model) return null;
  const e0 = residual(model, photo), error0 = rms(e0);
  // Jacobian by finite differences: one render per target group
  const h = 0.35, J = KEYS.map(() => new Array(KEYS.length).fill(0));
  for (let j = 0; j < KEYS.length; j++) {
    const d = v[j] > 0.6 || (KEYS[j] === 'eyeSize' && v[j] > 0) ? -h : h, vj = [...v];
    vj[j] += d;
    const m = await measureHead(avatar, toFace(vj));
    if (!m) continue;
    KEYS.forEach((k, i) => (J[i][j] = ((m[k] - model[k]) / photo[k] / d) * (TRUST[k] ?? 1)));
  }
  // damped Gauss-Newton steps (reuse the Jacobian); if a step makes it worse, try half of it
  let best = { v: [...v], err: error0, e: e0 };
  for (let it = 0, scale = 1; it < 6; it++) {
    const e = best.e;
    const JtJ = KEYS.map((_, a) => KEYS.map((_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const Jte = KEYS.map((_, a) => J.reduce((s, row, i) => s + row[a] * e[i], 0));
    const step = solve(JtJ, Jte, 0.002);
    const vt = limit(best.v.map((x, i) => x + step[i] * scale));
    const m = await measureHead(avatar, toFace(vt));
    if (!m) break;
    const et = residual(m, photo), err = rms(et);
    if (err < best.err - 1e-4) best = { v: vt, err, e: et };
    else if ((scale /= 2) < 0.2) break;
  }
  if (typeof window !== "undefined") window.__faceDbg = { e0, e: best.e, Jd: J.map((r, i) => r[i]) }; // for tests;
  return { face: toFace(best.v), values: Object.fromEntries(KEYS.map((k, i) => [k, best.v[i]])), error: best.err, error0, ms: performance.now() - t0 };
}

// for tests: raw ratios of the model head with given face targets
export async function modelRatios(avatar, face) {
  if (!R) setup(avatar.H);
  return measureHead(avatar, face);
}
