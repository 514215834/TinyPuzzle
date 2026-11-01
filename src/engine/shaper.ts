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

/** 生成整块路径的 SVG d 串（画布局部坐标 = stage 坐标平移 margin-原点；sx/sy 用于归一化裁形） */
export function buildPiecePathData(spec: ShapeSpec, pieceId: number, sx = 1, sy = 1): string {
  const { rows, cols, hEdges, vEdges, margin } = spec;
  const cw = spec.stageW / cols;
  const ch = spec.stageH / rows;
  const S = Math.min(cw, ch);
  const r = Math.floor(pieceId / cols);
  const c = pieceId % cols;

  const x0 = c * cw;
  const y0 = r * ch;
  const ox = margin - x0; // 舞台坐标 → 画布局部坐标
  const oy = margin - y0;
  const fx = (v: number): string => (v * sx).toFixed(4);
  const fy = (v: number): string => (v * sy).toFixed(4);

  let d = `M${fx(x0 + ox)} ${fy(y0 + oy)}`;
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
      d += `L${fx(to.x + ox)} ${fy(to.y + oy)}`;
      return;
    }
    const segs = reversed ? reverseSegs(tabSegments(params)) : tabSegments(params);
    for (const [, C1, C2, P3] of segs) {
      const a = mapPt(from, ex, ey, L, nx, ny, S, C1);
      const b = mapPt(from, ex, ey, L, nx, ny, S, C2);
      const p3 = mapPt(from, ex, ey, L, nx, ny, S, P3);
      d += `C${fx(a.x + ox)} ${fy(a.y + oy)} ${fx(b.x + ox)} ${fy(b.y + oy)} ${fx(p3.x + ox)} ${fy(p3.y + oy)}`;
    }
  };

  addSegs({ x: x0, y: y0 }, { x: x0 + cw, y: y0 }, hEdges[r][c], false); // 上
  addSegs({ x: x0 + cw, y: y0 }, { x: x0 + cw, y: y0 + ch }, vEdges[r][c + 1], false); // 右
  addSegs({ x: x0 + cw, y: y0 + ch }, { x: x0, y: y0 + ch }, hEdges[r + 1][c], true); // 下
  addSegs({ x: x0, y: y0 + ch }, { x: x0, y: y0 }, vEdges[r][c], true); // 左
  return `${d}Z`;
}

export function buildPiecePath(spec: ShapeSpec, pieceId: number): Path2D {
  return new Path2D(buildPiecePathData(spec, pieceId));
}

export interface BuiltPieceShape {
  /** 命中测试路径（画布局部坐标，逻辑尺寸见 logicalW/H） */
  path: Path2D;
  /** objectBoundingBox 归一化裁形引用 id（视图注入共享 <clipPath> 节点） */
  clipId: string;
  /** 归一化裁形路径（0-1 坐标 d 串），随元素尺寸自适应缩放 */
  clipD: string;
  /** 画布局部逻辑尺寸（stage px）：命中测试坐标换算用 */
  logicalW: number;
  logicalH: number;
}

/**
 * 整副棋盘的形状几何（F-513 图集化）：纯计算瞬时完成，不再逐块生成位图。
 * 块面像素由视图以共享舞台图为 background 图层提供，轮廓由 objectBoundingBox clip-path 裁出。
 */
export function buildPieceShapes(spec: ShapeSpec): BuiltPieceShape[] {
  const cw = spec.stageW / spec.cols;
  const ch = spec.stageH / spec.rows;
  const W = cw + spec.margin * 2;
  const H = ch + spec.margin * 2;
  const out: BuiltPieceShape[] = [];
  for (let id = 0; id < spec.rows * spec.cols; id++) {
    out.push({
      path: new Path2D(buildPiecePathData(spec, id)),
      clipId: `piece-clip-${id}`,
      clipD: buildPiecePathData(spec, id, 1 / W, 1 / H),
      logicalW: W,
      logicalH: H,
    });
  }
  return out;
}

/**
 * 舞台模糊折射图层（F-510 / F-513）：全场一次生成，Blob URL 供全部块以 background 图层共享。
 * screen 混合无逐层透明度可调，故按折射强度把 alpha 预先烘进图内（等价原 canvas globalAlpha）。
 */
export async function buildBlurredStageUrl(stageUrl: string, refraction = 0.22): Promise<string> {
  const img = new Image();
  img.src = stageUrl;
  await img.decode();
  const blur = buildBlurredStage(img);
  const bctx = blur.getContext('2d');
  if (bctx && refraction < 1) {
    bctx.globalCompositeOperation = 'destination-in';
    bctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, Math.min(1, refraction)).toFixed(3)})`;
    bctx.fillRect(0, 0, blur.width, blur.height);
  }
  return new Promise<string>((resolve) => {
    blur.toBlob((blob) => {
      resolve(blob ? URL.createObjectURL(blob) : blur.toDataURL('image/webp', 0.8));
    }, 'image/webp', 0.8);
  });
}

/**
 * 整图模糊底图：逐级 1/2 降采样到约 1/8 再放大回原尺寸。
 * 不用 ctx.filter（Safari 支持不完整），靠降采样+双线性放大获得天然模糊。
 */
function buildBlurredStage(img: HTMLImageElement): HTMLCanvasElement {
  const W = Math.max(1, img.naturalWidth);
  const H = Math.max(1, img.naturalHeight);
  let src: CanvasImageSource = img;
  let w = W;
  let h = H;
  for (let i = 0; i < 3; i++) {
    w = Math.max(1, Math.round(w / 2));
    h = Math.max(1, Math.round(h / 2));
    const step = document.createElement('canvas');
    step.width = w;
    step.height = h;
    const sctx = step.getContext('2d');
    if (!sctx) break;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, 0, 0, w, h);
    src = step;
  }
  const big = document.createElement('canvas');
  big.width = W;
  big.height = H;
  const bctx = big.getContext('2d');
  if (bctx) {
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(src, 0, 0, W, H);
  }
  return big;
}

