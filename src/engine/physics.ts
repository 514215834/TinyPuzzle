/**
 * 桌面俯视轻量物理（F-511）。
 *
 * 模型：俯视桌面 —— 无重力，块（圆近似）带惯性滑行、相互弹性碰撞、
 * 撞场地边界反弹，速度衰减（指数阻尼）后入睡。纯逻辑零 DOM，可单测。
 *
 * 三种 body：
 * - static   散落场上静置的块（被撞且冲击足够才转 dynamic）
 * - dynamic  运动中的块（积分、碰撞、边界反弹、入睡）
 * - kinematic 拖拽中的块：位置由指针控制，速度用于把邻居推开（无限质量）
 *
 * 性能约定：
 * - broadphase 只对「活跃区域」（actors 包围盒外扩一格）建空间哈希；
 * - 子步进保证单步位移 < 半径/2，高速不穿墙不穿透；
 * - dynamic 数量上限防 1000 块级联唤醒雪崩（超限按 static 处理）。
 */

export type PhysKind = 'static' | 'dynamic' | 'kinematic';

export interface PhysBody {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 碰撞半径（块的圆近似） */
  r: number;
  kind: PhysKind;
  sleeping: boolean;
}

export interface PhysRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PhysWorldOptions {
  /** 反弹恢复系数（块间 / 边界共用） */
  restitution?: number;
  /** 每秒速度保留比例（指数阻尼）：0.1 = 1 秒后剩 10% */
  damping?: number;
  /** 入睡速度阈值 px/s */
  sleepSpeed?: number;
  /** 连续低速步数达到后入睡 */
  sleepFrames?: number;
  /** 速度上限 px/s（防穿墙，配合子步进） */
  maxSpeed?: number;
  /** dynamic 数量上限（超出按 static 处理） */
  maxDynamic?: number;
  /** 唤醒沉睡块所需的最小冲击速度 px/s */
  wakeImpact?: number;
}

const DEFAULTS: Required<PhysWorldOptions> = {
  restitution: 0.45,
  damping: 0.1,
  sleepSpeed: 10,
  sleepFrames: 6,
  maxSpeed: 2600,
  maxDynamic: 160,
  wakeImpact: 25,
};

interface BodyMeta {
  slowFrames: number;
}

export class PhysWorld {
  private bodies = new Map<number, PhysBody>();
  private meta = new Map<number, BodyMeta>();
  private bounds: PhysRect = { x: 0, y: 0, w: 1e6, h: 1e6 };
  private readonly o: Required<PhysWorldOptions>;
  private dynCount = 0;
  private awakeCount = 0;
  private hash = new Map<number, number[]>();
  private cell = 48;

  constructor(opts: PhysWorldOptions = {}) {
    this.o = { ...DEFAULTS, ...opts };
  }

  /** 是否全部入睡（视图据此停帧） */
  get isSettled(): boolean {
    return this.awakeCount === 0;
  }

  get dynamicCount(): number {
    return this.dynCount;
  }

  setBounds(b: PhysRect): void {
    this.bounds = { ...b };
  }

  has(id: number): boolean {
    return this.bodies.has(id);
  }

  bodyPos(id: number): { x: number; y: number } | null {
    const b = this.bodies.get(id);
    return b ? { x: b.x, y: b.y } : null;
  }

  /** 只读访问 body（视图 / 测试断言用） */
  bodyOf(id: number): Readonly<PhysBody> | null {
    return this.bodies.get(id) ?? null;
  }

  /** 不存在则建 static body；存在则更新半径（保持现有状态） */
  ensureBody(id: number, x: number, y: number, r: number): void {
    let b = this.bodies.get(id);
    if (!b) {
      b = { id, x, y, vx: 0, vy: 0, r, kind: 'static', sleeping: true };
      this.bodies.set(id, b);
      this.meta.set(id, { slowFrames: 0 });
      return;
    }
    b.r = r;
  }

  removeBody(id: number): void {
    const b = this.bodies.get(id);
    if (!b) return;
    if (b.kind === 'dynamic') {
      this.dynCount -= 1;
      if (!b.sleeping) this.awakeCount -= 1;
    }
    this.bodies.delete(id);
    this.meta.delete(id);
  }

