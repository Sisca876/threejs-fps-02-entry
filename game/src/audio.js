// All sound is synthesized with WebAudio: no audio files, no network. Gunshots are
// shaped noise bursts, impacts are filtered clicks, the spike beeps accelerate, and
// a faint wind loop keeps the desert alive. Everything degrades silently when the
// AudioContext is unavailable (headless captures) or before the first user gesture.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let windStarted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 1.2;
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function noise({ duration, volume, filterType = 'lowpass', frequency = 1200, q = 0.8, when = 0, slideTo = null }) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, t);
    if (slideTo) filter.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  function tone({ frequency, duration, volume, type = 'sine', when = 0, slideTo = null }) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  // Distance-attenuated gain for world sounds, 0..1.
  function attenuate(distance) {
    return 1 / (1 + Math.max(0, distance) * 0.055);
  }

  return {
    unlock() {
      if (ensure() && !windStarted) {
        windStarted = true;
        // Desert wind: looped noise through a slow-wandering lowpass.
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 320;
        const gain = ctx.createGain();
        gain.gain.value = 0.035;
        src.connect(filter).connect(gain).connect(master);
        src.start();
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 140;
        lfo.connect(lfoGain).connect(filter.frequency);
        lfo.start();
      }
    },
    shot(id, distance = 0) {
      const v = 0.5 * attenuate(distance);
      if (id === 'sniper') {
        noise({ duration: 0.32, volume: v, frequency: 2600, slideTo: 300 });
        tone({ frequency: 110, duration: 0.22, volume: v * 0.7, type: 'triangle', slideTo: 45 });
      } else if (id === 'shotgun') {
        noise({ duration: 0.26, volume: v, frequency: 1800, slideTo: 220 });
        tone({ frequency: 95, duration: 0.18, volume: v * 0.6, type: 'triangle', slideTo: 40 });
      } else if (id === 'smg') {
        noise({ duration: 0.09, volume: v * 0.8, frequency: 3200, slideTo: 700 });
      } else if (id === 'pistol') {
        noise({ duration: 0.14, volume: v * 0.9, frequency: 2800, slideTo: 500 });
      } else {
        noise({ duration: 0.13, volume: v, frequency: 2400, slideTo: 380 });
        tone({ frequency: 130, duration: 0.1, volume: v * 0.4, type: 'triangle', slideTo: 60 });
      }
    },
    dryFire() {
      tone({ frequency: 1900, duration: 0.03, volume: 0.12, type: 'square' });
    },
    reload() {
      noise({ duration: 0.05, volume: 0.16, filterType: 'bandpass', frequency: 2400, q: 2 });
      noise({ duration: 0.05, volume: 0.2, filterType: 'bandpass', frequency: 1800, q: 2, when: 0.45 });
      noise({ duration: 0.06, volume: 0.24, filterType: 'bandpass', frequency: 3000, q: 2, when: 0.9 });
    },
    hit(kill) {
      tone({ frequency: kill ? 1500 : 1150, duration: 0.06, volume: 0.22, type: 'square' });
      if (kill) tone({ frequency: 1900, duration: 0.09, volume: 0.2, type: 'square', when: 0.07 });
    },
    hurt() {
      noise({ duration: 0.12, volume: 0.3, frequency: 500, slideTo: 140 });
    },
    step(distance = 0, running = true) {
      const v = (running ? 0.1 : 0.05) * attenuate(distance);
      if (v < 0.015) return;
      noise({ duration: 0.07, volume: v, frequency: 420, slideTo: 160 });
    },
    beep(urgency) {
      // Spike beeps: faster and higher as detonation nears.
      tone({ frequency: 950 + urgency * 350, duration: 0.07, volume: 0.24, type: 'square' });
    },
    explosion() {
      noise({ duration: 1.4, volume: 0.85, frequency: 900, slideTo: 60 });
      tone({ frequency: 70, duration: 1.1, volume: 0.7, type: 'sine', slideTo: 28 });
      noise({ duration: 0.5, volume: 0.4, filterType: 'bandpass', frequency: 900, q: 1, when: 0.1 });
    },
    roundWin() {
      tone({ frequency: 523, duration: 0.14, volume: 0.22, type: 'triangle' });
      tone({ frequency: 659, duration: 0.14, volume: 0.22, type: 'triangle', when: 0.12 });
      tone({ frequency: 784, duration: 0.3, volume: 0.26, type: 'triangle', when: 0.24 });
    },
    roundLose() {
      tone({ frequency: 392, duration: 0.16, volume: 0.22, type: 'triangle' });
      tone({ frequency: 330, duration: 0.16, volume: 0.22, type: 'triangle', when: 0.14 });
      tone({ frequency: 262, duration: 0.34, volume: 0.24, type: 'triangle', when: 0.28 });
    },
    plant() {
      tone({ frequency: 700, duration: 0.08, volume: 0.2, type: 'square' });
      tone({ frequency: 700, duration: 0.08, volume: 0.2, type: 'square', when: 0.14 });
      tone({ frequency: 1050, duration: 0.16, volume: 0.24, type: 'square', when: 0.28 });
    },
    defuse() {
      tone({ frequency: 880, duration: 0.1, volume: 0.2, type: 'sine' });
      tone({ frequency: 1175, duration: 0.2, volume: 0.22, type: 'sine', when: 0.12 });
    },
    buy() {
      tone({ frequency: 1245, duration: 0.07, volume: 0.18, type: 'sine' });
      tone({ frequency: 1661, duration: 0.12, volume: 0.18, type: 'sine', when: 0.07 });
    },
    denied() {
      tone({ frequency: 220, duration: 0.12, volume: 0.18, type: 'square' });
    },
    click() {
      tone({ frequency: 1400, duration: 0.04, volume: 0.12, type: 'sine' });
    },
  };
}
