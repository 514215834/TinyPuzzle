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

describe('PuzzleEngine（交换式）', () => {
  it('create：打乱为完全错位', () => {
    const engine = PuzzleEngine.create(3, 3, {}, mulberry32(1));
    expect(engine.getPieces()).toHaveLength(9);
    expect(engine.placedCount).toBe(0);
    expect(engine.isSolved).toBe(false);
  });

  it('drop：有效交换步数 +1，弹回不计（F-104）', () => {
    const engine = new PuzzleEngine(2, 2, [1, 0, 3, 2]);
    expect(engine.drop(0, 1).type).toBe('snapback');
    expect(engine.moves).toBe(0);
    expect(engine.drop(0, 0).type).toBe('swap');
    expect(engine.moves).toBe(1);
  });

  it('placedCount 与 isSolved 按格子判断，与锁定无关（F-106）', () => {
    const engine = new PuzzleEngine(2, 2, [1, 0, 3, 2], { lockOnSnap: false });
    engine.drop(0, 0);
    expect(engine.placedCount).toBe(2);
    expect(engine.isSolved).toBe(false);
    engine.drop(3, 3);
    expect(engine.isSolved).toBe(true);
    expect(engine.getPieces().every((p) => !p.locked)).toBe(true);
  });

  it('lockOnSnap=true：落对即锁定，锁定格不可再落子', () => {
    const engine = new PuzzleEngine(2, 2, [1, 0, 3, 2], { lockOnSnap: true });
    engine.drop(0, 0);
    expect(engine.piece(0).locked).toBe(true);
    expect(engine.drop(3, 0).type).toBe('bounce');
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
    const engine = PuzzleEngine.create(3, 3, {}, mulberry32(2));
    engine.drop(0, 0);
    engine.reshuffle(mulberry32(3));
    expect(engine.moves).toBe(0);
    expect(engine.placedCount).toBe(0);
    expect(engine.isSolved).toBe(false);
  });

  it('大棋盘（10×10）可创建并打乱', () => {
    const engine = PuzzleEngine.create(10, 10, {}, mulberry32(4));
    expect(engine.getPieces()).toHaveLength(100);
    expect(engine.placedCount).toBe(0);
  });
});

describe('PuzzleEngine（旋转模式，F-303）', () => {
  it('初始朝向随机但可恢复', () => {
    const engine = PuzzleEngine.create(5, 5, { rotationEnabled: true }, mulberry32(5));
    const rots = engine.getRots();
    expect(rots).toHaveLength(25);
    expect(rots.every((r) => Number.isInteger(r) && r >= 0 && r <= 3)).toBe(true);
  });

  it('rotatePiece 循环 0→1→2→3→0，并解除正确格上的锁定', () => {
    const engine = new PuzzleEngine(2, 2, [0, 1, 3, 2], { rotationEnabled: true, lockOnSnap: true });
    engine.drop(0, 0); // 块 0 归位但 rot=0 → 锁定
    expect(engine.piece(0).locked).toBe(true);
    expect(engine.rotatePiece(0)).toBe(1);
    expect(engine.piece(0)).toMatchObject({ cell: 0, rot: 1, locked: false });
    engine.rotatePiece(0);
    engine.rotatePiece(0);
    expect(engine.rotatePiece(0)).toBe(0);
    expect(engine.piece(0).locked).toBe(true);
  });

  it('位置正确但朝向不对 → 不算归位、不锁定', () => {
    const engine = new PuzzleEngine(2, 2, [1, 0, 3, 2], { rotationEnabled: true, rots: [2, 0, 0, 0] });
    engine.drop(0, 0); // 块 0 落到正确格，但 rot=2
    expect(engine.piece(0)).toMatchObject({ cell: 0, rot: 2, locked: false });
    expect(engine.placedCount).toBe(1); // 块 1 初始即归位
    expect(engine.isSolved).toBe(false);
  });

  it('全部归位且朝向正确 → solved', () => {
    const engine = new PuzzleEngine(2, 2, [1, 0, 3, 2], { rotationEnabled: true, rots: [3, 0, 0, 0] });
    engine.drop(0, 0); // 块 0 落对但 rot=3
    engine.rotatePiece(0); // 3→0 转正 → 锁定
    expect(engine.placedCount).toBe(2);
    expect(engine.drop(3, 3).type).toBe('solved');
  });
});

describe('PuzzleEngine（自由摆放，F-302）', () => {
  it('自由模式初始全部散置（cell=-1）', () => {
    const engine = PuzzleEngine.create(3, 3, { mode: 'free' }, mulberry32(6));
    expect(engine.getPieces().every((p) => p.cell === -1 && !p.locked)).toBe(true);
    expect(engine.placedCount).toBe(0);
  });

  it('lockPiece 归位 + countMove 计步', () => {
    const engine = PuzzleEngine.create(2, 2, { mode: 'free' }, mulberry32(7));
    engine.lockPiece(1);
    engine.countMove();
    expect(engine.piece(1)).toMatchObject({ cell: 1, locked: true });
    expect(engine.moves).toBe(1);
    expect(engine.isSolved).toBe(false);
  });

  it('自由模式最后一次归位 → solved', () => {
    const engine = PuzzleEngine.create(2, 2, { mode: 'free' }, mulberry32(8));
    for (const id of [0, 1, 2]) {
      engine.lockPiece(id);
      engine.countMove();
    }
    const outcome = engine.lockPiece(3);
    expect(outcome).toEqual({ type: 'solved' });
    expect(engine.isSolved).toBe(true);
  });

  it('getAssignment：未归位记 -1', () => {
    const engine = PuzzleEngine.create(2, 2, { mode: 'free' }, mulberry32(9));
    engine.lockPiece(0);
    expect(engine.getAssignment()).toEqual([0, -1, -1, -1]);
  });

  it('自由模式 + 旋转：朝向不对仅落位不锁定', () => {
    const engine = new PuzzleEngine(2, 2, [0, 1, 3, 2], {
      mode: 'free',
      rotationEnabled: true,
      rots: [3, 0, 0, 0],
    });
    const outcome = engine.lockPiece(0);
    expect(outcome).toEqual({ type: 'placed' });
    expect(engine.piece(0)).toMatchObject({ cell: 0, rot: 3, locked: false });
    expect(engine.isSolved).toBe(false);
  });
});
