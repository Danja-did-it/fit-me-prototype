// Anatomy data: where muscles and fat depots sit on each body segment,
// how thick they are, and their fiber-type mix.
//
// Each body segment is a tube (see avatar.js). A muscle is a "bump" on that tube:
//   t: [center, halfLength]   position along the segment, 0 = at the joint, 1 = far end
//                             (torso: 0 = pelvis/waist below, 1 = top)
//   a: [centerDeg, halfWidthDeg]  position around the segment:
//                             0 = front, 90 = outside (left side of body), 180 = back,
//                             -90 = inside (limbs) / other side (torso)
//   h: thickness as a fraction of the local base radius
//   sym: true -> also mirrored to the other side (-a), used for paired torso muscles
// Limbs are described for the LEFT side; the right side is mirrored automatically.
//
// Fiber types: `slow` = share of slow-twitch (type I, "red", endurance) fibers.
// The rest is fast-twitch (type II, "white", strength/speed). Values are rough
// averages from biopsy/autopsy studies (e.g. Johnson et al. 1973); they vary a lot
// between people, so treat them as illustrative.

// Muscle groups (used for the per-group sliders and the "Muskelgruppen" view)
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
  rectusFem:     { name: 'Gerader Schenkelmuskel', group: 'quads', slow: 0.40 },
  vastusLat:     { name: 'Äußerer Schenkelmuskel', group: 'quads', slow: 0.45 },
  vastusMed:     { name: 'Innerer Schenkelmuskel', group: 'quads', slow: 0.50 },
  hamstrings:    { name: 'Beinbeuger', group: 'hamstrings', slow: 0.55 },
  adductors:     { name: 'Adduktoren', group: 'adductors', slow: 0.55 },
  gastrocnemius: { name: 'Zwillingswadenmuskel', group: 'calves', slow: 0.50 },
  soleus:        { name: 'Schollenmuskel', group: 'calves', slow: 0.80 },
  tibialis:      { name: 'Vorderer Schienbeinmuskel', group: 'calves', slow: 0.73 },
};

// Muscle bumps per segment
export const SEGMENT_MUSCLES = {
  neck: [
    { m: 'trapezius', t: [0.3, 0.8], a: [150, 70], h: 0.35, sym: true },
    { m: 'sternocleido', t: [0.5, 0.6], a: [40, 22], h: 0.14, sym: true },
  ],
  chest: [
    { m: 'pectoralis', t: [0.74, 0.28], a: [34, 40], h: 0.17, sym: true },
    { m: 'rectusAbd', t: [0.12, 0.3], a: [0, 24], h: 0.05 },
    { m: 'serratus', t: [0.45, 0.3], a: [82, 22], h: 0.05, sym: true },
    { m: 'latissimus', t: [0.5, 0.48], a: [128, 38], h: 0.13, sym: true },
    { m: 'trapezius', t: [0.8, 0.4], a: [180, 60], h: 0.12 },
    { m: 'erector', t: [0.3, 0.5], a: [168, 14], h: 0.06, sym: true },
  ],
  belly: [
    { m: 'rectusAbd', t: [0.55, 0.5], a: [0, 26], h: 0.07 },
    { m: 'obliques', t: [0.6, 0.5], a: [75, 45], h: 0.06, sym: true },
    { m: 'erector', t: [0.55, 0.55], a: [166, 16], h: 0.09, sym: true },
    { m: 'gluteus', t: [0.05, 0.3], a: [150, 42], h: 0.16, sym: true },
  ],
  upperArm: [
    { m: 'deltoid', t: [0.1, 0.38], a: [90, 130], h: 0.45 },
    { m: 'biceps', t: [0.56, 0.34], a: [0, 55], h: 0.34 },
    { m: 'brachialis', t: [0.78, 0.16], a: [55, 35], h: 0.12 },
    { m: 'triceps', t: [0.45, 0.45], a: [180, 65], h: 0.34 },
  ],
  forearm: [
    { m: 'flexors', t: [0.25, 0.25], a: [-35, 60], h: 0.28 },
    { m: 'extensors', t: [0.2, 0.24], a: [110, 60], h: 0.26 },
  ],
  thigh: [
    { m: 'gluteus', t: [0.0, 0.2], a: [175, 70], h: 0.35 },
    { m: 'rectusFem', t: [0.5, 0.42], a: [5, 32], h: 0.2 },
    { m: 'vastusLat', t: [0.5, 0.42], a: [72, 38], h: 0.18 },
    { m: 'vastusMed', t: [0.84, 0.16], a: [-45, 32], h: 0.16 },
    { m: 'hamstrings', t: [0.5, 0.42], a: [180, 60], h: 0.24 },
    { m: 'adductors', t: [0.3, 0.3], a: [-95, 45], h: 0.2 },
  ],
  calf: [
    { m: 'gastrocnemius', t: [0.28, 0.25], a: [150, 34], h: 0.36 },
    { m: 'gastrocnemius', t: [0.28, 0.25], a: [-150, 34], h: 0.36 },
    { m: 'soleus', t: [0.55, 0.3], a: [180, 85], h: 0.2 },
    { m: 'tibialis', t: [0.35, 0.3], a: [30, 28], h: 0.12 },
  ],
};

