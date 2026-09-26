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
  R.lastL = L; // for buildFaceMap
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

// ---- face texture from the photo ("Snapchat filter" technique, all on this device) ----
// The fitted model head is rendered once more and MediaPipe finds its 478 points. Every point
// on the render corresponds to the same point on the photo. For a cube on the face: project it
// into the render, map it to the photo (affine fit of all points + smooth local correction from the
// nearest points) and take the photo color there. The photo's large-scale light and shadow is
// divided out (blurred copy), so the voxel light does not shade the face twice.
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149,
  150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
export async function buildFaceMap(avatar, face, photo) {
  if (!photo || !avatar.H) return null;
  if (!R) setup(avatar.H);
  const ratios = await measureHead(avatar, face);
  const Lr = R.lastL;
  if (!ratios || !Lr) return null;
  const cam = R.camera;
  cam.updateMatrixWorld();
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const Lp = photo.L, n = Math.min(468, Lr.length, Lp.length);
  // affine map render -> photo (least squares)
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = [Lr[i].x, Lr[i].y, 1];
    for (let r = 0; r < 3; r++) { for (let c = 0; c < 3; c++) M[r][c] += a[r] * a[c]; bx[r] += a[r] * Lp[i].x; by[r] += a[r] * Lp[i].y; }
  }
  const ax = solve(M, bx, 1e-6), ay = solve(M, by, 1e-6);
  const aff = (x, y) => [ax[0] * x + ax[1] * y + ax[2], ay[0] * x + ay[1] * y + ay[2]];
  const res = [];
  for (let i = 0; i < n; i++) { const q = aff(Lr[i].x, Lr[i].y); res.push([Lp[i].x - q[0], Lp[i].y - q[1]]); }
  // local correction on a grid over the render (inverse distance weights of the 8 nearest points)
  const G = 96, cell = SIZE / G, disp = new Float32Array((G + 1) * (G + 1) * 2);
  for (let gy = 0; gy <= G; gy++) for (let gx = 0; gx <= G; gx++) {
    const px = gx * cell, py = gy * cell, bd = new Array(8).fill(Infinity), bi = new Array(8).fill(0);
    for (let i = 0; i < n; i++) { // keep the 8 nearest points
      const d2 = (Lr[i].x - px) ** 2 + (Lr[i].y - py) ** 2;
      if (d2 >= bd[7]) continue;
      let k = 7;
      while (k > 0 && bd[k - 1] > d2) { bd[k] = bd[k - 1]; bi[k] = bi[k - 1]; k--; }
      bd[k] = d2; bi[k] = i;
    }
    let wx = 0, wy = 0, ws = 0;
    for (let k = 0; k < 8; k++) { const w = 1 / (bd[k] + 4), i = bi[k]; wx += w * res[i][0]; wy += w * res[i][1]; ws += w; }
    disp[(gy * (G + 1) + gx) * 2] = wx / ws; disp[(gy * (G + 1) + gx) * 2 + 1] = wy / ws;
  }
  const dispAt = (px, py) => {
    const fx = Math.max(0, Math.min(G - 1e-3, px / cell)), fy = Math.max(0, Math.min(G - 1e-3, py / cell));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, o = [0, 0];
    for (const [dx, dy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const k = ((y0 + dy) * (G + 1) + x0 + dx) * 2; o[0] += w * disp[k]; o[1] += w * disp[k + 1];
    }
    return o;
  };
  // face outline on the render (for the soft edge)
  const oval = OVAL.map((i) => Lr[i]);
  const edgeDist = (px, py) => { // > 0 inside, pixels to the outline
    let inside = false, d = Infinity;
    for (let i = 0, j = oval.length - 1; i < oval.length; j = i++) {
      const a = oval[i], b = oval[j];
      if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      const ex = b.x - a.x, ey = b.y - a.y, t = Math.max(0, Math.min(1, ((px - a.x) * ex + (py - a.y) * ey) / (ex * ex + ey * ey)));
      d = Math.min(d, Math.hypot(px - a.x - ex * t, py - a.y - ey * t));
    }
    return inside ? d : -d;
  };
  // photo + blurred brightness (large-scale light) of the photo
  const S = photo.size, P = photo.pixels, lumA = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) lumA[i] = 0.299 * P[i * 4] + 0.587 * P[i * 4 + 1] + 0.114 * P[i * 4 + 2];
  const blur = boxBlur(boxBlur(lumA, S, 12), S, 12);
  const faceWR = Math.hypot(Lr[234].x - Lr[454].x, Lr[234].y - Lr[454].y); // face width on the render
  const skinRef = blur[Math.round(Lp[50].y) * S + Math.round(Lp[50].x)] || 120; // cheek brightness
  const wb = photo.wb || [1, 1, 1];
  const v = new THREE.Vector4();
  return {
    // color (0xRRGGBB) + weight 0..1 for a point on the model face (world coordinates of the build)
    lookup(x, y, z) {
      v.set(x, y, z, 1).applyMatrix4(vp);
      const px = (v.x / v.w * 0.5 + 0.5) * SIZE, py = (1 - (v.y / v.w * 0.5 + 0.5)) * SIZE;
      const e = edgeDist(px, py);
      if (e <= 0) return null;
      const q = aff(px, py), d = dispAt(px, py), u = q[0] + d[0], w = q[1] + d[1];
      const xi = Math.round(u), yi = Math.round(w);
      if (xi < 1 || yi < 1 || xi >= S - 1 || yi >= S - 1) return null;
      let r = 0, g = 0, b = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const k = ((yi + j) * S + xi + i) * 4; r += P[k]; g += P[k + 1]; b += P[k + 2]; }
      const light = Math.min(1.35, Math.max(0.75, Math.pow(skinRef / Math.max(20, blur[yi * S + xi]), 0.55))); // take out most of the photo's own shading
      const c = [r / 9 * wb[0] * light, g / 9 * wb[1] * light, b / 9 * wb[2] * light].map((x) => Math.max(0, Math.min(255, Math.round(x))));
      return { color: (c[0] << 16) | (c[1] << 8) | c[2], weight: 0.9 * Math.min(1, e / (0.08 * faceWR)) };
    },
  };
}
function boxBlur(src, S, r) {
  const tmp = new Float32Array(S * S), out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) { let acc = 0; for (let x = -r; x <= r; x++) acc += src[y * S + Math.max(0, Math.min(S - 1, x))];
    for (let x = 0; x < S; x++) { tmp[y * S + x] = acc / (2 * r + 1); acc += src[y * S + Math.min(S - 1, x + r + 1)] - src[y * S + Math.max(0, x - r)]; } }
  for (let x = 0; x < S; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[Math.max(0, Math.min(S - 1, y)) * S + x];
    for (let y = 0; y < S; y++) { out[y * S + x] = acc / (2 * r + 1); acc += tmp[Math.min(S - 1, y + r + 1) * S + x] - tmp[Math.max(0, y - r) * S + x]; } }
  return out;
}
