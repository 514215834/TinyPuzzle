import { describe, expect, it } from 'vitest';

import {
  MAX_RATIO,
  MIN_RATIO,
  clampBoardRatio,
  computeCrop,
  computeStageSize,
  isSupportedImage,
} from '../src/engine/imageProcessor';

describe('clampBoardRatio', () => {
  it('范围内的比例保持不变', () => {
    expect(clampBoardRatio(1)).toBe(1);
    expect(clampBoardRatio(1024 / 768)).toBeCloseTo(4 / 3, 10);
  });

  it('过扁 / 过长的比例被夹取', () => {
    expect(clampBoardRatio(5)).toBe(MAX_RATIO);
    expect(clampBoardRatio(0.3)).toBe(MIN_RATIO);
  });
});

describe('computeCrop', () => {
  it('宽图：左右居中裁剪', () => {
    const { sx, sy, sw, sh } = computeCrop(2000, 1000, 1);
    expect(sx).toBe(500);
    expect(sy).toBe(0);
    expect(sw).toBe(1000);
    expect(sh).toBe(1000);
  });

  it('高图：上下居中裁剪', () => {
    const { sx, sy, sw, sh } = computeCrop(1000, 2000, 1);
    expect(sx).toBe(0);
    expect(sy).toBe(500);
    expect(sw).toBe(1000);
    expect(sh).toBe(1000);
  });

  it('比例一致时不裁剪', () => {
    const { sx, sy, sw, sh } = computeCrop(800, 600, 800 / 600);
    expect(sx).toBe(0);
    expect(sy).toBe(0);
    expect(sw).toBe(800);
    expect(sh).toBe(600);
  });
});

describe('computeStageSize', () => {
  it('横图最长边为 1024', () => {
    expect(computeStageSize(4 / 3)).toEqual({ w: 1024, h: 768 });
  });

  it('竖图最长边为 1024', () => {
    expect(computeStageSize(3 / 4)).toEqual({ w: 768, h: 1024 });
  });
});

describe('isSupportedImage', () => {
  it('仅放行 png / jpeg / webp', () => {
    const f = (type: string) => new File(['x'], 'x', { type });
    expect(isSupportedImage(f('image/png'))).toBe(true);
    expect(isSupportedImage(f('image/jpeg'))).toBe(true);
    expect(isSupportedImage(f('image/webp'))).toBe(true);
    expect(isSupportedImage(f('image/gif'))).toBe(false);
    expect(isSupportedImage(f('application/pdf'))).toBe(false);
    expect(isSupportedImage(f('image/svg+xml'))).toBe(false);
  });
});