  clear(): void {
    this.bodies.clear();
    this.meta.clear();
    this.hash.clear();
    this.dynCount = 0;
    this.awakeCount = 0;
  }

  /** 拖拽中：位置由指针控制，速度为指针速度（用于推挤邻居） */
  setKinematic(id: number, x: number, y: number, vx: number, vy: number): void {
    const b = this.bodies.get(id);
    if (!b) return;
    if (b.kind === 'dynamic') {
      this.dynCount -= 1;
      if (!b.sleeping) this.awakeCount -= 1;
    }
    b.kind = 'kinematic';
    b.sleeping = false;
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
  }

  /** 指针停住时清零 kinematic 速度，避免持续推挤邻居 */
  haltKinematic(id: number): void {
    const b = this.bodies.get(id);
    if (b && b.kind === 'kinematic') {
      b.vx = 0;
      b.vy = 0;
    }
  }

  /** 散置松手：置于 (x, y) 并注入速度转 dynamic。超上限返回 false（保持静止） */
  launch(id: number, x: number, y: number, vx: number, vy: number): boolean {
    const b = this.bodies.get(id);
    if (!b) return false;
    if (b.kind === 'kinematic') {
      // 拖拽松手：kinematic → dynamic（拖拽块必转，不受上限约束）
      b.kind = 'dynamic';
      this.dynCount += 1;
      this.awakeCount += 1;
    } else if (b.kind === 'static') {
      if (this.dynCount >= this.o.maxDynamic) return false;
      b.kind = 'dynamic';
      this.dynCount += 1;
      this.awakeCount += 1;
    }
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
    b.sleeping = false;
    this.meta.get(id)!.slowFrames = 0;
    return true;
  }

  /** 更新 static body 位置（视口尺寸变化后的夹取） */
  placeStatic(id: number, x: number, y: number): void {
    const b = this.bodies.get(id);
    if (b && b.kind === 'static') {
      b.x = x;
      b.y = y;
    }
  }

  /** 把所有 body 位置夹进边界（resize 后调用） */
  clampIntoBounds(): void {
    const { x: bx, y: by, w: bw, h: bh } = this.bounds;
    for (const b of this.bodies.values()) {
      b.x = Math.min(Math.max(b.x, bx + b.r), bx + bw - b.r);
      b.y = Math.min(Math.max(b.y, by + b.r), by + bh - b.r);
    }
  }

  /** static → dynamic（受数量上限约束） */
  private makeDynamic(b: PhysBody): boolean {
    if (b.kind === 'dynamic') return true;
    if (b.kind === 'kinematic') throw new Error('kinematic 转 dynamic 请走 launch');
    if (this.dynCount >= this.o.maxDynamic) return false;
    b.kind = 'dynamic';
    b.sleeping = false;
    this.dynCount += 1;
    this.awakeCount += 1;
    this.meta.get(b.id)!.slowFrames = 0;
    return true;
  }

  private wake(b: PhysBody): void {
    if (b.kind !== 'dynamic') return;
    if (b.sleeping) {
      b.sleeping = false;
      this.awakeCount += 1;
    }
    this.meta.get(b.id)!.slowFrames = 0;
  }

