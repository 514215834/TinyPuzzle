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

type SoundName = 'pick' | 'drop' | 'correct' | 'win';

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
  }
}
