// Entry point: sets up the Three.js scene, camera, lights and render loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Avatar } from './avatar.js';
import { bodyFromScans } from './measure.js';
import { Animator } from './anim.js';
import { analyze, drawScan, startCamera, stopCamera, captureFrame, loadImageFile, loadPose } from './scan.js';

const stage = document.getElementById('stage');

// Renderer draws the scene into a <canvas>
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

// Camera looks at the avatar from the front
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0, 1.1, 3.4);

// Mouse / touch drag to rotate the view
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;

// Lights: soft fill + one directional "sun"
scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(2, 4, 3);
scene.add(sun);

// Floor grid for orientation
scene.add(new THREE.GridHelper(4, 16, 0x333844, 0x22262e));

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
window.scans = scans;

async function runScan(view, image) {
  setStatus('Analysiere ' + (view === 'front' ? 'Front' : 'Seite') + ' … (erstes Mal lädt Modell)');
  try {
    const scan = await analyze(image);
    drawScan($(view === 'front' ? 'prevFront' : 'prevSide'), image, scan);
    if (!scan) return setStatus('Keine Person erkannt. Ganzer Körper im Bild?');
    scans[view] = scan;
    setStatus((view === 'front' ? 'Front' : 'Seite') + ' erkannt ✓ – Avatar angepasst');
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
    runScan(view, await loadImageFile(file));
    input.value = ''; // allow picking the same file again
  });
}

// Camera with 5 s self-timer so the user can step back
const video = $('video');
let cameraOn = false;
$('camBtn').addEventListener('click', async () => {
  if (cameraOn) {
    stopCamera(video);
    cameraOn = false;
  } else {
    try {
      await startCamera(video);
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
  avatar.body = bodyFromScans(scans, h);
  avatar.build();
  showMeasures(avatar.body);
}
heightInput.addEventListener('change', applyScans);
applyScans();

// ---------------------------------------------------------------------------
// Fat / muscle sliders -> per-region growth (see GROWTH in avatar.js)
// ---------------------------------------------------------------------------
let rebuildQueued = false;
function updateComposition() {
  const fat = Number($('fat').value), muscle = Number($('muscle').value);
  const fmt = (v) => (v > 0 ? '+' : '') + v + ' %';
  $('fatOut').textContent = fmt(fat);
  $('muscleOut').textContent = fmt(muscle);
  Object.assign(avatar.composition, { fat: fat / 100, muscle: muscle / 100, tint: $('tint').checked });
  // rebuild at most once per frame while dragging
  if (!rebuildQueued) {
    rebuildQueued = true;
    requestAnimationFrame(() => { rebuildQueued = false; avatar.build(); });
  }
}
for (const id of ['fat', 'muscle']) $(id).addEventListener('input', updateComposition);
$('tint').addEventListener('change', updateComposition);
$('resetComp').addEventListener('click', () => {
  $('fat').value = 0;
  $('muscle').value = 0;
  updateComposition();
});

// ---------------------------------------------------------------------------
// Animation mode buttons
// ---------------------------------------------------------------------------
for (const btn of document.querySelectorAll('#modes button')) {
  btn.addEventListener('click', () => {
    animator.mode = btn.dataset.mode;
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b === btn));
  });
}
