// Synthesised sound, no audio files: a two-strike bell for the end of the
// timer and soft rain. iOS only lets audio start inside a tap, so the
// AudioContext is created and resumed from a tap handler (unlockAudio).

let ctx = null;
let rain = null;

/** Call from a tap. Creates or wakes the audio context. */
export function unlockAudio() {
  try {
    if (!ctx) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return null;
      ctx = new Context();
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  } catch {
    ctx = null;
  }
  return ctx;
}

export function audioReady() {
  return Boolean(ctx);
}

/** True once the audio context actually plays (iOS may hold it suspended). */
export function audioRunning() {
  return ctx?.state === 'running';
}

// iOS mutes Web Audio when the side switch is on silent, unless the page's
// audio session says "playback". That category also stops his music, so it's
// set only while the bell sounds, never for the whole session.
const BELL_SECONDS = 9.1;
let bellSessionTimer = null;

function setSessionType(type) {
  try {
    const session = navigator.audioSession;
    if (session && session.type !== type) session.type = type;
  } catch {
    // An older WebKit without the setting.
  }
}

function bellSessionStart() {
  clearTimeout(bellSessionTimer);
  setSessionType('playback');
}

function bellSessionEnd() {
  clearTimeout(bellSessionTimer);
  bellSessionTimer = null;
  setSessionType('auto');
}

/** Two soft strikes of a bell, about nine seconds in all. */
export function ringBell() {
  if (!ctx) return;
  bellSessionStart();
  try {
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.05;
    let last = null;
    [0, 2.4].forEach((offset, strike) => {
      const t = t0 + offset;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(strike ? 0.16 : 0.24, t + 0.012);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 6.5);
      out.connect(ctx.destination);
      // Partials of a small bell: ratio, level, decay in seconds.
      for (const [ratio, level, decay] of [[1, 1, 6.5], [2.01, 0.42, 4.2], [2.76, 0.3, 3.2], [5.4, 0.12, 1.8], [8.93, 0.05, 1.0]]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 523.25 * ratio;
        gain.gain.setValueAtTime(level, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        osc.connect(gain);
        gain.connect(out);
        osc.start(t);
        osc.stop(t + decay + 0.1);
        if (!last || t + decay > last.end) last = { osc, end: t + decay };
      }
    });
    // Back to the normal session once the longest partial has died away; the
    // timer covers a context that never gets to play it.
    last.osc.addEventListener('ended', bellSessionEnd);
    bellSessionTimer = setTimeout(bellSessionEnd, (BELL_SECONDS + 3) * 1000);
  } catch {
    // No sound is better than a broken screen.
    bellSessionEnd();
  }
}

export function rainPlaying() {
  return rain !== null;
}

/** Soft rain: pink-ish noise, band-limited, faded in. */
export function startRain() {
  const audio = unlockAudio();
  if (!audio || rain) return;
  try {
    const length = audio.sampleRate * 6;
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.09;
      b6 = white * 0.115926;
    }
    // Fade the loop's ends so the seam doesn't click.
    const fade = Math.floor(audio.sampleRate * 0.05);
    for (let j = 0; j < fade; j += 1) {
      const k = j / fade;
      data[j] *= k;
      data[length - 1 - j] *= k;
    }
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const highpass = audio.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 180;
    const lowpass = audio.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 1600;
    const gain = audio.createGain();
    const t = audio.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 1.5);
    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(audio.destination);
    source.start();
    rain = { source, gain };
  } catch {
    rain = null;
  }
}

/** Fades the rain out over `seconds`. */
export function stopRain(seconds = 0.6) {
  if (!rain || !ctx) {
    rain = null;
    return;
  }
  try {
    const t = ctx.currentTime;
    const { gain, source } = rain;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    source.stop(t + seconds + 0.05);
  } catch {
    // Already stopped.
  }
  rain = null;
}
