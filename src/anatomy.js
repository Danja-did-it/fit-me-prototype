// Anatomy data: the body is built from smooth 3D shapes that are blended together.
//
//   base shapes  - skeleton-like volumes (pelvis, rib cage, limbs, skull, hands, feet)
//   muscles      - one ellipsoid "muscle belly" per muscle, stretched from origin (a) to
//                  insertion (b), bulging in the direction `out`. Width w, thickness th.
//   fat depots   - soft regions where fat is stored (belly, love handles, hips ...)
//
// Every shape belongs to a bone (joint name in avatar.js) and is given in that bone's
// local coordinates: the joint is at the origin, limbs point down (-y), +z is the front,
// +x is the outside for left limbs (right limbs are mirrored automatically).
// Units: meters. `s` scales everything to the person's height.
//
// Fiber types: `slow` = share of slow-twitch (type I, "red", endurance) fibers,
// the rest is fast-twitch (type II, "white", strength/speed). Rough averages from
// biopsy/autopsy studies (e.g. Johnson et al. 1973). They differ a lot between people.

// Muscle groups (per-group sliders and the "Muskelgruppen" view)
export const GROUPS = {
  neck:       { label: 'Nacken / Trapez', color: 0x8e5bd6 },
  shoulders:  { label: 'Schultern', color: 0xf06292 },
  chest:      { label: 'Brust', color: 0xe53935 },
  back:       { label: 'Rücken', color: 0x3949ab },
  abs:        { label: 'Bauch', color: 0xffb300 },
  biceps:     { label: 'Bizeps', color: 0x43a047 },
  triceps:    { label: 'Trizeps', color: 0x00897b },
  forearms:   { label: 'Unterarme', color: 0x7cb342 },
  glutes:     { label: 'Po', color: 0xd81b60 },
  quads:      { label: 'Oberschenkel vorn', color: 0x1e88e5 },
  hamstrings: { label: 'Oberschenkel hinten', color: 0x5e35b1 },
  adductors:  { label: 'Adduktoren', color: 0x26c6da },
  calves:     { label: 'Waden', color: 0xfb8c00 },
};

// Muscles: German name, group, slow-twitch share
export const MUSCLES = {
  trapezius:     { name: 'Trapezmuskel', group: 'neck', slow: 0.54 },
  sternocleido:  { name: 'Kopfwender', group: 'neck', slow: 0.35 },
  deltoid:       { name: 'Deltamuskel', group: 'shoulders', slow: 0.55 },
  pectoralis:    { name: 'Großer Brustmuskel', group: 'chest', slow: 0.42 },
  serratus:      { name: 'Sägemuskel', group: 'chest', slow: 0.50 },
  latissimus:    { name: 'Breiter Rückenmuskel', group: 'back', slow: 0.50 },
  erector:       { name: 'Rückenstrecker', group: 'back', slow: 0.60 },
  rectusAbd:     { name: 'Gerader Bauchmuskel', group: 'abs', slow: 0.46 },
  obliques:      { name: 'Schräge Bauchmuskeln', group: 'abs', slow: 0.55 },
  biceps:        { name: 'Bizeps', group: 'biceps', slow: 0.42 },
  brachialis:    { name: 'Oberarmmuskel', group: 'biceps', slow: 0.50 },
  triceps:       { name: 'Trizeps', group: 'triceps', slow: 0.35 },
  flexors:       { name: 'Unterarmbeuger', group: 'forearms', slow: 0.50 },
  extensors:     { name: 'Unterarmstrecker', group: 'forearms', slow: 0.45 },
  gluteus:       { name: 'Großer Gesäßmuskel', group: 'glutes', slow: 0.60 },
  gluteusMed:    { name: 'Mittlerer Gesäßmuskel', group: 'glutes', slow: 0.55 },
  rectusFem:     { name: 'Gerader Schenkelmuskel', group: 'quads', slow: 0.40 },
  vastusLat:     { name: 'Äußerer Schenkelmuskel', group: 'quads', slow: 0.45 },
  vastusMed:     { name: 'Innerer Schenkelmuskel', group: 'quads', slow: 0.50 },
  hamstrings:    { name: 'Beinbeuger', group: 'hamstrings', slow: 0.55 },
  adductors:     { name: 'Adduktoren', group: 'adductors', slow: 0.55 },
  gastrocnemius: { name: 'Zwillingswadenmuskel', group: 'calves', slow: 0.50 },
  soleus:        { name: 'Schollenmuskel', group: 'calves', slow: 0.80 },
  tibialis:      { name: 'Vorderer Schienbeinmuskel', group: 'calves', slow: 0.73 },
};

