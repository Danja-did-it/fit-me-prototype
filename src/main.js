// Entry point: sets up the Three.js scene, camera, lights and render loop.
import * as THREE from 'three';
import './mplog.js'; // quiet MediaPipe status lines
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Avatar, HAIR_STYLES, HERO_LOOK, HERO_COLORS, HERO_COMP, SKIN_TONES, HAIR_TONES, snapColor, contrastHair, massOf } from './avatar.js';
import { buildBodyMap } from './bodymap.js';
import { bodyFromScans, verticalExtent } from './measure.js';
import { fitToScan, faceTargets, FRONT_KEYS, SIDE_KEYS, FRONT_PROFILES, SIDE_PROFILES } from './fit.js';
import { Animator } from './anim.js';
import { GROUPS } from './anatomy.js';
import * as voice from './voice.js'; // spoken camera instructions
// scan.js (MediaPipe, large) is loaded only when the user starts a scan -> faster first load
const scanModule = () => import('./scan.js');

const stage = document.getElementById('stage');

// Renderer draws the scene into a <canvas>
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping; // true-to-life colors (skin keeps its saturation)
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // soft edges via shadow.radius
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1e24);

// Camera looks at the avatar from the front (framed so the big afro of the hero fits under the demo button)
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
const CAM_HOME = { pos: [0, 1.2, 3.9], target: [0, 1.02, 0] };
camera.position.set(...CAM_HOME.pos);

// Mouse / touch drag to rotate the view
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(...CAM_HOME.target);
controls.enableDamping = true;
controls.minDistance = 0.4;
controls.maxDistance = 8;
window.camera = camera; window.controls = controls; // for the test script

// Studio lights: warm key light with soft shadows, cool fill, rim light from behind
// soft studio light from all sides (image based lighting, like a photo studio), neutral colors
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
const hemi = new THREE.HemisphereLight(0xffffff, 0x4a4440, 0.3);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfffaf4, 2.3);
key.position.set(1.6, 3.2, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -1.1, right: 1.1, top: 2.1, bottom: -0.2, near: 0.5, far: 8 });
key.shadow.bias = -0.001;
key.shadow.normalBias = 0.025; // avoids stripe artifacts ("shadow acne") on the cubes
key.shadow.radius = 3;
scene.add(key);
const fill = new THREE.DirectionalLight(0xf2f4ff, 0.75);
fill.position.set(-2.5, 1.8, 1.5);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.9);
rim.position.set(-0.5, 2.5, -3);
scene.add(rim);
// second rim light: only used by the game stage (intensity 0 in the realistic one). Both stages keep the
// same lights, so switching the style never recompiles the shaders.
const rim2 = new THREE.DirectionalLight(0xffb070, 0);
rim2.position.set(2.2, 2.6, -2.2);
scene.add(rim2);

// Round floor that catches the shadow
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(1.3, 64),
  new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.95 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Game stage (Voxel-Double): warm sunset backdrop as a vertical gradient (glow behind head and shoulders)
// and a larger, darker floor whose edge fades out (radial alpha), like the concept image.
const canvasTex = (w, h, paint) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  return new THREE.CanvasTexture(c);
};
// gym by a big window at sunset: city skyline with a few lit windows, window frame (mullions + transom),
// palm silhouettes at the edges (fixed pseudo-random numbers, the same picture every time)
const sunset = canvasTex(512, 512, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  for (const [t, col] of [[0, '#151a2b'], [0.22, '#2e2a45'], [0.34, '#b8704f'], [0.4, '#e0925e'], [0.47, '#6a4640'], [0.58, '#2a201d'], [1, '#121012']]) grad.addColorStop(t, col);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const base = 0.47 * h;
  for (let x = 0; x < w;) {
    const bw = 12 + rnd() * 28, bh = 20 + rnd() * 60;
    g.fillStyle = 'rgba(58,47,69,0.7)'; g.fillRect(x, base - bh, bw - 2, bh);
    g.fillStyle = 'rgba(242,195,138,0.6)';
    for (let k = 0, n = 2 + Math.floor(rnd() * 3); k < n; k++) g.fillRect(x + 2 + rnd() * (bw - 8), base - bh + 4 + rnd() * (bh - 10), 2, 3);
    x += bw;
  }
  g.fillStyle = '#1a1620'; // palms
  for (const [px, dir] of [[18, 1], [w - 18, -1]]) {
    g.fillRect(px - 3, 0.4 * h, 6, 0.2 * h);
    for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(px + dir * (k - 2) * 12, 0.4 * h - 4 + Math.abs(k - 2) * 5, 22, 5, dir * (k - 2) * 0.45, 0, Math.PI * 2); g.fill(); }
  }
  g.fillStyle = '#14121a'; // window frame
  for (const fx of [0.12, 0.5, 0.88]) g.fillRect(fx * w - 3, 0, 6, 0.58 * h);
  g.fillRect(0, 0.28 * h - 3, w, 6);
});
sunset.colorSpace = THREE.SRGBColorSpace;
const fade = canvasTex(256, 256, (g, w, h) => {
  const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grad.addColorStop(0, '#fff'); grad.addColorStop(0.55, '#fff'); grad.addColorStop(1, '#000');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
});
// gym floor: dark tiles with a hint of sheen, the edge fades out
const tiles = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#1a1514'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#2a2220'; for (let k = 0; k < w; k += 64) { g.fillRect(k, 0, 2, h); g.fillRect(0, k, w, 2); }
});
tiles.colorSpace = THREE.SRGBColorSpace;
const floorGame = new THREE.Mesh(
  new THREE.CircleGeometry(2.2, 64),
  new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.35, metalness: 0.3, alphaMap: fade, transparent: true })
);
floorGame.rotation.x = -Math.PI / 2;
floorGame.receiveShadow = true;
scene.add(floorGame);

