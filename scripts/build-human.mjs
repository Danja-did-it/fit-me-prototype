// Builds the web version of the MakeHuman body (data: CC0, from MPFB2).
// Runs after `npm install` (see "postinstall"). Downloads once, caches in
// node_modules/.cache/human, writes public/human/human.bin + human.json.
//
// What is packed:
//   - base mesh (19,158 points in decimeters; body faces + eyes)
//   - joint "cubes" (small helper cubes whose center is a joint -> joints follow the shape)
//   - morph targets (sparse point offsets): macro (gender / age / muscle / weight),
//     body measures (bust, waist, hips, shoulder, limb girths, lengths), local muscle/fat,
//     face (head shape, nose, mouth, eyes, brows, chin, cheeks, ears, forehead, neck)
//   - skin weights (up to 4 bones per point) of the "game_engine" rig
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const RAW = 'https://raw.githubusercontent.com/makehumancommunity/mpfb2/master/src/mpfb/data';
const CACHE = 'node_modules/.cache/human';
const OUT = 'public/human';
mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });

async function get(path) {
  const file = `${CACHE}/${path.replace(/\//g, '__')}`;
  if (existsSync(file)) return readFileSync(file);
  const res = await fetch(`${RAW}/${path}`);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

// ---- which targets ----
const MACRO = [];
for (const g of ['female', 'male']) for (const a of ['child', 'young', 'old'])
  for (const m of ['minmuscle', 'averagemuscle', 'maxmuscle']) for (const w of ['minweight', 'averageweight', 'maxweight'])
    MACRO.push(`macrodetails/universal-${g}-${a}-${m}-${w}`);

// gender + age shape lives in the ethnic targets ({race}-{gender}-{age}); MakeHuman mixes the
// three races (default 1/3 each). "universal" targets add muscle / weight on top.
for (const r of ['african', 'asian', 'caucasian']) for (const g of ['female', 'male']) for (const a of ['child', 'young', 'old'])
  MACRO.push(`macrodetails/${r}-${g}-${a}`);

const pair = (dir, base, a = 'decr', b = 'incr') => [`${dir}/${base}-${a}`, `${dir}/${base}-${b}`];
const LR = (dir, base, a, b) => [...pair(dir, `l-${base}`, a, b), ...pair(dir, `r-${base}`, a, b)];
const LOCAL = [
  // body measures (MakeHuman "measure" modifiers)
  ...['bust-circ', 'underbust-circ', 'waist-circ', 'hips-circ', 'shoulder-dist', 'frontchest-dist', 'napetowaist-dist', 'waisttohip-dist']
    .flatMap((n) => pair('torso', `measure-${n}`)),
  ...['upperarm-circ', 'upperarm-length', 'lowerarm-length'].flatMap((n) => pair('arms', `measure-${n}`)),
  ...['thigh-circ', 'calf-circ', 'knee-circ', 'upperleg-height', 'lowerleg-height'].flatMap((n) => pair('legs', `measure-${n}`)),
  ...['neck-circ', 'neck-height'].flatMap((n) => pair('neck', `measure-${n}`)),
  // muscles / fat / shape of the torso
  ...pair('torso', 'torso-muscle-pectoral'), ...pair('torso', 'torso-muscle-dorsi'), ...pair('torso', 'torso-vshape'),
  ...pair('torso', 'torso-scale-depth'), ...pair('torso', 'torso-scale-horiz'),
  ...pair('stomach', 'stomach-pregnant'), ...pair('stomach', 'stomach-tone'),
  ...pair('hip', 'hip-scale-depth'), ...pair('hip', 'hip-scale-horiz'), ...pair('buttocks', 'buttocks-volume'),
  ...LR('arms', 'upperarm-muscle'), ...LR('arms', 'upperarm-fat'), ...LR('arms', 'lowerarm-muscle'), ...LR('arms', 'lowerarm-fat'),
  ...LR('arms', 'upperarm-shoulder-muscle'),
  ...LR('legs', 'upperleg-muscle'), ...LR('legs', 'upperleg-fat'), ...LR('legs', 'lowerleg-muscle'), ...LR('legs', 'lowerleg-fat'),
  ...pair('neck', 'neck-double'), ...pair('neck', 'neck-scale-horiz'), ...pair('neck', 'neck-scale-depth'),
  // head + face
  ...pair('head', 'head-fat'), ...pair('head', 'head-scale-horiz'), ...pair('head', 'head-scale-vert'), ...pair('head', 'head-scale-depth'),
  'head/head-oval', 'head/head-round', 'head/head-square', 'head/head-rectangular', 'head/head-triangular', 'head/head-invertedtriangular', 'head/head-diamond',
  ...pair('chin', 'chin-width'), ...pair('chin', 'chin-height'), ...pair('chin', 'chin-prominent'), ...pair('chin', 'chin-bones'),
  ...LR('cheek', 'cheek-bones'), ...LR('cheek', 'cheek-volume'),
  ...pair('forehead', 'forehead-scale-vert'),
  ...pair('eyebrows', 'eyebrows-trans', 'down', 'up'),
  ...pair('nose', 'nose-scale-horiz'), ...pair('nose', 'nose-scale-vert'), ...pair('nose', 'nose-scale-depth'),
  ...pair('nose', 'nose-width1'), ...pair('nose', 'nose-width2'), ...pair('nose', 'nose-width3'), ...pair('nose', 'nose-hump'),
  ...pair('nose', 'nose-point-width'), ...pair('nose', 'nose-nostrils-width'), ...pair('nose', 'nose-volume'),
  ...pair('mouth', 'mouth-scale-horiz'), ...pair('mouth', 'mouth-scale-vert'),
  ...pair('mouth', 'mouth-upperlip-volume'), ...pair('mouth', 'mouth-lowerlip-volume'),
  ...pair('mouth', 'mouth-upperlip-height'), ...pair('mouth', 'mouth-lowerlip-height'),
  ...LR('eyes', 'eye-scale'), ...LR('eyes', 'eye-trans', 'in', 'out'), ...LR('eyes', 'eye-height2'),
  ...LR('ears', 'ear-scale'), ...LR('ears', 'ear-flap'),
];

// ---- base mesh ----
const obj = (await get('3dobjs/base.obj')).toString();
const verts = [];
const groups = {}; // group -> { faces: [[a,b,c,d]], verts: Set }
let cur = null;
for (const line of obj.split('\n')) {
  if (line.startsWith('v ')) { const [, x, y, z] = line.split(/\s+/); verts.push(+x, +y, +z); }
  else if (line.startsWith('g ')) { cur = line.slice(2).trim(); groups[cur] ||= { faces: [], verts: new Set() }; }
  else if (line.startsWith('f ') && cur) {
    const f = line.slice(2).trim().split(/\s+/).map((t) => parseInt(t, 10) - 1);
    groups[cur].faces.push(f);
    for (const v of f) groups[cur].verts.add(v);
  }
}
const N = verts.length / 3;
const faceGroups = ['body', 'helper-l-eye', 'helper-r-eye'];
const faces = [];
const faceGroupId = [];
faceGroups.forEach((g, gi) => {
  for (const f of groups[g].faces) {
    // quads -> 2 triangles
    faces.push(f[0], f[1], f[2]); faceGroupId.push(gi);
    if (f.length === 4) { faces.push(f[0], f[2], f[3]); faceGroupId.push(gi); }
  }
});
const joints = {};
for (const [g, d] of Object.entries(groups)) if (g.startsWith('joint-')) joints[g.slice(6)] = [...d.verts];
console.log(`base mesh: ${N} points, ${faces.length / 3} triangles, ${Object.keys(joints).length} joint cubes`);

// ---- targets (sparse, int16 in 1/1000 dm = 0.1 mm) ----
const targets = [];
let missing = 0;
for (const name of [...MACRO, ...LOCAL]) {
  let txt;
  try { txt = gunzipSync(await get(`targets/${name}.target.gz`)).toString(); }
  catch (e) { missing++; console.warn('skip', name, e.message); continue; }
  const idx = [], d = [];
  for (const line of txt.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p.length < 4 || p[0].startsWith('#')) continue;
    idx.push(+p[0]);
    d.push(Math.round(+p[1] * 1000), Math.round(+p[2] * 1000), Math.round(+p[3] * 1000));
  }
  targets.push({ name, idx, d });
}
console.log(`targets: ${targets.length} (${missing} missing)`);

