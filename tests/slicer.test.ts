import { describe, expect, it } from 'vitest';

import { buildPieces, cellAtPoint, computeCells } from '../src/engine/slicer';

describe('computeCells', () => {
  it('等分 1024×768 为 3×3', () => {
    const cells = computeCells(1024, 768, 3, 3);
    expect(cells).toHaveLength(9);
    expect(cells[0]).toMatchObject({ cell: 0, row: 0, col: 0, x: 0, y: 0 });
    expect(cells[4]).toMatchObject({ cell: 4, row: 1, col: 1 });
    for (const c of cells) {
      expect(c.w).toBeCloseTo(1024 / 3);
      expect(c.h).toBeCloseTo(768 / 3);
    }
    // 覆盖整个舞台
    const last = cells[8];
    expect(last.x + last.w).toBeCloseTo(1024);
    expect(last.y + last.h).toBeCloseTo(768);
  });

  it('支持非方形行列（2×4）', () => {
    const cells = computeCells(800, 400, 2, 4);
    expect(cells).toHaveLength(8);
    expect(cells[5]).toMatchObject({ row: 1, col: 1 });
    expect(cells[5].w).toBeCloseTo(200);
    expect(cells[5].h).toBeCloseTo(200);
  });
});

describe('cellAtPoint', () => {
  const W = 300;
  const H = 300;

  it('命中格中心', () => {
    expect(cellAtPoint(50, 50, W, H, 3, 3)).toBe(0);
    expect(cellAtPoint(150, 150, W, H, 3, 3)).toBe(4);
    expect(cellAtPoint(250, 250, W, H, 3, 3)).toBe(8);
  });

  it('边界坐标收敛到边缘格', () => {
    expect(cellAtPoint(0, 0, W, H, 3, 3)).toBe(0);
    expect(cellAtPoint(300, 300, W, H, 3, 3)).toBe(8);
    expect(cellAtPoint(-50, -50, W, H, 3, 3)).toBe(0); // 越界收敛
    expect(cellAtPoint(999, 999, W, H, 3, 3)).toBe(8);
  });
});

describe('buildPieces', () => {
  it('按 assignment 建块并初始化锁定状态', () => {
    const pieces = buildPieces([1, 0, 2]);
    expect(pieces).toEqual([
      { id: 1, cell: 0, locked: false },
      { id: 0, cell: 1, locked: false },
      { id: 2, cell: 2, locked: true },
    ]);
  });
});
