// sound.js — ambient drone via Web Audio API
// Eno-inspired: fundamental drones + harmonic overtones + spatial delay network.
// Zone-aware: tonal character shifts as you move between eras.

const Sound = (() => {
  let audioCtx   = null;
  let masterGain = null;
  let filter     = null;
  let delay1, delay2, fb1Gain, fb2Gain, wetGain;
  let harmGain;
  let oscs       = [];  // { osc, lfo, lfoGain }
  let harmOscs   = [];  // { osc }
  let muted      = false;
  let started    = false;
  let currentZone = null;

  // Zone tonal profiles.
  // freqs: fundamental pair (slightly detuned for natural beating)
  // harmFreqs: overtone pair (octave or fifth above, much quieter)
  // lfoDepth: vibrato depth in Hz (breathes, not vibrates)
  // delayFb: feedback depth for spatial reverb tail
  const ZONE_PROFILES = {
    cosmic: {
      freqs:      [54.80, 55.12],
      harmFreqs:  [109.60, 164.72],  // octave + fifth
      filterFreq: 750,
      filterQ:    0.38,
      lfoRate:    0.07,
      lfoDepth:   0.20,
      gain:       0.034,
      delayFb:    0.44,              // long reverb tail = vast space
    },
    geological: {
      freqs:      [51.95, 52.38],    // lower, heavier, older
      harmFreqs:  [103.90, 155.85],
      filterFreq: 480,
      filterQ:    1.30,
      lfoRate:    0.06,
      lfoDepth:   0.25,
      gain:       0.038,
      delayFb:    0.40,
    },
    ancient: {
      freqs:      [55.80, 56.20],    // slightly warmer, human scale
      harmFreqs:  [111.60, 167.55],
      filterFreq: 950,
      filterQ:    0.68,
      lfoRate:    0.12,
      lfoDepth:   0.15,
      gain:       0.032,
      delayFb:    0.34,
    },
    modern: {
      freqs:      [55.00, 55.28],    // clean, neutral — editorial
      harmFreqs:  [110.00, 165.00],
      filterFreq: 1150,
      filterQ:    0.32,
      lfoRate:    0.10,
      lfoDepth:   0.12,
      gain:       0.030,
      delayFb:    0.28,
    },
  };

  function build() {
    audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);

    // ── Tonal filter (shapes timbre per zone) ─────────────────────────────────
    filter = audioCtx.createBiquadFilter();
    filter.type            = 'lowpass';
    filter.frequency.value = 750;
    filter.Q.value         = 0.38;
    filter.connect(masterGain); // dry path

    // ── Spatial delay network (Eno-style spatial depth) ───────────────────────
    // Two feedback delays at irrational time ratios create a dense, reverb-like
    // tail without convolution. High-frequency damping in each loop simulates
    // room absorption — the tail softens as it decays.
    wetGain = audioCtx.createGain();
    wetGain.gain.value = 0.42;
    filter.connect(wetGain);

    delay1 = audioCtx.createDelay(1.0);
    delay1.delayTime.value = 0.289; // ~289ms

    delay2 = audioCtx.createDelay(1.0);
    delay2.delayTime.value = 0.467; // ~467ms (irrational ratio = denser tails)

    fb1Gain = audioCtx.createGain();
    fb1Gain.gain.value = 0.42;

    fb2Gain = audioCtx.createGain();
    fb2Gain.gain.value = 0.36;

    // High-frequency rolloff in each feedback loop (room absorption)
    const dlpf1 = audioCtx.createBiquadFilter();
    dlpf1.type = 'lowpass';
    dlpf1.frequency.value = 1600;

    const dlpf2 = audioCtx.createBiquadFilter();
    dlpf2.type = 'lowpass';
    dlpf2.frequency.value = 1400;

    // Delay 1: wetGain → delay1 → dlpf1 → fb1 ↩ delay1; delay1 → masterGain
    wetGain.connect(delay1);
    delay1.connect(dlpf1);
    dlpf1.connect(fb1Gain);
    fb1Gain.connect(delay1); // feedback loop
    delay1.connect(masterGain);

    // Delay 2: wetGain → delay2 → dlpf2 → fb2 ↩ delay2; delay2 → masterGain
    wetGain.connect(delay2);
    delay2.connect(dlpf2);
    dlpf2.connect(fb2Gain);
    fb2Gain.connect(delay2); // feedback loop
    delay2.connect(masterGain);

    // ── Fundamental oscillators ────────────────────────────────────────────────
    // Triangle wave: slightly richer than sine, still smooth and non-intrusive
    const profile = ZONE_PROFILES.cosmic;
    for (const freq of profile.freqs) {
      const osc     = audioCtx.createOscillator();
      osc.type      = 'triangle';
      osc.frequency.value = freq;

      const lfo     = audioCtx.createOscillator();
      const lfoGain = audioCtx.createGain();
      lfo.frequency.value = profile.lfoRate;
      lfoGain.gain.value  = profile.lfoDepth;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start();

      osc.connect(filter);
      osc.start();
      oscs.push({ osc, lfo, lfoGain });
    }

    // ── Harmonic overtones ─────────────────────────────────────────────────────
    // Quiet sine waves at upper harmonics add air and richness without
    // sounding musical or intrusive. Level is ~15% of fundamentals.
    harmGain = audioCtx.createGain();
    harmGain.gain.value = 0.15;
    harmGain.connect(filter);

    for (const freq of profile.harmFreqs) {
      const osc     = audioCtx.createOscillator();
      osc.type      = 'sine';
      osc.frequency.value = freq;
      osc.connect(harmGain);
      osc.start();
      harmOscs.push({ osc });
    }
  }

  function applyZone(zone) {
    if (!audioCtx || zone === currentZone) return;
    currentZone = zone;
    const p   = ZONE_PROFILES[zone] || ZONE_PROFILES.modern;
    const now = audioCtx.currentTime;
    const dur = 4.0;

    for (let i = 0; i < oscs.length; i++) {
      if (p.freqs[i] == null) continue;
      const { osc, lfo, lfoGain } = oscs[i];

      osc.frequency.cancelScheduledValues(now);
      osc.frequency.setValueAtTime(osc.frequency.value, now);
      osc.frequency.linearRampToValueAtTime(p.freqs[i], now + dur);

      lfo.frequency.setValueAtTime(lfo.frequency.value, now);
      lfo.frequency.linearRampToValueAtTime(p.lfoRate, now + dur);

      lfoGain.gain.setValueAtTime(lfoGain.gain.value, now);
      lfoGain.gain.linearRampToValueAtTime(p.lfoDepth, now + dur);
    }

    for (let i = 0; i < harmOscs.length; i++) {
      if (p.harmFreqs[i] == null) continue;
      harmOscs[i].osc.frequency.cancelScheduledValues(now);
      harmOscs[i].osc.frequency.setValueAtTime(harmOscs[i].osc.frequency.value, now);
      harmOscs[i].osc.frequency.linearRampToValueAtTime(p.harmFreqs[i], now + dur);
    }

    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(filter.frequency.value, now);
    filter.frequency.linearRampToValueAtTime(p.filterFreq, now + dur);

    filter.Q.cancelScheduledValues(now);
    filter.Q.setValueAtTime(filter.Q.value, now);
    filter.Q.linearRampToValueAtTime(p.filterQ, now + dur);

    if (fb1Gain && fb2Gain) {
      fb1Gain.gain.setValueAtTime(fb1Gain.gain.value, now);
      fb1Gain.gain.linearRampToValueAtTime(p.delayFb, now + dur);
      fb2Gain.gain.setValueAtTime(fb2Gain.gain.value, now);
      fb2Gain.gain.linearRampToValueAtTime(p.delayFb * 0.80, now + dur);
    }
  }

  function fadeIn() {
    if (!masterGain) return;
    const p = ZONE_PROFILES[currentZone || 'cosmic'];
    masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
    masterGain.gain.setValueAtTime(masterGain.gain.value, audioCtx.currentTime);
    masterGain.gain.linearRampToValueAtTime(p.gain, audioCtx.currentTime + 3);
  }

  function fadeOut() {
    if (!masterGain) return;
    masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
    masterGain.gain.setValueAtTime(masterGain.gain.value, audioCtx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.5);
  }

  function start() {
    if (started) return;
    started = true;
    build();
    fadeIn();
  }

  function toggle() {
    muted = !muted;
    if (muted) {
      fadeOut();
    } else {
      if (!started) start();
      else fadeIn();
    }
    return muted;
  }

  function isMuted() { return muted; }

  function attachAutostart() {
    const handler = () => {
      if (!muted) start();
      window.removeEventListener('click',   handler);
      window.removeEventListener('keydown', handler);
    };
    window.addEventListener('click',   handler);
    window.addEventListener('keydown', handler);
  }

  return { attachAutostart, toggle, isMuted, applyZone };
})();
