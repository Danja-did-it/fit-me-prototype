// Voxel avatar built from a realistic human mesh (MakeHuman data, CC0, see human.js).
//
//   1. Mix the MakeHuman targets for this person (gender, age, muscle, weight + local
//      measures and face features from the scan) -> smooth, anatomically correct mesh.
//   2. Pose the arms down, scale to the real height, stand on the floor.
//   3. Cut the mesh surface into cubes (voxelize.js): 1 cm body, 0.5 cm head/neck/hands.
//   4. Each cube: bone (for animation), exact mesh normal (smooth light), crease shading,
//      color (skin, clothes, hair, eyes, lips, beard) and tissue (muscle group / fiber type / fat).
// Muscle groups come from MakeHuman's own muscle targets: the points a muscle target moves
// ARE that muscle (drawn by artists), e.g. "torso-muscle-pectoral" = chest muscle.
//
// All sizes in meters.
import * as THREE from 'three';
import { MUSCLES, GROUPS, muscleGain } from './anatomy.js';
import { loadHuman, mix, macroWeights, poseBody, jointPos, ourJoint } from './human.js';
import { voxelize, vertexNormals } from './voxelize.js';

export const VOXEL_SIZES = [0.04, 0.02, 0.015, 0.01, 0.0075, 0.005];
const BODY_VERTS = 13380;
// our animation joints (order = index in the GPU skinning uniform)
const JOINT_NAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'elbowL', 'hipL', 'kneeL', 'ankleL',
  'shoulderR', 'elbowR', 'hipR', 'kneeR', 'ankleR'];
const JOINT_INDEX = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i])); // the first 13,380 mesh points are the body (then eyes, teeth ...)

// Default colors (the scan replaces them)
const COLORS = {
  skin: 0xe0ac8a, shirt: 0x3b82c4, shorts: 0x2d3340, shoe: 0xf2f2f2, hair: 0x3a2a20,
  eye: 0x5a4030, lip: 0xc07f70, brow: 0x3a2a20, beard: 0x3a2a20,
};
export const DEFAULT_FACE = {
  faceLong: 1, jaw: 1, eyeSpacing: 1, eyeSize: 1, eyeOpen: 1, noseWidth: 1, noseLength: 1,
  mouthWidth: 1, lipUpper: 1, lipLower: 1, chin: 1,
};
export const DEFAULT_LOOK = {
  hair: { style: 'short', top: 1, width: 1, bangs: false }, // none | short | medium | long
  beard: 'none',                                            // none | stubble | goatee | full
  mustache: false,
  outfit: { top: 'shirt', sleeves: 'short', bottoms: 'short', shoes: true },
};
// Measurements (meters). The scan overrides them; the model is fitted to them (fit.js).
export const DEFAULT_BODY = {
  height: 1.75, shoulderWidth: 0.42, waistWidth: 0.30, hipWidth: 0.34, thighWidth: 0.16,
  chestDepth: 0.23, bellyDepth: 0.21, legLength: 0.93, armLength: 0.52,
  neckWidth: 0.12, upperArmWidth: 0.095, forearmWidth: 0.08, calfWidth: 0.11,
  colors: COLORS, face: DEFAULT_FACE, look: DEFAULT_LOOK,
};
// Person settings that are not lengths
export const DEFAULT_PERSON = { gender: 1, age: 30 };

const DETAIL = {
  sole: new THREE.Color(0x2e2e2e), sock: new THREE.Color(0xf0f0f0), eyeWhite: new THREE.Color(0xf4f1ea),
  pupil: new THREE.Color(0x111111),
};
const VIEW_COLORS = {
  fat: new THREE.Color(0xf4d35e), tendon: new THREE.Color(0xb9c0cc), other: new THREE.Color(0x9a8f86),
  slow: new THREE.Color(0x8e1b1b), fast: new THREE.Color(0xf29a9a),
};
const TINT = { fat: new THREE.Color(0xffa040), muscle: new THREE.Color(0xe53935), less: new THREE.Color(0x4fa8e8) };