  /**
   * 推进一步，返回位置发生变化的 body id（不含 kinematic）。
   * dt 为秒；内部自动子步进。
   */
  step(dtRaw: number): number[] {
    const dt = Math.max(0, Math.min(dtRaw, 0.05));
    if (dt === 0) return [];
    const actors: PhysBody[] = [];
    for (const b of this.bodies.values()) {
      if (b.kind === 'kinematic' || (b.kind === 'dynamic' && !b.sleeping)) actors.push(b);
    }
    if (actors.length === 0) return [];

    // 子步进：单步最大位移 ≤ 最小 actor 半径的一半
    let maxSpeed = 0;
    let minR = Infinity;
    for (const b of actors) {
      const s = Math.hypot(b.vx, b.vy);
      if (s > maxSpeed) maxSpeed = s;
      if (b.r < minR) minR = b.r;
    }
    if (!Number.isFinite(minR)) minR = this.cell;
    const sub = Math.max(1, Math.min(8, Math.ceil((maxSpeed * dt) / (minR * 0.5))));
    const h = dt / sub;
    const moved = new Set<number>();
    for (let s = 0; s < sub; s++) this.substep(h, actors, moved);

    // 入睡判定按整步累计
    for (const b of actors) {
      if (b.kind !== 'dynamic' || b.sleeping) continue;
      const m = this.meta.get(b.id)!;
      if (Math.hypot(b.vx, b.vy) < this.o.sleepSpeed) {
        m.slowFrames += 1;
        if (m.slowFrames >= this.o.sleepFrames) {
          b.sleeping = true;
          b.vx = 0;
          b.vy = 0;
          this.awakeCount -= 1;
        }
      } else {
        m.slowFrames = 0;
      }
    }
    return [...moved];
  }

  private substep(h: number, actors: PhysBody[], moved: Set<number>): void {
    const damp = Math.pow(this.o.damping, h);
    // 1) 积分 + 边界反弹（仅 dynamic；kinematic 位置由指针控制）
    for (const b of actors) {
      if (b.kind !== 'dynamic') continue;
      b.vx *= damp;
      b.vy *= damp;
      const s = Math.hypot(b.vx, b.vy);
      if (s > this.o.maxSpeed) {
        const k = this.o.maxSpeed / s;
        b.vx *= k;
        b.vy *= k;
      }
      b.x += b.vx * h;
      b.y += b.vy * h;
      this.walls(b);
      moved.add(b.id);
    }

    // 2) 碰撞：只对活跃区域建空间哈希
    const region = this.activeRegion(actors);
    this.rebuildHash(region);
    const seenPairs = new Set<number>(); // 重叠格桶 / 双向枚举会导致同一对重复，去重
    for (const a of actors) {
      const neighbors = this.query(a);
      for (const b of neighbors) {
        if (b.id === a.id) continue;
        const lo = Math.min(a.id, b.id);
        const hi = Math.max(a.id, b.id);
        const key = lo * 65536 + hi;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        this.resolve(a, b, moved);
      }
    }
  }

  private walls(b: PhysBody): void {
    const { x: bx, y: by, w: bw, h: bh } = this.bounds;
    const e = this.o.restitution;
    if (b.x - b.r < bx) {
      b.x = bx + b.r;
      if (b.vx < 0) b.vx = -b.vx * e;
    } else if (b.x + b.r > bx + bw) {
      b.x = bx + bw - b.r;
      if (b.vx > 0) b.vx = -b.vx * e;
    }
    if (b.y - b.r < by) {
      b.y = by + b.r;
      if (b.vy < 0) b.vy = -b.vy * e;
    } else if (b.y + b.r > by + bh) {
      b.y = by + bh - b.r;
      if (b.vy > 0) b.vy = -b.vy * e;
    }
  }

  private activeRegion(actors: PhysBody[]): PhysRect {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let maxR = 0;
    for (const b of actors) {
      x0 = Math.min(x0, b.x - b.r);
      y0 = Math.min(y0, b.y - b.r);
      x1 = Math.max(x1, b.x + b.r);
      y1 = Math.max(y1, b.y + b.r);
      if (b.r > maxR) maxR = b.r;
    }
    const pad = this.cell;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }

