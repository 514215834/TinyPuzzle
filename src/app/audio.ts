/**
 * 音效（F-203）：Web Audio 合成，零音频资源文件。
 * 浏览器自动播放策略：首次用户手势时 unlockAudio() 初始化上下文。
 */
let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    // 音频不可用不影响游戏
  }
}

type SoundName = 'pick' | 'drop' | 'correct' | 'win' | 'explosion';

function tone(freq: number, startAt: number, dur: number, type: OscillatorType, gain: number): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + startAt;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** enabled 由调用方传入（settings.soundOn），未解锁或静音时静默跳过 */
export function playTone(name: SoundName, enabled: boolean): void {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  switch (name) {
    case 'pick':
      tone(740, 0, 0.06, 'sine', 0.06);
      break;
    case 'drop':
      tone(240, 0, 0.08, 'triangle', 0.09);
      break;
    case 'correct':
      tone(660, 0, 0.09, 'sine', 0.09);
      tone(990, 0.09, 0.12, 'sine', 0.09);
      break;
    case 'win':
      tone(523, 0, 0.12, 'sine', 0.1);
      tone(659, 0.12, 0.12, 'sine', 0.1);
      tone(784, 0.24, 0.12, 'sine', 0.1);
      tone(1047, 0.36, 0.28, 'sine', 0.12);
      break;
    case 'explosion':
      explosionSound();
      break;
  }
}

/** 开局爆散音（F-512）：低频扫频冲击 + 白噪爆裂，Web Audio 合成 */
function explosionSound(): void {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  // 低频冲击：170Hz → 38Hz 指数下扫，模拟「咚」的低音冲击
  const osc = ctx.createOscillator();
  const og = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(170, t0);
  osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.42);
  og.gain.setValueAtTime(0.24, t0);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
  osc.connect(og).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.52);
  // 噪声爆裂：白噪经低通渐闭，模拟碎石飞溅
  const len = Math.floor(ctx.sampleRate * 0.3);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(3200, t0);
  lp.frequency.exponentialRampToValueAtTime(220, t0 + 0.3);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.32, t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
  src.connect(lp).connect(ng).connect(ctx.destination);
  src.start(t0);
}
