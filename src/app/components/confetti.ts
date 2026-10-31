import { must } from '../../utils/dom';

const COLORS = ['#ffb454', '#ff7a59', '#5dd39e', '#6ea8fe', '#f472b6', '#fde68a'];

/** 胜利撒花（F-006）；遵循 prefers-reduced-motion 直接跳过 */
export function startConfetti(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = must(document.querySelector<HTMLCanvasElement>('#confetti'), '#confetti');
  const ctx = must(canvas.getContext('2d'), 'confetti canvas context');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const parts = Array.from({ length: 140 }, () => ({
    x: Math.random() * W,
    y: -20 - Math.random() * H * 0.3,
    vx: (Math.random() - 0.5) * 2.4,
    vy: 2 + Math.random() * 3,
    size: 6 + Math.random() * 8,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.25,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));

  const started = performance.now();
  const frame = (now: number): void => {
    const t = (now - started) / 1000;
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.02;
      p.rot += p.vr;
      if (p.y < H + 30) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, Math.min(1, 3.2 - t));
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (alive && t < 4) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, W, H);
    }
  };
  requestAnimationFrame(frame);
}
