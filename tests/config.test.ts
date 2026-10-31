import { describe, expect, it } from 'vitest';

import { fitGrid } from '../src/app/config';

describe('fitGrid（按图片比例自适应行列）', () => {
  it('1.6 比例 + 1000 块 → 40×25（默认档）', () => {
    expect(fitGrid(1.6, 1000)).toEqual({ rows: 25, cols: 40 });
  });

  it('4:3 + 1000 块 → 列/行 ≈ 4/3，格子接近正方形', () => {
    const { rows, cols } = fitGrid(4 / 3, 1000);
    expect(cols / rows).toBeCloseTo(4 / 3, 1);
    expect(rows * cols).toBeGreaterThanOrEqual(900);
    expect(rows * cols).toBeLessThanOrEqual(1100);
  });

  it('方图 + 1000 块 → 接近方形网格', () => {
    const { rows, cols } = fitGrid(1, 1000);
    expect(rows).toBe(32);
    expect(cols).toBe(32);
  });

  it('极端比例跟随真实比例（不夹取），单边不超上限', () => {
    const wide = fitGrid(10, 1000);
    expect(wide.cols / wide.rows).toBeCloseTo(10, 0);
    const tall = fitGrid(0.05, 1000);
    expect(tall.rows).toBeLessThanOrEqual(220);
    expect(fitGrid(1, 1).rows).toBeGreaterThanOrEqual(2);
  });
});
