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
  /** 指针类型：长按旋转仅触屏生效，鼠标误触率高（按下瞄准即超时） */
  pointerType: string;
  lastDx: number;
  lastDy: number;
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
    board.addEventListener('contextmenu', this.onContextMenu);
  }

  destroy(): void {
    const board = this.board;
    board.removeEventListener('pointerdown', this.onDown);
    board.removeEventListener('pointermove', this.onMove);
    board.removeEventListener('pointerup', this.onUp);
    board.removeEventListener('pointercancel', this.onCancel);
    board.removeEventListener('contextmenu', this.onContextMenu);
    window.clearTimeout(this.pressTimer);
  }

  /** 是否有进行中的拖拽（视图层判断是否让位给平移手势） */
  get dragging(): boolean {
    return this.session !== null;
  }

  /** 当前拖拽中的块 id（无则 null） */
  get heldPieceId(): number | null {
    return this.session?.pieceId ?? null;
  }

  /** 拖拽中键盘旋转后刷新持块姿态（Q/E 旋转） */
  refreshHeldRot(rot: number): void {
    const s = this.session;
    if (!s) return;
    s.el.dataset.rot = String(rot);
    s.el.style.transform = `translate3d(${s.lastDx}px, ${s.lastDy}px, 0) scale(1.04)${this.currentRot(s.el)}${this.flipSuffix(s.el)}`;
  }

  /** 背面翻转态后缀（查看编码） */
  private flipSuffix(el: HTMLElement): string {
    return el.dataset.flipped === '1' ? ' rotateY(180deg)' : '';
  }

  /** 棋盘视觉缩放系数：client px / 棋盘局部 px（视口缩放后两者不再相等） */
  private scaleFactor(): number {
    const rect = this.board.getBoundingClientRect();
    return rect.width / (this.board.offsetWidth || 1);
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
      pointerType: e.pointerType,
      lastDx: 0,
      lastDy: 0,
    };
    el.classList.add('dragging');
    el.style.zIndex = '30';
    if (this.cb.rotate) {
      window.clearTimeout(this.pressTimer);
      this.pressTimer = window.setTimeout(() => {
        if (this.session && !this.session.moved && this.session.pointerType === 'touch') this.cb.rotate?.(this.session.pieceId);
      }, LONG_PRESS_MS);
    }
  };

  /** 块中心棋盘坐标：格上块按格中心，自由散布块按像素位置（均为局部 px） */
  private centerOf(s: DragSession, dx: number, dy: number): { cx: number; cy: number } {
    const cw = this.board.offsetWidth / this.spec.cols;
    const ch = this.board.offsetHeight / this.spec.rows;
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

    // 位移统一换算为棋盘局部 px（client px / 缩放系数），视觉位移随缩放保持 1:1
    const scale = this.scaleFactor();
    const dx = (e.clientX - s.startX) / scale;
    const dy = (e.clientY - s.startY) / scale;
    s.lastDx = dx;
    s.lastDy = dy;
    if (!s.moved && Math.hypot(e.clientX - s.startX, e.clientY - s.startY) > LONG_PRESS_TOLERANCE) {
      s.moved = true;
      window.clearTimeout(this.pressTimer);
    }
    s.el.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.04)${this.currentRot(s.el)}`;

    // 以块中心判定目标格；中心拖出棋盘视为无目标
    const w = this.board.offsetWidth;
    const h = this.board.offsetHeight;
    const { cx, cy } = this.centerOf(s, dx, dy);
    const inside = cx >= 0 && cx <= w && cy >= 0 && cy <= h;
    const hit = inside
      ? cellAtPoint(cx, cy, w, h, this.spec.rows, this.spec.cols)
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

  private finish(e: PointerEvent, cancelled: boolean): void {
    const s = this.session;
    if (!s || e.pointerId !== s.pointerId) return;
    window.clearTimeout(this.pressTimer);
    this.session = null;
    s.el.classList.remove('dragging');
    this.cb.hoverChange(null);

    const scale = this.scaleFactor();
    const dx = (e.clientX - s.startX) / scale;
    const dy = (e.clientY - s.startY) / scale;
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
