// Voxel avatar: a human figure built from small cubes ("voxels").
//
// Structure:
//   - A tree of joints (THREE.Group). Rotating a joint moves everything below it,
//     which is what the animations use (e.g. rotate "kneeL" to bend the left knee).
//   - Each body segment (thigh, chest, head, ...) is one InstancedMesh of cubes,
//     attached to its joint. A segment is an elliptic "tube": we know its length and
//     the width (rx) / depth (rz) radius at its top and bottom, and fill it with voxels.
//   - Only the outer shell of voxels is created (interior cubes are invisible anyway).
//
// All sizes are in meters.
import * as THREE from 'three';

export const VOXEL = 0.04; // edge length of one cube (4 cm)

// Default colors per region (voxel look: skin + sports outfit).
// The front photo replaces them with colors sampled from the picture.
const COLORS = {
  skin: 0xe0ac8a,
  shirt: 0x3b82c4,
  shorts: 0x2d3340,
  shoe: 0xf2f2f2,
  hair: 0x3a2a20,
};

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

// How much each region's radius grows at slider value +1 (= +100 %).
// [fat, muscle]. Fat goes mostly to belly, hips, thighs, upper arms;
// muscle mostly to shoulders, chest, arms and calves.
const GROWTH = {
  bellyX: [0.45, 0.05], bellyZ: [0.75, 0.05], // belly sticks out to the front
  hipsX: [0.35, 0.05], hipsZ: [0.4, 0.1],
  chestX: [0.15, 0.2], chestZ: [0.3, 0.3],
  shoulders: [0.08, 0.22],
  neck: [0.25, 0.3],
  head: [0.08, 0],
  upperArm: [0.4, 0.55],
  forearm: [0.15, 0.3],
  thigh: [0.35, 0.3],
  calf: [0.15, 0.35],
};

// Tint colors to show what changed
const TINT = { fat: new THREE.Color(0xffa040), muscle: new THREE.Color(0xe53935), less: new THREE.Color(0x4fa8e8) };

// Slider value -> effect. Losing is harder than gaining: negative side counts half.
const eff = (v) => (v > 0 ? v : 0.5 * v);

// Build segment lengths and shapes from body measurements + composition
// (comp.fat / comp.muscle in -1..+1, 0 = as scanned).
// Radii: [rx, rz] = half width (left-right), half depth (front-back).
function segmentSpecs(b, comp) {
  const s = b.height / 1.75;                       // general size factor
  const c = b.colors;
  // growth factor and color tint of one region
  // (never below 70 %: thinner limbs would collapse to a single voxel row)
  const g = (key) => Math.max(0.7, 1 + GROWTH[key][0] * eff(comp.fat) + GROWTH[key][1] * eff(comp.muscle));
  const tint = (key) => comp.tint ? { fat: GROWTH[key][0] * eff(comp.fat), muscle: GROWTH[key][1] * eff(comp.muscle) } : null;

  const foot = 0.07 * s;
  const legRest = b.legLength - foot;              // thigh + calf
  const upper = (b.height - b.legLength) / 0.82;   // factor for torso + head lengths
  const armR = 0.05 * s * g('upperArm');           // upper arm radius
  const legR = (b.thighWidth / 2) * g('thigh');    // thigh radius
  const calfR = (b.thighWidth / 2) * 0.72 * g('calf');
  const shoulderR = (b.shoulderWidth / 2) * g('shoulders');
  const waistR = (b.waistWidth / 2) * g('bellyX');
  const hipR = (b.hipWidth / 2) * g('hipsX');
  const chestZ = (b.chestDepth / 2) * g('chestZ');
  const bellyZ = (b.bellyDepth / 2) * g('bellyZ');
  const foreR = Math.min(0.04 * s * g('forearm'), armR * 0.85); // never wider than the upper arm
  const neckR = 0.05 * s * g('neck');
  const headK = g('head');
  const shoulderJointX = Math.max(shoulderR - armR, waistR * 1.05 + armR, hipR * 0.8);

  return {
    // lengths (used by joints too)
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
    // Horizontal placement of the limbs (legs must not overlap)
    hipJointX: Math.max(hipR - legR, legR * 0.95),
    // arms always outside the waist, even for a wide belly
    shoulderJointX,
    // spread arms a little if the hips are wider than the shoulders
    armSpread: Math.max(0.06, Math.asin(Math.min(0.5, (hipR + armR * 1.2 - shoulderJointX) / b.armLength))),
    // Segment shapes: region name -> tube description
    shapes: {
      // torso, built upward from the pelvis
      belly: { top: [waistR, bellyZ], bottom: [hipR, (b.bellyDepth / 2) * 0.95 * g('hipsZ')], color: c.shirt, bands: [[0, 0.3, c.shorts]], tint: tint('bellyZ') },
      chest: { top: [Math.max(shoulderR - armR * 2, waistR), chestZ * 0.9], bottom: [waistR * 1.05, (chestZ + bellyZ) / 2], color: c.shirt, tint: tint('chestZ') },
      neck: { top: [neckR, neckR], bottom: [neckR * 1.1, neckR * 1.1], color: c.skin, tint: tint('neck') },
      head: { top: [0.095 * s * headK, 0.105 * s * headK], bottom: [0.095 * s * headK, 0.105 * s * headK], color: c.skin, bands: [[0.7, 1, c.hair]], hair: c.hair, profile: 'round' },
      // arms, hanging down from the shoulders
      upperArm: { top: [armR, armR], bottom: [armR * 0.85, armR * 0.85], color: c.shirt, bands: [[0.45, 1, c.skin]], tint: tint('upperArm') },
      forearm: { top: [foreR, foreR], bottom: [foreR * 0.75, foreR * 0.62], color: c.skin, tint: tint('forearm') },
      // legs, hanging down from the hips
      thigh: { top: [legR, legR], bottom: [Math.max(legR * 0.72, calfR), Math.max(legR * 0.72, calfR)], color: c.shorts, bands: [[0.55, 1, c.skin]], tint: tint('thigh') },
      calf: { top: [calfR, calfR], bottom: [calfR * 0.62, calfR * 0.62], color: c.skin, tint: tint('calf') },
      foot: { top: [0.045 * s, 0.11 * s], bottom: [0.045 * s, 0.12 * s], color: c.shoe, offsetZ: 0.05 * s },
    },
  };
}

