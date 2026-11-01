import { describe, expect, it } from 'vitest';

import { PhysWorld } from '../src/engine/physics';

/** 完全弹性、无阻尼：便于做守恒类断言 */
const ELASTIC = { restitution: 1, damping: 1 };
const FIELD = { x: 0, y: 0, w: 600, h: 600 };

describe('PhysWorld（桌面俯视物理 F-511）', () => {
  it('等质量对心碰撞：速度交换、动量守恒', () => {
    const w = new PhysWorld(ELASTIC);
    w.setBounds(FIELD);
    w.ensureBody(1, 30, 100, 10);
    w.ensureBody(2, 45, 100, 10);
    w.launch(1, 30, 100, 100, 0);
    w.launch(2, 45, 100, 0, 0);
    w.step(1 / 60);
    const a = w.bodyOf(1)!;
    const b = w.bodyOf(2)!;
    expect(a.vx).toBeCloseTo(0, 6);
    expect(b.vx).toBeCloseTo(100, 6);
    expect(a.vx + b.vx).toBeCloseTo(100, 6); // 动量守恒
  });

  it('碰撞位置修正：重叠对被逐步推开', () => {
    const w = new PhysWorld(ELASTIC);
    w.setBounds(FIELD);
    w.ensureBody(1, 100, 100, 10);
    w.ensureBody(2, 106, 100, 10); // pen = 14
    w.launch(1, 100, 100, 0, 0);
    w.launch(2, 106, 100, 0, 0);
    for (let i = 0; i < 10; i++) w.step(1 / 60);
    const d = Math.abs(w.bodyOf(2)!.x - w.bodyOf(1)!.x);
    expect(d).toBeGreaterThan(18); // 位置修正迭代后基本分离
  });

  it('边界反弹：法向速度按恢复系数反转', () => {
    const w = new PhysWorld({ restitution: 0.5, damping: 1 });
    w.setBounds(FIELD);
    w.ensureBody(1, 8, 300, 10); // 8 - 10 已越过左墙
    w.launch(1, 8, 300, -100, 0);
    w.step(1 / 60);
    const b = w.bodyOf(1)!;
    expect(b.x).toBeCloseTo(10, 6); // 贴墙
    expect(b.vx).toBeCloseTo(50, 6); // -(-100) * 0.5
  });

  it('静态体不可推动，动态体被弹回', () => {
    const w = new PhysWorld(ELASTIC);
    w.setBounds(FIELD);
    w.ensureBody(1, 30, 100, 10);
    w.ensureBody(2, 45, 100, 10); // static
    w.launch(1, 30, 100, 100, 0);
    w.step(1 / 60);
    expect(w.bodyOf(2)!.x).toBe(45); // 未动
    expect(w.bodyOf(1)!.vx).toBeLessThan(0); // 被弹回
  });

  it('低速连续步数达到后入睡，isSettled 为真', () => {
    const w = new PhysWorld({ damping: 1 });
    w.setBounds(FIELD);
    w.ensureBody(1, 100, 100, 10);
    w.launch(1, 100, 100, 5, 0); // 低于默认 sleepSpeed=10
    for (let i = 0; i < 5; i++) w.step(1 / 60);
    expect(w.bodyOf(1)!.sleeping).toBe(false);
    w.step(1 / 60); // 第 6 步入睡
    expect(w.bodyOf(1)!.sleeping).toBe(true);
    expect(w.isSettled).toBe(true);
    expect(w.step(1 / 60)).toEqual([]); // 全睡后无位移
  });

  it('沉睡块被足够冲击唤醒并参与碰撞', () => {
    const w = new PhysWorld({});
    w.setBounds(FIELD);
    w.ensureBody(1, 100, 100, 10);
    w.launch(1, 100, 100, 1, 0);
    for (let i = 0; i < 10; i++) w.step(1 / 60); // 入睡
    expect(w.bodyOf(1)!.sleeping).toBe(true);
    w.ensureBody(2, 60, 100, 10);
    w.launch(2, 60, 100, 300, 0); // 高速逼近（需数步后才接触）
    for (let i = 0; i < 12; i++) w.step(1 / 60);
    expect(w.bodyOf(1)!.sleeping).toBe(false);
    expect(Math.abs(w.bodyOf(1)!.vx)).toBeGreaterThan(0);
  });

  it('launch 受 maxDynamic 上限约束', () => {
    const w = new PhysWorld({ maxDynamic: 1 });
    w.ensureBody(1, 0, 0, 10);
    w.ensureBody(2, 100, 0, 10);
    expect(w.launch(1, 0, 0, 50, 0)).toBe(true);
    expect(w.launch(2, 100, 0, 0, 0)).toBe(false);
    expect(w.bodyOf(2)!.kind).toBe('static');
  });

  it('拖拽块（kinematic）推挤静置块：唤醒为 dynamic 并被推开', () => {
    const w = new PhysWorld({});
    w.setBounds(FIELD);
    w.ensureBody(1, 85, 100, 10);
    w.ensureBody(2, 100, 100, 10);
    w.setKinematic(1, 85, 100, 200, 0);
    const moved = w.step(1 / 60);
    const b = w.bodyOf(2)!;
    expect(b.kind).toBe('dynamic');
    expect(b.x).toBeGreaterThan(100);
    expect(b.vx).toBeGreaterThan(0);
    expect(moved).not.toContain(1); // kinematic 不进 moved
    expect(moved).toContain(2);
  });

  it('拖拽块位置由指针控制，不因碰撞位移', () => {
    const w = new PhysWorld({});
    w.setBounds(FIELD);
    w.ensureBody(1, 85, 100, 10);
    w.ensureBody(2, 100, 100, 10);
    w.setKinematic(1, 85, 100, 0, 0); // 指针静止压入
    w.step(1 / 60);
    w.step(1 / 60);
    expect(w.bodyOf(1)!.x).toBe(85); // 不被弹开
  });

  it('setKinematic / launch 的动态计数守恒', () => {
    const w = new PhysWorld({});
    w.ensureBody(1, 0, 0, 10);
    w.setKinematic(1, 0, 0, 10, 0); // static → kinematic
    expect(w.dynamicCount).toBe(0);
    expect(w.launch(1, 0, 0, 10, 0)).toBe(true); // kinematic → dynamic
    expect(w.dynamicCount).toBe(1);
    expect(w.isSettled).toBe(false);
    w.removeBody(1);
    expect(w.dynamicCount).toBe(0);
    expect(w.isSettled).toBe(true);
  });

  it('clampIntoBounds 把越界 body 夹回边界内', () => {
    const w = new PhysWorld({});
    w.setBounds(FIELD);
    w.ensureBody(1, -50, 700, 10);
    w.clampIntoBounds();
    const b = w.bodyOf(1)!;
    expect(b.x).toBe(10);
    expect(b.y).toBe(590);
  });
});
