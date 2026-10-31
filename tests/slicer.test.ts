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
      { id: 1, cell: 0, locked: false, rot: 0 },
      { id: 0, cell: 1, locked: false, rot: 0 },
      { id: 2, cell: 2, locked: true, rot: 0 },
    ]);
  });

  it('旋转模式：按 rots 初始化朝向，朝向不对则不锁定', () => {
    const pieces = buildPieces([0, 1, 2], true, [0, 1, 0], true);
    expect(pieces[0]).toMatchObject({ id: 0, cell: 0, locked: true, rot: 0 });
    expect(pieces[1]).toMatchObject({ id: 1, cell: 1, locked: false, rot: 1 });
  });

  it('自由摆放模式：全部不在格上（F-302）', () => {
    const pieces = buildPieces([-1, -1, -1], true, undefined, false, true);
    expect(pieces.every((p) => p.cell === -1 && !p.locked)).toBe(true);
  });

  it('自由摆放恢复：正条目归位、-1 散置', () => {
    // cells: 格 0 放块 2（非正确格，不锁定），格 2 放块 0（正确格，锁定），块 1 未归位
    const pieces = buildPieces([2, -1, 0], true, undefined, false, true);
    expect(pieces).toEqual([
      { id: 0, cell: 2, locked: false, rot: 0 },
      { id: 1, cell: -1, locked: false, rot: 0 },
      { id: 2, cell: 0, locked: false, rot: 0 },
    ]);
    // 只有落在正确格的块才锁定
    const settled = buildPieces([0, -1, 2], true, undefined, false, true);
    expect(settled.map((p) => p.locked)).toEqual([true, false, true]);
  });
});
