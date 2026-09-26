// Entry point: sets up the Three.js scene, camera, lights and render loop.
import * as THREE from 'three';
import './mplog.js'; // quiet MediaPipe status lines
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Avatar, HAIR_STYLES } from './avatar.js';
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
// soft studio light from all sides (image based lighting, like a photo studio), neutral colors
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4440, 0.3));
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

let demo = null; // running demo tour (see runDemo)

// Render loop
renderer.setAnimationLoop(() => {
  const now = performance.now();
  if (demo?.spin) avatar.root.rotation.y += Math.min((now - lastTime) / 1000, 0.1) * 0.7; // demo: turn slowly
  animator.update(Math.min((now - lastTime) / 1000, 0.1)); // seconds; capped after tab switches
  avatar.updateSkin(); // joint movement -> GPU skinning of the cubes
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

// All scans: several photos per view. front = front + back photos (widths, lengths),
// side = left + right photos (depths). Every measurement uses the median of all photos.
export const scans = { front: [], side: [], face: null, outfit: null };
const tips = {};
window.scans = scans;
const VIEW_NAMES = { front: 'Front', back: 'Rücken', side: 'Seite' };

async function runScan(view, image, { apply = true } = {}) {
  setStatus('Analysiere ' + VIEW_NAMES[view] + ' … (erstes Mal lädt die Modelle)');
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
          scans.face = scan.face; drawFace($('prevFace'), scan.face); manual = {};
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
  applyScans();
  setStatus('Aufnahmen gelöscht.');
});

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

function applyScans() {
  const h = Math.min(220, Math.max(120, Number(heightInput.value) || 175)) / 100;
  const body = bodyFromScans(scans, h);
  // manual choices in "Individuell" win over the scan
  body.look = { ...body.look, ...manual.look, hair: { ...body.look.hair, ...manual.look?.hair }, outfit: { ...body.look.outfit, ...manual.look?.outfit } };
  body.colors = { ...body.colors, ...manual.colors };
  avatar.body = body;
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
    // body fat estimate from the model's girths (US Navy formula) - veins show when it is low
    const f = avatar.fat, pct = f ? f.percent.toFixed(1).replace('.', ',') : null;
    const lean = f && f.percent - (1 - avatar.person.gender) * 8 - 1.5 * Math.max(0, avatar.composition.muscle);
    $('kfa').textContent = f ? `Körperfettanteil ≈ ${pct} % (Schätzung aus Hals-, Taillen- und Hüftumfang, Navy-Formel)` +
      (lean <= 16 ? ` · Adern sichtbar${lean <= 9 ? ' (deutlich)' : ''}` : ' · Adern ab niedrigem KFA') : '';
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
  const o = L.outfit;
  $('top').value = o.top === 'none' ? 'none' : o.sleeves === 'long' ? 'long' : o.sleeves === 'none' ? 'tank' : 'short';
  $('bottoms').value = o.bottoms;
  $('shoes').checked = !!o.shoes;
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
window.fitme = { runScan, applyScans, faceFit: () => faceFit, scene, camera, renderer, THREE }; // for scripts/validate.mjs
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
function stopDemo() {
  if (!demo) return;
  demo = null;
  $('caption').hidden = true;
  $('demoBtn').textContent = '▶ Demo: So funktioniert Fit-me';
  $('demoBtn').classList.remove('running');
  avatar.root.rotation.y = 0;
  $('fat').value = 0; $('muscle').value = 0; $('view').value = 'look';
  setMode('idle');
  updateComposition();
}
async function runDemo() {
  const token = { spin: true };
  demo = token;
  const alive = () => demo === token;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const say = (t) => { $('caption').textContent = t; $('caption').hidden = false; };
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
  $('demoBtn').textContent = '■ Demo beenden';
  $('demoBtn').classList.add('running');
  camera.position.set(0, 1.15, 3.6); controls.target.set(0, 0.95, 0);
  const steps = [
    async () => { say('Fit-me macht aus 2 Handyfotos deinen 3D-Körper – Würfel für Würfel. Alles wird auf deinem Gerät berechnet, nichts hochgeladen.'); await wait(5000); },
    async () => { say('Weniger Körperfett, mehr Muskeln …'); await tween(-80, 80, 2400); say('Weniger Körperfett, mehr Muskeln: Muskeldefinition und Adern werden sichtbar' + kfa() + '.'); await wait(3500); },
    async () => { say('… und so mit mehr Körperfett.'); await tween(70, 0, 2400); say('… und so mit mehr Körperfett' + kfa() + '.'); await wait(2500); },
    async () => { $('fat').value = 0; $('muscle').value = 40; $('view').value = 'groups'; updateComposition(); say('Jede Muskelgruppe einzeln: sieh, welche Muskeln dein Training aufbaut.'); await wait(4000); },
    async () => { $('view').value = 'look'; $('muscle').value = 20; updateComposition(); token.spin = false; avatar.root.rotation.y = 0; setMode('walk'); say('Dein Avatar bewegt sich: Gehen …'); await wait(3000); setMode('squat'); say('… Kniebeuge.'); await wait(3800); },
    async () => { setMode('idle'); say('Jetzt du: Fotos aufnehmen unter „1 · Körper scannen“ – dein eigener Voxel-Körper in Sekunden.'); await wait(4000); },
  ];
  for (const step of steps) { if (!alive()) return; await step(); }
  if (alive()) stopDemo();
}
$('demoBtn').addEventListener('click', () => (demo ? stopDemo() : runDemo()));
stage.addEventListener('pointerdown', (e) => { if (demo && e.target === renderer.domElement) stopDemo(); });
window.fitme.runDemo = runDemo;
