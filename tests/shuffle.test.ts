import { describe, expect, it } from 'vitest';

import { shuffledAssignment } from '../src/engine/shuffle';

/** 可复现的确定性随机源 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('shuffledAssignment', () => {
  it.each([4, 9, 16, 100])('生成双射排列（n=%i）', (n) => {
    for (let seed = 0; seed < 20; seed++) {
      const arr = shuffledAssignment(n, mulberry32(seed));
      expect([...arr].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it('n ≤ 9 时完全错位（无一块在原位）', () => {
    for (const n of [4, 9]) {
      for (let seed = 0; seed < 50; seed++) {
        const arr = shuffledAssignment(n, mulberry32(seed));
        expect(arr.every((v, i) => v !== i)).toBe(true);
      }
    }
  });

  it('n > 9 时至少非完成态', () => {
    for (let seed = 0; seed < 50; seed++) {
      const arr = shuffledAssignment(16, mulberry32(seed));
      expect(arr.some((v, i) => v !== i)).toBe(true);
    }
  });

  it('同一随机种子结果可复现', () => {
    expect(shuffledAssignment(9, mulberry32(7))).toEqual(shuffledAssignment(9, mulberry32(7)));
  });

  it('随机源连续失败时兜底为整体轮转（仍完全错位）', () => {
    const arr = shuffledAssignment(9, () => 0.999999);
    expect(arr).toEqual(Array.from({ length: 9 }, (_, i) => (i + 1) % 9));
  });
});
