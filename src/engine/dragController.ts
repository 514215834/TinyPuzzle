import { cellAtPoint } from './slicer';
import type { BoardSpec, DropOutcome } from './types';

export interface DragCallbacks {
  /** 是否可拾起该块（未锁定且对局未结束） */
  canPick: (pieceId: number) => boolean;
  /**
   * 视图层命中测试（含异形块路径命中与层级优先级，F-301），
   * 返回命中的拼图块元素，未命中返回 null。
   */
  pickAt: (clientX: number, clientY: number) => HTMLElement | null;
  /**
   * 释放结算。targetCell 为命中格（自由摆放模式下为块中心所在格）；
   * cx / cy 为块中心的棋盘坐标（自由摆放吸附判定用）。
   * 引擎状态在回调内更新，动画由视图层依据返回值播放。
   */
  drop: (
    pieceId: number,
    targetCell: number,
    dx: number,
    dy: number,
    cx: number,
    cy: number,
  ) => DropOutcome;
  /** 拖拽悬停信息变化（块 id + 目标格 + 块中心），null 表示无有效目标 */
  hoverChange: (info: { pieceId: number; cell: number | null; cx: number; cy: number } | null) => void;
  /** 旋转请求（F-303，双击 / 长按触发）；未启用旋转时不传 */
  rotate?: (pieceId: number) => void;
}

interface DragSession {
  pieceId: number;
  pointerId: number;
  startX: number;
  startY: number;
  el: HTMLElement;
  /** 拾起时所在格 */
  startCell: number;
  target: number | null;
  moved: boolean;
}

const LONG_PRESS_MS = 480;
const LONG_PRESS_TOLERANCE = 8;
const PICK_GRACE = 8;

/**
 * 拖拽控制（F-004）：Pointer Events 统一鼠标 / 触屏，
 * setPointerCapture 保证指针移出棋盘后仍持续跟踪。
 */
export class DragController {
  private session: DragSession | null = null;
  private pressTimer: number | undefined;

  constructor(
    private board: HTMLElement,
    private spec: BoardSpec,
    private cb: DragCallbacks,
  ) {
    board.addEventListener('pointerdown', this.onDown);
    board.addEventListener('pointermove', this.onMove);
    board.addEventListener('pointerup', this.onUp);
    board.addEventListener('pointercancel', this.onCancel);
    board.addEventListener('dblclick', this.onDblClick);
    board.addEventListener('contextmenu', this.onContextMenu);
  }

  destroy(): void {
    const board = this.board;
    board.removeEventListener('pointerdown', this.onDown);
    board.removeEventListener('pointermove', this.onMove);
    board.removeEventListener('pointerup', this.onUp);
    board.removeEventListener('pointercancel', this.onCancel);
    board.removeEventListener('dblclick', this.onDblClick);
    board.removeEventListener('contextmenu', this.onContextMenu);
    window.clearTimeout(this.pressTimer);
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault(); // 屏蔽长按右键菜单，避免干扰触屏拖拽
  };

  private onDown = (e: PointerEvent): void => {
    if (this.session || !e.isPrimary) return;
    let el = this.cb.pickAt(e.clientX, e.clientY);
    if (!el) {
      // 8px 容差（F-201）：小尺寸块在移动端更易触达
      const rect = this.board.getBoundingClientRect();
      if (
        e.clientX < rect.left - PICK_GRACE || e.clientX > rect.right + PICK_GRACE ||
        e.clientY < rect.top - PICK_GRACE || e.clientY > rect.bottom + PICK_GRACE
      ) {
        return;
      }
      const px = Math.min(Math.max(e.clientX, rect.left), rect.right - 1);
      const py = Math.min(Math.max(e.clientY, rect.top), rect.bottom - 1);
      el = this.cb.pickAt(px, py);
    }
    if (!el) return;
    const pieceId = Number(el.dataset.pieceId);
    if (!this.cb.canPick(pieceId)) return;

    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // 合成事件（无活动指针）等场景忽略
    }
    this.session = {
      pieceId,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      el,
      startCell: Number(el.dataset.cell),
      target: null,
      moved: false,
    };
    el.classList.add('dragging');
    el.style.zIndex = '30';
    if (this.cb.rotate) {
      window.clearTimeout(this.pressTimer);
      this.pressTimer = window.setTimeout(() => {
        if (this.session && !this.session.moved) this.cb.rotate?.(this.session.pieceId);
      }, LONG_PRESS_MS);
    }
  };

  /** 块中心棋盘坐标：格上块按格中心，自由散布块按像素位置 */
  private centerOf(s: DragSession, dx: number, dy: number): { cx: number; cy: number } {
    const rect = this.board.getBoundingClientRect();
    const cw = rect.width / this.spec.cols;
    const ch = rect.height / this.spec.rows;
    if (s.startCell >= 0) {
      return {
        cx: ((s.startCell % this.spec.cols) + 0.5) * cw + dx,
        cy: (Math.floor(s.startCell / this.spec.cols) + 0.5) * ch + dy,
      };
    }
    return {
      cx: Number(s.el.dataset.px ?? 0) + cw / 2 + dx,
      cy: Number(s.el.dataset.py ?? 0) + ch / 2 + dy,
    };
  }

  private onMove = (e: PointerEvent): void => {
    const s = this.session;
    if (!s || e.pointerId !== s.pointerId) return;
    e.preventDefault();

    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.moved && Math.hypot(dx, dy) > LONG_PRESS_TOLERANCE) {
      s.moved = true;
      window.clearTimeout(this.pressTimer);
    }
    s.el.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.04)${this.currentRot(s.el)}`;

    // 以块中心判定目标格；中心拖出棋盘视为无目标
    const rect = this.board.getBoundingClientRect();
    const { cx, cy } = this.centerOf(s, dx, dy);
    const inside = cx >= 0 && cx <= rect.width && cy >= 0 && cy <= rect.height;
    const hit = inside
      ? cellAtPoint(cx, cy, rect.width, rect.height, this.spec.rows, this.spec.cols)
      : null;
    const target = hit !== null && hit !== s.startCell ? hit : null;

    if (target !== s.target) {
      s.target = target;
      this.cb.hoverChange({ pieceId: s.pieceId, cell: target, cx, cy });
    }
  };

  private currentRot(el: HTMLElement): string {
    const rot = Number(el.dataset.rot ?? 0);
    return rot ? ` rotate(${rot * 90}deg)` : '';
  }

  private onDblClick = (e: MouseEvent): void => {
    if (!this.cb.rotate || this.session) return;
    const el = this.cb.pickAt(e.clientX, e.clientY);
    if (!el) return;
    const pieceId = Number(el.dataset.pieceId);
    if (this.cb.canPick(pieceId)) this.cb.rotate(pieceId);
  };

  private finish(e: PointerEvent, cancelled: boolean): void {
    const s = this.session;
    if (!s || e.pointerId !== s.pointerId) return;
    window.clearTimeout(this.pressTimer);
    this.session = null;
    s.el.classList.remove('dragging');
    this.cb.hoverChange(null);

    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    const { cx, cy } = this.centerOf(s, dx, dy);
    const target = cancelled ? s.startCell : (s.target ?? s.startCell);
    this.cb.drop(s.pieceId, target, dx, dy, cx, cy);
  }

  private onUp = (e: PointerEvent): void => {
    this.finish(e, false);
  };

  private onCancel = (e: PointerEvent): void => {
    this.finish(e, true);
  };
}