// Fat depots per segment (same format, no muscle id). `all` = even layer everywhere.
export const SEGMENT_FAT = {
  neck: { all: 0.12, depots: [{ t: [0.2, 0.3], a: [0, 60], h: 0.2 }] },           // double chin
  chest: { all: 0.1, depots: [
    { t: [0.66, 0.24], a: [30, 45], h: 0.22, sym: true },                       // chest
    { t: [0.05, 0.35], a: [0, 75], h: 0.4 },                                    // upper belly (continues the belly)
    { t: [0.05, 0.3], a: [95, 45], h: 0.18, sym: true },                        // sides
    { t: [0.3, 0.3], a: [120, 50], h: 0.12, sym: true },                        // back rolls
  ] },
  belly: { all: 0.12, depots: [
    { t: [0.55, 0.65], a: [0, 80], h: 0.55 },                                   // belly
    { t: [0.45, 0.45], a: [95, 45], h: 0.28, sym: true },                       // love handles
    { t: [0.1, 0.25], a: [160, 45], h: 0.25, sym: true },                       // buttocks
  ] },
  upperArm: { all: 0.16, depots: [{ t: [0.45, 0.4], a: [180, 70], h: 0.35 }] },  // back of upper arm
  forearm: { all: 0.08, depots: [] },
  thigh: { all: 0.14, depots: [
    { t: [0.1, 0.25], a: [100, 50], h: 0.3 },                                   // hips / saddlebags
    { t: [0.12, 0.25], a: [175, 60], h: 0.3 },                                  // buttocks
    { t: [0.35, 0.35], a: [-90, 45], h: 0.25 },                                 // inner thigh
  ] },
  calf: { all: 0.08, depots: [] },
  head: { all: 0.06, depots: [{ t: [0.25, 0.2], a: [60, 50], h: 0.08, sym: true }] }, // cheeks
};

// How strongly the fibers grow: [slow-twitch, fast-twitch] per training style.
// Strength training grows fast-twitch fibers most; endurance training grows little.
export const TRAINING = {
  strength:  { label: 'Kraft', w: [0.45, 1.0] },
  mixed:     { label: 'Gemischt', w: [0.65, 0.75] },
  endurance: { label: 'Ausdauer', w: [0.5, 0.2] },
};

// Muscle "definition" shown at slider 0 (share of a bump's thickness that is already there)
export const BASE_DEFINITION = 0.35;

// Growth of one muscle for the current sliders.
//   total = global muscle slider + group slider (both -1..+1)
export function muscleGain(muscle, comp) {
  const total = Math.max(-1, Math.min(1.5, comp.muscle + (comp.groups?.[muscle.group] || 0)));
  const s = muscle.slow, f = 1 - s;
  if (total >= 0) {
    const [ws, wf] = TRAINING[comp.training || 'mixed'].w;
    // 2.2 = at +100 % a muscle belly gets up to ~2x its base thickness (untrained -> very muscular)
    return total * 2.2 * (s * ws + f * wf);
  }
  // atrophy: fast-twitch fibers shrink first; never below "no muscle relief"
  return Math.max(-BASE_DEFINITION, total * 0.35 * (0.6 * s + f));
}

// Smooth bump: 1 in the center, 0 at the edge (and beyond)
export function bump(t, angleDeg, b, mirrorA = false) {
  const dt = (t - b.t[0]) / b.t[1];
  if (dt <= -1 || dt >= 1) return 0;
  const center = mirrorA ? -b.a[0] : b.a[0];
  let da = angleDeg - center;
  da = ((da + 540) % 360) - 180; // wrap to -180..180
  const dn = da / b.a[1];
  if (dn <= -1 || dn >= 1) return 0;
  const ft = 1 - dt * dt, fa = 1 - dn * dn;
  return ft * ft * fa * fa; // soft, muscle-belly-like falloff
}
