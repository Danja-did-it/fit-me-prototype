// Entry point: sets up the Three.js scene, camera, lights and render loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Avatar } from './avatar.js';
import { bodyFromScans } from './measure.js';
import { Animator } from './anim.js';
import { GROUPS } from './anatomy.js';
// scan.js (MediaPipe, large) is loaded only when the user starts a scan -> faster first load
const scanModule = () => import('./scan.js');

const stage = document.getElementById('stage');

// Renderer draws the scene into a <canvas>
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; // softer, film-like light
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // soft edges via shadow.radius
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1e24);

// Camera looks at the avatar from the front
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
camera.position.set(0, 1.15, 3.6);

// Mouse / touch drag to rotate the view
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0);
controls.enableDamping = true;
controls.minDistance = 0.4;
controls.maxDistance = 8;
window.camera = camera; window.controls = controls; // for the test script

// Studio lights: warm key light with soft shadows, cool fill, rim light from behind
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3430, 0.55));
const key = new THREE.DirectionalLight(0xfff0e0, 2.4);
key.position.set(1.6, 3.2, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -1.1, right: 1.1, top: 2.1, bottom: -0.2, near: 0.5, far: 8 });
key.shadow.bias = -0.001;
key.shadow.normalBias = 0.025; // avoids stripe artifacts ("shadow acne") on the cubes
key.shadow.radius = 3;
scene.add(key);
const fill = new THREE.DirectionalLight(0xbcd2ff, 0.7);
fill.position.set(-2.5, 1.8, 1.5);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.9);
rim.position.set(-0.5, 2.5, -3);
scene.add(rim);

// Round floor that catches the shadow
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(1.3, 64),
  new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.95 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// The voxel avatar
const avatar = new Avatar();
scene.add(avatar.root);
window.avatar = avatar; // handy for debugging in the browser console
const animator = new Animator(avatar);
window.animator = animator;
let lastTime = performance.now();

// Keep canvas size in sync with the window
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

// Render loop
renderer.setAnimationLoop(() => {
  const now = performance.now();
  animator.update(Math.min((now - lastTime) / 1000, 0.1)); // seconds; capped after tab switches
  lastTime = now;
  controls.update();
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------------------
// Scan UI: camera / photo -> MediaPipe -> preview
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const setStatus = (t) => (statusEl.textContent = t);

// Latest scan results, used to shape the avatar
export const scans = { front: null, side: null };
const tipsByView = { front: [], side: [] };
window.scans = scans;

async function runScan(view, image) {
  setStatus('Analysiere ' + (view === 'front' ? 'Front' : 'Seite') + ' … (erstes Mal lädt Modell)');
  try {
    const { analyze, drawScan } = await scanModule();
    const scan = await analyze(image);
    drawScan($(view === 'front' ? 'prevFront' : 'prevSide'), image, scan);
    if (!scan) return setStatus('Keine Person erkannt. Ganzer Körper im Bild?');
    scans[view] = scan;
    let faceText = '';
    if (view === 'front') {
      // face + hair on the same photo: shape of the face, real colors, hairstyle, beard
      setStatus('Analysiere Gesicht …');
      const { analyzeFace, drawFace } = await import('./face.js');
      try {
        scan.face = await analyzeFace(image, scan.landmarks);
      } catch (e) { console.warn('face analysis failed', e); scan.face = null; }
      if (scan.face) drawFace($('prevFace'), scan.face);
      manual = {}; // a new scan replaces manual changes
      faceText = scan.face ? ', Gesicht erkannt' : ', Gesicht nicht erkannt';
    }
    // tips when the photo is not ideal (arms at the body, not upright, clothes ...)
    const { scanQuality } = await scanModule();
    tipsByView[view] = scanQuality(scan, view);
    $('tips').innerHTML = [...tipsByView.front, ...tipsByView.side].map((t) => `<li>${t}</li>`).join('');
    setStatus((view === 'front' ? 'Front' : 'Seite') + ' erkannt ✓' + faceText + ' – Avatar angepasst');
    applyScans();
  } catch (e) {
    console.error(e);
    setStatus('Fehler bei der Analyse: ' + e.message);
  }
}

// Photo files
for (const view of ['front', 'side']) {
  const input = $(view === 'front' ? 'fileFront' : 'fileSide');
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const { loadImageFile } = await scanModule();
    runScan(view, await loadImageFile(file));
    input.value = ''; // allow picking the same file again
  });
}

// Camera with 5 s self-timer so the user can step back
const video = $('video');
let cameraOn = false;
let facing = 'user'; // selfie camera first
$('camBtn').addEventListener('click', async () => {
  const { startCamera, stopCamera, loadPose } = await scanModule();
  if (cameraOn) {
    stopCamera(video);
    cameraOn = false;
  } else {
    try {
      await startCamera(video, facing);
      cameraOn = true;
      loadPose(); // start loading the model in the background
    } catch (e) {
      console.warn(e);
      setStatus('Kamera nicht verfügbar (Erlaubnis? HTTPS?). Foto wählen geht immer.');
    }
  }
  video.parentElement.hidden = !cameraOn;
  $('camBtn').textContent = cameraOn ? 'Kamera stoppen' : 'Kamera starten';
  $('snapFront').disabled = $('snapSide').disabled = !cameraOn;
  $('flipCam').hidden = !cameraOn;
  video.classList.toggle('mirror', facing === 'user'); // selfie preview feels natural mirrored
});