// The two stages: realistic = neutral studio (as before), game = warm key light from the upper left, warm
// orange rim lights from behind (edge on shoulders and hair), a weak cool fill, less reflection, more contrast
const STAGES = {
  real: { bg: new THREE.Color(0x1b1e24), exposure: 1.12, env: 0.3, hemi: [0xffffff, 0x4a4440, 0.3],
    key: [0xfffaf4, 2.3, [1.6, 3.2, 2.6]], fill: [0xf2f4ff, 0.75, [-2.5, 1.8, 1.5]], rim: [0xffffff, 0.9, [-0.5, 2.5, -3]], rim2: [0xffb070, 0, [2.2, 2.6, -2.2]] },
  game: { bg: sunset, exposure: 1.35, env: 0.2, hemi: [0xffd8b0, 0x2a1a12, 0.35],
    key: [0xfff0e2, 4.2, [-1.4, 3.2, 2.4]], fill: [0x8ea2d8, 0.25, [2.5, 1.2, 1.8]], rim: [0xff8c42, 3.0, [-3.0, 1.8, -0.8]], rim2: [0xffb070, 1.6, [3.0, 2.0, -0.8]] },
};
function setStage(style) {
  const S = STAGES[style] || STAGES.real;
  scene.background = S.bg;
  renderer.toneMappingExposure = S.exposure;
  scene.environmentIntensity = S.env;
  hemi.color.set(S.hemi[0]); hemi.groundColor.set(S.hemi[1]); hemi.intensity = S.hemi[2];
  for (const [light, [color, intensity, p]] of [[key, S.key], [fill, S.fill], [rim, S.rim], [rim2, S.rim2]]) {
    light.color.set(color); light.intensity = intensity; light.position.set(...p);
  }
  floor.visible = style !== 'game';
  floorGame.visible = style === 'game';
}

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
  fitView();
}
// The avatar is shown in the free space between the stat chips (left) and the accessory rail (right):
// the picture is shifted sideways (view offset), so orbiting still turns around the avatar.
function fitView() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const overlays = document.body.dataset.stage !== 'progress';
  const shift = overlays ? ((12 + 96 + 10) + (w - 12 - 44 - 10)) / 2 - w / 2 : 0; // px, avatar to the right
  if (shift) camera.setViewOffset(w, h, -shift, 0, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

let demo = null; // running demo tour (see runDemo)
let progress = null; // progress view (Anfang / Jetzt / Ziel), see enterProgress

// Render loop
renderer.setAnimationLoop(() => {
  const now = performance.now();
  if (demo?.spin) avatar.root.rotation.y += Math.min((now - lastTime) / 1000, 0.1) * 0.7; // demo: turn slowly
  animator.update(Math.min((now - lastTime) / 1000, 0.1)); // seconds; capped after tab switches
  avatar.updateSkin(); // joint movement -> GPU skinning of the cubes
  if (progress) progressFrame(Math.min((now - lastTime) / 1000, 0.1));
  lastTime = now;
  controls.update();
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------------------
// Scan UI: camera / photo -> MediaPipe -> preview
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// App shell: 5 tabs. Phones: fixed tab bar at the bottom; desktop: the same tabs as a strip on top of
// the panel. One tab's section is shown at a time (body[data-tab], CSS). All controls keep their ids.
// ---------------------------------------------------------------------------
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TABS = [
  ['avatar', 'Avatar', '<circle cx="12" cy="7" r="3.5"/><path d="M5 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/>'],
  ['scan', 'Scan', '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3"/>'],
  ['body', 'Körper', '<path d="M6 8v8M18 8v8M3 10.5v3M21 10.5v3M6 12h12"/>'],
  ['style', 'Style', '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15.5l.7 1.8 1.8.7-1.8.7L19 20.5l-.7-1.8-1.8-.7 1.8-.7z"/>'],
  ['details', 'Details', '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'],
];
const tabNavs = [$('tabbar'), $('tabstrip')];
for (const nav of tabNavs) {
  nav.innerHTML = TABS.map(([id, label, icon]) => `<button role="tab" data-tab="${id}" aria-selected="false">${svg(icon)}<span>${label}</span></button>`).join('');
  nav.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
}
function showTab(id, { force = false } = {}) {
  if (!force && tabNavs[0].hasAttribute('data-locked')) return; // no tab change while a capture runs
  document.body.dataset.tab = id;
  for (const b of document.querySelectorAll('.tabs button[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === id));
  window.scrollTo(0, 0);
  $('panel').scrollTop = 0;
}
showTab('avatar');
$('ctaScan').addEventListener('click', () => showTab('scan'));
const setScanBusy = (on) => { for (const b of document.querySelectorAll('.tabs button[data-tab="scan"]')) b.toggleAttribute('data-busy', on); };

const statusEl = $('status');
const setStatus = (t) => (statusEl.textContent = t);

// All scans: several photos per view. front = front + back photos (widths, lengths),
// side = left + right photos (depths). Every measurement uses the median of all photos.
export const scans = { front: [], side: [], face: null, outfit: null };
const tips = {};
window.scans = scans;
const VIEW_NAMES = { front: 'Front', back: 'Rücken', side: 'Seite' };

async function runScan(view, image, { apply = true } = {}) {
  setStatus('Analysiere ' + VIEW_NAMES[view] + ' … (erstes Mal lädt die Modelle)');
  setScanBusy(true); // dot on the Scan tab while it runs
  try {
    const { analyze, drawScan, scanQuality } = await scanModule();
    const scan = await analyze(image);
    drawScan($(view === 'side' ? 'prevSide' : 'prevFront'), image, scan);
    if (!scan) return setStatus('Keine Person erkannt. Ganzer Körper im Bild?');
    scan.view = view;
    (view === 'side' ? scans.side : scans.front).push(scan);
    let faceText = '';
    if (view === 'front') {
      if (!scans.outfit && scan.outfit) scans.outfit = scan.outfit;
      if (!scans.face) {
        // face + hair from the first front photo with a visible face
        setStatus('Analysiere Gesicht …');
        const { analyzeFace, drawFace } = await import('./face.js');
        try { scan.face = await analyzeFace(image, scan.landmarks); } catch (e) { console.warn('face analysis failed', e); }
        if (scan.face) {
          // absolute face size: face width / body height (the ratios alone are scale-free)
          const { top, bottom } = verticalExtent(scan.mask);
          if (bottom > top) scan.face.ratios.faceSize = scan.face.faceWidthImg / ((bottom - top) / scan.mask.height);
          scans.face = scan.face; drawFace($('prevFace'), scan.face); manual = { look: {}, colors: {} };
        }
        faceText = scan.face ? ', Gesicht erkannt' : ', Gesicht nicht erkannt';
      }
    }
    // tips when the photo is not ideal (arms at the body, not upright, clothes ...)
    tips[view] = scanQuality(scan, view === 'back' ? 'front' : view);
    $('tips').innerHTML = [...new Set(Object.values(tips).flat())].map((t) => `<li>${t}</li>`).join('');
    if (!apply) { setStatus(VIEW_NAMES[view] + ' erkannt ✓' + faceText); return; }
    setStatus(VIEW_NAMES[view] + ' erkannt ✓' + faceText + ' – Körpermodell wird angepasst …');
    await new Promise((r) => setTimeout(r, 30)); // let the status show before the fit
    applyScans();
    setStatus(VIEW_NAMES[view] + ' erkannt ✓' + faceText + ' – Avatar angepasst');
  } catch (e) {
    console.error(e);
    setStatus('Fehler bei der Analyse: ' + e.message);
  } finally {
    setScanBusy(false);
  }
}

function updateScanCount() {
  const nb = scans.front.filter((s) => s.view === 'back').length, nf = scans.front.length - nb, ns = scans.side.length;
  $('scanCount').textContent = nf + nb + ns
    ? `Aufnahmen: ${nf}× Front, ${nb}× Rücken, ${ns}× Seite – Maße = Median aller Aufnahmen.`
    : 'Noch keine Aufnahmen. Mehr Aufnahmen = genauere Maße (Median).';
}

// Photo files (several at once)
for (const [view, id] of [['front', 'fileFront'], ['back', 'fileBack'], ['side', 'fileSide']]) {
  const input = $(id);
  input.addEventListener('change', async () => {
    const { loadImageFile } = await scanModule();
    for (const file of [...input.files]) await runScan(view, await loadImageFile(file));
    input.value = ''; // allow picking the same files again
    updateScanCount();
  });
}
$('clearScans').addEventListener('click', () => {
  scans.front.length = 0; scans.side.length = 0; scans.face = null; scans.outfit = null;
  for (const k of Object.keys(tips)) delete tips[k];
  $('tips').innerHTML = '';
  updateScanCount();
  if (!compTouched) { resetComp(); updateComposition(); } // back to the hero start values
  applyScans();
  setStatus('Aufnahmen gelöscht.');
});

// Camera with 5 s self-timer so the user can step back
const video = $('video');
let cameraOn = false;
let facing = 'user'; // selfie camera first
$('camBtn').addEventListener('click', async () => {
  showTab('scan'); // the camera image lives in the Scan tab (a hidden <video> may stop on iOS)
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
  $('snapFront').disabled = $('snapBack').disabled = $('snapSide').disabled = !cameraOn;
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


// Guided capture: live pose check on the camera image, spoken instructions, then a burst of
// photos. It only fires when the pose is right AND you stand still for 1.5 s, checks again during
// the countdown, never fires by itself after a timeout, and only one capture can run at a time.
const BURST = 4;
const VIEW_INTRO = {
  front: 'Stell dich frontal zur Kamera, zwei bis drei Meter entfernt. Arme leicht vom Körper weg.',
  side: 'Dreh dich um neunzig Grad, eine Schulter zeigt zur Kamera. Arme locker hängen lassen.',
  back: 'Dreh dich mit dem Rücken zur Kamera. Arme leicht vom Körper weg.',
};
let capture = null; // running capture: { cancelled }
const capButtons = ['snapFront', 'snapBack', 'snapSide', 'guidedAll', 'camBtn', 'flipCam'];
function setCapturing(on) {
  for (const id of capButtons) $(id).disabled = on || (id.startsWith('snap') && !cameraOn);
  $('cancelCap').hidden = !on;
  if (on) showTab('scan', { force: true });
  for (const nav of tabNavs) nav.toggleAttribute('data-locked', on); // tabs locked while capturing
}
$('cancelCap').addEventListener('click', () => { if (capture) capture.cancelled = true; });
$('voiceOn').addEventListener('change', () => voice.setVoiceEnabled($('voiceOn').checked));

async function guidedCapture(view, hint, token = null) {
  if (capture && capture !== token) return false; // already running
  const own = !token;
  const job = token || (capture = { cancelled: false });
  if (own) setCapturing(true);
  const { captureFrame, livePose, quickPose, plausible, scanQuality } = await scanModule();
  const el = $('countdown'), box = video.parentElement;
  const show = (t, ok) => { el.textContent = t; el.style.fontSize = t.length > 3 ? '17px' : ''; box.dataset.ok = ok ? '1' : '0'; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const alive = () => cameraOn && !job.cancelled;
  // Live tracking ~6-8 x per second. Single frames can flicker (a missed frame, a hand briefly at the
  // hip): the state shown / spoken is the clear majority of the last 0.7 s, "not seen" only after
  // ~1 s without a person, and "still" means little movement over a whole second.
  const NOT_SEEN = 'Ich sehe dich nicht. Stell dich ganz ins Bild, von Kopf bis Fuß.';
  const KEY = [0, 11, 12, 15, 16, 23, 24, 27, 28];
  // (all windows count frames AND time, so it behaves the same on fast and slow phones)
  const hist = [];
  let missing = 0, missingSince = 0;
  const sample = async () => {
    const lm = await livePose(video), now = performance.now();
    if (lm) { missing = 0; missingSince = 0; } else { missing++; missingSince ||= now; }
    const tips = lm ? scanQuality({ landmarks: lm }, view === 'back' ? 'front' : view) : null;
    const state = lm ? (tips.length ? tips[0] : 'OK') : missing >= 3 && now - missingSince > 1000 ? NOT_SEEN : 'WAIT';
    hist.push({ t: now, lm, state });
    while (hist.length > 30 || (hist.length && now - hist[0].t > 4000)) hist.shift();
  };
  const stable = () => { // clear majority of the last 4 decided frames (at most 2.5 s old)
    const now = performance.now(), recent = hist.filter((h) => now - h.t < 2500 && h.state !== 'WAIT').slice(-4);
    if (recent.length < 3) return null;
    const count = {};
    for (const h of recent) count[h.state] = (count[h.state] || 0) + 1;
    const [best, n] = Object.entries(count).sort((x, y) => y[1] - x[1])[0];
    return n / recent.length >= 0.6 ? best : null;
  };
  const stillFor = (ms) => { // little movement over >= ms and >= 3 frames
    const withLm = hist.filter((h) => h.lm);
    if (withLm.length < 3) return false;
    const now = performance.now();
    let win = withLm.filter((h) => now - h.t <= ms);
    if (win.length < 3) win = withLm.slice(-3);
    if (now - win[0].t < ms * 0.6) return false;
    const last = win[win.length - 1].lm, h = Math.abs(last[27].y - last[0].y) || 1;
    let mx = 0;
    for (const a of win) for (const i of KEY) mx = Math.max(mx, Math.hypot(a.lm[i].x - last[i].x, a.lm[i].y - last[i].y));
    return mx / h < 0.025;
  };
  setStatus(hint);
  voice.resetHints();
  voice.speak(VIEW_INTRO[view], { force: true });
  let taken = false, goodSince = 0, movingSince = 0, saidGood = false, shown = '';
  const until = performance.now() + 90000; // then give up - never fires by itself
  try {
    while (alive() && performance.now() < until && !taken) {
      await sample();
      const st = stable(), now = performance.now();
      if (st === 'OK') {
        if (stillFor(1000)) {
          movingSince = 0;
          goodSince ||= now;
          if (shown !== 'OK') { shown = 'OK'; show('Pose passt ✓ – still halten', true); }
          if (!saidGood) { saidGood = true; voice.speak('Gut so. Bitte still halten.', { force: true }); }
        } else {
          goodSince = 0;
          movingSince ||= now;
          if (shown !== 'MOVE') { shown = 'MOVE'; show('Bitte still stehen …', false); }
          if (now - movingSince > 2000) voice.speak('Bitte still stehen.');
        }
      } else if (st) {
        goodSince = 0; movingSince = 0; saidGood = false;
        if (shown !== st) { shown = st; show(st, false); }
        voice.speak(st); // not chatty: voice.js spaces and limits repeats
      }
      if (!goodSince || now - goodSince < 1500) { await wait(100); continue; }
      // countdown - tracking keeps running, a clear pose error or movement restarts it
      let lost = false;
      for (let n = 3; n > 0 && alive() && !lost; n--) {
        show(String(n), true);
        voice.speak(['', 'Eins', 'Zwei', 'Drei'][n], { force: true, withBeep: false });
        const end = performance.now() + 800;
        while (performance.now() < end && alive()) {
          await sample();
          const s2 = stable();
          if ((s2 && s2 !== 'OK') || !stillFor(700)) { lost = true; break; }
          await wait(80);
        }
      }
      if (!alive()) break;
      // cross-check with the precise model on the real frame before taking the photos
      if (!lost) { const q = await quickPose(captureFrame(video)); if (!q || !plausible(q)) lost = true; }
      if (lost) {
        goodSince = 0; saidGood = false; shown = '';
        show('Position verloren – nochmal', false);
        voice.speak('Position verloren. Nochmal.', { force: true });
        await wait(1200);
        continue;
      }
      // burst: several photos, the measurements use the median
      const frames = [];
      for (let i = 0; i < BURST && alive(); i++) { frames.push(captureFrame(video)); voice.shutterSound(); show('📸 ' + (i + 1) + '/' + BURST, true); await wait(250); }
      show('', true); delete box.dataset.ok;
      voice.speak('Foto aufgenommen.', { force: true });
      for (const [i, f] of frames.entries()) await runScan(view, f, { apply: i === frames.length - 1 });
      updateScanCount();
      taken = true;
    }
    if (!taken) {
      show('', false); delete box.dataset.ok;
      const why = job.cancelled ? 'Aufnahme abgebrochen.' : 'Keine passende Pose erkannt. Aufnahme abgebrochen.';
      setStatus(why); voice.speak(why, { force: true });
    }
  } finally {
    if (own) { capture = null; setCapturing(false); }
  }
  return taken;
}
for (const [view, id, hint] of [['front', 'snapFront', 'Frontal zur Kamera stellen, Arme etwas vom Körper weg …'], ['back', 'snapBack', 'Rücken zur Kamera drehen …'], ['side', 'snapSide', 'Seitlich zur Kamera stellen …']]) {
  $(id).addEventListener('click', () => { voice.unlockAudio(); guidedCapture(view, hint); });
}

// Hands-free guided scan: front -> side -> back with spoken instructions (for scanning yourself:
// put the phone down upright at hip height, step back 2-3 m)
$('guidedAll').addEventListener('click', async () => {
  if (capture) return;
  showTab('scan');
  voice.unlockAudio();
  if (!cameraOn) $('camBtn').click();
  const job = (capture = { cancelled: false });
  setCapturing(true);
  try {
    for (let t = 0; !cameraOn && t < 50; t++) await new Promise((r) => setTimeout(r, 100)); // wait for the camera
    if (!cameraOn) return;
    voice.speak('Geführter Scan. Stell das Handy aufrecht auf Hüfthöhe und geh zwei bis drei Meter zurück.', { force: true });
    await new Promise((r) => setTimeout(r, 5500));
    for (const [view, hint] of [['front', 'Front …'], ['side', 'Seite …'], ['back', 'Rücken …']]) {
      if (job.cancelled || !cameraOn) break;
      const ok = await guidedCapture(view, hint, job);
      if (!ok) return;
    }
    if (!job.cancelled) { voice.speak('Fertig! Dein Avatar ist berechnet.', { force: true }); setStatus('Geführter Scan fertig ✓'); }
  } finally {
    capture = null;
    setCapturing(false);
  }
});

// ---------------------------------------------------------------------------
// Measurements -> avatar
// ---------------------------------------------------------------------------
const heightInput = $('height');

const LABELS = [
  ['shoulderWidth', 'Schulterbreite'], ['waistWidth', 'Taillenbreite'], ['hipWidth', 'Hüftbreite'],
  ['thighWidth', 'Oberschenkel'], ['calfWidth', 'Wade'], ['upperArmWidth', 'Oberarm'], ['forearmWidth', 'Unterarm'],
  ['neckWidth', 'Hals'], ['legLength', 'Beinlänge'], ['armLength', 'Armlänge'],
  ['chestDepth', 'Brusttiefe', 'side'], ['bellyDepth', 'Bauchtiefe', 'side'],
];
let fitResult = null;

// table: photo value (median, number of photos) -> fitted model
function showMeasures(body) {
  const cm = (v) => (v > 0 ? (v * 100).toFixed(1) + ' cm' : '–');
  const model = fitResult?.model;
  const rows = LABELS.map(([key, label, src]) => {
    const n = src === 'side' ? scans.side.length : scans.front.length;
    const pm = body.spread?.[key] ? ` ±${(body.spread[key] * 100).toFixed(1)}` : '';
    const photo = n ? `${cm(body[key])}<span class="src">${pm} · ${n}×</span>` : '<span class="src">kein Foto</span>';
    return `<tr><td>${label}</td><td>${photo}</td><td>${model ? cm(model[key]) : ''}</td></tr>`;
  });
  $('measures').innerHTML = `<tr><td>Größe</td><td colspan="2">${cm(body.height)} <span class="src">eingegeben</span></td></tr>` +
    (model ? '<tr class="head"><td></td><td>Foto</td><td>Modell</td></tr>' : '') + rows.join('') +
    (fitResult ? `<tr><td colspan="3" class="src">Modell-Abweichung im Mittel ${(fitResult.error * 100).toFixed(1)} % (${Math.round(fitResult.ms)} ms)</td></tr>` : '') +
    (faceFit.result ? `<tr><td colspan="3" class="src">Gesicht: Abweichung ${(faceFit.result.error0 * 100).toFixed(1)} → ${(faceFit.result.error * 100).toFixed(1)} % (${Math.round(faceFit.result.ms)} ms)</td></tr>` : '');
}

// Face fit (facefit.js) is async and costs ~1 s, so its result is kept until the face scan,
// gender, age or the body fit (weight/muscle also shape the face) change.
let faceFit = { obj: null, key: null, face: null, result: null };
const faceKey = () => (scans.face ? [avatar.person.gender, avatar.person.age, avatar.fit.weight.toFixed(2), avatar.fit.muscle.toFixed(2)].join() : null);
async function startFaceFit(key) {
  const obj = scans.face;
  faceFit = { obj, key, face: null, result: null };
  const { fitFace } = await import('./facefit.js');
  const r = await fitFace(avatar, obj.ratios, obj.measures).catch((e) => (console.warn('face fit failed', e), null));
  if (faceFit.obj !== obj || faceFit.key !== key || !r) return; // newer scan meanwhile / failed: keep the estimate
  Object.assign(faceFit, { face: r.face, result: r });
  avatar.fit.face = r.face;
  // face texture from the photo (projected via the face points, on this device)
  const { buildFaceMap } = await import('./facefit.js');
  faceFit.map = await buildFaceMap(avatar, r.face, obj.photo).catch((e) => (console.warn('face map failed', e), null));
  if (faceFit.obj !== obj) return;
  avatar.faceMap = faceFit.map;
  rebuild();
  showMeasures(avatar.body);
}

let wasScanned = false;
function applyScans() {
  const h = Math.min(220, Math.max(120, Number(heightInput.value) || 175)) / 100;
  const body = bodyFromScans(scans, h);
  scanLook = { look: body.look, colors: body.colors }; // what the scan found (without a scan: the hero)
  // first scan: the sliders start at 0 / 0 = you as scanned (not the hero's lean start values)
  const scanned = isScanned();
  if (scanned && !wasScanned && !compTouched) { resetComp(); updateComposition(); }
  if (scanned && !wasScanned && !goalTouched) resetGoal(); // goal after a scan: -40 / +40
  wasScanned = scanned;
  document.body.classList.toggle('scanned', scanned); // hides "Jetzt scannen"
  avatar.body = body;
  composeLook();
  avatar.person = { gender: Number($('gender').value), age: Number($('age').value) || 30 };
  // fit the human model to everything that was measured
  const keys = [...(scans.front.length ? [...FRONT_KEYS, ...FRONT_PROFILES] : []), ...(scans.side.length ? [...SIDE_KEYS, ...SIDE_PROFILES] : [])];
  if (avatar.H && keys.length) fitResult = fitToScan(avatar, body, keys);
  else { avatar.fit = { weight: 0.5, muscle: 0.5, local: {} }; fitResult = null; }
  // clothes colors from the photos (projected onto the fitted body, bodymap.js)
  avatar.bodyMap = avatar.H && keys.length ? buildBodyMap(avatar, scans, body, scans.face?.wb) : null;
  avatar.fit.face = faceTargets(scans.face?.measures); // face shape: quick estimate first ...
  const fk = faceKey();
  avatar.faceMap = null;
  if (fk && faceFit.face && faceFit.obj === scans.face && faceFit.key === fk) { avatar.fit.face = faceFit.face; avatar.faceMap = faceFit.map || null; }
  else if (fk && scans.face.ratios) startFaceFit(fk); // ... then the exact fit on the rendered model head (~1 s)
  rebuild();
  showMeasures(body);
  showLook(body);
  if (progress) rebuildExtras(); // a new scan: all three avatars
}
heightInput.addEventListener('change', applyScans);
for (const id of ['gender', 'age']) $(id).addEventListener('change', applyScans);

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
    ' <i style="background:#f4d35e"></i>Fett <i style="background:#d9d2c5"></i>Sehne/Knochen',
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
    updateChips();
    if (progress) updateProgress();
    const s = avatar.stats, n = (v) => v.toLocaleString('de-DE');
    const muscle = s.slow + s.fast;
    $('stats').textContent = `${n(avatar.voxelCount)} Würfel (${Math.round(avatar.buildMs)} ms) · sichtbar: ` +
      `${n(muscle)} Muskel (${muscle ? Math.round((s.slow / muscle) * 100) : 0} % langsam), ${n(s.fat)} Fett`;
    // body fat estimate from the model's girths (US Navy formula) - veins show when it is low
    const f = avatar.fat, pct = f ? f.percent.toFixed(1).replace('.', ',') : null;
    const lean = f && f.percent - (1 - avatar.person.gender) * 8 - 1.5 * Math.max(0, avatar.composition.muscle);
    $('kfa').textContent = f ? `Körperfett ≈ ${pct} %` +
      (avatar.style === 'game' ? '' : lean <= 16 ? ` · Adern sichtbar${lean <= 9 ? ' (deutlich)' : ''}` : '') : ''; // veins: realistic style only
    $('kfaInfo').textContent = f ? `Körperfettanteil ≈ ${pct} %: Schätzung aus Hals-, Taillen- und Hüftumfang des Modells (Navy-Formel), ` +
      'gemittelt mit einer Schätzung aus den Modell-Einstellungen. Adern (realistischer Stil) ab niedrigem KFA.' : '';
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
  syncViewSeg();
  const fine = Number($('voxel').value);
  avatar.voxel = dragging ? Math.max(fine, 0.02) : fine;
  $('legend').innerHTML = LEGENDS[avatar.view];
  // the same legend on the stage when colors carry a meaning (muscle groups, fibers, tint); it takes the
  // place of the stat chips
  const legendOn = avatar.view !== 'look' || avatar.composition.tint;
  $('stageLegend').innerHTML = LEGENDS[avatar.view];
  $('stageLegend').hidden = !legendOn;
  document.body.classList.toggle('legend-on', legendOn);
  rebuild();
}
for (const el of [$('fat'), $('muscle'), ...groupInputs]) {
  el.addEventListener('input', () => { compTouched = true; updateComposition(true); });
  el.addEventListener('change', () => updateComposition(false));
}
for (const id of ['training', 'tint', 'view', 'voxel']) $(id).addEventListener('change', () => updateComposition());
// Körper tab: [Aussehen | Muskelgruppen] drives the "Ansicht" select (Details tab), and mirrors it
for (const b of $('viewSeg').querySelectorAll('button')) b.addEventListener('click', () => { $('view').value = b.dataset.view; $('view').dispatchEvent(new Event('change')); });
function syncViewSeg() { for (const b of $('viewSeg').querySelectorAll('button')) b.classList.toggle('active', b.dataset.view === $('view').value); }
// Start values of the sliders: the hero's lean, defined body before a scan, 0 / 0 (= as scanned) after it
let compTouched = false; // the user moved a composition slider himself
const isScanned = () => scans.front.length + scans.side.length > 0;
function resetComp() {
  const c = isScanned() ? { fat: 0, muscle: 0 } : HERO_COMP;
  $('fat').value = c.fat; $('muscle').value = c.muscle;
  for (const el of groupInputs) el.value = 0;
  compTouched = false;
}
$('resetComp').addEventListener('click', () => {
  resetComp();
  updateComposition();
});
resetComp();
updateComposition();

// ---------------------------------------------------------------------------
// Stat chips on the stage: weight (mesh volume x density), body fat, muscle mass since "Anfang"
// ---------------------------------------------------------------------------
// "Anfang" = start of the story: before a scan the hero's softer "before" body, after a scan you as scanned
const anfangComp = () => (isScanned() ? { fat: 0, muscle: 0 } : { fat: 0.3, muscle: -0.1 });
const leanOf = (kg, bf) => kg * (1 - bf / 100);
// kg of any state; a weight typed in (Scan tab) calibrates all numbers to the scanned / start body
function kgCalib() {
  const w = Number($('weight').value), A = avatar.estimate(anfangComp());
  return w > 0 ? w / A.kg : 1;
}
function updateChips() {
  const f = avatar.fat;
  if (!f || !avatar.volumeL || !avatar.H) return;
  const calib = kgCalib(), A = avatar.estimate(anfangComp());
  const kg = massOf(avatar.volumeL, f.percent) * calib;
  // muscle mass: lean mass with the current muscle setting vs. Anfang, both at the Anfang fat setting
  // (the fat estimate lags behind a fat change, so lean(Jetzt) would also count part of the new fat)
  const M = avatar.estimate({ fat: anfangComp().fat, muscle: avatar.composition.muscle });
  const dm = (leanOf(M.kg, M.bf) - leanOf(A.kg, A.bf)) * calib;
  const typed = Number($('weight').value) > 0;
  $('chipKg').innerHTML = `${typed ? '' : '<span class="approx">≈ </span>'}<span class="num">${Math.round(kg).toLocaleString('de-DE')}</span><span class="unit"> kg</span>`;
  $('chipBf').innerHTML = `<span class="num">${Math.round(f.percent)}</span><span class="unit"> %</span>`;
  const sign = dm > 0.05 ? '+' : dm < -0.05 ? '−' : '±';
  const v = (Math.abs(dm) < 0.05 ? 0 : Math.abs(dm)).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  $('chipMm').innerHTML = `<span class="num${dm > 0.05 ? ' good' : ''}">${sign}${v}</span><span class="unit"> kg</span>`;
}
$('weight').addEventListener('change', () => { updateChips(); if (progress) updateProgress(); });

// ---------------------------------------------------------------------------
// Fortschritt: "Anfang / Jetzt / Ziel" side by side. Jetzt = the main avatar (x = 0); Anfang and Ziel are
// two extra avatars (sharing the body data) that exist only while this view is open.
// ---------------------------------------------------------------------------
const SPACING = 0.85; // m between the avatars (the afro is ~0.8 m wide)
const goalDefault = () => (isScanned() ? { fat: -40, muscle: 40 } : { fat: -70, muscle: 90 });
let goalTouched = false;
const goalComp = () => ({ fat: Number($('goalFat').value) / 100, muscle: Number($('goalMuscle').value) / 100 });
function showGoal() { $('goalFatOut').textContent = fmt(Number($('goalFat').value)); $('goalMuscleOut').textContent = fmt(Number($('goalMuscle').value)); }
function resetGoal() { const g = goalDefault(); $('goalFat').value = g.fat; $('goalMuscle').value = g.muscle; goalTouched = false; showGoal(); }
resetGoal();
for (const id of ['goalFat', 'goalMuscle']) {
  $(id).addEventListener('input', () => { goalTouched = true; showGoal(); });
  $(id).addEventListener('change', () => { if (progress) { buildExtra(progress.ziel, goalComp()); updateProgress(); } });
}
$('goalReset').addEventListener('click', () => { resetGoal(); if (progress) { buildExtra(progress.ziel, goalComp()); updateProgress(); } });
$('goalEdit').addEventListener('click', () => { showTab('body'); $('goal').scrollIntoView({ block: 'start' }); });

function makeExtra(x, phase) {
  const a = new Avatar(avatar.H, avatar);
  a.setHuman(avatar.H, avatar); // now (not in the constructor's promise): builds only once, below
  a.root.position.x = x;
  scene.add(a.root);
  const anim = new Animator(a);
  anim.time = phase; // not all in step
  return { a, anim };
}
// same person / look / style as the main avatar, own fat + muscle (uniform, no single groups)
function buildExtra(e, comp) {
  Object.assign(e.a, { body: avatar.body, person: { ...avatar.person }, fit: avatar.fit, style: avatar.style, view: 'look',
    voxel: avatar.style === 'real' ? Math.max(avatar.voxel, 0.01) : avatar.voxel, faceMap: avatar.faceMap, bodyMap: avatar.bodyMap });
  e.a.composition = { ...avatar.composition, fat: comp.fat, muscle: comp.muscle, groups: {}, tint: false };
  e.a.build();
}
function rebuildExtras() {
  buildExtra(progress.anfang, anfangComp());
  buildExtra(progress.ziel, goalComp());
  updateProgress();
}
function enterProgress() {
  if (progress || !avatar.H) return;
  document.body.dataset.stage = 'progress';
  progress = { cam: [camera.position.clone(), controls.target.clone()], anfang: makeExtra(-SPACING, 0.4), ziel: makeExtra(SPACING, 0.8) };
  // labels: kg / KF chip over each avatar, name under it, arrows between them
  $('progressLabels').innerHTML = ['anfang', 'jetzt', 'ziel'].map((k) => `<div class="pl-chip glass" data-k="${k}"></div>`).join('') +
    '<div class="pl-name" data-k="anfang">Anfang</div><div class="pl-name now" data-k="jetzt">Jetzt</div><div class="pl-name" data-k="ziel">Ziel</div>' +
    '<div class="pl-arrow" data-k="a1">»</div><div class="pl-arrow" data-k="a2">»</div>';
  rebuildExtras();
  fitView();
  // camera: all three (plus labels) in view
  const vf = (camera.fov * Math.PI) / 360, hf = Math.atan(Math.tan(vf) * camera.aspect);
  const d = Math.max(1.3 / Math.tan(vf), (SPACING + 0.47) / Math.tan(hf));
  controls.target.set(0, 1.0, 0);
  camera.position.set(0, 1.05, d);
  for (const b of $('modeSeg').querySelectorAll('button')) b.classList.toggle('active', b.dataset.stage === 'progress');
}
function leaveProgress() {
  if (!progress) return;
  for (const e of [progress.anfang, progress.ziel]) e.a.dispose();
  camera.position.copy(progress.cam[0]); controls.target.copy(progress.cam[1]);
  progress = null;
  document.body.dataset.stage = 'avatar';
  $('progressLabels').innerHTML = '';
  fitView();
  for (const b of $('modeSeg').querySelectorAll('button')) b.classList.toggle('active', b.dataset.stage === 'avatar');
}
for (const b of $('modeSeg').querySelectorAll('button')) b.addEventListener('click', () => (b.dataset.stage === 'progress' ? enterProgress() : leaveProgress()));
// texts: kg + KF per avatar, "x % zum Ziel" (how far Jetzt is on the way Anfang -> Ziel in the slider plane)
function updateProgress() {
  if (!progress) return;
  const calib = kgCalib(), el = (k) => $('progressLabels').querySelector(`.pl-chip[data-k="${k}"]`);
  for (const [k, a] of [['anfang', progress.anfang.a], ['jetzt', avatar], ['ziel', progress.ziel.a]]) {
    if (!a.fat || !a.volumeL) continue;
    el(k).innerHTML = `<b>${Math.round(massOf(a.volumeL, a.fat.percent) * calib)} kg</b> · ${Math.round(a.fat.percent)} % KF`;
  }
  const A = anfangComp(), Z = goalComp(), J = avatar.composition;
  const zx = Z.fat - A.fat, zy = Z.muscle - A.muscle, l2 = zx * zx + zy * zy;
  const p = l2 ? Math.min(1, Math.max(0, ((J.fat - A.fat) * zx + (J.muscle - A.muscle) * zy) / l2)) : 1;
  const txt = `${Math.round(p * 100)} % zum Ziel`;
  $('progressBarText').textContent = txt;
  $('progressBar').querySelector('.fill').style.width = (p * 100).toFixed(1) + '%';
  const z = progress.ziel.a;
  $('progressText').textContent = txt + (z.fat ? ` · Ziel: ${Math.round(massOf(z.volumeL, z.fat.percent) * calib)} kg, ${Math.round(z.fat.percent)} % Körperfett` : '');
  progress.p = p;
}
// every frame: extra avatars move (idle), labels follow the projected avatars
function progressFrame(dt) {
  for (const e of [progress.anfang, progress.ziel]) { e.anim.update(dt); e.a.updateSkin(); }
  const rect = stage.getBoundingClientRect(), v = new THREE.Vector3();
  const at = (x, y) => { v.set(x, y, 0).project(camera); return [((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height]; };
  const place = (sel, [x, y]) => { const n = $('progressLabels').querySelector(sel); if (n) { n.style.left = x + 'px'; n.style.top = y + 'px'; } };
  const avs = { anfang: progress.anfang.a, jetzt: avatar, ziel: progress.ziel.a };
  for (const [k, a] of Object.entries(avs)) {
    if (!a.joints.head) continue;
    // over the hair: top of the figure, following the head as it moves
    const x = a.root.position.x, hy = (a.topY ?? a.bindHeadY + 0.3) + (a.joints.head.getWorldPosition(v).y - a.bindHeadY) + 0.02;
    const [sx, sy] = at(x, hy);
    place(`.pl-chip[data-k="${k}"]`, [sx, sy - 10]);
    place(`.pl-name[data-k="${k}"]`, [at(x, 0)[0], at(x, 0)[1] + 8]);
  }
  const hipY = avatar.mesh ? avatar.mesh.W.hips[1] : 0.7;
  place('.pl-arrow[data-k="a1"]', at(-SPACING / 2, hipY));
  place('.pl-arrow[data-k="a2"]', at(SPACING / 2, hipY));
}

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
let manual = { look: {}, colors: {} }; // user overrides (only the controls the user changed)
let scanLook = { look: HERO_LOOK, colors: HERO_COLORS }; // look + colors from the scan (start: the hero)
// hairstyle list from the catalog (avatar.js HAIR_STYLES)
$('hairStyle').innerHTML = Object.entries(HAIR_STYLES).map(([id, h]) => `<option value="${id}">${h.label}</option>`).join('');
$('hairStyle').value = 'short';
const hexColor = (c) => '#' + c.toString(16).padStart(6, '0');
const COLOR_INPUTS = { colSkin: 'skin', colHair: 'hair', colEye: 'eye', colLip: 'lip', colShirt: 'shirt', colShorts: 'shorts' };

function showLook(body) {
  const L = body.look;
  $('hairStyle').value = L.hair.style;
  $('bangs').checked = !!L.hair.bangs;
  $('beard').value = L.beard;
  $('mustache').checked = !!L.mustache;
  for (const [id, k] of [['accGlasses', 'glasses'], ['accChain', 'chain'], ['accWatch', 'watch']]) $(id).checked = !!L.acc?.[k];
  const o = L.outfit;
  $('top').value = o.top === 'none' ? 'none' : o.sleeves === 'long' ? 'long' : o.sleeves === 'none' ? 'tank' : 'short';
  $('bottoms').value = o.bottoms;
  $('shoes').checked = !!o.shoes;
  syncRail();
  for (const [id, key] of Object.entries(COLOR_INPUTS)) $(id).value = hexColor(body.colors[key]);
  const f = scans.face;
  if (f) {
    const pct = (v) => Math.round(v * 100) + ' %';
    const m = f.measures;
    $('faceInfo').textContent = `Gesicht erkannt (100 % = Durchschnitt): Länge ${pct(m.faceLong)}, Kiefer ${pct(m.jaw)}, ` +
      `Augenabstand ${pct(m.eyeSpacing)}, Augen ${pct(m.eyeSize)}, Nase ${pct(m.noseWidth)} breit / ${pct(m.noseLength)} lang, ` +
      `Mund ${pct(m.mouthWidth)}, Lippen ${pct((m.lipUpper + m.lipLower) / 2)}, Kinn ${pct(m.chin)}.`;
  }
}

// Look + colors: hero start look -> what the scan found -> style rules -> manual choices (always win)
function composeLook() {
  const game = avatar.style === 'game', scanned = isScanned();
  const look = { ...scanLook.look, hair: { ...scanLook.look.hair }, acc: { ...HERO_LOOK.acc }, outfit: { ...scanLook.look.outfit } };
  const colors = { ...scanLook.colors };
  if (game) {
    // Voxel-Double: your body, face and hair in the hero outfit; skin and hair snap to clean game tones
    look.outfit = { ...HERO_LOOK.outfit };
    for (const k of ['shirt', 'shorts', 'shoe']) colors[k] = HERO_COLORS[k];
    if (scanned) {
      // no hair found (or an unreliable hair mask) -> short hair, so the big chibi head never shows a bare crown
      if (look.hair.style === 'none' || look.hair.style == null) look.hair = { ...look.hair, style: 'short', profile: null };
      colors.skin = snapColor(colors.skin, SKIN_TONES);
      colors.hair = colors.brow = colors.beard = contrastHair(snapColor(colors.hair, HAIR_TONES), colors.skin);
    }
  } else if (scanned) look.acc = { glasses: false, chain: false, watch: false }; // realistic after a scan: true to life
  const m = manual.look;
  avatar.body.look = { ...look, ...m, hair: { ...look.hair, ...m.hair }, acc: { ...look.acc, ...m.acc }, outfit: { ...look.outfit, ...m.outfit } };
  avatar.body.colors = { ...colors, ...manual.colors };
}

// a control in "Individuell" changed: remember only that choice
function updateLook(e) {
  const id = e.target.id, m = manual.look;
  if (id in COLOR_INPUTS) {
    const c = parseInt($(id).value.slice(1), 16);
    manual.colors[COLOR_INPUTS[id]] = c;
    if (id === 'colHair') manual.colors.beard = manual.colors.brow = c; // beard and eyebrows follow the hair color
  } else if (id === 'hairStyle' || id === 'bangs') m.hair = { style: $('hairStyle').value, bangs: $('bangs').checked };
  else if (id === 'beard') m.beard = $('beard').value;
  else if (id === 'mustache') m.mustache = $('mustache').checked;
  else if (id.startsWith('acc')) m.acc = { ...m.acc, [{ accGlasses: 'glasses', accChain: 'chain', accWatch: 'watch' }[id]]: $(id).checked };
  else if (id === 'top') m.outfit = { ...m.outfit, top: $('top').value === 'none' ? 'none' : 'shirt', sleeves: { none: 'none', short: 'short', long: 'long', tank: 'none' }[$('top').value] };
  else if (id === 'bottoms') m.outfit = { ...m.outfit, bottoms: $('bottoms').value };
  else if (id === 'shoes') m.outfit = { ...m.outfit, shoes: $('shoes').checked };
  applyScans();
}
for (const id of ['hairStyle', 'beard', 'bangs', 'mustache', 'accGlasses', 'accChain', 'accWatch', 'top', 'bottoms', 'shoes', ...Object.keys(COLOR_INPUTS)]) $(id).addEventListener('change', updateLook);

// Accessory rail on the stage: each button drives its control in the Style tab (the control stays the truth)
let lastTop = 'short'; // the rail's shirt button toggles "Oben ohne" <-> the last worn top
function syncRail() {
  for (const b of document.querySelectorAll('.rail-btn')) {
    const el = $(b.dataset.for);
    b.setAttribute('aria-pressed', String(el.type === 'checkbox' ? el.checked : el.value !== 'none'));
  }
  if ($('top').value !== 'none') lastTop = $('top').value;
}
for (const b of document.querySelectorAll('.rail-btn')) {
  b.addEventListener('click', () => {
    const el = $(b.dataset.for);
    if (el.type === 'checkbox') el.checked = !el.checked;
    else el.value = el.value === 'none' ? lastTop : 'none';
    el.dispatchEvent(new Event('change'));
  });
}
for (const id of ['top', 'accGlasses', 'accChain', 'accWatch', 'shoes']) $(id).addEventListener('change', syncRail);
// Style: Voxel-Double (game look, chunky 2.8 cm cubes, bigger head) or realistic (fine 0.75 cm cubes)
function applyStyle() {
  avatar.style = $('style').value;
  setStage(avatar.style);
  $('voxel').value = avatar.style === 'game' ? '0.028' : '0.0075';
  composeLook(); // outfit / accessories / palette depend on the style
  showLook(avatar.body);
  updateComposition();
  if (progress) rebuildExtras();
}
$('style').addEventListener('change', applyStyle);
setStage($('style').value);
window.fitme = { runScan, applyScans, faceFit: () => faceFit, scene, camera, renderer, THREE, STAGES, setStage, avatarBox }; // for scripts (validate.mjs, checks)
applyScans(); // first build (defaults until a photo is scanned)
avatar.ready.then(() => applyScans()); // the body data (~9 MB) loads in the background

// ---------------------------------------------------------------------------
// Demo tour (~25 s): shows the idea without an own scan - scan -> voxel body -> change fat /
// muscle (definition, veins) -> muscle groups -> movement. Any touch on the 3D view stops it.
// ---------------------------------------------------------------------------
const setMode = (mode) => {
  animator.mode = mode;
  for (const b of document.querySelectorAll('#modes button')) b.classList.toggle('active', b.dataset.mode === mode);
};
// Screen box of the avatar in the stage (viewport px): top of the hair, feet, shoulders
// +-0.35 m. Used to keep captions and overlays off the avatar.
function avatarBox(av = avatar) {
  const rect = stage.getBoundingClientRect(), p = new THREE.Vector3();
  const head = av.joints.head ? av.joints.head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.6, 0);
  const x0 = av.root.position.x, shY = av.mesh ? (av.mesh.W.shoulderL[1] + av.mesh.W.shoulderR[1]) / 2 : 1.2;
  const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  // top: the top of the figure (big afro) when known, else head + 0.30 m
  const topY = av.topY != null ? av.topY + (head.y - av.bindHeadY) : head.y + 0.3;
  for (const w of [[head.x, topY, head.z], [head.x - 0.3, topY, head.z], [head.x + 0.3, topY, head.z], [x0, 0, 0], [x0 - 0.35, shY, 0], [x0 + 0.35, shY, 0], [x0 - 0.15, 0, 0.12], [x0 + 0.15, 0, 0.12]]) {
    p.set(...w).project(camera);
    const sx = rect.left + ((p.x + 1) / 2) * rect.width, sy = rect.top + ((1 - p.y) / 2) * rect.height;
    box.left = Math.min(box.left, sx); box.right = Math.max(box.right, sx); box.top = Math.min(box.top, sy); box.bottom = Math.max(box.bottom, sy);
  }
  return box;
}
// Demo: frame the avatar in the free space under the caption (pan the view up / down, pull back if needed)
function frameAvatar() {
  const cap = $('caption'), rect = stage.getBoundingClientRect();
  const topFree = cap.hidden ? rect.top + 56 : cap.getBoundingClientRect().bottom + 8, bottomFree = rect.bottom - 8;
  for (let i = 0; i < 40; i++) {
    camera.updateMatrixWorld(); controls.update();
    const b = avatarBox();
    const room = bottomFree - topFree, h = b.bottom - b.top;
    if (h > room) { // too big: pull back along the view direction
      camera.position.sub(controls.target).multiplyScalar(1.06).add(controls.target);
      continue;
    }
    const err = (b.top + b.bottom) / 2 - (topFree + bottomFree) / 2; // px, + = avatar too low
    if (Math.abs(err) < 2 && b.top >= topFree && b.bottom <= bottomFree) break;
    // world height per pixel at the target distance
    const dist = camera.position.distanceTo(controls.target);
    const wpp = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / rect.height;
    camera.position.y -= err * wpp; controls.target.y -= err * wpp;
  }
}
window.avatarBox = avatarBox;

function stopDemo() {
  if (!demo) return;
  demo = null;
  $('caption').hidden = true;
  camera.position.set(...CAM_HOME.pos); controls.target.set(...CAM_HOME.target);
  $('demoBtn').innerHTML = '<span class="long">▶ Demo: So funktioniert Fit-me</span><span class="short">▶ Demo</span>';
  $('demoBtn').classList.remove('running');
  avatar.root.rotation.y = 0;
  resetComp(); $('view').value = 'look'; // back to the start values (hero, or you after a scan)
  setMode('idle');
  updateComposition();
}
async function runDemo() {
  showTab('avatar'); // big stage for the tour
  leaveProgress();
  const token = { spin: true };
  demo = token;
  const alive = () => demo === token;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const say = (t) => { $('caption').textContent = t; $('caption').hidden = false; frameAvatar(); };
  const kfa = () => (avatar.fat ? ` (Körperfett ≈ ${avatar.fat.percent.toFixed(0)} %)` : '');
  // slide fat / muscle smoothly (coarse cubes while moving, full detail at the end)
  const tween = async (fat, muscle, ms) => {
    const f0 = Number($('fat').value), m0 = Number($('muscle').value);
    for (let i = 1; i <= 8 && alive(); i++) {
      $('fat').value = Math.round(f0 + ((fat - f0) * i) / 8);
      $('muscle').value = Math.round(m0 + ((muscle - m0) * i) / 8);
      updateComposition(i < 8);
      await wait(ms / 8);
    }
  };
  $('demoBtn').innerHTML = '■ Demo beenden';
  $('demoBtn').classList.add('running');
  camera.position.set(...CAM_HOME.pos); controls.target.set(...CAM_HOME.target);
  const steps = [
    async () => { say('Fit-me macht aus 2 Handyfotos deinen 3D-Körper – Würfel für Würfel. Alles wird auf deinem Gerät berechnet, nichts hochgeladen.'); await wait(5000); },
    async () => { say('Weniger Körperfett, mehr Muskeln …'); await tween(-80, 80, 2400); say('Weniger Körperfett, mehr Muskeln: ' + (avatar.style === 'game' ? 'Muskeldefinition wird sichtbar' : 'Muskeldefinition und Adern werden sichtbar') + kfa() + '.'); await wait(3500); },
    async () => { say('… und so mit mehr Körperfett.'); await tween(70, 0, 2400); say('… und so mit mehr Körperfett' + kfa() + '.'); await wait(2500); },
    async () => { $('fat').value = 0; $('muscle').value = 40; $('view').value = 'groups'; updateComposition(); say('Jede Muskelgruppe einzeln: sieh, welche Muskeln dein Training aufbaut.'); await wait(4000); },
    async () => { $('view').value = 'look'; $('muscle').value = 20; updateComposition(); token.spin = false; avatar.root.rotation.y = 0; setMode('walk'); say('Dein Avatar bewegt sich: Gehen …'); await wait(3000); setMode('squat'); say('… Kniebeuge.'); await wait(3800); },
    async () => { setMode('idle'); say('Jetzt du: Fotos aufnehmen unter „Scan“ – dein eigener Voxel-Körper in Sekunden.'); await wait(4000); },
  ];
  for (const step of steps) { if (!alive()) return; await step(); }
  if (alive()) stopDemo();
}
$('demoBtn').addEventListener('click', () => (demo ? stopDemo() : runDemo()));
stage.addEventListener('pointerdown', (e) => { if (demo && e.target === renderer.domElement) stopDemo(); });
window.fitme.runDemo = runDemo;