function hash(a, b, c, d) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177) ^ Math.imul(d | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Muscle groups -> MakeHuman targets. side: which part of the target's region
// belongs to the group ('front' / 'back' / 'inner' by surface direction).
// ---------------------------------------------------------------------------
const MUSCLE_TARGETS = {
  chest:      [{ t: 'torso/torso-muscle-pectoral' }],
  back:       [{ t: 'torso/torso-muscle-dorsi' }],
  shoulders:  [{ t: 'arms/l-upperarm-shoulder-muscle' }, { t: 'arms/r-upperarm-shoulder-muscle' }],
  biceps:     [{ t: 'arms/l-upperarm-muscle', side: 'front' }, { t: 'arms/r-upperarm-muscle', side: 'front' }],
  triceps:    [{ t: 'arms/l-upperarm-muscle', side: 'back' }, { t: 'arms/r-upperarm-muscle', side: 'back' }],
  forearms:   [{ t: 'arms/l-lowerarm-muscle' }, { t: 'arms/r-lowerarm-muscle' }],
  abs:        [{ t: 'stomach/stomach-tone' }],
  glutes:     [{ t: 'buttocks/buttocks-volume' }],
  quads:      [{ t: 'legs/l-upperleg-muscle', side: 'front' }, { t: 'legs/r-upperleg-muscle', side: 'front' }],
  hamstrings: [{ t: 'legs/l-upperleg-muscle', side: 'back' }, { t: 'legs/r-upperleg-muscle', side: 'back' }],
  adductors:  [{ t: 'legs/l-upperleg-muscle', side: 'inner' }, { t: 'legs/r-upperleg-muscle', side: 'inner' }],
  calves:     [{ t: 'legs/l-lowerleg-muscle' }, { t: 'legs/r-lowerleg-muscle' }],
  neck:       [{ t: 'neck/measure-neck-circ' }],
};
// fat distribution: target -> share of the fat slider
const FAT_TARGETS = {
  'stomach/stomach-pregnant': 1.0, 'arms/l-upperarm-fat': 0.8, 'arms/r-upperarm-fat': 0.8,
  'arms/l-lowerarm-fat': 0.5, 'arms/r-lowerarm-fat': 0.5, 'legs/l-upperleg-fat': 0.8, 'legs/r-upperleg-fat': 0.8,
  'legs/l-lowerleg-fat': 0.5, 'legs/r-lowerleg-fat': 0.5, 'neck/neck-double': 0.6, 'head/head-fat': 0.4,
  'buttocks/buttocks-volume': 0.5,
};
// share of slow-twitch fibers per group (average of its muscles in anatomy.js)
const GROUP_IDS = Object.keys(GROUPS);
const GROUP_SLOW = {};
for (const g of GROUP_IDS) {
  const ms = Object.values(MUSCLES).filter((m) => m.group === g);
  GROUP_SLOW[g] = ms.length ? ms.reduce((s, m) => s + m.slow, 0) / ms.length : 0.5;
}

// Per point: which muscle group lies under the skin (from the rest mesh), -1 = none
function muscleLabels(H, normals) {
  const label = new Int8Array(H.N).fill(-1), best = new Float32Array(H.N);
  GROUP_IDS.forEach((g, gi) => {
    for (const { t, side } of MUSCLE_TARGETS[g]) {
      const T = H.targets[t + '-incr'];
      if (!T) continue;
      let mx = 0;
      for (let i = 0; i < T.idx.length; i++) mx = Math.max(mx, Math.hypot(T.d[i * 3], T.d[i * 3 + 1], T.d[i * 3 + 2]));
      for (let i = 0; i < T.idx.length; i++) {
        const v = T.idx[i];
        let s = Math.hypot(T.d[i * 3], T.d[i * 3 + 1], T.d[i * 3 + 2]) / (mx || 1);
        const nz = normals[v * 3 + 2], inward = normals[v * 3] * Math.sign(H.base[v * 3] || 1); // < 0 = faces the body center
        if (side === 'front' && nz < 0.15) s = 0;
        if (side === 'back' && nz > -0.15) s = 0;
        if (side === 'inner') s = inward < -0.45 ? s * 1.2 : 0;
        if ((side === 'front' || side === 'back') && inward < -0.45 && (g === 'quads' || g === 'hamstrings')) s *= 0.5;
        if (s > 0.12 && s > best[v]) { best[v] = s; label[v] = gi; }
      }
    }
  });
  return label;
}

// points that belong to fat depots (for the "fat" tissue view)
function fatVerts(H) {
  const set = new Set();
  for (const t of Object.keys(FAT_TARGETS)) {
    const T = H.targets[t + '-incr'];
    if (!T) continue;
    const mag = (i) => Math.abs(T.d[i * 3]) + Math.abs(T.d[i * 3 + 1]) + Math.abs(T.d[i * 3 + 2]);
    let mx = 0;
    for (let i = 0; i < T.idx.length; i++) mx = Math.max(mx, mag(i));
    for (let i = 0; i < T.idx.length; i++) if (mag(i) > mx * 0.35) set.add(T.idx[i]);
  }
  return set;
}

// ---------------------------------------------------------------------------
export class Avatar {
  constructor(human = null) {
    this.root = new THREE.Group();
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    // GPU skinning: every cube follows up to 4 joints (weights from the mesh), so the skin
    // bends smoothly at knees / elbows instead of cracking. boneM = joint movement since bind pose.
    this.boneUniform = { value: JOINT_NAMES.map(() => new THREE.Matrix4()) };
    const skinChunk = `attribute vec3 instanceNormal;
attribute vec4 skinJ;
attribute vec4 skinW;
uniform mat4 boneM[${JOINT_NAMES.length}];
mat4 cubeSkin() {
  return boneM[int(skinJ.x)] * skinW.x + boneM[int(skinJ.y)] * skinW.y + boneM[int(skinJ.z)] * skinW.z + boneM[int(skinJ.w)] * skinW.w;
}`;
    const project = `vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * (cubeSkin() * mvPosition);
gl_Position = projectionMatrix * mvPosition;`;
    const inject = (shader, normals) => {
      shader.uniforms.boneM = this.boneUniform;
      let v = shader.vertexShader.replace('#include <common>', '#include <common>\n' + skinChunk)
        .replace('#include <project_vertex>', project)
        // shadows are looked up at the moved position too
        .replace('#include <worldpos_vertex>', `vec4 worldPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
worldPosition = instanceMatrix * worldPosition;
#endif
worldPosition = modelMatrix * (cubeSkin() * worldPosition);`);
      // smooth light: blend each cube face normal with the real mesh normal
      if (normals) v = v.replace('#include <beginnormal_vertex>',
        'vec3 objectNormal = mat3(cubeSkin()) * normalize(mix(vec3(normal), instanceNormal, 0.85));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif');
      shader.vertexShader = v;
    };
    this.material.onBeforeCompile = (shader) => inject(shader, true);
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depthMaterial.onBeforeCompile = (shader) => inject(shader, false);
    this.body = { ...DEFAULT_BODY };
    this.person = { ...DEFAULT_PERSON };
    this.fit = { muscle: 0.5, weight: 0.5, local: {} }; // set by the scan fit (fit.js)
    this.composition = { fat: 0, muscle: 0, training: 'mixed', groups: {}, tint: false };
    this.voxel = 0.01;
    this.view = 'look';
    this.joints = {};
    this.lengths = { foot: 0.07, thigh: 0.45, calf: 0.43 };
    this.armSpread = 0;
    this.stats = { total: 0, slow: 0, fast: 0, fat: 0, other: 0 };
    this.buildMs = 0;
    this.ready = (human ? Promise.resolve(human) : loadHuman()).then((H) => { this.setHuman(H); this.build(); });
  }

  // up to 4 of our joints + weights for a mesh point (from the MakeHuman skin weights)
  cubeWeights(v) {
    const H = this.H, acc = {};
    for (let k = 0; k < 4; k++) {
      const w = H.skinW[v * 4 + k] / 255;
      if (w) { const j = JOINT_INDEX[ourJoint(H.bones[H.skinIdx[v * 4 + k]].name)]; acc[j] = (acc[j] || 0) + w; }
    }
    const top = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((t, [, w]) => t + w, 0) || 1;
    const js = [0, 0, 0, 0], ws = [0, 0, 0, 0];
    top.forEach(([j, w], i) => { js[i] = +j; ws[i] = w / sum; });
    if (!top.length) ws[0] = 1;
    return [js, ws];
  }

  // call every frame after the animation: joint movement since bind pose -> GPU
  updateSkin() {
    if (!this.bindInv) return;
    this.root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    JOINT_NAMES.forEach((j, i) => {
      const g = this.joints[j];
      if (g) this.boneUniform.value[i].copy(rootInv).multiply(g.matrixWorld).multiply(this.bindInv[i]);
    });
  }

  setHuman(H) {
    this.H = H;
    this.restNormals = vertexNormals(H.base, H.faces, H.N);
    this.labels = muscleLabels(H, this.restNormals);
    this.fatSet = fatVerts(H);
    this.vertJoint = Array.from({ length: H.N }, (_, v) => ourJoint(H.bones[H.skinIdx[v * 4]].name));
    const detailBone = (n) => /^(head|neck_01|hand|thumb|index|middle|ring|pinky)/.test(n);
    this.vertDetail = Uint8Array.from({ length: H.N }, (_, v) => (detailBone(H.bones[H.skinIdx[v * 4]].name) ? 1 : 0));
    this.vertHand = Uint8Array.from({ length: H.N }, (_, v) => (/^(hand|thumb|index|middle|ring|pinky)/.test(H.bones[H.skinIdx[v * 4]].name) ? 1 : 0));
  }

  // All target weights for the current person + sliders
  targetWeights() {
    const c = this.composition, f = this.fit;
    const fatGain = c.fat > 0 ? c.fat : 0.5 * c.fat;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const macro = macroWeights({
      gender: this.person.gender, age: this.person.age,
      muscle: clamp(f.muscle + 0.3 * c.muscle, 0, 1),
      weight: clamp(f.weight + 0.35 * fatGain, 0, 1),
    });
    const local = {};
    const add = (name, v) => { local[name] = (local[name] || 0) + v; };
    for (const [n, v] of Object.entries(f.local)) add(n, v);
    for (const [n, v] of Object.entries(f.face || {})) add(n, v);
    // muscle groups: global slider + group slider, fiber mix decides the growth
    const gains = {};
    for (const g of GROUP_IDS) {
      gains[g] = muscleGain({ group: g, slow: GROUP_SLOW[g] }, c);
      const seen = new Set();
      for (const { t } of MUSCLE_TARGETS[g]) {
        if (seen.has(t)) continue;
        seen.add(t);
        const shared = GROUP_IDS.filter((o) => MUSCLE_TARGETS[o].some((x) => x.t === t)).length;
        add(t, (gains[g] * 0.9) / shared);
      }
    }
    for (const [t, share] of Object.entries(FAT_TARGETS)) add(t, fatGain * share);
    const out = [...macro];
    for (const [n, v] of Object.entries(local)) {
      const w = clamp(v, -1, 1);
      if (Math.abs(w) < 1e-3) continue;
      if (this.H.targets[n + '-incr']) out.push([n + (w < 0 ? '-decr' : '-incr'), Math.abs(w)]);
      else if (this.H.targets[n + '-out']) out.push([n + (w < 0 ? '-in' : '-out'), Math.abs(w)]);
      else if (this.H.targets[n]) out.push([n, Math.max(0, w)]); // single targets (head shapes)
    }
    this.gains = gains;
    this.fatGain = fatGain;
    return out;
  }

  // The posed, scaled mesh (meters) + joint positions. Also used by the scan fit.
  shape(weights = this.targetWeights()) {
    const H = this.H, comp = this.composition;
    let p = mix(H, weights);
    const spread = this.poseSpread ?? (0.1 + 0.12 * Math.max(0, this.fatGain || 0) + 0.05 * Math.max(0, comp.muscle)); // hands clear the hips
    p = poseBody(H, p, { armSpread: spread, legSpread: this.poseLegSpread ?? 0.025 });
    let minY = Infinity, maxY = -Infinity;
    for (let v = 0; v < BODY_VERTS; v++) { minY = Math.min(minY, p[v * 3 + 1]); maxY = Math.max(maxY, p[v * 3 + 1]); }
    const s = this.body.height / (maxY - minY);
    const pos = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) { pos[i] = p[i] * s; pos[i + 1] = (p[i + 1] - minY) * s; pos[i + 2] = p[i + 2] * s; }
    const J = (name) => jointPos(H, pos, name);
    const W = {
      hips: J('pelvis'), chest: J('spine-2'), neck: J('neck'), head: J('head'),
      shoulderL: J('l-shoulder'), elbowL: J('l-elbow'), handL: J('l-hand'), hipL: J('l-upper-leg'), kneeL: J('l-knee'), ankleL: J('l-ankle'),
      shoulderR: J('r-shoulder'), elbowR: J('r-elbow'), handR: J('r-hand'), hipR: J('r-upper-leg'), kneeR: J('r-knee'), ankleR: J('r-ankle'),
      eyeL: J('l-eye'), eyeR: J('r-eye'),
    };
    W.spine = W.hips;
    return { pos, W };
  }

  build() {
    if (!this.H) return;
    const t0 = performance.now();
    const saved = {};
    for (const [k, j] of Object.entries(this.joints)) saved[k] = j.rotation.clone();
    this.root.traverse((o) => o.isInstancedMesh && o.dispose());
    for (const g of Object.values(this.geometries || {})) g.dispose();
    this.root.clear();

    const H = this.H, V = this.voxel;
    const { pos, W } = this.shape();

    // ---- joint tree (bind pose = mesh pose, no rotation) ----
    const joints = (this.joints = {});
    const worldOf = {};
    const joint = (name, parent, w) => {
      const g = new THREE.Group();
      g.name = name;
      const pw = parent === this.root ? [0, 0, 0] : worldOf[parent.name];
      g.position.set(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]);
      parent.add(g);
      joints[name] = g;
      worldOf[name] = w;
      return g;
    };
    joint('hips', this.root, W.hips);
    joint('spine', joints.hips, W.spine);
    joint('chest', joints.spine, W.chest);
    joint('neck', joints.chest, W.neck);
    joint('head', joints.neck, W.head);
    for (const S of ['L', 'R']) {
      joint('shoulder' + S, joints.chest, W['shoulder' + S]);
      joint('elbow' + S, joints['shoulder' + S], W['elbow' + S]);
      joint('hip' + S, joints.hips, W['hip' + S]);
      joint('knee' + S, joints['hip' + S], W['knee' + S]);
      joint('ankle' + S, joints['knee' + S], W['ankle' + S]);
    }
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const L = (this.lengths = {
      foot: W.ankleL[1], calf: W.kneeL[1] - W.ankleL[1], thigh: W.hipL[1] - W.kneeL[1],
      upperArm: dist(W.shoulderL, W.elbowL), forearmOnly: dist(W.elbowL, W.handL),
    });
    L.forearm = L.forearmOnly + 0.1 * this.body.height;

    // ---- cubes ----
    const normals = vertexNormals(pos, H.faces, H.N);
    const F = H.faces, nT = F.length / 3;
    const triJoint = new Array(nT), triDetail = new Uint8Array(nT);
    for (let t = 0; t < nT; t++) { triJoint[t] = this.vertJoint[F[t * 3]]; triDetail[t] = this.vertDetail[F[t * 3]]; }
    const Vd = V >= 0.0075 ? V / 2 : V;
    const passes = [];
    if (Vd < V) {
      passes.push([V, voxelize(pos, F, V, null, (t) => !triDetail[t])]);
      const boxOf = (test) => {
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (let v = 0; v < H.N; v++) if (test(v)) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[v * 3 + k]); mx[k] = Math.max(mx[k], pos[v * 3 + k]); }
        return { min: mn.map((x) => x - 0.03), max: mx.map((x) => x + 0.03) };
      };
      const isHead = (v) => this.vertDetail[v] && (this.vertJoint[v] === 'head' || this.vertJoint[v] === 'neck');
      for (const test of [isHead, (v) => this.vertHand[v] && this.vertJoint[v] === 'elbowL', (v) => this.vertHand[v] && this.vertJoint[v] === 'elbowR']) {
        passes.push([Vd, voxelize(pos, F, Vd, boxOf(test), (t) => triDetail[t] && test(F[t * 3]))]);
      }
    } else passes.push([V, voxelize(pos, F, V)]);

    // face frame for painting (eyes, brows, lips, beard, hair line)
    const eye = { x: (W.eyeL[0] - W.eyeR[0]) / 2, y: (W.eyeL[1] + W.eyeR[1]) / 2, z: (W.eyeL[2] + W.eyeR[2]) / 2 };
    let chinY = Infinity;
    for (let v = 0; v < BODY_VERTS; v++) {
      if (this.vertJoint[v] === 'head' && pos[v * 3 + 2] > eye.z - 0.01 && Math.abs(pos[v * 3]) < 0.02) chinY = Math.min(chinY, pos[v * 3 + 1]);
    }
    const face = { eye, chinY, mouthY: chinY + 0.39 * (eye.y - chinY), noseY: chinY + 0.64 * (eye.y - chinY), eyeL: W.eyeL, eyeR: W.eyeR };
    const s = this.body.height / 1.75;
    const ctx = { W, L, face, s, waistY: W.hipL[1] + 0.1 * s };

    const byJoint = {};
    const stats = { total: 0, slow: 0, fast: 0, fat: 0, other: 0 };
    const col = new THREE.Color(), nrm = new THREE.Vector3();
    const extra = []; // hair / beard volume layers
    for (const [size, cubes] of passes) {
      for (const cb of cubes) {
        const a = F[cb.tri * 3], b = F[cb.tri * 3 + 1], c = F[cb.tri * 3 + 2];
        const w0 = 1 - cb.u - cb.v;
        nrm.set(
          normals[a * 3] * w0 + normals[b * 3] * cb.u + normals[c * 3] * cb.v,
          normals[a * 3 + 1] * w0 + normals[b * 3 + 1] * cb.u + normals[c * 3 + 1] * cb.v,
          normals[a * 3 + 2] * w0 + normals[b * 3 + 2] * cb.u + normals[c * 3 + 2] * cb.v).normalize();
        const vMain = w0 >= cb.u && w0 >= cb.v ? a : cb.u >= cb.v ? b : c; // closest mesh point
        const jn = triJoint[cb.tri];
        const isEye = H.faceGroup[cb.tri] > 0;
        const tissue = this.tissueOf(this.labels[vMain], vMain, cb, jn, isEye);
        stats.total++; stats[tissue.kind]++;
        const res = this.colorCube(col, { jn, x: cb.x, y: cb.y, z: cb.z, n: nrm, isEye, hand: this.vertHand[vMain], tissue, occ: cb.occ, size, ctx });
        const jw = worldOf[jn];
        (byJoint[jn + '|' + size] ||= []).push({ p: [cb.x - jw[0], cb.y - jw[1], cb.z - jw[2]], c: col.clone(), n: nrm.clone(), v: vMain });
        if (res) extra.push({ jn, size, x: cb.x, y: cb.y, z: cb.z, n: nrm.clone(), layers: res.layers, color: res.color, jw });
      }
    }
    // hair / beard volume: extra cube layers along the surface normal
    const taken = new Set();
    for (const [key, list] of Object.entries(byJoint)) for (const r of list) taken.add(key + r.p.map((v) => Math.round(v * 1000)).join());
    for (const e of extra) {
      for (let k = 1; k <= e.layers; k++) {
        const q = [e.x + e.n.x * e.size * k, e.y + e.n.y * e.size * k, e.z + e.n.z * e.size * k].map((v) => (Math.floor(v / e.size) + 0.5) * e.size);
        const p2 = [q[0] - e.jw[0], q[1] - e.jw[1], q[2] - e.jw[2]];
        const key = e.jn + '|' + e.size;
        const id = key + p2.map((v) => Math.round(v * 1000)).join();
        if (taken.has(id)) continue;
        taken.add(id);
        (byJoint[key] ||= []).push({ p: p2, c: new THREE.Color(e.color).multiplyScalar(1 - 0.06 * k), n: e.n });
      }
    }
    if (this.body.look.hair.style !== 'none') this.addHair(byJoint, worldOf, ctx, Vd);

    // ---- meshes: one per cube size, positions in bind pose + skin weights ----
    const bySize = {};
    for (const [key, list] of Object.entries(byJoint)) {
      const [name, size] = key.split('|');
      const jw = worldOf[name];
      for (const r of list) (bySize[size] ||= []).push({ ...r, w: [r.p[0] + jw[0], r.p[1] + jw[1], r.p[2] + jw[2]], jn: name });
    }
    const m4 = new THREE.Matrix4();
    this.geometries = {};
    for (const [size, list] of Object.entries(bySize)) {
      const geo = new THREE.BoxGeometry(+size, +size, +size);
      const nb = new Float32Array(list.length * 3), sj = new Float32Array(list.length * 4), sw = new Float32Array(list.length * 4);
      list.forEach((r, i) => {
        nb.set([r.n.x, r.n.y, r.n.z], i * 3);
        const [js, ws] = r.v !== undefined ? this.cubeWeights(r.v) : [[JOINT_INDEX[r.jn], 0, 0, 0], [1, 0, 0, 0]];
        sj.set(js, i * 4); sw.set(ws, i * 4);
      });
      geo.setAttribute('instanceNormal', new THREE.InstancedBufferAttribute(nb, 3));
      geo.setAttribute('skinJ', new THREE.InstancedBufferAttribute(sj, 4));
      geo.setAttribute('skinW', new THREE.InstancedBufferAttribute(sw, 4));
      this.geometries[size] = geo;
      const mesh = new THREE.InstancedMesh(geo, this.material, list.length);
      mesh.name = 'cubes-' + size;
      mesh.customDepthMaterial = this.depthMaterial; // skinned shadows
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false; // cubes move on the GPU; bounds would be wrong
      list.forEach((r, i) => { mesh.setMatrixAt(i, m4.makeTranslation(r.w[0], r.w[1], r.w[2])); mesh.setColorAt(i, r.c); });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.root.add(mesh);
    }
    this.bindInv = JOINT_NAMES.map((j) => new THREE.Matrix4().makeTranslation(-worldOf[j][0], -worldOf[j][1], -worldOf[j][2]));
    for (const [k, r] of Object.entries(saved)) if (joints[k]) joints[k].rotation.copy(r);
    this.armSpread = 0; // the arms are already posed in the mesh
    this.stats = stats;
    this.mesh = { pos, normals, W };
    this.buildMs = performance.now() - t0;
  }

  // tissue under this cube: muscle group (slow / fast fibers), fat or other
  tissueOf(lab, v, cb, jn, isEye) {
    if (isEye || jn === 'head' || jn === 'ankleL' || jn === 'ankleR') return { kind: 'other' };
    if (this.fatGain > 0.15 && this.fatSet.has(v) && lab < 0) return { kind: 'fat' };
    if (lab < 0) return { kind: 'other' };
    const g = GROUP_IDS[lab];
    // fiber type: constant along ~4 cm so it looks like fiber bundles
    const h = hash(Math.round(cb.x / 0.01), Math.floor(cb.y / 0.04), Math.round(cb.z / 0.01), lab);
    return { kind: h < GROUP_SLOW[g] ? 'slow' : 'fast', group: g };
  }

  // ---- colors: returns { layers, color } when extra hair/beard volume is wanted ----
  colorCube(out, q) {
    const { jn, x, y, z, n, isEye, hand, tissue, occ, ctx } = q;
    const c = this.body.colors, look = this.body.look, o = look.outfit;
    const { face, W, L, s } = ctx;
    const E = face.eye;
    const head = jn === 'head' || jn === 'neck';
    // crease shading: gentle on face and hands (otherwise it reads like dirt)
    let shade = Math.min(1.05, Math.max(0.55, 1.18 - 0.7 * occ));
    if (head || hand) shade = 1 - (1 - shade) * 0.4;
    const jitter = 0.985 + hash(Math.round(x * 400), Math.round(y * 400), Math.round(z * 400), 3) * 0.03;
    let result = null;

    if (this.view === 'groups' || this.view === 'fibers') {
      if (tissue.kind === 'fat') out.copy(VIEW_COLORS.fat);
      else if (tissue.kind === 'slow' || tissue.kind === 'fast') {
        if (this.view === 'groups') out.set(GROUPS[tissue.group].color);
        else out.copy(tissue.kind === 'slow' ? VIEW_COLORS.slow : VIEW_COLORS.fast);
      } else out.copy(head || jn.startsWith('ankle') ? VIEW_COLORS.other : VIEW_COLORS.tendon);
      out.multiplyScalar(shade * jitter);
      return null;
    }

    let color = c.skin, special = null;
    const ax = Math.abs(x), front = n.z > 0.25;
    if (isEye) {
      // eyeball: direction from the eye center -> pupil / iris / white
      const ec = x > 0 ? face.eyeL : face.eyeR;
      const d = Math.hypot(x - ec[0], y - ec[1], z - ec[2]) || 1;
      const dz = (z - ec[2]) / d;
      if (dz > 0.985) special = DETAIL.pupil;
      else if (dz > 0.82) color = c.eye;
      else special = DETAIL.eyeWhite;
    } else if (head) {
      // hair line (relative to the eyes), style from the scan
      const style = look.hair.style;
      const hairTop = y > E.y + 0.066 * s || (y > E.y + 0.05 * s && z < E.z - 0.01);
      const hairBack = z < E.z - 0.075 * s && y > E.y - 0.05 * s;
      const hairSide = ax > 0.058 * s && y > E.y + 0.012 * s && z < E.z - 0.025 * s && z > E.z - 0.1 * s;
      const bangs = look.hair.bangs && y > E.y + 0.03 * s && z > E.z;
      if (style !== 'none' && jn === 'head' && (hairTop || hairBack || hairSide || bangs)) {
        color = c.hair; // scalp under the hair volume (see addHair)
      }
      // eyebrows: thin arch above each eye
      const ex = ax - E.x;
      const arch = E.y + 0.019 * s + 0.003 * s * Math.cos((ex / (0.02 * s)) * 1.2);
      if (jn === 'head' && front && z > E.z && Math.abs(ex) < 0.019 * s &&
          Math.abs(y - arch) < 0.0026 * s * (1 - 0.5 * Math.max(0, ex / (0.019 * s)))) {
        color = new THREE.Color(c.brow).lerp(new THREE.Color(c.skin), 0.25).getHex();
      }
      // lips (lens shape around the mouth line)
      const mw = 0.024 * s * (this.body.face?.mouthWidth || 1);
      const dy = y - face.mouthY;
      const onLips = jn === 'head' && front && z > E.z - 0.005 && Math.abs(dy) < 0.009 * s && ax < mw * (1 - 0.5 * (dy / (0.011 * s)) ** 2);
      if (onLips) color = new THREE.Color(c.lip).lerp(new THREE.Color(c.skin), Math.abs(dy) < 0.0012 * s ? 0 : 0.2).getHex();
      // facial hair
      const lowFace = jn === 'head' && z > E.z - 0.075 * s && y < face.mouthY + 0.004 * s && ax < 0.075 * s;
      const must = jn === 'head' && ax < 0.03 * s && y > face.mouthY + 0.008 * s && y < face.noseY - 0.01 * s && z > E.z;
      const goatee = lowFace && ax < 0.026 * s && y < face.mouthY - 0.008 * s;
      if (!onLips && ((look.beard === 'full' && (lowFace || must)) || (look.beard === 'goatee' && (goatee || must)) || (look.mustache && must))) {
        color = c.beard;
        result = { layers: Math.max(1, Math.round(0.006 / q.size)), color: c.beard };
      } else if (look.beard === 'stubble' && !onLips && (lowFace || must)) {
        color = new THREE.Color(c.skin).lerp(new THREE.Color(c.beard), 0.35).getHex();
      }
    } else {
      // clothes as scanned (or chosen)
      const shirt = o.top !== 'none';
      const legEnd = o.bottoms === 'short' ? W.kneeL[1] + 0.5 * L.thigh : o.bottoms === 'knee' ? W.kneeL[1] - 0.03 * s : W.ankleL[1] + 0.02 * s;
      const torso = jn === 'chest' || jn === 'spine' || jn === 'hips';
      const onArm = /^(shoulder|elbow)/.test(jn);
      if (torso && y > ctx.waistY) {
        const neckline = y > W.neck[1] - 0.045 * s && Math.hypot(x - W.neck[0], (z - W.neck[2]) * 0.8) < 0.075 * s && z > W.neck[2] - 0.01; // crew neck
        color = shirt && !neckline ? c.shirt : c.skin;
      } else if ((torso || /^(hip|knee)/.test(jn)) && y > legEnd) color = c.shorts;
      if (onArm) {
        const along = W[jn.replace('elbow', 'shoulder')][1] - y; // how far down the arm
        const sleeveLen = o.sleeves === 'long' ? 9 : o.sleeves === 'short' ? 0.45 * L.upperArm : -1;
        color = shirt && along < sleeveLen && !hand ? c.shirt : c.skin;
      }
      if (/^knee/.test(jn) && o.shoes && y < W.ankleL[1] + 0.05 * s && color === c.skin) special = DETAIL.sock;
      if (/^ankle/.test(jn)) {
        if (o.shoes) { color = c.shoe; if (y < 0.018 * s) special = DETAIL.sole; }
        else if (o.bottoms === 'long' && y > W.ankleL[1] - 0.01) color = c.shorts;
      }
      // bare upper body: nipples and navel
      if (!shirt && jn === 'chest' && front) {
        const d = Math.hypot(ax - W.shoulderL[0] * 0.55, y - (W.shoulderL[1] - 0.17 * s));
        if (d < 0.011 * s) special = new THREE.Color(c.skin).multiplyScalar(d < 0.005 * s ? 0.62 : 0.8);
      }
      if (!shirt && (jn === 'spine' || jn === 'chest') && n.z > 0.5 && Math.hypot(x, y - (W.hipL[1] + 0.125 * s)) < 0.006 * s) {
        special = new THREE.Color(c.skin).multiplyScalar(0.6);
      }
    }
    if (special) out.copy(special); else out.set(color);
    // tint: where fat / muscle was added or removed
    if (this.composition.tint) {
      if (tissue.kind === 'fat' && Math.abs(this.fatGain) > 0.01) out.lerp(this.fatGain > 0 ? TINT.fat : TINT.less, Math.min(0.3, Math.abs(this.fatGain) * 0.3));
      const g = tissue.group && this.gains?.[tissue.group];
      if (g && Math.abs(g) > 0.02) out.lerp(g > 0 ? TINT.muscle : TINT.less, Math.min(0.3, Math.abs(g) * 0.25));
    }
    out.multiplyScalar(shade * jitter);
    return result;
  }

  // Hair volume around the skull: a shell of the given thickness that follows the head
  // and then hangs straight down to the style's length. The face stays free.
  //   short: 1.2 cm, down to the nape   medium: 2 cm, bob to the chin   long: 2.2 cm, over the shoulders
  addHair(byJoint, worldOf, ctx, V) {
    const { face, W, s } = ctx;
    const look = this.body.look.hair, E = face.eye;
    const style = look.style;
    const thick = { short: 0.008, medium: 0.02, long: 0.022 }[style] * s * (0.8 + 0.2 * (look.width || 1));
    const top = 0.004 * s * ((look.top || 1) - 1) * 3; // extra volume on top from the scan
    const C = [0, E.y + 0.018 * s, E.z - 0.07 * s];     // skull center
    const R = [0.083 * s, 0.108 * s + top, 0.103 * s];   // skull radii (just under the hair)
    const bottom = style === 'short' ? E.y - 0.045 * s : style === 'medium' ? face.chinY - 0.005 * s : W.shoulderL[1] - 0.14 * s;
    const col = new THREE.Color(this.body.colors.hair);
    // radial distance (1 = skull surface); below the center the shape hangs straight down
    const rad = (x, y, z) => {
      const dy = Math.max(0, y - C[1]);
      return Math.hypot(x / R[0], dy / R[1], (z - C[2]) / R[2]);
    };
    const inHair = (x, y, z) => {
      if (y < bottom || y > C[1] + R[1] + thick * 1.5) return false;
      const r = rad(x, y, z), rOut = 1 + thick / R[0];
      if (r < 1 || r > rOut) return false;
      const frontZ = z - C[2];
      // face opening: no hair in front of the face below the hair line (unless fringe)
      // natural hair line: a little higher at the temples
      const hairLine = look.bangs ? E.y + 0.012 * s : E.y + 0.058 * s + 0.012 * s * Math.min(1, Math.abs(x) / (0.06 * s));
      if (frontZ > 0.03 * s && y < hairLine) return false;
      // sides in front of the ears only above the temple for short hair
      // short: sides only above the ears, back down to the nape
      if (style === 'short' && frontZ > -0.03 * s && y < E.y + 0.03 * s) return false;
      if (style === 'short' && Math.abs(x) > 0.05 * s && y < E.y + 0.012 * s) return false;
      if (style === 'short' && y < E.y - 0.03 * s + 0.045 * s * Math.min(1, Math.abs(x) / (0.07 * s))) return false; // tapered nape
      // below the skull center the hair is only behind / beside the head (not under the chin)
      if (y < C[1] && frontZ > 0.02 * s) return false;
      return true;
    };
    const hw = worldOf.head, key = 'head|' + V;
    const list = (byJoint[key] ||= []);
    const x0 = -R[0] - thick - V, x1 = -x0, z0 = C[2] - R[2] - thick - V, z1 = C[2] + R[2] + thick + V;
    const snap = (v) => (Math.floor(v / V) + 0.5) * V;
    for (let y = snap(bottom); y < C[1] + R[1] + thick * 1.5; y += V) {
      for (let x = snap(x0); x < x1; x += V) for (let z = snap(z0); z < z1; z += V) {
        if (!inHair(x, y, z)) continue;
        // only the outer shell of the hair volume
        if (inHair(x + V, y, z) && inHair(x - V, y, z) && inHair(x, y + V, z) && inHair(x, y - V, z) && inHair(x, y, z + V) && inHair(x, y, z - V)) continue;
        const n = new THREE.Vector3(x / R[0], Math.max(0, y - C[1]) / R[1], (z - C[2]) / R[2]).normalize();
        // strands: slight vertical streaks
        const streak = 0.86 + 0.14 * hash(Math.round(x / (V * 1.5)), Math.round(z / (V * 1.5)), 11, 2);
        list.push({ p: [x - hw[0], y - hw[1], z - hw[2]], c: col.clone().multiplyScalar(streak), n });
      }
    }
  }

  get voxelCount() {
    let n = 0;
    this.root.traverse((o) => { if (o.isInstancedMesh) n += o.count; });
    return n;
  }
}
