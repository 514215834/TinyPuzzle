import { describe, expect, it } from 'vitest';

import { PuzzleEngine } from '../src/engine/game';

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

describe('PuzzleEngine', () => {
  it('create：打乱为完全错位', () => {
    const engine = PuzzleEngine.create(3, 3, true, mulberry32(1));
    expect(engine.getPieces()).toHaveLength(9);
    expect(engine.placedCount).toBe(0);
    expect(engine.isSolved).toBe(false);
  });

  it('drop：有效交换步数 +1，弹回不计（F-104）', () => {
    const engine = new PuzzleEngine(2, 2, [1, 0, 3, 2]);
    expect(engine.drop(0, 1).type).toBe('snapback'); // 落回自己格子
    expect(engine.moves).toBe(0);
    expect(engine.drop(0, 0).type).toBe('swap');
    expect(engine.moves).toBe(1);
  });

  it('placedCount 与 isSolved 按格子判断，与锁定无关（F-106）', () => {
    const engine = new PuzzleEngine(2, 2, [1, 0, 3, 2], false);
    engine.drop(0, 0); // 0、1 归位但不锁定
    expect(engine.placedCount).toBe(2);
    expect(engine.isSolved).toBe(false);
    engine.drop(3, 3); // 剩余互换完成
    expect(engine.isSolved).toBe(true);
    expect(engine.getPieces().every((p) => !p.locked)).toBe(true);
  });

  it('lockOnSnap=true：落对即锁定，锁定格不可再落子', () => {
    const engine = new PuzzleEngine(2, 2, [1, 0, 3, 2], true);
    engine.drop(0, 0);
    expect(engine.piece(0).locked).toBe(true);
    expect(engine.drop(3, 0).type).toBe('bounce'); // 目标格已锁定
  });

  it('getAssignment 与构造参数互逆', () => {
    const engine = new PuzzleEngine(3, 3, [8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(engine.getAssignment()).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('restoreMoves 恢复进度步数', () => {
    const engine = new PuzzleEngine(2, 2, [1, 0, 3, 2]);
    engine.restoreMoves(42);
    expect(engine.moves).toBe(42);
    expect(engine.drop(0, 1).type).toBe('snapback');
    expect(engine.moves).toBe(42);
    expect(engine.drop(0, 0).type).toBe('swap');
    expect(engine.moves).toBe(43);
  });

  it('reshuffle：重置步数且保持完全错位（F-107）', () => {
    const engine = PuzzleEngine.create(3, 3, true, mulberry32(2));
    expect(engine.moves).toBe(0);
    engine.drop(0, 0); // 随便走一步
    engine.reshuffle(mulberry32(3));
    expect(engine.moves).toBe(0);
    expect(engine.placedCount).toBe(0);
    expect(engine.isSolved).toBe(false);
  });

  it('大棋盘（10×10）可创建并打乱', () => {
    const engine = PuzzleEngine.create(10, 10, true, mulberry32(4));
    expect(engine.getPieces()).toHaveLength(100);
    expect(engine.placedCount).toBe(0);
  });
});