// Switch between selfie and back camera
$('flipCam').addEventListener('click', async () => {
  facing = facing === 'user' ? 'environment' : 'user';
  const { startCamera } = await scanModule();
  try {
    await startCamera(video, facing);
  } catch (e) {
    console.warn(e);
    setStatus('Diese Kamera ist nicht verfügbar.');
  }
  video.classList.toggle('mirror', facing === 'user');
});

async function countdown(seconds) {
  const el = $('countdown');
  for (let s = seconds; s > 0; s--) {
    el.textContent = s;
    await new Promise((r) => setTimeout(r, 1000));
  }
  el.textContent = '';
}

for (const view of ['front', 'side']) {
  $(view === 'front' ? 'snapFront' : 'snapSide').addEventListener('click', async () => {
    setStatus(view === 'front' ? 'Frontal zur Kamera stellen …' : 'Seitlich zur Kamera stellen …');
    await countdown(5);
    const { captureFrame } = await scanModule();
    if (cameraOn) runScan(view, captureFrame(video));
  });
}

// ---------------------------------------------------------------------------
// Measurements -> avatar
// ---------------------------------------------------------------------------
const heightInput = $('height');

const LABELS = [
  ['height', 'Größe', 'eingegeben'],
  ['shoulderWidth', 'Schulterbreite', 'front'],
  ['waistWidth', 'Taillenbreite', 'front'],
  ['hipWidth', 'Hüftbreite', 'front'],
  ['thighWidth', 'Oberschenkel', 'front'],
  ['legLength', 'Beinlänge', 'front'],
  ['armLength', 'Armlänge', 'front'],
  ['chestDepth', 'Brusttiefe', 'side'],
  ['bellyDepth', 'Bauchtiefe', 'side'],
];

function showMeasures(body) {
  $('measures').innerHTML = LABELS.map(([key, label, src]) => {
    const from = src === 'eingegeben' ? src : scans[src] ? (src === 'front' ? 'Front-Foto' : 'Seiten-Foto') : 'Standard';
    return `<tr><td>${label} <span class="src">${from}</span></td><td>${Math.round(body[key] * 100)} cm</td></tr>`;
  }).join('');
}

function applyScans() {
  const h = Math.min(220, Math.max(120, Number(heightInput.value) || 175)) / 100;
  const body = bodyFromScans(scans, h);
  // manual choices in "Individuell" win over the scan
  body.look = { ...body.look, ...manual.look, hair: { ...body.look.hair, ...manual.look?.hair }, outfit: { ...body.look.outfit, ...manual.look?.outfit } };
  body.colors = { ...body.colors, ...manual.colors };
  avatar.body = body;
  rebuild();
  showMeasures(body);
  showLook(body);
}
heightInput.addEventListener('change', applyScans);

// ---------------------------------------------------------------------------
// Body composition: fat, muscle, training style, per muscle group
// (distribution: see anatomy.js)
// ---------------------------------------------------------------------------
const fmt = (v) => (v > 0 ? '+' : '') + v + ' %';
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// one slider per muscle group
$('groupSliders').innerHTML = Object.entries(GROUPS).map(([id, g]) => `
  <label class="slider">
    <span><span><i class="chip" style="background:${hex(g.color)}"></i>${g.label}</span><output id="gOut-${id}">0 %</output></span>
    <input type="range" data-group="${id}" min="-100" max="100" value="0" step="5">
  </label>`).join('');
const groupInputs = [...document.querySelectorAll('#groupSliders input')];

// legend text depends on the view
const LEGENDS = {
  look: '<i style="background:#ffa040"></i>mehr Fett <i style="background:#e53935"></i>mehr Muskeln <i style="background:#4fa8e8"></i>weniger',
  groups: Object.values(GROUPS).map((g) => `<i style="background:${hex(g.color)}"></i>${g.label}`).join(' ') +
    ' <i style="background:#f4d35e"></i>Fettdepot <i style="background:#d9d2c5"></i>Sehne/Knochen',
  fibers: '<i style="background:#8e1b1b"></i>langsame Fasern (Typ I, Ausdauer) <i style="background:#f0b8b0"></i>schnelle Fasern (Typ II, Kraft) <i style="background:#f4d35e"></i>Fett',
};

