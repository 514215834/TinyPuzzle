/**
 * 异形拼图块形状生成（F-301）。
 *
 * 几何约定：
 * - 每条内部边只生成一次参数（sign/c/w/h），相邻两块共享同一条曲线；
 *   一块沿正向描边，另一块反向描边（t→1-t，u→-u），天然凹凸互补；
 * - 正向定义：水平边从左到右、垂直边从上到下；法向 n = (-ey, ex)；
 * - 曲线在 (t, u) 归一化坐标系中定义：t 为沿边比例（0-1），
 *   u 为沿法向偏移比例（乘以 S = min(cellW, cellH) 得像素）。
 */
import type { EdgeParams, ShapeSpec } from './shapeTypes';

type Pt = [number, number];
type Seg = [Pt, Pt, Pt, Pt]; // [P0, C1, C2, P3]

/**
 * 经典拼图凸舌：8 段三次贝塞尔，真实拼图的蘑菇卡口造型。
 *
 * 造型要点（相对边长 L 的横向比例、相对 S 的纵向比例）：
 * - 基线平直引入/引出，肩部从 c±2.1w 开始起势；
 * - 颈部收窄（最窄 c±0.95w，高于基线 0.36h），形成上窄下宽的脖颈；
 * - 头部外翻（最宽 c±1.5w，高于基线 0.66h），颈部明显窄于头部 → 卡口 undercut；
 * - 头顶圆拱，端点切线水平，保证相邻边衔接光滑；
 * - 相邻块共享同一边参数，反向描边天然互补。
 */
export function tabSegments(p: EdgeParams): Seg[] {
  const s = p.sign;
  const { c, w, h } = p;
  const u = (v: number): number => v * s;
  return [
    // 基线引入（平直）
    [[0, 0], [0.12, 0], [c - 2.9 * w, 0], [c - 2.1 * w, 0]],
    // 起势入颈：切线从水平转竖直，向中心收窄
    [[c - 2.1 * w, u(0)], [c - 1.25 * w, u(0)], [c - 0.95 * w, u(0.16 * h)], [c - 0.95 * w, u(0.36 * h)]],
    // 外翻形成卡口（head undercut：头部最宽 > 颈部）
    [[c - 0.95 * w, u(0.36 * h)], [c - 0.95 * w, u(0.52 * h)], [c - 1.5 * w, u(0.54 * h)], [c - 1.5 * w, u(0.66 * h)]],
    // 左上圆拱
    [[c - 1.5 * w, u(0.66 * h)], [c - 1.5 * w, u(0.86 * h)], [c - 0.58 * w, u(h)], [c, u(h)]],
    // 右上圆拱
    [[c, u(h)], [c + 0.58 * w, u(h)], [c + 1.5 * w, u(0.86 * h)], [c + 1.5 * w, u(0.66 * h)]],
    // 右侧卡口收回
    [[c + 1.5 * w, u(0.66 * h)], [c + 1.5 * w, u(0.54 * h)], [c + 0.95 * w, u(0.52 * h)], [c + 0.95 * w, u(0.36 * h)]],
    // 出颈下行
    [[c + 0.95 * w, u(0.36 * h)], [c + 0.95 * w, u(0.16 * h)], [c + 1.25 * w, u(0)], [c + 2.1 * w, u(0)]],
    // 基线引出（平直）
    [[c + 2.1 * w, u(0)], [c + 2.9 * w, u(0)], [0.88, 0], [1, 0]],
  ];
}

function mapPt(
  from: { x: number; y: number },
  ex: number,
  ey: number,
  L: number,
  nx: number,
  ny: number,
  S: number,
  p: Pt,
): { x: number; y: number } {
  return {
    x: from.x + ex * p[0] * L + nx * p[1] * S,
    y: from.y + ey * p[0] * L + ny * p[1] * S,
  };
}

/** 段反转：t→1-t，u→-u，C1/C2 互换、段序颠倒 */
export function reverseSegs(segs: Seg[]): Seg[] {
  const pts: Pt[] = [segs[0][0]];
  for (const seg of segs) pts.push(seg[1], seg[2], seg[3]);
  const inv = (q: Pt): Pt => [1 - q[0], -q[1]] as Pt;
  const out: Seg[] = [];
  for (let i = pts.length - 1; i >= 3; i -= 3) {
    out.push([inv(pts[i]), inv(pts[i - 1]), inv(pts[i - 2]), inv(pts[i - 3])]);
  }
  return out;
}

