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

/** 由打乱后的 assignment[cell] = pieceId 构建拼图块列表；lockOnSnap 决定初始是否锁定（F-106） */
export function buildPieces(assignment: number[], lockOnSnap = true): PuzzlePiece[] {
  return assignment.map((id, cell) => ({ id, cell, locked: lockOnSnap && id === cell }));
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
