import { describe, expect, it } from 'vitest';

import { applyResult, recordKey, type RecordMap } from '../src/storage/records';

describe('recordKey', () => {
  it('按行列分档', () => {
    expect(recordKey(3, 3)).toBe('3x3');
    expect(recordKey(4, 5)).toBe('4x5');
  });
});

describe('applyResult', () => {
  it('首次成绩即为双项纪录', () => {
    const { map, newTimeRecord, newMovesRecord, bestTimeMs, bestMoves } = applyResult({}, 3, 3, 60_000, 20);
    expect(newTimeRecord).toBe(true);
    expect(newMovesRecord).toBe(true);
    expect(bestTimeMs).toBe(60_000);
    expect(bestMoves).toBe(20);
    expect(map['3x3']).toHaveLength(1);
  });

  it('更好成绩刷新纪录，更差成绩仅入档', () => {
    let map: RecordMap = {};
    map = applyResult(map, 3, 3, 60_000, 20).map;
    const second = applyResult(map, 3, 3, 50_000, 25);
    expect(second.newTimeRecord).toBe(true);
    expect(second.newMovesRecord).toBe(false);
    expect(second.bestTimeMs).toBe(50_000);
    expect(second.bestMoves).toBe(20);
  });

  it('各难度档互不干扰', () => {
    let map: RecordMap = {};
    map = applyResult(map, 3, 3, 10_000, 5).map;
    const other = applyResult(map, 4, 4, 99_999, 99);
    expect(other.newTimeRecord).toBe(true);
    expect(map['3x3']).toHaveLength(1);
  });

  it('记录按档位封顶保留最近 10 条', () => {
    let map: RecordMap = {};
    for (let i = 1; i <= 15; i++) {
      map = applyResult(map, 3, 3, i * 1000, i).map;
    }
    expect(map['3x3']).toHaveLength(10);
    expect(map['3x3'][0].time).toBe(6000); // 最旧的 5 条被裁剪
  });

  it('applyResult 为纯函数：不修改传入 map', () => {
    const map: RecordMap = { '3x3': [{ time: 1000, moves: 5, at: 1 }] };
    const snapshot = JSON.stringify(map);
    applyResult(map, 3, 3, 2000, 6);
    expect(JSON.stringify(map)).toBe(snapshot);
  });
});
