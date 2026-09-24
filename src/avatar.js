// Voxel avatar: a human figure built from small cubes ("voxels").
//
// How the body is made:
//   1. A skeleton is computed from the measurements (lengths, widths, depths).
//   2. anatomy.js describes the body as smooth 3D shapes attached to bones:
//      bone-like base volumes, one "muscle belly" per muscle, fat depots.
//   3. Those shapes are blended into one smooth surface (signed distance field:
//      for every point in space we know how far it is inside/outside the body).
//   4. The space is cut into cubes. We first test a coarse grid and only refine
//      near the skin, so even 0.5 cm cubes stay fast. Only the left half is
//      computed; the right half is mirrored.
//   5. Only the outer shell of cubes is kept. Each cube is attached to the bone
//      of the nearest shape (so animations move it), gets a tissue type
//      (fat / slow-twitch / fast-twitch muscle / tendon) and a crease shading.
//
// All sizes are in meters.
import * as THREE from 'three';
import { MUSCLES, GROUPS, bodyParts, muscleGain } from './anatomy.js';

// Available cube sizes (edge length). Smaller = more precise, more cubes.
export const VOXEL_SIZES = [0.04, 0.02, 0.015, 0.01, 0.0075, 0.005];

// Default colors (the front photo replaces skin/shirt/shorts/hair)
const COLORS = {
  skin: 0xe0ac8a,
  shirt: 0x3b82c4,
  shorts: 0x2d3340,
  shoe: 0xf2f2f2,
  hair: 0x3a2a20,
};
const DETAIL = {
  sole: new THREE.Color(0x2e2e2e),
  sock: new THREE.Color(0xf0f0f0),
  eyeWhite: new THREE.Color(0xf4f1ea),
  iris: new THREE.Color(0x3b2a20),
  lip: new THREE.Color(0xb3685a),
};

// Colors of the anatomy views
const VIEW_COLORS = {
  fat: new THREE.Color(0xf4d35e),
  tendon: new THREE.Color(0xb9c0cc),
  other: new THREE.Color(0x9a8f86),
  slow: new THREE.Color(0x8e1b1b),   // type I: dark red (lots of myoglobin)
  fast: new THREE.Color(0xf29a9a),   // type II: pale red ("white meat")
};

// Tint colors in the normal view to show what changed
const TINT = { fat: new THREE.Color(0xffa040), muscle: new THREE.Color(0xe53935), less: new THREE.Color(0x4fa8e8) };

// Default body measurements (average adult, 1.75 m). The photo scan overrides these.
export const DEFAULT_BODY = {
  height: 1.75,        // total height
  shoulderWidth: 0.42, // outer width across the shoulders (incl. upper arms)
  waistWidth: 0.30,    // narrowest width between chest and hips
  hipWidth: 0.34,      // outer width across the hips
  thighWidth: 0.16,    // width of one thigh
  chestDepth: 0.23,    // front-to-back at the chest (side photo)
  bellyDepth: 0.21,    // front-to-back at the belly (side photo)
  legLength: 0.93,     // hip joint to floor
  armLength: 0.52,     // shoulder to wrist
  colors: COLORS,
};

const CENTRAL = new Set(['hips', 'spine', 'chest', 'neck', 'head']);

