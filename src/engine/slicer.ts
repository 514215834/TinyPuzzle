import type { PuzzlePiece } from './types';

/** 单个格子的几何信息（舞台像素坐标） */
export interface CellRect {
  cell: number;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 行列切图：把舞台等分为 rows × cols 个格子 */
export function computeCells(stageW: number, stageH: number, rows: number, cols: number): CellRect[] {
  const w = stageW / cols;
  const h = stageH / rows;
  const cells: CellRect[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({ cell: row * cols + col, row, col, x: col * w, y: row * h, w, h });
    }
  }
  return cells;
}

/**
 * 由 assignment[cell] = pieceId 构建拼图块列表。
 * - lockOnSnap：初始落在正确格是否锁定（F-106）
 * - rots：按 pieceId 索引的初始朝向（F-303，仅 rotationEnabled 时生效）
 * - free：自由摆放模式下块不在格上（cell = -1）（F-302）
 */
export function buildPieces(
  assignment: number[],
  lockOnSnap = true,
  rots?: number[],
  rotationEnabled = false,
  free = false,
): PuzzlePiece[] {
  const n = assignment.length;
  if (free) {
    // 自由模式：assignment[cell] = pieceId（未归位记 -1）；缺失的块散置（cell = -1）
    const cellOf = new Map<number, number>();
    assignment.forEach((id, cell) => {
      if (id >= 0) cellOf.set(id, cell);
    });
    return Array.from({ length: n }, (_, id) => {
      const rot = rotationEnabled ? (rots?.[id] ?? 0) : 0;
      const cell = cellOf.get(id);
      const settled = cell !== undefined && cell === id; // 自由模式仅正确格才算落位
      return {
        id,
        cell: cell ?? -1,
        locked: settled && lockOnSnap && (!rotationEnabled || rot === 0),
        rot,
      };
    });
  }
  return assignment.map((id, cell) => {
    const rot = rotationEnabled ? (rots?.[id] ?? 0) : 0;
    const rotOk = !rotationEnabled || rot === 0;
    return { id, cell, locked: lockOnSnap && id === cell && rotOk, rot };
  });
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 屏幕坐标 → 格索引（越界时收敛到边缘格） */
export function cellAtPoint(
  px: number,
  py: number,
  boardW: number,
  boardH: number,
  rows: number,
  cols: number,
): number {
  const col = clamp(Math.floor((px / boardW) * cols), 0, cols - 1);
  const row = clamp(Math.floor((py / boardH) * rows), 0, rows - 1);
  return row * cols + col;
}