/** 生成整副棋盘的边参数：内部边带凸舌参数，边界为直线（null） */
export function buildShapeSpec(
  rows: number,
  cols: number,
  stageW: number,
  stageH: number,
  rng: () => number = Math.random,
): ShapeSpec {
  const rand = (lo: number, hi: number): number => lo + rng() * (hi - lo);
  const edge = (): EdgeParams => ({
    sign: rng() < 0.5 ? 1 : -1,
    c: rand(0.44, 0.56),
    w: rand(0.085, 0.115),
    h: rand(0.21, 0.26),
  });
  const hEdges: (EdgeParams | null)[][] = [];
  for (let r = 0; r <= rows; r++) {
    hEdges.push(Array.from({ length: cols }, () => (r === 0 || r === rows ? null : edge())));
  }
  const vEdges: (EdgeParams | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    vEdges.push(Array.from({ length: cols + 1 }, (_, c) => (c === 0 || c === cols ? null : edge())));
  }
  const margin = Math.round(Math.min(stageW / cols, stageH / rows) * 0.3);
  return { rows, cols, stageW, stageH, margin, hEdges, vEdges };
}

/**
 * 构建单块的局部路径（画布像素坐标，含 margin 留白）。
 * 描边顺序（屏幕坐标系顺时针）：上（正向）→ 右（正向）→ 下（反向）→ 左（反向）。
 */
export function buildPiecePath(spec: ShapeSpec, pieceId: number): Path2D {
  const { rows, cols, stageW, stageH, hEdges, vEdges, margin } = spec;
  const cw = stageW / cols;
  const ch = stageH / rows;
  const S = Math.min(cw, ch);
  const r = Math.floor(pieceId / cols);
  const c = pieceId % cols;

  const x0 = c * cw;
  const y0 = r * ch;
  const ox = margin - x0; // 舞台坐标 → 画布局部坐标
  const oy = margin - y0;

  const path = new Path2D();
  const addSegs = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    params: EdgeParams | null,
    reversed: boolean,
  ): void => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const L = Math.hypot(dx, dy);
    const ex = dx / L;
    const ey = dy / L;
    const nx = -ey;
    const ny = ex;
    if (!params) {
      path.lineTo(to.x + ox, to.y + oy);
      return;
    }
    const segs = reversed ? reverseSegs(tabSegments(params)) : tabSegments(params);
    for (const [, C1, C2, P3] of segs) {
      const a = mapPt(from, ex, ey, L, nx, ny, S, C1);
      const b = mapPt(from, ex, ey, L, nx, ny, S, C2);
      const d = mapPt(from, ex, ey, L, nx, ny, S, P3);
      path.bezierCurveTo(a.x + ox, a.y + oy, b.x + ox, b.y + oy, d.x + ox, d.y + oy);
    }
  };

  path.moveTo(x0 + ox, y0 + oy);
  addSegs({ x: x0, y: y0 }, { x: x0 + cw, y: y0 }, hEdges[r][c], false); // 上
  addSegs({ x: x0 + cw, y: y0 }, { x: x0 + cw, y: y0 + ch }, vEdges[r][c + 1], false); // 右
  addSegs({ x: x0 + cw, y: y0 + ch }, { x: x0, y: y0 + ch }, hEdges[r + 1][c], true); // 下
  addSegs({ x: x0, y: y0 + ch }, { x: x0, y: y0 }, vEdges[r][c], true); // 左
  path.closePath();
  return path;
}

export interface BuiltPieceShape {
  canvas: HTMLCanvasElement;
  path: Path2D;
  /** 画布实际像素 / 逻辑像素 比（高清采样倍率，命中测试换算用） */
  scale: number;
}

/** 载入舞台图并为每块生成离屏切片 + 命中路径（按块数 2~3 倍超采样，缩放查看不模糊） */
export async function buildPieceShapes(
  spec: ShapeSpec,
  stageDataUrl: string,
): Promise<BuiltPieceShape[]> {
  const img = new Image();
  img.src = stageDataUrl;
  await img.decode();

  const { rows, cols, stageW, stageH, margin } = spec;
  const cw = stageW / cols;
  const ch = stageH / rows;
  // 超采样倍率：≤1200 块用 3×，更多用 2×（平衡清晰度与显存）
  const dpr = rows * cols > 1200 ? 2 : 3;
  const out: BuiltPieceShape[] = [];
  for (let id = 0; id < rows * cols; id++) {
    const path = buildPiecePath(spec, id);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((cw + margin * 2) * dpr);
    canvas.height = Math.round((ch + margin * 2) * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 上下文不可用');
    ctx.scale(dpr, dpr); // 路径与绘制保持逻辑坐标，背板高清
    const r = Math.floor(id / cols);
    const c = id % cols;
    // 路径已是画布局部坐标：直接裁剪；源矩形显式取「格子外扩 margin 与舞台的交集」
    const sx = Math.max(0, c * cw - margin);
    const sy = Math.max(0, r * ch - margin);
    const sw = Math.min(stageW, (c + 1) * cw + margin) - sx;
    const sh = Math.min(stageH, (r + 1) * ch + margin) - sy;
    const dx = sx - (c * cw - margin);
    const dy = sy - (r * ch - margin);
    ctx.save();
    ctx.clip(path);
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
    ctx.restore();
    // 沿路径描边，增强拼块轮廓
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.lineWidth = 2;
    ctx.stroke(path);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke(path);
    out.push({ canvas, path, scale: dpr });
  }
  return out;
}
