import { describe, expect, it } from 'vitest';

import { resolveDrop } from '../src/engine/snapSolver';
import type { PuzzlePiece } from '../src/engine/types';

/** assignment[cell] = pieceId → 拼图块状态 */
function mk(assignment: number[], lockOnSnap = true): PuzzlePiece[] {
  return assignment.map((id, cell) => ({ id, cell, locked: lockOnSnap && id === cell }));
}

describe('resolveDrop', () => {
  it('落回自己的格子 → snapback 且状态不变', () => {
    const pieces = mk([2, 1, 0]);
    const { outcome, next } = resolveDrop(pieces, 0, 2); // 块 0 在格 2
    expect(outcome).toEqual({ type: 'snapback' });
    expect(next).toBe(pieces);
  });

  it('目标格已锁定 → bounce', () => {
    const pieces = mk([1, 0, 2]); // 块 2 已在正确格 2（锁定）
    const { outcome, next } = resolveDrop(pieces, 0, 2);
    expect(outcome).toEqual({ type: 'bounce' });
    expect(next).toBe(pieces);
  });

  it('互换后各自落对 → 双双锁定', () => {
    const pieces = mk([1, 0, 3, 2]); // 2×2：两对互换
    const { outcome, next } = resolveDrop(pieces, 0, 0); // 块 0（在格 1）放到格 0
    expect(outcome).toEqual({ type: 'swap', a: 0, b: 1 });
    expect(next.find((p) => p.id === 0)).toMatchObject({ cell: 0, locked: true });
    expect(next.find((p) => p.id === 1)).toMatchObject({ cell: 1, locked: true });
    expect(next.find((p) => p.id === 2)).toMatchObject({ cell: 3, locked: false });
  });

  it('互换后未全部归位 → solved 不触发', () => {
    const pieces = mk([1, 0, 3, 2]);
    const { outcome } = resolveDrop(pieces, 0, 0);
    expect(outcome.type).toBe('swap');
  });

  it('最后一次互换完成 → solved', () => {
    const pieces = mk([2, 1, 0]); // 仅块 1 锁定，0 与 2 互换即完成
    const { outcome, next } = resolveDrop(pieces, 0, 0); // 块 0（在格 2）放到格 0
    expect(outcome).toEqual({ type: 'solved', a: 0, b: 2 });
    expect(next.every((p) => p.locked)).toBe(true);
  });

  it('lockOnSnap=false：落对不锁定但仍可判定完成（F-106）', () => {
    const pieces = mk([2, 1, 0], false);
    const { outcome, next } = resolveDrop(pieces, 0, 0, false);
    expect(outcome.type).toBe('solved');
    expect(next.every((p) => !p.locked)).toBe(true); // 全程无锁定
    expect(next.every((p) => p.cell === p.id)).toBe(true); // 但按格子判定完成
  });

  it('lockOnSnap=false：落对的块仍可被再次交换', () => {
    const pieces = mk([1, 0, 3, 2]);
    const first = resolveDrop(pieces, 0, 0, false); // 块 0、1 落对但不锁定
    expect(first.next.find((p) => p.id === 0)?.locked).toBe(false);
    // 落对的块 0 仍可被拾起换走
    const second = resolveDrop(first.next, 1, 0, false);
    expect(second.outcome.type).toBe('swap');
    expect(second.next.find((p) => p.id === 0)).toMatchObject({ cell: 1 });
  });

  it('resolveDrop 为纯函数：不修改入参数组', () => {
    const pieces = mk([1, 0]);
    const snapshot = pieces.map((p) => ({ ...p }));
    resolveDrop(pieces, 0, 0);
    expect(pieces).toEqual(snapshot);
  });
});