let rebuildQueued = false;
function rebuild() {
  // rebuild at most once per frame while dragging
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    avatar.build();
    const s = avatar.stats, n = (v) => v.toLocaleString('de-DE');
    const muscle = s.slow + s.fast;
    $('stats').textContent = `${n(avatar.voxelCount)} Würfel (${Math.round(avatar.buildMs)} ms) · sichtbar: ` +
      `${n(muscle)} Muskel (${muscle ? Math.round((s.slow / muscle) * 100) : 0} % langsam), ${n(s.fat)} Fett`;
  });
}

// While a slider is dragged we build with coarse 2 cm cubes (fast), and in full
// detail when it is released.
function updateComposition(dragging = false) {
  const fat = Number($('fat').value), muscle = Number($('muscle').value);
  $('fatOut').textContent = fmt(fat);
  $('muscleOut').textContent = fmt(muscle);
  const groups = {};
  for (const input of groupInputs) {
    groups[input.dataset.group] = Number(input.value) / 100;
    $('gOut-' + input.dataset.group).textContent = fmt(Number(input.value));
  }
  Object.assign(avatar.composition, {
    fat: fat / 100, muscle: muscle / 100, groups, training: $('training').value, tint: $('tint').checked,
  });
  avatar.view = $('view').value;
  const fine = Number($('voxel').value);
  avatar.voxel = dragging ? Math.max(fine, 0.02) : fine;
  $('legend').innerHTML = LEGENDS[avatar.view];
  rebuild();
}
for (const el of [$('fat'), $('muscle'), ...groupInputs]) {
  el.addEventListener('input', () => updateComposition(true));
  el.addEventListener('change', () => updateComposition(false));
}
for (const id of ['training', 'tint', 'view', 'voxel']) $(id).addEventListener('change', () => updateComposition());
$('resetComp').addEventListener('click', () => {
  for (const el of [$('fat'), $('muscle'), ...groupInputs]) el.value = 0;
  updateComposition();
});
updateComposition();

// ---------------------------------------------------------------------------
// Animation mode buttons
// ---------------------------------------------------------------------------
for (const btn of document.querySelectorAll('#modes button')) {
  btn.addEventListener('click', () => {
    animator.mode = btn.dataset.mode;
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b === btn));
  });
}

// ---------------------------------------------------------------------------
// "Individuell": hairstyle, beard and colors (prefilled from the face scan)
// ---------------------------------------------------------------------------
let manual = {}; // user overrides: { look: {...}, colors: {...} }
const hexColor = (c) => '#' + c.toString(16).padStart(6, '0');
const COLOR_INPUTS = { colSkin: 'skin', colHair: 'hair', colEye: 'eye', colLip: 'lip', colShirt: 'shirt', colShorts: 'shorts' };

function showLook(body) {
  const L = body.look;
  $('hairStyle').value = L.hair.style;
  $('bangs').checked = !!L.hair.bangs;
  $('beard').value = L.beard;
  $('mustache').checked = !!L.mustache;
  const o = L.outfit;
  $('top').value = o.top === 'none' ? 'none' : o.sleeves === 'long' ? 'long' : o.sleeves === 'none' ? 'tank' : 'short';
  $('bottoms').value = o.bottoms;
  $('shoes').checked = !!o.shoes;
  for (const [id, key] of Object.entries(COLOR_INPUTS)) $(id).value = hexColor(body.colors[key]);
  const f = scans.front?.face;
  if (f) {
    const pct = (v) => Math.round(v * 100) + ' %';
    const m = f.measures;
    $('faceInfo').textContent = `Gesicht erkannt (100 % = Durchschnitt): Länge ${pct(m.faceLong)}, Kiefer ${pct(m.jaw)}, ` +
      `Augenabstand ${pct(m.eyeSpacing)}, Augen ${pct(m.eyeSize)}, Nase ${pct(m.noseWidth)} breit / ${pct(m.noseLength)} lang, ` +
      `Mund ${pct(m.mouthWidth)}, Lippen ${pct((m.lipUpper + m.lipLower) / 2)}, Kinn ${pct(m.chin)}.`;
  }
}

function updateLook() {
  manual.look = {
    hair: { style: $('hairStyle').value, bangs: $('bangs').checked },
    beard: $('beard').value,
    mustache: $('mustache').checked,
    outfit: {
      top: $('top').value === 'none' ? 'none' : 'shirt',
      sleeves: { none: 'none', short: 'short', long: 'long', tank: 'none' }[$('top').value],
      bottoms: $('bottoms').value,
      shoes: $('shoes').checked,
    },
  };
  manual.colors = {};
  for (const [id, key] of Object.entries(COLOR_INPUTS)) manual.colors[key] = parseInt($(id).value.slice(1), 16);
  // beard and eyebrows follow a manually chosen hair color
  if (manual.colors.hair !== avatar.body.colors.hair) manual.colors.beard = manual.colors.brow = manual.colors.hair;
  applyScans();
}
for (const id of ['hairStyle', 'beard', 'bangs', 'mustache', 'top', 'bottoms', 'shoes', ...Object.keys(COLOR_INPUTS)]) $(id).addEventListener('change', updateLook);
applyScans(); // first build (defaults until a photo is scanned)
