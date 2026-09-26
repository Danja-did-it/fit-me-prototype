// Spoken instructions for the camera scan (so you can scan yourself from 2-3 m away).
// Uses the browser's own speech (Web Speech API, works offline on iPhone) with a German
// female voice, set slightly higher and even ("robot" style), plus a short two-tone beep
// before each instruction. Nothing is sent anywhere.
let voice = null, enabled = true, audio = null, lastText = '', lastAt = 0;

function pickVoice() {
  const all = window.speechSynthesis?.getVoices() || [];
  const de = all.filter((v) => /^de/i.test(v.lang));
  const female = /anna|helena|petra|marlene|vicki|katja|hedda|sandy|shelley|flo|female|frau|weiblich/i;
  voice = de.find((v) => female.test(v.name)) || de[0] || null;
}
if (window.speechSynthesis) { pickVoice(); speechSynthesis.addEventListener?.('voiceschanged', pickVoice); }

export const setVoiceEnabled = (on) => { enabled = on; if (!on) window.speechSynthesis?.cancel(); };

// Call from a tap (iPhone only allows sound after a user gesture)
export function unlockAudio() {
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { audio = null; }
  if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); }
}

function tone(freqs, dur = 0.07, type = 'square', vol = 0.05) {
  if (!audio || !enabled) return;
  let t = audio.currentTime;
  for (const f of freqs) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
    t += dur + 0.02;
  }
}
export const beep = () => tone([880, 1320]);
export const shutterSound = () => tone([2400, 1800], 0.04, 'triangle', 0.12);

// Say a sentence. The same sentence is not repeated within 4 s (unless force).
export function speak(text, { force = false, withBeep = true } = {}) {
  if (!enabled || !window.speechSynthesis || !text) return;
  const clean = text.replace(/\(.*?\)/g, '').replace(/[✓📸–]/g, ' ').trim();
  const now = performance.now();
  if (!force && clean === lastText && now - lastAt < 4000) return;
  lastText = clean; lastAt = now;
  speechSynthesis.cancel();
  if (withBeep) beep();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'de-DE';
  if (voice) u.voice = voice;
  u.pitch = 1.3; u.rate = 1.0; // a bit higher and even: friendly robot voice
  speechSynthesis.speak(u);
}
export const speaking = () => !!window.speechSynthesis?.speaking;
