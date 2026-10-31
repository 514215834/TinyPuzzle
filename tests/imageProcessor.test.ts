import { describe, expect, it } from 'vitest';

import { computeStageSize, isSupportedImage } from '../src/engine/imageProcessor';

describe('computeStageSize', () => {
  it('横图最长边为 2048', () => {
    expect(computeStageSize(4 / 3)).toEqual({ w: 2048, h: 1536 });
  });

  it('竖图最长边为 2048', () => {
    expect(computeStageSize(3 / 4)).toEqual({ w: 1536, h: 2048 });
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
