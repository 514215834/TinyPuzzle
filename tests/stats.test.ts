import { describe, expect, it } from 'vitest';

import { StatsService, formatMs } from '../src/engine/stats';

describe('StatsService', () => {
  it('累计计时并支持暂停/恢复', () => {
    let t = 0;
    const stats = new StatsService(() => t);
    stats.start();
    t += 1500;
    expect(stats.elapsedMs).toBe(1500);
    stats.pause(); // 累计 1500
    t += 10_000; // 暂停期间不计时
    expect(stats.elapsedMs).toBe(1500);
    stats.resume();
    t += 500;
    expect(stats.elapsedMs).toBe(2000);
  });

  it('startWith 从已累计时长继续（进度恢复）', () => {
    let t = 100;
    const stats = new StatsService(() => t);
    stats.startWith(30_000);
    t += 2000;
    expect(stats.elapsedMs).toBe(32_000);
  });

  it('reset 语义：start 归零重新计时', () => {
    let t = 0;
    const stats = new StatsService(() => t);
    stats.start();
    t += 800;
    stats.start();
    t += 200;
    expect(stats.elapsedMs).toBe(200);
  });

  it('重复 pause / resume 幂等', () => {
    let t = 0;
    const stats = new StatsService(() => t);
    stats.pause();
    stats.resume();
    stats.resume();
    stats.start();
    t += 100;
    stats.pause();
    stats.pause();
    expect(stats.elapsedMs).toBe(100);
  });
});

describe('formatMs', () => {
  it('格式化为 mm:ss', () => {
    expect(formatMs(0)).toBe('00:00');
    expect(formatMs(950)).toBe('00:00');
    expect(formatMs(65_000)).toBe('01:05');
    expect(formatMs(600_500)).toBe('10:00');
    expect(formatMs(3_600_000)).toBe('60:00');
  });

  it('负值收敛为 00:00', () => {
    expect(formatMs(-5)).toBe('00:00');
  });
});
