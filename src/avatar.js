// Voxel avatar: a human figure built from small cubes ("voxels").
//
// Structure:
//   - A tree of joints (THREE.Group). Rotating a joint moves everything below it,
//     which is what the animations use (e.g. rotate "kneeL" to bend the left knee).
//   - Each body segment (thigh, chest, head, ...) is one InstancedMesh of cubes,
//     attached to its joint.
//   - Shape of a segment: a base ellipse (from the photo measurements) plus
//     anatomical "bumps" for every muscle and fat depot (see anatomy.js).
//     The radius is stored per slice (one voxel thick) for 72 directions around
//     the segment, which makes the cube test fast even with 1 cm voxels.
//   - Every cube gets a tissue type: skin, fat, slow-twitch muscle, fast-twitch muscle,
//     tendon/bone. The view mode decides how that is colored.
//   - Only the outer shell of cubes is created (interior cubes are invisible anyway).
//
// All sizes are in meters.
import * as THREE from 'three';
import { MUSCLES, GROUPS, SEGMENT_MUSCLES, SEGMENT_FAT, BASE_DEFINITION, muscleGain, bump } from './anatomy.js';

// Available cube sizes (edge length). Smaller = more precise, more cubes.
export const VOXEL_SIZES = [0.04, 0.02, 0.015, 0.01, 0.0075, 0.005];

// Default colors per region (voxel look: skin + sports outfit).
// The front photo replaces them with colors sampled from the picture.
const COLORS = {
  skin: 0xe0ac8a,
  shirt: 0x3b82c4,
  shorts: 0x2d3340,
  shoe: 0xf2f2f2,
  hair: 0x3a2a20,
};