// How strongly the fibers grow: [slow-twitch, fast-twitch] per training style.
// Strength training grows fast-twitch fibers most; endurance training grows little.
export const TRAINING = {
  strength:  { label: 'Kraft', w: [0.45, 1.0] },
  mixed:     { label: 'Gemischt', w: [0.65, 0.75] },
  endurance: { label: 'Ausdauer', w: [0.5, 0.2] },
};

// Growth of one muscle for the current sliders (0 = as scanned).
//   total = global muscle slider + group slider (both -1..+1)
export function muscleGain(muscle, comp) {
  const total = Math.max(-1, Math.min(1.5, comp.muscle + (comp.groups?.[muscle.group] || 0)));
  const s = muscle.slow, f = 1 - s;
  if (total >= 0) {
    const [ws, wf] = TRAINING[comp.training || 'mixed'].w;
    return total * 1.15 * (s * ws + f * wf);
  }
  // atrophy: fast-twitch fibers shrink first
  return total * 0.5 * (0.6 * s + f);
}

// ---------------------------------------------------------------------------
// Body parts from the skeleton measures `k` (see avatar.js: lengths L, widths, s, u)
// Shape records:
//   { bone, type: 'ell', c, r }                       axis-aligned ellipsoid
//   { bone, type: 'cone', a, b, ra, rb }              capsule with changing radius
//   { bone, type: 'muscle', m, a, b, out, w, th }     muscle belly
//   { bone, type: 'fat', c, r, amt }                  fat depot, amt = thickness in m at +100 %
// `sym: true` on a central bone = also mirrored to the right side of the body.
// ---------------------------------------------------------------------------
export function bodyParts(k) {
  const { s, u, L } = k;
  const S = (v) => v * s;
  const base = [], muscles = [], fat = [];
  const ell = (bone, c, r, sym) => base.push({ bone, type: 'ell', c, r, sym });
  const cone = (bone, a, b, ra, rb, sym) => base.push({ bone, type: 'cone', a, b, ra, rb, sym });
  const mus = (bone, m, a, b, out, w, th, sym) => muscles.push({ bone, type: 'muscle', m, a, b, out, w: S(w), th: S(th), sym });
  const dep = (bone, c, r, amt, sym) => fat.push({ bone, type: 'fat', c, r, amt: S(amt), sym });

  const hipR = k.hipR, waistR = k.waistR, chestZ = k.chestZ, bellyZ = k.bellyZ;
  const Lc = L.chest, Lb = L.belly;
  const shX = k.shoulderJointX;
  const ribX = Math.max(waistR * 1.08, k.shoulderR - S(0.095));
  const thR = k.thighR;

  // ---- pelvis (bone 'hips', origin = hip joint height, body center) ----
  ell('hips', [0, S(0.035), -S(0.005)], [hipR * 0.86, S(0.1), bellyZ * 0.88]);
  mus('hips', 'gluteus', [S(0.035), S(0.075), -bellyZ * 0.72], [hipR * 0.72, -S(0.085), -bellyZ * 0.5], [0.35, 0, -1], 0.08, 0.034, true);
  mus('hips', 'gluteusMed', [hipR * 0.62, S(0.085), -S(0.02)], [hipR * 0.88, -S(0.01), -S(0.025)], [1, 0.1, -0.2], 0.05, 0.025, true);
  dep('hips', [hipR * 0.45, -S(0.02), -bellyZ * 0.85], [S(0.1), S(0.1), S(0.07)], 0.035, true);   // buttocks
  dep('hips', [hipR * 0.95, S(0.0), -S(0.01)], [S(0.06), S(0.11), S(0.09)], 0.03, true);          // hips

  // ---- abdomen (bone 'spine', origin = hip joint height) ----
  ell('spine', [0, S(0.14) * u, S(0.004)], [waistR * 0.94, S(0.13) * u, bellyZ * 0.93]);
  mus('spine', 'rectusAbd', [S(0.034), S(0.04), bellyZ * 0.9], [S(0.04), Lb + S(0.05), bellyZ * 0.95], [0, 0, 1], 0.042, 0.014, true);
  mus('spine', 'obliques', [waistR * 0.8, S(0.05), S(0.03)], [waistR * 0.88, S(0.23) * u, S(0.04)], [1, 0, 0.45], 0.06, 0.02, true);
  mus('spine', 'erector', [S(0.03), S(0.02), -bellyZ * 0.82], [S(0.032), Lb + S(0.1), -chestZ * 0.85], [0, 0, -1], 0.028, 0.024, true);
  dep('spine', [0, S(0.12) * u, bellyZ * 0.75], [waistR * 0.95, S(0.16) * u, S(0.1)], 0.09);               // belly
  dep('spine', [waistR * 0.9, S(0.12) * u, -S(0.01)], [S(0.07), S(0.1) * u, S(0.1)], 0.045, true);         // love handles
  dep('spine', [0, S(0.13) * u, -bellyZ * 0.9], [waistR * 0.9, S(0.1) * u, S(0.05)], 0.025);              // lower back
  dep('spine', [0, S(0.07), S(0)], [waistR * 1.3, S(0.25) * u, bellyZ * 1.4], 0.012);                     // even layer

  // ---- rib cage + shoulder girdle (bone 'chest', origin = bottom of rib cage) ----
  ell('chest', [0, S(0.13) * u, -S(0.006)], [ribX, S(0.19) * u, chestZ * 0.92]);
  cone('chest', [S(0.02), Lc - S(0.025), S(0.005)], [shX, Lc - S(0.04), -S(0.005)], S(0.036), S(0.042), true);  // collarbone / shoulder
  mus('chest', 'pectoralis', [S(0.018), S(0.11) * u, chestZ * 0.84], [shX - S(0.035), Lc - S(0.065), S(0.042)], [0.25, -0.1, 1], 0.07, 0.027, true);
  mus('chest', 'serratus', [ribX * 0.93, S(0.04), S(0.035)], [ribX * 0.88, S(0.16) * u, S(0.03)], [1, 0, 0.25], 0.03, 0.012, true);
  mus('chest', 'latissimus', [waistR * 0.65, -S(0.02), -chestZ * 0.62], [shX - S(0.045), Lc - S(0.1), -S(0.035)], [0.75, 0, -0.65], 0.07, 0.024, true);
  mus('chest', 'trapezius', [S(0.012), Lc + S(0.075), -S(0.03)], [shX - S(0.03), Lc - S(0.005), -S(0.02)], [0, 1, -0.45], 0.042, 0.024, true);
  mus('chest', 'trapezius', [S(0.01), Lc - S(0.02), -chestZ * 0.84], [S(0.012), S(0.06) * u, -chestZ * 0.9], [0.2, 0, -1], 0.075, 0.012, true);
  mus('chest', 'erector', [S(0.03), S(0.0), -chestZ * 0.85], [S(0.028), Lc - S(0.03), -chestZ * 0.8], [0, 0, -1], 0.024, 0.016, true);
  dep('chest', [S(0.06), S(0.14) * u, chestZ * 0.9], [S(0.08), S(0.07), S(0.05)], 0.03, true);             // chest
  dep('chest', [0, S(0.02), bellyZ * 0.8], [waistR, S(0.09), S(0.08)], 0.05);                              // upper belly
  dep('chest', [ribX * 0.8, S(0.05), -chestZ * 0.6], [S(0.06), S(0.08), S(0.06)], 0.02, true);             // back rolls
  dep('chest', [0, S(0.14) * u, 0], [ribX * 1.4, S(0.28) * u, chestZ * 1.4], 0.01);                        // even layer

  // ---- neck (bone 'neck', origin = neck base) ----
  cone('neck', [0, -S(0.02), -S(0.008)], [0, L.neck + S(0.03), -S(0.012)], S(0.054), S(0.048));
  mus('neck', 'sternocleido', [S(0.012), S(0.0), S(0.035)], [S(0.042), L.neck + S(0.02), -S(0.012)], [0.55, 0, 1], 0.015, 0.012, true);
  dep('neck', [0, S(0.03), S(0.03)], [S(0.05), S(0.04), S(0.04)], 0.015);                                  // double chin

  // ---- head (bone 'head', origin = chin height) ----
  ell('head', [0, S(0.14), -S(0.012)], [S(0.075), S(0.095), S(0.095)]);          // skull
  ell('head', [0, S(0.07), S(0.024)], [S(0.058), S(0.07), S(0.07)]);             // face / jaw
  ell('head', [S(0.044), S(0.1), S(0.048)], [S(0.024), S(0.02), S(0.03)], true);  // cheekbones
  ell('head', [0, S(0.134), S(0.068)], [S(0.058), S(0.016), S(0.03)]);           // brow ridge
  ell('head', [0, S(0.098), S(0.094)], [S(0.012), S(0.026), S(0.018)]);          // nose
  ell('head', [S(0.078), S(0.118), -S(0.006)], [S(0.012), S(0.03), S(0.02)], true); // ears
  dep('head', [S(0.045), S(0.07), S(0.05)], [S(0.035), S(0.035), S(0.035)], 0.01, true); // cheeks

  // ---- upper arm (bone 'shoulder', arm points down) ----
  const Lu = L.upperArm;
  cone('shoulder', [0, S(0.01), 0], [0, -Lu, 0], S(0.038), S(0.031));
  ell('shoulder', [0, -Lu, -S(0.005)], [S(0.034), S(0.028), S(0.03)]);           // elbow
  mus('shoulder', 'deltoid', [S(0.012), S(0.03), 0], [S(0.022), -S(0.13), S(0.004)], [1, 0.15, 0], 0.048, 0.032);
  mus('shoulder', 'deltoid', [S(0.0), S(0.02), S(0.034)], [S(0.016), -S(0.1), S(0.028)], [0.4, 0.1, 1], 0.03, 0.024);
  mus('shoulder', 'deltoid', [S(0.0), S(0.02), -S(0.034)], [S(0.016), -S(0.1), -S(0.028)], [0.4, 0.1, -1], 0.03, 0.022);
  mus('shoulder', 'biceps', [S(0.0), -S(0.07), S(0.024)], [S(0.0), -Lu + S(0.04), S(0.027)], [0, 0, 1], 0.03, 0.027);
  mus('shoulder', 'brachialis', [S(0.024), -Lu * 0.55, S(0.01)], [S(0.02), -Lu + S(0.02), S(0.014)], [1, 0, 0.3], 0.02, 0.012);
  mus('shoulder', 'triceps', [S(0.0), -S(0.05), -S(0.027)], [S(0.0), -Lu + S(0.035), -S(0.029)], [0, 0, -1], 0.034, 0.028);
  mus('shoulder', 'triceps', [S(0.02), -S(0.06), -S(0.018)], [S(0.02), -Lu * 0.72, -S(0.02)], [0.7, 0, -0.7], 0.024, 0.02);
  dep('shoulder', [0, -Lu * 0.5, -S(0.03)], [S(0.04), Lu * 0.4, S(0.035)], 0.022);     // back of upper arm
  dep('shoulder', [0, -Lu * 0.5, 0], [S(0.06), Lu * 0.6, S(0.06)], 0.01);               // even layer

  // ---- forearm + hand (bone 'elbow') ----
  const Lf = L.forearmOnly;
  cone('elbow', [0, 0, 0], [0, -Lf, 0], S(0.034), S(0.021));
  mus('elbow', 'flexors', [-S(0.012), -S(0.02), S(0.018)], [-S(0.008), -Lf * 0.62, S(0.012)], [-0.6, 0, 0.8], 0.026, 0.021);
  mus('elbow', 'extensors', [S(0.021), S(0.0), S(0.01)], [S(0.014), -Lf * 0.6, S(0.0)], [1, 0, 0.1], 0.024, 0.021);
  ell('elbow', [0, -Lf - S(0.048), S(0.004)], [S(0.014), S(0.05), S(0.042)]);        // palm
  ell('elbow', [0, -Lf - S(0.125), S(0.008)], [S(0.011), S(0.045), S(0.037)]);       // fingers
  cone('elbow', [-S(0.004), -Lf - S(0.025), S(0.034)], [-S(0.012), -Lf - S(0.085), S(0.044)], S(0.011), S(0.009)); // thumb
  dep('elbow', [0, -Lf * 0.3, 0], [S(0.05), Lf * 0.4, S(0.05)], 0.008);

  // ---- thigh (bone 'hip') ----
  const Lt = L.thigh;
  cone('hip', [0, S(0.03), 0], [0, -Lt, 0], thR, thR * 0.6);
  ell('hip', [0, -Lt, S(0.008)], [S(0.048), S(0.045), S(0.048)]);                     // knee
  ell('hip', [0, -Lt + S(0.005), S(0.042)], [S(0.024), S(0.03), S(0.012)]);           // kneecap
  mus('hip', 'rectusFem', [S(0.0), -S(0.07), thR * 0.55], [S(0.0), -Lt + S(0.08), thR * 0.5], [0, 0, 1], 0.038, 0.03);
  mus('hip', 'vastusLat', [thR * 0.6, -S(0.1), S(0.004)], [thR * 0.5, -Lt + S(0.06), S(0.012)], [1, 0, 0.15], 0.044, 0.03);
  mus('hip', 'vastusMed', [-thR * 0.5, -Lt * 0.56, S(0.02)], [-thR * 0.42, -Lt + S(0.04), S(0.028)], [-0.75, 0, 0.65], 0.034, 0.03);
  mus('hip', 'hamstrings', [thR * 0.25, -S(0.08), -thR * 0.55], [thR * 0.25, -Lt + S(0.07), -thR * 0.45], [0.2, 0, -1], 0.03, 0.028);
  mus('hip', 'hamstrings', [-thR * 0.28, -S(0.08), -thR * 0.55], [-thR * 0.25, -Lt + S(0.07), -thR * 0.45], [-0.2, 0, -1], 0.03, 0.028);
  mus('hip', 'adductors', [-thR * 0.6, -S(0.04), S(0.0)], [-thR * 0.4, -Lt * 0.6, S(0.004)], [-1, 0, 0], 0.044, 0.028);
  dep('hip', [thR * 0.6, -S(0.08), -S(0.01)], [S(0.07), S(0.1), S(0.08)], 0.03);      // saddlebags
  dep('hip', [-thR * 0.6, -Lt * 0.35, S(0.0)], [S(0.05), Lt * 0.3, S(0.06)], 0.025);  // inner thigh
  dep('hip', [0, -Lt * 0.45, 0], [thR * 1.4, Lt * 0.6, thR * 1.4], 0.012);            // even layer

  // ---- lower leg (bone 'knee') ----
  const Lk = L.calf;
  cone('knee', [0, 0, 0], [0, -Lk, 0], S(0.044), S(0.026));
  ell('knee', [0, -Lk, 0], [S(0.03), S(0.03), S(0.03)]);                              // ankle
  mus('knee', 'gastrocnemius', [-S(0.017), -S(0.035), -S(0.03)], [-S(0.012), -S(0.2), -S(0.024)], [-0.35, 0, -1], 0.026, 0.027);
  mus('knee', 'gastrocnemius', [S(0.017), -S(0.045), -S(0.03)], [S(0.012), -S(0.19), -S(0.024)], [0.35, 0, -1], 0.024, 0.023);
  mus('knee', 'soleus', [S(0.0), -S(0.11), -S(0.024)], [S(0.0), -Lk + S(0.07), -S(0.02)], [0, 0, -1], 0.036, 0.016);
  mus('knee', 'tibialis', [S(0.017), -S(0.04), S(0.028)], [S(0.01), -Lk + S(0.06), S(0.028)], [0.3, 0, 1], 0.016, 0.014);
  dep('knee', [0, -Lk * 0.35, -S(0.01)], [S(0.05), Lk * 0.35, S(0.05)], 0.01);

  // ---- foot (bone 'ankle', origin = ankle joint) ----
  ell('ankle', [S(0.004), -L.foot + S(0.034), S(0.055)], [S(0.043), S(0.034), S(0.125)]);
  ell('ankle', [0, -L.foot + S(0.032), -S(0.03)], [S(0.034), S(0.032), S(0.036)]);   // heel

  return { base, muscles, fat };
}
