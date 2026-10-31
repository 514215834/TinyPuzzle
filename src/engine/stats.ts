/**
 * 计时统计（F-103）：净用时累计，支持暂停/恢复。
 * 页面切后台自动暂停由视图层监听 visibilitychange 驱动。
 */
export class StatsService {
  private startedAt = 0;
  private accumulated = 0;
  private running = false;

  constructor(private now: () => number = () => performance.now()) {}

  start(): void {
    this.accumulated = 0;
    this.running = true;
    this.startedAt = this.now();
  }

  /** 从已累计的时长继续计时（进度恢复用） */
  startWith(elapsedMs: number): void {
    this.accumulated = Math.max(0, elapsedMs);
    this.running = true;
    this.startedAt = this.now();
  }

  pause(): void {
    if (!this.running) return;
    this.accumulated += this.now() - this.startedAt;
    this.running = false;
  }

  resume(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = this.now();
  }

  get isRunning(): boolean {
    return this.running;
  }

  get elapsedMs(): number {
    return this.accumulated + (this.running ? this.now() - this.startedAt : 0);
  }
}

/** mm:ss（分钟数不设上限） */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
