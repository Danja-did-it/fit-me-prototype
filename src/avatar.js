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

// Build segment lengths and shapes from body measurements.
// Radii: [rx, rz] = half width (left-right), half depth (front-back).
function segmentSpecs(b) {
  const s = b.height / 1.75;                       // general size factor
  const c = b.colors;
  const foot = 0.07 * s;
  const legRest = b.legLength - foot;              // thigh + calf
  const upper = (b.height - b.legLength) / 0.82;   // factor for torso + head lengths
  const armR = 0.05 * s;                           // upper arm radius
  const legR = b.thighWidth / 2;                   // thigh radius
  const shoulderR = b.shoulderWidth / 2;
  const waistR = b.waistWidth / 2;
  const hipR = b.hipWidth / 2;
  const chestZ = b.chestDepth / 2;
  const bellyZ = b.bellyDepth / 2;

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
    shoulderJointX: Math.max(shoulderR - armR, waistR * 1.05 + armR),
    // spread arms a little if the hips are wider than the shoulders
    armSpread: Math.max(0.06, Math.asin(Math.min(0.5, (hipR + armR * 1.2 - Math.max(shoulderR - armR, waistR * 1.05 + armR)) / b.armLength))),
    // Segment shapes: region name -> tube description
    shapes: {
      // torso, built upward from the pelvis
      belly: { top: [waistR, bellyZ], bottom: [hipR, bellyZ * 0.95], color: c.shirt, bands: [[0, 0.3, c.shorts]] },
      chest: { top: [shoulderR - armR * 2, chestZ * 0.9], bottom: [waistR * 1.05, (chestZ + bellyZ) / 2], color: c.shirt },
      neck: { top: [0.05 * s, 0.05 * s], bottom: [0.055 * s, 0.055 * s], color: c.skin },
      head: { top: [0.095 * s, 0.105 * s], bottom: [0.095 * s, 0.105 * s], color: c.skin, bands: [[0.7, 1, c.hair]], hair: c.hair, profile: 'round' },
      // arms, hanging down from the shoulders
      upperArm: { top: [armR, armR], bottom: [armR * 0.85, armR * 0.85], color: c.shirt, bands: [[0.45, 1, c.skin]] },
      forearm: { top: [armR * 0.8, armR * 0.8], bottom: [armR * 0.6, armR * 0.5], color: c.skin },
      // legs, hanging down from the hips
      thigh: { top: [legR, legR], bottom: [legR * 0.72, legR * 0.72], color: c.shorts, bands: [[0.55, 1, c.skin]] },
      calf: { top: [legR * 0.72, legR * 0.72], bottom: [legR * 0.45, legR * 0.45], color: c.skin },
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
    // small random brightness change per cube = "pixel art" texture
    c.set(col).multiplyScalar(0.92 + Math.random() * 0.12);
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

    const spec = segmentSpecs(this.body);
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
