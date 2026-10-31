import { cellAtPoint } from './slicer';
import type { BoardSpec, DropOutcome } from './types';

export interface DragCallbacks {
  /** 是否可拾起该块（未锁定且对局未结束） */
  canPick: (pieceId: number) => boolean;
  /**
   * 释放结算。targetCell 为有效目标格；块被拖出棋盘时为其原格。
   * 引擎状态在回调内更新，动画由视图层依据返回值播放。
   */
  drop: (pieceId: number, targetCell: number, dx: number, dy: number) => DropOutcome;
  /** 拖拽命中的目标格变化（null 表示无有效目标），用于高亮 */
  targetCellChange: (cell: number | null) => void;
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
}

/**
 * 拖拽控制（F-004）：Pointer Events 统一鼠标 / 触屏，
 * setPointerCapture 保证指针移出棋盘后仍持续跟踪。
 */
export class DragController {
  private session: DragSession | null = null;

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
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault(); // 屏蔽长按右键菜单，避免干扰触屏拖拽
  };

  private onDown = (e: PointerEvent): void => {
    if (this.session || !e.isPrimary) return;
    const el = this.pickElement(e);
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
    };
    el.classList.add('dragging');
    el.style.zIndex = '30';
  };

  /** 命中拼图块；未直接命中时提供 8px 容差（F-201，小尺寸块更易触达） */
  private pickElement(e: PointerEvent): HTMLElement | null {
    const direct = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-piece-id]');
    if (direct) return direct;

    const rect = this.board.getBoundingClientRect();
    const pad = 8;
    if (
      e.clientX < rect.left - pad || e.clientX > rect.right + pad ||
      e.clientY < rect.top - pad || e.clientY > rect.bottom + pad
    ) {
      return null;
    }
    const px = Math.min(Math.max(e.clientX, rect.left), rect.right - 1);
    const py = Math.min(Math.max(e.clientY, rect.top), rect.bottom - 1);
    const cell = cellAtPoint(px - rect.left, py - rect.top, rect.width, rect.height, this.spec.rows, this.spec.cols);
    return this.board.querySelector<HTMLElement>(`[data-cell="${cell}"]`);
  }

  private onMove = (e: PointerEvent): void => {
    const s = this.session;
    if (!s || e.pointerId !== s.pointerId) return;
    e.preventDefault();

    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    s.el.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.04)`;

    // 以块中心判定目标格；中心拖出棋盘视为无效落点
    const rect = this.board.getBoundingClientRect();
    const cw = rect.width / this.spec.cols;
    const ch = rect.height / this.spec.rows;
    const cx = ((s.startCell % this.spec.cols) + 0.5) * cw + dx;
    const cy = (Math.floor(s.startCell / this.spec.cols) + 0.5) * ch + dy;
    const inside = cx >= 0 && cx <= rect.width && cy >= 0 && cy <= rect.height;
    const hit = inside
      ? cellAtPoint(cx, cy, rect.width, rect.height, this.spec.rows, this.spec.cols)
      : null;
    const target = hit !== null && hit !== s.startCell ? hit : null;

    if (target !== s.target) {
      s.target = target;
      this.cb.targetCellChange(target);
    }
  };

  private finish(e: PointerEvent, cancelled: boolean): void {
    const s = this.session;
    if (!s || e.pointerId !== s.pointerId) return;
    this.session = null;
    s.el.classList.remove('dragging');
    this.cb.targetCellChange(null);

    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    const target = cancelled ? s.startCell : (s.target ?? s.startCell);
    this.cb.drop(s.pieceId, target, dx, dy);
  }

  private onUp = (e: PointerEvent): void => {
    this.finish(e, false);
  };

  private onCancel = (e: PointerEvent): void => {
    this.finish(e, true);
  };
}
