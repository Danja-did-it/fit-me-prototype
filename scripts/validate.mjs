// Accuracy test for the scan: creates virtual people with KNOWN measurements,
// "photographs" them like a phone (front + side, camera at hip height, 3 m away),
// runs the full scan pipeline on those images and compares the result in cm.
// Usage: node scripts/validate.mjs [url] [people=4]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
const people = Number(process.argv[3] || 4);
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.avatar?.H, null, { timeout: 60000 });

const result = await page.evaluate(async (people) => {
  const { runScan, applyScans, scene, camera, renderer } = window.fitme;
  const av = window.avatar;
  const { measureModel } = await import('/src/fit.js');
  const { THREE } = window.fitme;
  const KEYS = ['shoulderWidth', 'waistWidth', 'hipWidth', 'thighWidth', 'calfWidth', 'upperArmWidth', 'neckWidth', 'legLength', 'armLength', 'chestDepth', 'bellyDepth'];
  // deterministic "random" people
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const photo = (rotY) => {
    // phone-like camera: 3 m away at hip height, portrait 9:16, ~65 deg vertical field of view
    const cam = new THREE.PerspectiveCamera(63, 9 / 16, 0.1, 20);
    cam.position.set(0, 0.95, 3.0); cam.lookAt(0, 0.9, 0);
    av.root.rotation.y = rotY;
    av.updateSkin();
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setSize(720, 1280, false);
    renderer.render(scene, cam);
    const c = document.createElement('canvas'); c.width = 720; c.height = 1280;
    c.getContext('2d').drawImage(renderer.domElement, 0, 0, 720, 1280);
    renderer.setSize(size.x, size.y, false);
    av.root.rotation.y = 0;
    return c;
  };
  const rows = [], cal = {};
  for (let n = 0; n < people; n++) {
    // 1. truth body
    const gender = n % 2 ? 0 : 1, height = 1.6 + rnd() * 0.3;
    document.getElementById('gender').value = String(gender);
    document.getElementById('height').value = String(Math.round(height * 100));
    window.scans.front.length = 0; window.scans.side.length = 0; window.scans.face = null; window.scans.outfit = null;
    applyScans(); // neutral person with this gender/height
    const local = {};
    for (const t of ['torso/measure-waist-circ', 'torso/measure-hips-circ', 'torso/measure-shoulder-dist', 'legs/measure-thigh-circ', 'stomach/stomach-pregnant', 'arms/measure-upperarm-circ'])
      local[t] = (rnd() - 0.5) * 1.2;
    av.fit = { weight: 0.25 + rnd() * 0.5, muscle: 0.25 + rnd() * 0.5, local, face: {} };
    av.body.look = { ...av.body.look, outfit: { top: 'none', sleeves: 'none', bottoms: 'short', shoes: false } };
    av.build();
    const truthFit = JSON.parse(JSON.stringify(av.fit));
    const truthShape = av.shape(), truthW = truthShape.W;
    const truth = measureModel(av, truthShape);
    // photos in the pose of the scan guide: arms ~25 deg away from the body
    av.poseSpread = 0.44; av.build();
    const front = photo(0), side = photo(-Math.PI / 2);
    av.poseSpread = undefined;
    // 2. scan these photos with the normal pipeline
    await runScan('front', front);
    await runScan('side', side);
    // landmark calibration: where MediaPipe puts its points vs. the model's joints (share of height)
    {
      const sc = window.scans.front[0], m = sc.mask;
      let top = -1, bottom = -1;
      for (let y = 0; y < m.height; y++) { let c = 0; for (let x = 0; x < m.width; x++) if (m.data[y * m.width + x] > 0.5) c++; if (c > 2) { if (top < 0) top = y; bottom = y; } }
      const k = height / (bottom - top), W = truthW;
      const lmY = (i) => (bottom - sc.landmarks[i].y * m.height) * k;
      const lmX = (i) => (sc.landmarks[i].x * m.width - m.width / 2) * k;
      const J = { 11: 'shoulderL', 23: 'hipL', 25: 'kneeL', 27: 'ankleL', 13: 'elbowL', 15: 'handL' };
      for (const [i, j] of Object.entries(J)) {
        // MediaPipe "left" = person's left = our L side (+x); average both sides
        const i2 = +i + 1, j2 = j.replace('L', 'R');
        const dy = ((lmY(+i) - W[j][1]) + (lmY(i2) - W[j2][1])) / 2 / height;
        (cal[j] ||= []).push(+dy.toFixed(4));
      }
    }
    const fitted = measureModel(av, av.shape());
    if (n === 0) { // which measurement pulls the legs? error terms with fitted legs vs. legs = 0
      const tgt = av.body, keysAll = ['legLength', 'pTorso', 'pTorsoD', 'pThigh', 'pCalf', 'pThighD', 'pCalfD', 'hipWidth', 'thighWidth', 'calfWidth', 'waistWidth', 'shoulderWidth'];
      const errs = () => { const m = measureModel(av, av.shape()); const o = {};
        for (const k of keysAll) { if (k.startsWith('p')) { const T = tgt.profile?.[k] || []; let e = 0, c = 0; T.forEach((t, i) => { if (t > 0 && m[k][i] > 0) { e += ((m[k][i] - t) / t) ** 2; c++; } }); o[k] = c ? +(1000 * e / c).toFixed(2) : 0; } else o[k] = +(1000 * ((m[k] - tgt[k]) / tgt[k]) ** 2).toFixed(2); }
        return o; };
      const fitLocal = { ...av.fit.local }, save = av.poseSpread, saveL = av.poseLegSpread;
      av.poseSpread = tgt.armAngle; av.poseLegSpread = tgt.legAngle;
      const eFit = errs();
      av.fit.local = { ...fitLocal, 'legs/measure-upperleg-height': 0, 'legs/measure-lowerleg-height': 0 };
      const eZero = errs();
      av.fit.local = fitLocal; av.poseSpread = save; av.poseLegSpread = saveL;
      const f = (a) => (a || []).map((v) => Math.round(v * 1000) / 10).join(' ');
      av.fit.local = { ...fitLocal, 'legs/measure-upperleg-height': 0, 'legs/measure-lowerleg-height': 0 };
      av.poseSpread = tgt.armAngle; av.poseLegSpread = tgt.legAngle;
      const m0 = measureModel(av, av.shape());
      av.fit.local = fitLocal; av.poseSpread = save; av.poseLegSpread = saveL;
      window.__legDebug = { eFit, eZero, photo: { thigh: f(tgt.profile.pThigh), calf: f(tgt.profile.pCalf), legAngle: tgt.legAngle }, truthModel: { thigh: f(m0.pThigh), calf: f(m0.pCalf) } };
    }
    const row = { gender: gender ? 'm' : 'f', height: Math.round(height * 100) };
    for (const k of KEYS) row[k] = +((fitted[k] - truth[k]) * 100).toFixed(1);
    for (const k of ['legLength', 'hipWidth', 'thighWidth', 'upperArmWidth']) row['photo_' + k] = +((window.avatar.body[k] - truth[k]) * 100).toFixed(1);
    row.fitLegs = +(av.fit.local['legs/measure-upperleg-height'] || 0).toFixed(2); row.fitW = +av.fit.weight.toFixed(2); row.trueW = +truthFit.weight.toFixed(2);
    rows.push(row);
  }
  // mean absolute error per measurement
  const mae = {};
  for (const k of KEYS) mae[k] = +(rows.reduce((s, r) => s + Math.abs(r[k]), 0) / rows.length).toFixed(1);
  const calib = {}; for (const [j, v] of Object.entries(cal)) calib[j] = +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(4);
  return { rows, mae, calib, legDebug: window.__legDebug };
}, people);

console.log('error (fitted - true) in cm per person:');
console.table(result.rows);
console.log('mean absolute error (cm):', result.mae);
console.log('leg debug', JSON.stringify(result.legDebug.photo), JSON.stringify(result.legDebug.truthModel));
console.log('landmark height offset (MediaPipe - joint, share of body height):', result.calib);
if (errors.length) console.log('page errors:', errors);
await browser.close();
