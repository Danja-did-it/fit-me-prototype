// Anatomy data: muscle groups, muscles with their fiber-type mix, training styles.
// (Since v9 the body shape itself comes from the MakeHuman model, see human.js / avatar.js;
// the hand-built shapes of v3-v8 are in the git tags v3 ... v8.)
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
