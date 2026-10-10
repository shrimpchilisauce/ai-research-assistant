import { storage } from './storage';

/**
 * 効果音は Web Audio で合成する（音声ファイルを持たない）。
 * ブラウザの制限で、最初のタップ・クリックより前は鳴らせない。
 */

export type SoundName = 'deal' | 'chip' | 'check' | 'fold' | 'turn' | 'warning' | 'levelUp' | 'win';

let ctx: AudioContext | null = null;
let muted = storage.muted();

function audio(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 最初の操作で AudioContext を有効にする。 */
export function unlockAudioOnFirstGesture() {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  storage.setMuted(value);
}

function tone(c: AudioContext, freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function noise(c: AudioContext, start: number, dur: number, gain: number, freq: number) {
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(c.destination);
  src.start(start);
}

export function play(name: SoundName) {
  if (muted) return;
  const c = audio();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime + 0.01;
  switch (name) {
    case 'deal':
      noise(c, t, 0.06, 0.5, 3_500);
      break;
    case 'chip':
      tone(c, 2_400, t, 0.05, 0.12, 'triangle');
      tone(c, 3_100, t + 0.045, 0.06, 0.1, 'triangle');
      break;
    case 'check':
      tone(c, 220, t, 0.08, 0.35, 'sine');
      tone(c, 180, t + 0.09, 0.08, 0.3, 'sine');
      break;
    case 'fold':
      noise(c, t, 0.18, 0.35, 1_200);
      break;
    case 'turn':
      tone(c, 660, t, 0.18, 0.15);
      tone(c, 880, t + 0.14, 0.25, 0.15);
      break;
    case 'warning':
      tone(c, 1_000, t, 0.12, 0.15, 'square');
      break;
    case 'levelUp':
      tone(c, 523, t, 0.15, 0.15);
      tone(c, 659, t + 0.12, 0.15, 0.15);
      tone(c, 784, t + 0.24, 0.3, 0.15);
      break;
    case 'win':
      for (let i = 0; i < 5; i++) tone(c, 2_200 + i * 180, t + i * 0.05, 0.06, 0.08, 'triangle');
      break;
  }
}