// Colors of the anatomy views
const VIEW_COLORS = {
  fat: new THREE.Color(0xf4d35e),
  tendon: new THREE.Color(0xb9c0cc),
  other: new THREE.Color(0x9a8f86),
  slow: new THREE.Color(0x8e1b1b),   // type I: dark red (lots of myoglobin)
  fast: new THREE.Color(0xf29a9a),   // type II: pale red ("white meat")
  eye: new THREE.Color(0x222222),
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

// Tissue labels per cube
const T_OTHER = -1; // tendon / bone / skin without muscle below
const T_FAT = -2;

const BINS = 72;            // directions around a segment (every 5 degrees)
const DEG = 180 / Math.PI;

// Deterministic pseudo-random number 0..1 from integers (same cube -> same value,
// so colors and fiber types do not flicker when the body is rebuilt)
function hash(a, b, c, d) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177) ^ Math.imul(d | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Base shapes from measurements
// ---------------------------------------------------------------------------
// Radii: [rx, rz] = half width (left-right), half depth (front-back).
function segmentSpecs(b) {
  const s = b.height / 1.75;                       // general size factor
  const c = b.colors;
  const foot = 0.07 * s;
  const legRest = b.legLength - foot;              // thigh + calf
  const upper = (b.height - b.legLength) / 0.82;   // factor for torso + head lengths
  const armR = 0.045 * s;                          // upper arm base radius (muscles come on top)
  const foreR = 0.036 * s;
  const legR = (b.thighWidth / 2) * 0.9;           // thigh base radius
  const calfR = legR * 0.7;
  const shoulderR = b.shoulderWidth / 2;
  const waistR = b.waistWidth / 2;
  const hipR = b.hipWidth / 2;
  const chestZ = b.chestDepth / 2;
  const bellyZ = b.bellyDepth / 2;
  const neckR = 0.048 * s;

  return {
    s,
    L: {
      foot,
      thigh: legRest * (0.44 / 0.86),
      calf: legRest * (0.42 / 0.86),
      belly: 0.24 * upper,
      chest: 0.28 * upper,
      neck: 0.07 * upper,
      head: 0.23 * upper,
      upperArm: b.armLength * (0.30 / 0.52),
      forearm: b.armLength * (0.22 / 0.52) + 0.08 * s, // + hand
    },
    base: { shoulderR, armR, hipR, legR },
    shapes: {
      // torso, built upward from the pelvis
      belly: { top: [waistR, bellyZ], bottom: [hipR, bellyZ * 0.95], color: c.shirt, bands: [[0, 0.3, c.shorts]] },
      chest: { top: [Math.max(shoulderR - armR * 2.2, waistR), chestZ * 0.9], bottom: [waistR * 1.03, (chestZ + bellyZ) / 2], color: c.shirt },
      neck: { top: [neckR, neckR], bottom: [neckR * 1.1, neckR * 1.1], color: c.skin },
      head: { top: [0.093 * s, 0.103 * s], bottom: [0.093 * s, 0.103 * s], color: c.skin, hair: c.hair, profile: 'round' },
      // arms, hanging down from the shoulders
      upperArm: { top: [armR, armR], bottom: [armR * 0.8, armR * 0.8], color: c.shirt, bands: [[0.45, 1, c.skin]] },
      forearm: { top: [foreR, foreR * 0.9], bottom: [foreR * 0.62, foreR * 0.4], color: c.skin, hand: true },
      // legs, hanging down from the hips
      thigh: { top: [legR, legR], bottom: [legR * 0.72, legR * 0.72], color: c.shorts, bands: [[0.55, 1, c.skin]] },
      calf: { top: [calfR, calfR], bottom: [calfR * 0.55, calfR * 0.55], color: c.skin },
      foot: { top: [0.045 * s, 0.11 * s], bottom: [0.045 * s, 0.12 * s], color: c.shoe, offsetZ: 0.05 * s, shoe: true },
    },
  };
}

// ---------------------------------------------------------------------------
// Profile: radius table per slice and direction, incl. muscles and fat
// ---------------------------------------------------------------------------
function expandSym(list) {
  const out = [];
  for (const b of list || []) {
    out.push(b);
    if (b.sym) out.push({ ...b, a: [-b.a[0], b.a[1]] });
  }
  return out;
}

function buildProfile(region, length, shape, dir, comp, V) {
  const slices = Math.max(1, Math.round(length / V));
  const muscles = expandSym(SEGMENT_MUSCLES[region]).map((b) => {
    const muscle = MUSCLES[b.m];
    return { ...b, muscle, gain: muscleGain(muscle, comp) };
  });
  const fatDef = SEGMENT_FAT[region] || { all: 0, depots: [] };
  const fatDepots = expandSym(fatDef.depots);
  const fatGain = comp.fat > 0 ? comp.fat : 0.5 * comp.fat; // losing fat is slower than gaining

  const n = slices * BINS;
  const P = {
    slices, V, dir, shape,
    R: new Float32Array(n),      // radius
    label: new Int16Array(n),    // index into muscles, or T_FAT / T_OTHER
    dM: new Float32Array(n),     // relative change from muscle sliders (for the tint)
    dF: new Float32Array(n),     // relative change from fat slider
    maxR: new Float32Array(slices),
    muscles,
  };
  const def0 = new Float32Array(BINS);
  const mus = new Float32Array(BINS);
  const musChange = new Float32Array(BINS);
  const best = new Int16Array(BINS);
  const bestVal = new Float32Array(BINS);
  const cover = new Float32Array(BINS); // how much a muscle lies under the skin here (0..1)

  for (let i = 0; i < slices; i++) {
    const t = (i + 0.5) / slices;
    const u = dir > 0 ? t : 1 - t;
    let rx = THREE.MathUtils.lerp(shape.bottom[0], shape.top[0], u);
    let rz = THREE.MathUtils.lerp(shape.bottom[1], shape.top[1], u);
    if (shape.profile === 'round') {
      // head: fuller in the middle, narrower at chin and top
      const k = 0.55 + 0.45 * Math.sin(Math.PI * t);
      rx *= k; rz *= k;
    }

    // pass 1: muscle contributions per direction
    let normSum = 0;
    for (let k = 0; k < BINS; k++) {
      const ang = k * 5 > 180 ? k * 5 - 360 : k * 5;
      let d0 = 0, m = 0, mc = 0, bi = T_OTHER, bv = 0, cv = 0; // bi: muscle that covers this spot most
      for (let j = 0; j < muscles.length; j++) {
        const b = muscles[j];
        const f = bump(t, ang, b);
        if (!f) continue;
        d0 += b.h * f * BASE_DEFINITION;
        const v = b.h * f * (BASE_DEFINITION + b.gain);
        m += v;
        mc += b.h * f * b.gain;
        if (v > bv) bv = v;
        if (f > cv) { cv = f; bi = j; }
      }
      def0[k] = d0; mus[k] = m; musChange[k] = mc; best[k] = bi; bestVal[k] = bv; cover[k] = cv;
      normSum += 1 + d0;
    }
    // keep the measured size: muscle relief at slider 0 must not make the body bigger
    const norm = normSum / BINS;

    // pass 2: final radius, fat and labels
    for (let k = 0; k < BINS; k++) {
      const ang = k * 5 > 180 ? k * 5 - 360 : k * 5;
      const a = ang / DEG;
      const s = Math.sin(a), c = Math.cos(a);
      const R0 = 1 / Math.sqrt((s / rx) ** 2 + (c / rz) ** 2); // ellipse radius in this direction
      let depot = 0;
      for (const d of fatDepots) depot += d.h * bump(t, ang, d);
      const fat = (fatDef.all + depot) * fatGain;
      const depotFat = depot * fatGain; // only real depots count as "fat" tissue
      const idx = i * BINS + k;
      P.R[idx] = Math.max(V * 0.75, R0 * (1 + mus[k] + fat) / norm);
      P.dM[idx] = musChange[k] / norm;
      P.dF[idx] = fat;
      // tissue under the skin here: fat depot, the dominant muscle, or tendon/bone
      P.label[idx] = depotFat > 0.06 && depotFat > bestVal[k] ? T_FAT : cover[k] < 0.015 ? T_OTHER : best[k];
      if (P.R[idx] > P.maxR[i]) P.maxR[i] = P.R[idx];
    }
  }
  return P;
}

// Direction index (fractional) of point (x, z); mirror = -1 for right-side limbs
function binOf(x, z, mirror) {
  let a = Math.atan2(mirror * x, z) * DEG; // 0 = front, 90 = outside
  if (a < 0) a += 360;
  return a / 5;
}

function radiusAt(P, i, x, z, mirror) {
  const f = binOf(x, z, mirror);
  const k0 = Math.floor(f) % BINS, k1 = (k0 + 1) % BINS, w = f - Math.floor(f);
  return P.R[i * BINS + k0] * (1 - w) + P.R[i * BINS + k1] * w;
}

function isInside(P, i, x, z, mirror) {
  if (i < 0 || i >= P.slices) return false;
  const r = radiusAt(P, i, x, z, mirror);
  return x * x + z * z <= r * r;
}

// Radius in one direction at slice i (angle in degrees, 0 = front, 90 = outside)
function radiusDir(P, i, angleDeg) {
  const k = Math.round(((angleDeg + 360) % 360) / 5) % BINS;
  return P.R[i * BINS + k];
}
function maxRadiusDir(P, angleDeg, from = 0, to = 1) {
  let m = 0;
  for (let i = Math.floor(from * (P.slices - 1)); i <= Math.floor(to * (P.slices - 1)); i++) m = Math.max(m, radiusDir(P, i, angleDeg));
  return m;
}

// ---------------------------------------------------------------------------
// Cubes: find shell cells of a profile and color them
// ---------------------------------------------------------------------------
function shellCells(P, mirror) {
  const V = P.V, cells = [];
  for (let i = 0; i < P.slices; i++) {
    const N = Math.ceil(P.maxR[i] / V) + 1;
    for (let kx = -N; kx < N; kx++) {
      const x = (kx + 0.5) * V;
      for (let kz = -N; kz < N; kz++) {
        const z = (kz + 0.5) * V;
        if (!isInside(P, i, x, z, mirror)) continue;
        const hidden =
          isInside(P, i, x + V, z, mirror) && isInside(P, i, x - V, z, mirror) &&
          isInside(P, i, x, z + V, mirror) && isInside(P, i, x, z - V, mirror) &&
          isInside(P, i + 1, x, z, mirror) && isInside(P, i - 1, x, z, mirror);
        if (!hidden) cells.push([i, kx, kz, x, z]);
      }
    }
  }
  return cells;
}

// Stats of visible tissue, filled while coloring
function emptyStats() { return { total: 0, slow: 0, fast: 0, fat: 0, other: 0 }; }

function colorCell(P, region, cell, mirror, view, comp, stats, out) {
  const [i, kx, kz, x, z] = cell;
  const { shape, dir } = P;
  const t = (i + 0.5) / P.slices;
  const f = binOf(x, z, mirror);
  const idx = i * BINS + (Math.round(f) % BINS);
  const ang = f * 5 > 180 ? f * 5 - 360 : f * 5;
  const label = P.label[idx];
  const jitter = 0.93 + hash(kx, i, kz, 7) * 0.1; // small brightness change = pixel-art texture

  // tissue type (also for stats). Muscle cubes are slow or fast twitch according to the
  // muscle's fiber mix; the random pick is constant along ~4 cm so it looks like fiber bundles.
  let tissue = 'other', muscle = null;
  if (label === T_FAT) tissue = 'fat';
  else if (label >= 0) {
    muscle = P.muscles[label].muscle;
    const bundle = Math.floor(i / Math.max(1, Math.round(0.04 / P.V)));
    tissue = hash(kx, bundle, kz, region.length) < muscle.slow ? 'slow' : 'fast';
  }
  if (region === 'head' || shape.shoe) tissue = 'other';
  stats.total++; stats[tissue]++;

  const isEye = region === 'head' && P.V <= 0.02 && t > 0.48 && t < 0.6 && Math.abs(Math.abs(ang) - 22) < 9 && z > 0;

  if (view === 'groups' || view === 'fibers') {
    if (isEye) out.copy(VIEW_COLORS.eye);
    else if (tissue === 'fat') out.copy(VIEW_COLORS.fat);
    else if (muscle && view === 'groups') {
      out.set(GROUPS[muscle.group].color);
      out.multiplyScalar(0.85 + 0.3 * hash(label, 3, region.length, 1)); // separate muscles within a group
    } else if (muscle) out.copy(tissue === 'slow' ? VIEW_COLORS.slow : VIEW_COLORS.fast);
    else out.copy(region === 'head' || shape.shoe ? VIEW_COLORS.other : VIEW_COLORS.tendon);
    return out.multiplyScalar(jitter);
  }

  // normal view: clothes / skin / hair
  let color = shape.color;
  for (const [a, b, c] of shape.bands || []) if (t >= a && t <= b) color = c;
  if (shape.hair) {
    const back = Math.abs(ang) > 110 && t > 0.35;
    const top = t > 0.72 && !(Math.abs(ang) < 60 && t < 0.8);
    if (back || top) color = shape.hair;
  }
  out.set(color);
  if (isEye) out.copy(VIEW_COLORS.eye);
  // tint shows where fat (orange) / muscle (red) was added or removed (blue)
  if (comp.tint && !shape.hair) {
    const dF = P.dF[idx], dM = P.dM[idx];
    if (Math.abs(dF) > 0.005) out.lerp(dF > 0 ? TINT.fat : TINT.less, Math.min(0.6, Math.abs(dF) * 1.6));
    if (Math.abs(dM) > 0.005) out.lerp(dM > 0 ? TINT.muscle : TINT.less, Math.min(0.6, Math.abs(dM) * 2.5));
  }
  return out.multiplyScalar(jitter);
}

function buildMesh(name, P, region, mirror, geometry, material, view, comp, stats) {
  const cells = shellCells(P, mirror);
  const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
  mesh.name = name;
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const offZ = P.shape.offsetZ || 0;
  cells.forEach((cell, n) => {
    const [i, , , x, z] = cell;
    m.makeTranslation(x, P.dir * (i + 0.5) * P.V, z + offZ);
    mesh.setMatrixAt(n, m);
    mesh.setColorAt(n, colorCell(P, region, cell, mirror, view, comp, stats, c));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// ---------------------------------------------------------------------------
export class Avatar {
  constructor() {
    this.root = new THREE.Group(); // add this to the scene
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true });
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
    const spec = segmentSpecs(this.body);
    const { L, shapes } = spec;
    this.geometry = new THREE.BoxGeometry(V * 0.96, V * 0.96, V * 0.96);

    // profiles (shared by left and right side)
    const up = { belly: 1, chest: 1, neck: 1, head: 1 };
    const P = {};
    for (const region of Object.keys(shapes)) {
      P[region] = buildProfile(region, L[region], shapes[region], up[region] ? 1 : -1, comp, V);
    }

    // Limb placement from the real (muscled / fat) shapes:
    //   arms outside the waist and the belly, legs not overlapping
    const torsoSide = Math.max(maxRadiusDir(P.belly, 90), maxRadiusDir(P.chest, 90, 0, 0.6));
    const armInner = maxRadiusDir(P.upperArm, -90, 0.3, 1);
    const shoulderJointX = Math.max(spec.base.shoulderR - spec.base.armR, torsoSide + armInner + V * 0.5);
    const hipSide = Math.max(radiusDir(P.belly, 0, 90), maxRadiusDir(P.thigh, 90, 0, 0.3));
    const foreInner = maxRadiusDir(P.forearm, -90);
    const armSpread = Math.max(0.05, Math.asin(Math.min(0.5, (hipSide * 1.02 + foreInner - shoulderJointX) / (L.upperArm + L.forearm))));
    const hipJointX = Math.max(spec.base.hipR - spec.base.legR, maxRadiusDir(P.thigh, -90) + V * 0.5);

    const J = (this.joints = {});
    const stats = emptyStats();
    const joint = (name, parent, x, y, z) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(x, y, z);
      parent.add(g);
      J[name] = g;
      return g;
    };
    const seg = (jointName, region, mirror = 1) =>
      J[jointName].add(buildMesh(region, P[region], region, mirror, this.geometry, this.material, this.view, comp, stats));

    // Hips sit at leg length above the floor
    joint('hips', this.root, 0, L.foot + L.calf + L.thigh, 0);
    joint('spine', J.hips, 0, 0, 0);            seg('spine', 'belly');
    joint('chest', J.spine, 0, L.belly, 0);     seg('chest', 'chest');
    joint('neck', J.chest, 0, L.chest, 0);      seg('neck', 'neck');
    joint('head', J.neck, 0, L.neck, 0);        seg('head', 'head');

    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      joint('shoulder' + side, J.chest, sx * shoulderJointX, L.chest - 0.04 * spec.s, 0);
      seg('shoulder' + side, 'upperArm', sx);
      joint('elbow' + side, J['shoulder' + side], 0, -L.upperArm, 0);
      seg('elbow' + side, 'forearm', sx);
      joint('hip' + side, J.hips, sx * hipJointX, 0, 0);
      seg('hip' + side, 'thigh', sx);
      joint('knee' + side, J['hip' + side], 0, -L.thigh, 0);
      seg('knee' + side, 'calf', sx);
      joint('ankle' + side, J['knee' + side], 0, -L.calf, 0);
      seg('ankle' + side, 'foot', sx);
      J['shoulder' + side].rotation.z = sx * armSpread; // arms hang slightly away from the body
    }

    for (const [k, r] of Object.entries(saved)) if (J[k]) J[k].rotation.copy(r);
    this.lengths = L;
    this.armSpread = armSpread; // used by the animations
    this.stats = stats;
    this.buildMs = performance.now() - t0;
  }

  // Total number of cubes (for debugging / performance)
  get voxelCount() {
    let n = 0;
    this.root.traverse((o) => { if (o.isInstancedMesh) n += o.count; });
    return n;
  }
}
