/**
 * 难度配置：按目标块数预设（默认约 40×25 形式的 1000 块），
 * 行列按图片宽高比自适应（cols/rows ≈ ratio），格子保持接近正方形。
 */
export interface PresetDifficulty {
  /** 目标块数（实际块数 = 行×列，随图片比例浮动） */
  target: number;
  labelKey: string;
}

export const PIECE_PRESETS: PresetDifficulty[] = [
  { target: 500, labelKey: 'p500' },
  { target: 1000, labelKey: 'p1000' },
  { target: 2000, labelKey: 'p2000' },
];

export const DEFAULT_PIECE_TARGET = 1000;

/** 目标块数允许范围（设置持久化的夹取范围） */
export const MIN_PIECE_TARGET = 100;
export const MAX_PIECE_TARGET = 4000;

export const MIN_DIM = 2;
/** 单边最大格数（防极端比例下退化，同时约束存档体积） */
export const MAX_DIM = 220;

/**
 * 按图片真实比例与目标块数计算行列：
 * rows = round(√(target / ratio))，cols = round(rows × ratio)，
 * 使 cols/rows ≈ 图片真实比例（不裁剪、格子接近正方形）。
 */
export function fitGrid(ratio: number, target: number): { rows: number; cols: number } {
  const r = Math.min(20, Math.max(0.05, ratio || 1));
  let rows = Math.max(MIN_DIM, Math.round(Math.sqrt(Math.max(target, 1) / r)));
  let cols = Math.max(MIN_DIM, Math.round(rows * r));
  // 极端比例下单边触顶时，反向重算另一边，尽量保持比例
  if (cols > MAX_DIM) {
    cols = MAX_DIM;
    rows = Math.max(MIN_DIM, Math.round(cols / r));
  }
  if (rows > MAX_DIM) {
    rows = MAX_DIM;
    cols = Math.max(MIN_DIM, Math.round(rows * r));
  }
  return { rows, cols };
}