// Deterministic pseudo-random number 0..1 (same cube -> same value, no flicker)
function hash(a, b, c, d) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177) ^ Math.imul(d | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Skeleton from measurements
// ---------------------------------------------------------------------------
function skeleton(b, comp) {
  const s = b.height / 1.75;                     // general size factor
  const u = (b.height - b.legLength) / 0.82;     // factor for torso + head lengths
  const foot = 0.07 * s;
  const legRest = b.legLength - foot;
  const L = {
    foot,
    thigh: legRest * (0.44 / 0.86),
    calf: legRest * (0.42 / 0.86),
    belly: 0.24 * u,
    chest: 0.28 * u,
    neck: 0.07 * u,
    head: 0.23 * u,
    upperArm: b.armLength * 0.535,
    forearmOnly: b.armLength * 0.465,           // elbow -> wrist
    hand: 0.108 * b.height,
  };
  L.forearm = L.forearmOnly + L.hand;
  const k = {
    s, u, L,
    shoulderR: b.shoulderWidth / 2,
    waistR: b.waistWidth / 2,
    hipR: b.hipWidth / 2,
    chestZ: b.chestDepth / 2,
    bellyZ: b.bellyDepth / 2,
    thighR: (b.thighWidth / 2) * 0.72,           // muscles are added on top
  };
  const ribX = Math.max(k.waistR * 1.08, k.shoulderR - 0.095 * s);
  k.shoulderJointX = Math.max(k.shoulderR - 0.05 * s, ribX + 0.02 * s);
  k.hipJointX = Math.max(k.hipR * 0.52, k.thighR * 1.3);
  // Arms hang slightly away from the body so the hands clear the (fat / muscular) hips
  const fatOut = Math.max(0, comp.fat) * 0.045 * s;
  const musOut = Math.max(0, comp.muscle) * 0.03 * s;
  const hipOuter = Math.max(k.hipR, k.hipJointX + k.thighR * 1.45) + fatOut + musOut;
  const reach = L.upperArm + L.forearm;
  k.armSpread = Math.max(0.05, Math.asin(Math.min(0.6, (hipOuter + 0.03 * s - k.shoulderJointX) / reach)));
  return k;
}

// ---------------------------------------------------------------------------
// Distance functions (negative = inside)
// ---------------------------------------------------------------------------
function sdEllipsoid(x, y, z, rx, ry, rz) {
  const k0 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  const k1 = Math.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2);
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
function sdCone(x, y, z, P) {
  const px = x - P.a[0], py = y - P.a[1], pz = z - P.a[2];
  let t = (px * P.ab[0] + py * P.ab[1] + pz * P.ab[2]) / P.ab2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - P.ab[0] * t, dy = py - P.ab[1] * t, dz = pz - P.ab[2] * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (P.ra + (P.rb - P.ra) * t);
}
// smooth minimum: blends two shapes with a soft fillet of size k
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const mirrorX = (v) => [-v[0], v[1], v[2]];

// Turn anatomy records into fast primitives with world-space bounds
function compile(parts, bind, comp, s) {
  const prims = [];
  const fatGain = comp.fat > 0 ? comp.fat : 0.5 * comp.fat; // losing fat is slower than gaining
  const add = (rec, mirrored) => {
    const P = { ...rec, e: bind[rec.bone].inv, mirrored };
    const m = mirrored ? mirrorX : (v) => v;
    let lc, lr;
    if (rec.type === 'ell' || rec.type === 'fat') {
      P.c = m(rec.c);
      // fat fields reach beyond the skin, so the thicker new surface still lies inside them
      if (rec.type === 'fat') P.r = rec.r.map((v) => v * 1.6);
      lc = P.c; lr = Math.max(...P.r);
    } else if (rec.type === 'cone') {
      P.a = m(rec.a); P.b = m(rec.b);
      P.ab = [P.b[0] - P.a[0], P.b[1] - P.a[1], P.b[2] - P.a[2]];
      P.ab2 = P.ab[0] ** 2 + P.ab[1] ** 2 + P.ab[2] ** 2;
      lc = [(P.a[0] + P.b[0]) / 2, (P.a[1] + P.b[1]) / 2, (P.a[2] + P.b[2]) / 2];
      lr = Math.sqrt(P.ab2) / 2 + Math.max(rec.ra, rec.rb);
    } else { // muscle belly: ellipsoid from origin a to insertion b
      const a = m(rec.a), b = m(rec.b);
      P.muscle = MUSCLES[rec.m];
      P.gain = muscleGain(P.muscle, comp);
      const ey = norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      const out = m(rec.out);
      const d = out[0] * ey[0] + out[1] * ey[1] + out[2] * ey[2];
      const ez = norm3([out[0] - ey[0] * d, out[1] - ey[1] * d, out[2] - ey[2] * d]);
      const ex = [ey[1] * ez[2] - ey[2] * ez[1], ey[2] * ez[0] - ey[0] * ez[2], ey[0] * ez[1] - ey[1] * ez[0]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const g = P.gain;
      // growth: much thicker, a bit wider, hardly longer (muscles grow in cross-section)
      const rz = rec.th * Math.max(0.6, 1 + 0.5 * g);
      const rx = rec.w * Math.max(0.75, 1 + 0.18 * g);
      const ry = (len / 2) * (1.05 + 0.04 * Math.max(0, g));
      const push = (rz - rec.th) * 0.6; // grow outward, not into the bone
      P.c = [(a[0] + b[0]) / 2 + ez[0] * push, (a[1] + b[1]) / 2 + ez[1] * push, (a[2] + b[2]) / 2 + ez[2] * push];
      P.ex = ex; P.ey = ey; P.ez = ez; P.r = [rx, ry, rz];
      lc = P.c; lr = Math.max(rx, ry, rz);
    }
    if (rec.type === 'fat') P.amt = rec.amt * fatGain;
    // world-space bounding sphere (for culling)
    const w = new THREE.Vector3(...lc).applyMatrix4(bind[rec.bone].world);
    P.wc = [w.x, w.y, w.z];
    P.wr = lr + (rec.type === 'fat' ? 0 : 0.012 * s) + 0.06 * s * Math.max(0, fatGain); // + fillet + fat
    P.kind = rec.type === 'fat' ? 2 : rec.type === 'muscle' ? 1 : 0;
    prims.push(P);
  };
  for (const list of [parts.base, parts.muscles, parts.fat]) {
    for (const rec of list) {
      if (rec.type === 'fat' && Math.abs(fatGain) < 1e-4) continue;
      add(rec, false);
      if (rec.sym && CENTRAL.has(rec.bone)) add(rec, true);
    }
  }
  return prims;
}

// Evaluate the body at world point (x, y, z) using candidate primitives.
// Returns the signed distance; details (nearest bone, muscle, fat) go into `info`.
const info = { bone: null, prim: null, muscle: null, muscleD: 1e9, fat: 0 };
function evaluate(x, y, z, cands, kB, kM, detail) {
  let dB = 1e9, dM = 1e9, F = 0, best = 1e9, bestP = null, bestM = null, bestMD = 1e9;
  for (let i = 0; i < cands.length; i++) {
    const P = cands[i], e = P.e;
    const lx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const ly = e[1] * x + e[5] * y + e[9] * z + e[13];
    const lz = e[2] * x + e[6] * y + e[10] * z + e[14];
    let d;
    if (P.kind === 2) { // fat depot: soft thickness field
      const qx = (lx - P.c[0]) / P.r[0], qy = (ly - P.c[1]) / P.r[1], qz = (lz - P.c[2]) / P.r[2];
      const w = 1 - (qx * qx + qy * qy + qz * qz);
      if (w > 0) F += P.amt * w * Math.sqrt(w);
      continue;
    }
    if (P.type === 'cone') d = sdCone(lx, ly, lz, P);
    else if (P.kind === 0) d = sdEllipsoid(lx - P.c[0], ly - P.c[1], lz - P.c[2], P.r[0], P.r[1], P.r[2]);
    else {
      const qx = lx - P.c[0], qy = ly - P.c[1], qz = lz - P.c[2];
      d = sdEllipsoid(
        qx * P.ex[0] + qy * P.ex[1] + qz * P.ex[2],
        qx * P.ey[0] + qy * P.ey[1] + qz * P.ey[2],
        qx * P.ez[0] + qy * P.ez[1] + qz * P.ez[2], P.r[0], P.r[1], P.r[2]);
    }
    if (P.kind === 0) dB = smin(dB, d, kB);
    else {
      dM = smin(dM, d, kM);
      if (d < bestMD) { bestMD = d; bestM = P; }
    }
    if (d < best) { best = d; bestP = P; }
  }
  if (detail) {
    info.prim = bestP; info.bone = bestP?.bone; info.muscle = bestM; info.muscleD = bestMD; info.fat = F;
  }
  return smin(dB, dM, kM * 1.4) - F;
}

// ---------------------------------------------------------------------------
export class Avatar {
  constructor() {
    this.root = new THREE.Group(); // add this to the scene
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    this.body = { ...DEFAULT_BODY };
    // body composition: sliders -1..+1 (0 = as scanned), per-group sliders,
    // training style (strength / mixed / endurance), tint = color the changes
    this.composition = { fat: 0, muscle: 0, training: 'mixed', groups: {}, tint: true };
    this.voxel = 0.01;   // cube size in meters (1 cm)
    this.view = 'look';  // 'look' | 'groups' | 'fibers'
    this.joints = {};
    this.build();
  }

  // (Re)create joints and cubes. Keeps joint rotations
  // so an animation can continue while the body is rebuilt.
  build() {
    const t0 = performance.now();
    const saved = {};
    for (const [k, j] of Object.entries(this.joints)) saved[k] = j.rotation.clone();
    this.root.traverse((o) => o.isInstancedMesh && o.dispose());
    this.geometry?.dispose();
    this.root.clear();

    const V = this.voxel, comp = this.composition;
    const k = skeleton(this.body, comp);
    const { L, s } = k;

    // ---- 1. joint tree in bind pose ----
    const J = (this.joints = {});
    const joint = (name, parent, x, y, z) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(x, y, z);
      parent.add(g);
      J[name] = g;
      return g;
    };
    joint('hips', this.root, 0, L.foot + L.calf + L.thigh, 0);
    joint('spine', J.hips, 0, 0, 0);
    joint('chest', J.spine, 0, L.belly, 0);
    joint('neck', J.chest, 0, L.chest, 0);
    joint('head', J.neck, 0, L.neck, 0);
    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      joint('shoulder' + side, J.chest, sx * k.shoulderJointX, L.chest - 0.04 * s, 0).rotation.z = sx * k.armSpread;
      joint('elbow' + side, J['shoulder' + side], 0, -L.upperArm, 0);
      joint('hip' + side, J.hips, sx * k.hipJointX, 0, 0);
      joint('knee' + side, J['hip' + side], 0, -L.thigh, 0);
      joint('ankle' + side, J['knee' + side], 0, -L.calf, 0);
    }
    this.root.updateMatrixWorld(true);
    // bind matrices; anatomy uses bone names without side (= left side)
    const rootInv = this.root.matrixWorld.clone().invert();
    const bind = {};
    for (const [name, g] of Object.entries(J)) {
      if (name.endsWith('R')) continue;
      const world = rootInv.clone().multiply(g.matrixWorld);
      const key = name.endsWith('L') ? name.slice(0, -1) : name;
      const invM = world.clone().invert();
      bind[key] = { world, invM, inv: invM.elements, joint: name };
    }

    // ---- 2. shapes ----
    const prims = compile(bodyParts(k), bind, comp, s);
    // blend sizes: larger = smoother transitions; bigger muscles blend more softly
    const kB = 0.045 * s, kM = 0.022 * s * (1 + 0.8 * Math.max(0, comp.muscle));
    const shapes = prims.filter((p) => p.kind !== 2);

    // ---- 3. coarse grid, then refine near the skin ----
    let maxX = 0, maxY = 0, minZ = 0, maxZ = 0;
    const minY = 0;
    for (const p of shapes) {
      maxX = Math.max(maxX, p.wc[0] + p.wr);
      maxY = Math.max(maxY, p.wc[1] + p.wr);
      minZ = Math.min(minZ, p.wc[2] - p.wr); maxZ = Math.max(maxZ, p.wc[2] + p.wr);
    }
    const n = Math.max(1, Math.round(0.04 / V)); // fine cells per coarse cell (per axis)
    const C = V * n;
    const z0 = Math.floor(minZ / C) * C;
    const cx = Math.ceil(maxX / C), cy = Math.ceil((maxY - minY) / C), cz = Math.ceil((maxZ - z0) / C);
    const fx = cx * n, fy = cy * n, fz = cz * n;
    const inside = new Uint8Array(fx * fy * fz);
    const fIdx = (ix, iy, iz) => (iy * fz + iz) * fx + ix;
    const band = []; // [coarseX, coarseY, coarseZ, candidates]
    // A shape must be included wherever it can change the surface inside this cell:
    // half cell diagonal + refinement band + blend size. Too small = steps between cells.
    const bandW = (C * 0.9 + 0.004) * (this.bandScale || 1.5); // refine where the skin can be
    const reach = C * 0.87 + bandW + kB * 1.5;
    for (let j = 0; j < cy; j++) for (let l = 0; l < cz; l++) for (let i = 0; i < cx; i++) {
      const x = (i + 0.5) * C, y = minY + (j + 0.5) * C, z = z0 + (l + 0.5) * C;
      const cands = [];
      for (const p of prims) {
        const dx = x - p.wc[0], dy = y - p.wc[1], dz = z - p.wc[2];
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) - p.wr < reach) cands.push(p);
      }
      if (!cands.some((p) => p.kind !== 2)) continue; // nothing here: outside
      const d = evaluate(x, y, z, cands, kB, kM, false);
      if (Math.abs(d) < bandW) band.push([i, j, l, cands]);
      else if (d < 0) { // completely inside: fill without testing each small cube
        for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) for (let a = 0; a < n; a++) {
          inside[fIdx(i * n + a, j * n + b, l * n + c)] = 1;
        }
      }
    }
    for (const [i, j, l, cands] of band) {
      for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) for (let a = 0; a < n; a++) {
        const ix = i * n + a, iy = j * n + b, iz = l * n + c;
        const d = evaluate((ix + 0.5) * V, minY + (iy + 0.5) * V, z0 + (iz + 0.5) * V, cands, kB, kM, false);
        if (d < 0) inside[fIdx(ix, iy, iz)] = 1;
      }
    }
    const isIn = (ix, iy, iz) => {
      if (ix < 0) ix = -ix - 1; // mirror across the body center
      if (ix >= fx || iy < 0 || iy >= fy || iz < 0 || iz >= fz) return 0;
      return inside[fIdx(ix, iy, iz)];
    };

    // ---- 4. shell cubes: bone, tissue, color ----
    const fatGain = comp.fat > 0 ? comp.fat : 0.5 * comp.fat;
    const aoR = V <= 0.015 ? 2 : 1;
    const aoCount = (2 * aoR + 1) ** 3 - 1;
    const byJoint = {}; // joint name -> [{p: local position, c: color}]
    const stats = { total: 0, slow: 0, fast: 0, fat: 0, other: 0 };
    const col = new THREE.Color();
    const local = new THREE.Vector3();
    for (const [i, j, l, cands] of band) {
      for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) for (let a = 0; a < n; a++) {
        const ix = i * n + a, iy = j * n + b, iz = l * n + c;
        if (!isIn(ix, iy, iz)) continue;
        if (isIn(ix + 1, iy, iz) && isIn(ix - 1, iy, iz) && isIn(ix, iy + 1, iz) &&
            isIn(ix, iy - 1, iz) && isIn(ix, iy, iz + 1) && isIn(ix, iy, iz - 1)) continue;
        const x = (ix + 0.5) * V, y = minY + (iy + 0.5) * V, z = z0 + (iz + 0.5) * V;
        evaluate(x, y, z, cands, kB, kM, true);
        const P = info.prim;
        if (!P) continue;
        const B = bind[P.bone];
        local.set(x, y, z).applyMatrix4(B.invM);

        // crease shading ("ambient occlusion"): many filled neighbors = darker
        let occ = 0;
        for (let db = -aoR; db <= aoR; db++) for (let dc = -aoR; dc <= aoR; dc++) for (let da = -aoR; da <= aoR; da++) {
          if (da || db || dc) occ += isIn(ix + da, iy + db, iz + dc);
        }
        const shade = Math.min(1.06, Math.max(0.55, 1.2 - 0.75 * (occ / aoCount)));

        // tissue under the skin here
        let tissue = 'other';
        const M = info.muscle;
        const bone = P.bone;
        const noMuscle = bone === 'head' || bone === 'ankle' || (bone === 'elbow' && local.y < -L.forearmOnly);
        if (!noMuscle) {
          if (info.fat > 0.02 * s && fatGain > 0) tissue = 'fat';
          else if (M && info.muscleD < 0.009 * s + Math.max(0, info.fat)) {
            // fiber type: constant along ~4 cm so it looks like fiber bundles
            const bundle = Math.floor(local.y / 0.04);
            const h = hash(Math.round(local.x / V), bundle, Math.round(local.z / V), M.m.length + (M.mirrored ? 7 : 0));
            tissue = h < M.muscle.slow ? 'slow' : 'fast';
          }
        }

        this.colorCube(col, bone, local, tissue, M, k, shade, ix, iy, iz);
        const color = col.clone();
        (byJoint[B.joint] ||= []).push({ p: local.clone(), c: color });
        // mirrored cube on the right side
        const nameR = CENTRAL.has(bone) ? B.joint : B.joint.slice(0, -1) + 'R';
        (byJoint[nameR] ||= []).push({ p: new THREE.Vector3(-local.x, local.y, local.z), c: color });
        stats.total += 2; stats[tissue] += 2;
      }
    }

    // ---- 5. meshes (one per bone) ----
    this.geometry = new THREE.BoxGeometry(V, V, V);
    const m4 = new THREE.Matrix4();
    for (const [name, list] of Object.entries(byJoint)) {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, list.length);
      mesh.name = name;
      mesh.castShadow = mesh.receiveShadow = true;
      list.forEach((r, i) => {
        mesh.setMatrixAt(i, m4.makeTranslation(r.p.x, r.p.y, r.p.z));
        mesh.setColorAt(i, r.c);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      J[name].add(mesh);
    }

    for (const [key, r] of Object.entries(saved)) if (J[key]) J[key].rotation.copy(r);
    this.lengths = L;
    this.armSpread = k.armSpread; // used by the animations
    this.stats = stats;
    this.buildMs = performance.now() - t0;
  }

  // Color of one cube (view mode, clothes, face details, change tint, crease shading)
  colorCube(out, bone, p, tissue, M, k, shade, ix, iy, iz) {
    const { L, s } = k;
    const c = this.body.colors;
    const jitter = 0.97 + hash(ix, iy, iz, 3) * 0.05;

    if (this.view === 'groups' || this.view === 'fibers') {
      if (tissue === 'fat') out.copy(VIEW_COLORS.fat);
      else if (tissue === 'slow' || tissue === 'fast') {
        if (this.view === 'groups') {
          out.set(GROUPS[M.muscle.group].color);
          out.multiplyScalar(0.85 + 0.3 * hash(M.m.length, Math.round(M.c[1] * 100), 5, 1)); // separate muscles in a group
        } else out.copy(tissue === 'slow' ? VIEW_COLORS.slow : VIEW_COLORS.fast);
      } else out.copy(bone === 'head' || bone === 'ankle' ? VIEW_COLORS.other : VIEW_COLORS.tendon);
      return out.multiplyScalar(shade * jitter);
    }

    // ---- normal view: skin, clothes, hair, face ----
    const S = (v) => v * s;
    let color = c.skin, special = null;
    if (bone === 'head') {
      const hair = p.y > S(0.178) || (p.z < -S(0.012) && p.y > S(0.075)) ||
        (Math.abs(p.x) > S(0.06) && p.y > S(0.132) && p.z < S(0.035) && Math.abs(p.x) < S(0.074));
      if (hair) color = c.hair;
      if (p.z > S(0.045)) {
        const ex = Math.abs(p.x) - S(0.031), ey = p.y - S(0.118);
        const eyeD = Math.hypot(ex, ey);
        if (eyeD < S(0.007)) special = DETAIL.iris;
        else if (eyeD < S(0.013) && Math.abs(ey) < S(0.008)) special = DETAIL.eyeWhite;
        else if (ey > S(0.013) && ey < S(0.022) && Math.abs(ex) < S(0.017)) color = c.hair;  // eyebrows
        else if (Math.abs(p.x) < S(0.021) && p.y > S(0.044) && p.y < S(0.056)) special = DETAIL.lip; // mouth
      }
    } else if (bone === 'chest') color = c.shirt;
    else if (bone === 'spine') color = p.y > S(0.08) ? c.shirt : c.shorts;
    else if (bone === 'hips') color = c.shorts;
    else if (bone === 'shoulder') color = p.y > -L.upperArm * 0.45 ? c.shirt : c.skin;
    else if (bone === 'hip') color = p.y > -L.thigh * 0.5 ? c.shorts : c.skin;
    else if (bone === 'knee') { if (p.y < -L.calf + S(0.05)) special = DETAIL.sock; }
    else if (bone === 'ankle') { color = c.shoe; if (p.y < -L.foot + S(0.018)) special = DETAIL.sole; }

    if (special) out.copy(special);
    else out.set(color);
    // hems and waistband a bit darker
    const hem = (bone === 'shoulder' && Math.abs(p.y + L.upperArm * 0.45) < S(0.012)) ||
      (bone === 'hip' && Math.abs(p.y + L.thigh * 0.5) < S(0.012)) ||
      (bone === 'spine' && p.y > S(0.06) && p.y < S(0.08));
    if (hem) out.multiplyScalar(0.8);

    // tint shows where fat (orange) / muscle (red) was added or removed (blue)
    const comp = this.composition;
    if (comp.tint && bone !== 'head') {
      const fatGain = comp.fat > 0 ? comp.fat : 0.5 * comp.fat;
      if (Math.abs(fatGain) > 0.01 && tissue === 'fat') out.lerp(fatGain > 0 ? TINT.fat : TINT.less, Math.min(0.3, Math.abs(fatGain) * 0.3));
      if (M && (tissue === 'slow' || tissue === 'fast') && Math.abs(M.gain) > 0.02) {
        out.lerp(M.gain > 0 ? TINT.muscle : TINT.less, Math.min(0.3, Math.abs(M.gain) * 0.25));
      }
    }
    return out.multiplyScalar(shade * jitter);
  }

  // Total number of cubes (for debugging / performance)
  get voxelCount() {
    let n = 0;
    this.root.traverse((o) => { if (o.isInstancedMesh) n += o.count; });
    return n;
  }
}