  /** 在活跃区域内建空间哈希（格宽 = 2×最大 actor 半径） */
  private rebuildHash(region: PhysRect): void {
    this.hash.clear();
    let maxR = 0;
    for (const b of this.bodies.values()) {
      if (b.kind !== 'static' && b.r > maxR) maxR = b.r;
    }
    this.cell = Math.max(32, maxR * 2);
    const c = this.cell;
    for (const b of this.bodies.values()) {
      if (b.x + b.r < region.x || b.x - b.r > region.x + region.w) continue;
      if (b.y + b.r < region.y || b.y - b.r > region.y + region.h) continue;
      const cx0 = Math.floor((b.x - b.r) / c);
      const cx1 = Math.floor((b.x + b.r) / c);
      const cy0 = Math.floor((b.y - b.r) / c);
      const cy1 = Math.floor((b.y + b.r) / c);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const key = this.key(cx, cy);
          const arr = this.hash.get(key);
          if (arr) arr.push(b.id);
          else this.hash.set(key, [b.id]);
        }
      }
    }
  }

  private key(cx: number, cy: number): number {
    return (cx + 8192) * 16384 + (cy + 8192);
  }

  private query(a: PhysBody): PhysBody[] {
    const out: PhysBody[] = [];
    const c = this.cell;
    const cx0 = Math.floor((a.x - a.r) / c);
    const cx1 = Math.floor((a.x + a.r) / c);
    const cy0 = Math.floor((a.y - a.r) / c);
    const cy1 = Math.floor((a.y + a.r) / c);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const arr = this.hash.get(this.key(cx, cy));
        if (!arr) continue;
        for (const id of arr) {
          const b = this.bodies.get(id);
          if (b) out.push(b);
        }
      }
    }
    return out;
  }

  /** 解算一对碰撞（n 由 a 指向 b，vn>0 表示相互接近） */
  private resolve(a: PhysBody, b: PhysBody, moved: Set<number>): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const rr = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return;
    let d = Math.sqrt(d2);
    let nx: number;
    let ny: number;
    if (d < 1e-6) {
      nx = 1;
      ny = 0;
      d = 1e-6;
    } else {
      nx = dx / d;
      ny = dy / d;
    }
    const pen = rr - d;

    // 沉睡块：冲击足够或已明显重叠才唤醒，否则按静态处理
    if (b.kind === 'dynamic' && b.sleeping) {
      const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (vn > this.o.wakeImpact || pen > 0.5) this.wake(b);
      else return;
    }
    if (a.kind === 'kinematic' && b.kind === 'kinematic') return;

    const e = this.o.restitution;

    // 拖拽块推挤静置块：唤醒为 dynamic 再推开（超上限则当作墙忽略）
    if (b.kind === 'static' && a.kind === 'kinematic') {
      if (!this.makeDynamic(b)) return;
    }

    if (b.kind === 'static') {
      // a（dynamic）撞静态：只修正 a
      a.x -= nx * pen * 0.8;
      a.y -= ny * pen * 0.8;
      const vn = a.vx * nx + a.vy * ny;
      if (vn > 0) {
        a.vx -= (1 + e) * vn * nx;
        a.vy -= (1 + e) * vn * ny;
      }
      moved.add(a.id);
      return;
    }

    if (a.kind === 'kinematic') {
      // 拖拽块推开 b（无限质量）
      b.x += nx * pen;
      b.y += ny * pen;
      const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (vn > 0) {
        b.vx += (1 + e) * vn * nx;
        b.vy += (1 + e) * vn * ny;
      }
      this.clampSpeed(b);
      this.wake(b);
      moved.add(b.id);
      return;
    }

    if (b.kind === 'kinematic') {
      // a 撞上拖拽块：a 被弹开
      a.x -= nx * pen;
      a.y -= ny * pen;
      const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (vn > 0) {
        a.vx -= (1 + e) * vn * nx;
        a.vy -= (1 + e) * vn * ny;
      }
      this.clampSpeed(a);
      moved.add(a.id);
      return;
    }

    // dynamic vs dynamic（等质量弹性碰撞）
    const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    const corr = pen * 0.35;
    a.x -= nx * corr * 0.5;
    a.y -= ny * corr * 0.5;
    b.x += nx * corr * 0.5;
    b.y += ny * corr * 0.5;
    if (vn > 0) {
      const j = ((1 + e) * vn) / 2;
      a.vx -= j * nx;
      a.vy -= j * ny;
      b.vx += j * nx;
      b.vy += j * ny;
      this.clampSpeed(a);
      this.clampSpeed(b);
    }
    moved.add(a.id);
    moved.add(b.id);
  }

  private clampSpeed(b: PhysBody): void {
    const s = Math.hypot(b.vx, b.vy);
    if (s > this.o.maxSpeed) {
      const k = this.o.maxSpeed / s;
      b.vx *= k;
      b.vy *= k;
    }
  }
}