// Is point (x, z) inside the ellipse with radii rx, rz?
const inside = (x, z, rx, rz) => (x * x) / (rx * rx) + (z * z) / (rz * rz) <= 1;

// Create one voxel segment as an InstancedMesh.
// dir = +1 grows upward from the joint, -1 grows downward.
function buildSegment(name, length, shape, dir, material) {
  const slices = Math.max(1, Math.round(length / VOXEL));
  const cells = []; // [x, y, z, color]

  // radius of slice i (0 = start at joint, 1 = far end)
  const radiusAt = (t) => {
    let rx = THREE.MathUtils.lerp(shape.bottom[0], shape.top[0], dir > 0 ? t : 1 - t);
    let rz = THREE.MathUtils.lerp(shape.bottom[1], shape.top[1], dir > 0 ? t : 1 - t);
    if (shape.profile === 'round') {
      // head: fuller in the middle, narrower at chin and top
      const k = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
      rx *= k; rz *= k;
    }
    // never thinner than half a voxel so each slice has at least one cube
    return [Math.max(rx, VOXEL * 0.5), Math.max(rz, VOXEL * 0.5)];
  };

  const offZ = shape.offsetZ || 0;
  for (let i = 0; i < slices; i++) {
    const t = (i + 0.5) / slices;
    const [rx, rz] = radiusAt(t);
    const [prx, prz] = radiusAt((i - 0.5) / slices); // neighbor slices, for shell test
    const [nrx, nrz] = radiusAt((i + 1.5) / slices);
    const nx = Math.max(1, Math.round((2 * rx) / VOXEL));
    const nz = Math.max(1, Math.round((2 * rz) / VOXEL));
    // widen the test ellipse slightly so the grid covers the full radius
    const ex = (nx * VOXEL) / 2, ez = (nz * VOXEL) / 2;
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const x = (ix - (nx - 1) / 2) * VOXEL;
        const z = (iz - (nz - 1) / 2) * VOXEL;
        if (!inside(x, z, ex, ez) && !(nx === 1 || nz === 1)) continue;
        // Shell test: skip cube if all neighbors are also filled
        const end = i === 0 || i === slices - 1;
        const hidden = !end &&
          inside(x + VOXEL, z, ex, ez) && inside(x - VOXEL, z, ex, ez) &&
          inside(x, z + VOXEL, ex, ez) && inside(x, z - VOXEL, ex, ez) &&
          inside(x, z, prx, prz) && inside(x, z, nrx, nrz);
        if (hidden) continue;

        // color: base color, overridden by "bands" [from, to, color]
        // (t = 0 at the joint, 1 at the far end), e.g. short sleeves
        let color = shape.color;
        for (const [a, b, c] of shape.bands || []) if (t >= a && t <= b) color = c;
        // hair: also down the back of the head, never over the face
        if (shape.hair && z < -rz * 0.3 && t > 0.35) color = shape.hair;
        if (name === 'head' && z > rz * 0.35 && t < 0.8) color = shape.color;
        const y = dir * (i + 0.5) * VOXEL;
        cells.push([x, y, z + offZ, color]);
      }
    }
  }

  const geo = new THREE.BoxGeometry(VOXEL * 0.96, VOXEL * 0.96, VOXEL * 0.96);
  const mesh = new THREE.InstancedMesh(geo, material, cells.length);
  mesh.name = name;
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  cells.forEach(([x, y, z, col], idx) => {
    m.makeTranslation(x, y, z);
    mesh.setMatrixAt(idx, m);
    c.set(col);
    // tint shows where fat (orange) / muscle (red) was added or removed (blue)
    if (shape.tint) {
      const { fat, muscle } = shape.tint;
      c.lerp(fat >= 0 ? TINT.fat : TINT.less, Math.min(0.6, Math.abs(fat) * 1.3));
      c.lerp(muscle >= 0 ? TINT.muscle : TINT.less, Math.min(0.6, Math.abs(muscle) * 1.3));
    }
    // small random brightness change per cube = "pixel art" texture
    c.multiplyScalar(0.92 + Math.random() * 0.12);
    mesh.setColorAt(idx, c);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

export class Avatar {
  constructor() {
    this.root = new THREE.Group(); // add this to the scene
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true });
    this.body = { ...DEFAULT_BODY };
    // body composition sliders: -1..+1, 0 = as scanned; tint = color the changes
    this.composition = { fat: 0, muscle: 0, tint: true };
    this.joints = {};
    this.build();
  }

  // (Re)create joints and voxels from this.body. Keeps joint rotations
  // so an animation can continue while the body is rebuilt.
  build() {
    const saved = {};
    for (const [k, j] of Object.entries(this.joints)) saved[k] = j.rotation.clone();
    // remove old meshes and free their GPU memory
    this.root.traverse((o) => o.isInstancedMesh && o.geometry.dispose());
    this.root.clear();

    const spec = segmentSpecs(this.body, this.composition);
    const { L, shapes } = spec;
    const J = (this.joints = {});
    const joint = (name, parent, x, y, z) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(x, y, z);
      parent.add(g);
      J[name] = g;
      return g;
    };
    const seg = (jointName, region, dir) =>
      J[jointName].add(buildSegment(region, L[region], shapes[region], dir, this.material));

    // Hips sit at leg length above the floor
    const hipY = L.foot + L.calf + L.thigh;
    joint('hips', this.root, 0, hipY, 0);
    joint('spine', J.hips, 0, 0, 0);            seg('spine', 'belly', +1);
    joint('chest', J.spine, 0, L.belly, 0);     seg('chest', 'chest', +1);
    joint('neck', J.chest, 0, L.chest, 0);      seg('neck', 'neck', +1);
    joint('head', J.neck, 0, L.neck, 0);        seg('head', 'head', +1);

    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      // arms: shoulder slightly below top of chest
      joint('shoulder' + side, J.chest, sx * spec.shoulderJointX, L.chest - VOXEL, 0);
      seg('shoulder' + side, 'upperArm', -1);
      joint('elbow' + side, J['shoulder' + side], 0, -L.upperArm, 0);
      seg('elbow' + side, 'forearm', -1);
      // legs
      joint('hip' + side, J.hips, sx * spec.hipJointX, 0, 0);
      seg('hip' + side, 'thigh', -1);
      joint('knee' + side, J['hip' + side], 0, -L.thigh, 0);
      seg('knee' + side, 'calf', -1);
      joint('ankle' + side, J['knee' + side], 0, -L.calf, 0);
      seg('ankle' + side, 'foot', -1);
      // arms hang slightly away from the body
      J['shoulder' + side].rotation.z = sx * spec.armSpread;
    }

    for (const [k, r] of Object.entries(saved)) if (J[k]) J[k].rotation.copy(r);
    this.lengths = L;
  }

  // Total number of cubes (for debugging / performance)
  get voxelCount() {
    let n = 0;
    this.root.traverse((o) => { if (o.isInstancedMesh) n += o.count; });
    return n;
  }
}
