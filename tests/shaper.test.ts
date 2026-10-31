import { describe, expect, it } from 'vitest';

import { buildShapeSpec, reverseSegs, tabSegments } from '../src/engine/shaper';

describe('shaper（F-301）', () => {
  it('边参数：边界为直线（null），内部边带随机互补参数', () => {
    const spec = buildShapeSpec(3, 3, 1024, 768, () => 0.42);
    expect(spec.hEdges).toHaveLength(4);
    expect(spec.hEdges[0].every((e) => e === null)).toBe(true);
    expect(spec.hEdges[3].every((e) => e === null)).toBe(true);
    expect(spec.hEdges[1].every((e) => e !== null)).toBe(true);
    expect(spec.vEdges).toHaveLength(3);
    expect(spec.vEdges[0][0]).toBeNull();
    expect(spec.vEdges[0][3]).toBeNull();
    expect(spec.vEdges[0][1]).not.toBeNull();
    expect(spec.margin).toBeGreaterThan(0);
  });

  it('同一随机源的边参数可复现', () => {
    const a = buildShapeSpec(3, 3, 1024, 768, () => 0.42);
    const b = buildShapeSpec(3, 3, 1024, 768, () => 0.42);
    expect(JSON.stringify(a.hEdges)).toBe(JSON.stringify(b.hEdges));
  });

  it('tabSegments：起止于基线两端，凸舌在 sign 方向', () => {
    const segs = tabSegments({ sign: 1, c: 0.5, w: 0.1, h: 0.23 });
    expect(segs).toHaveLength(8);
    expect(segs[0][0]).toEqual([0, 0]);
    expect(segs[7][3]).toEqual([1, 0]);
    // 头部圆拱控制点在 +u 方向
    const dome = segs[3];
    expect(dome[1][1]).toBeGreaterThan(0);
    expect(dome[2][1]).toBeGreaterThan(0);
    // 卡口造型：颈部（0.36h）比头部最宽处（0.66h）更窄
    const neck = segs[1][3][0];
    const bulb = segs[2][3][0];
    expect(Math.abs(bulb - 0.5)).toBeGreaterThan(Math.abs(neck - 0.5));
  });

  it('反向段与正向段几何互补（相邻块共享同一条曲线）', () => {
    const params = { sign: -1 as const, c: 0.47, w: 0.11, h: 0.25 };
    const forward = tabSegments(params);
    const backward = reverseSegs(forward);
    // 收集全部点（含控制点），验证反向集合 = 正向集合的 (1-t, -u) 映射
    const collect = (segs: typeof forward): string[] => {
      const pts: string[] = [JSON.stringify(segs[0][0])];
      for (const s of segs) pts.push(JSON.stringify(s[1]), JSON.stringify(s[2]), JSON.stringify(s[3]));
      return pts;
    };
    const fwd = collect(forward);
    const bwd = collect(backward);
    expect(bwd).toHaveLength(fwd.length);
    const inv = (json: string): string => {
      const [t, u] = JSON.parse(json) as [number, number];
      return JSON.stringify([1 - t, -u]);
    };
    // 反向的第 i 个点对应正向的倒数第 i 个点
    const mappedFwd = fwd.map(inv).reverse();
    for (let i = 0; i < bwd.length; i++) {
      expect(bwd[i]).toBeCloseToPts(mappedFwd[i]);
    }
  });
});

// 浮点比较辅助：JSON 字符串点近似相等
expect.extend({
  toBeCloseToPts(received: string, expected: string) {
    const [r0, r1] = JSON.parse(received) as [number, number];
    const [e0, e1] = JSON.parse(expected) as [number, number];
    const pass = Math.abs(r0 - e0) < 1e-9 && Math.abs(r1 - e1) < 1e-9;
    return { pass, message: (): string => `点 ${received} 与 ${expected} 不匹配` };
  },
});

declare module 'vitest' {
  interface Assertion {
    toBeCloseToPts(expected: string): void;
  }
}