// ---- skin weights: up to 4 bones per point ----
const W = JSON.parse((await get('rigs/standard/weights.game_engine.json')).toString()).weights;
const rig = JSON.parse((await get('rigs/standard/rig.game_engine.json')).toString());
const bones = Object.keys(W);
const per = Array.from({ length: N }, () => []);
bones.forEach((b, bi) => { for (const [v, w] of W[b]) if (v < N) per[v].push([bi, w]); });
const skinIdx = new Uint8Array(N * 4), skinW = new Uint8Array(N * 4);
for (let v = 0; v < N; v++) {
  const top = per[v].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((s, x) => s + x[1], 0) || 1;
  top.forEach(([bi, w], k) => { skinIdx[v * 4 + k] = bi; skinW[v * 4 + k] = Math.round((w / sum) * 255); });
}
const boneInfo = bones.map((b) => ({ name: b, parent: rig[b]?.parent || '', head: rig[b]?.head?.cube_name?.replace('joint-', '') || null,
  tail: rig[b]?.tail?.cube_name?.replace('joint-', '') || null }));

// ---- write binary ----
const parts = [];
let offset = 0;
const index = { N, units: 'dm', faces: faces.length, faceGroups, joints, bones: boneInfo, targets: [] };
const push = (arr) => { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const o = offset; parts.push(b); offset += b.length; const pad = (4 - (offset % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); offset += pad; } return o; };
index.verts = push(new Float32Array(verts));
index.faceData = push(new Uint16Array(faces));
index.faceGroup = push(new Uint8Array(faceGroupId));
index.skinIdx = push(skinIdx);
index.skinW = push(skinW);
for (const t of targets) {
  const o1 = push(new Uint16Array(t.idx));
  const o2 = push(new Int16Array(t.d));
  index.targets.push({ name: t.name, count: t.idx.length, idx: o1, d: o2 });
}
writeFileSync(`${OUT}/human.bin`, Buffer.concat(parts));
writeFileSync(`${OUT}/human.json`, JSON.stringify(index));
console.log(`wrote ${OUT}/human.bin (${(offset / 1e6).toFixed(1)} MB) + human.json`);
