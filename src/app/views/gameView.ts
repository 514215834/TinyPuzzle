import { playTone } from '../audio';
import { startConfetti } from '../components/confetti';
import { DragController } from '../../engine/dragController';
import { PuzzleEngine } from '../../engine/game';
import { StatsService, formatMs } from '../../engine/stats';
import type { DropOutcome } from '../../engine/types';
import { clearProgress, saveProgress } from '../../storage/progress';
import { submitResult } from '../../storage/records';
import { loadSettings, saveSettings } from '../../storage/settings';
import { must } from '../../utils/dom';
import type { GameSession } from '../session';

/** 交换动画时长（与 CSS transition 保持一致） */
const ANIM_MS = 240;
/** 开局入场动画时长 */
const ENTER_MS = 950;
/** 进度快照节流间隔 */
const SAVE_THROTTLE_MS = 400;

/** 游戏页（F-003 ~ F-007 / F-101~F-106 / F-201~F-205） */
export class GameView {
  private readonly board: HTMLElement;
  private readonly wrap: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly resultSub: HTMLElement;
  private readonly resultRecords: HTMLElement;
  private readonly statTime: HTMLElement;
  private readonly statMoves: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly btnSound: HTMLButtonElement;
  private readonly btnHint: HTMLButtonElement;
  private readonly btnLock: HTMLButtonElement;

  private session: GameSession | null = null;
  private engine: PuzzleEngine | null = null;
  private stats = new StatsService();
  private controller: DragController | null = null;
  private settings = loadSettings();
  private rows = 3;
  private cols = 3;
  private animating = false;
  private timers: number[] = [];
  private saveTimer: number | undefined;

  private readonly onResize = (): void => this.fitBoard();
  private readonly onVisibility = (): void => {
    if (!this.engine || this.engine.isSolved) return;
    if (document.hidden) this.stats.pause();
    else this.stats.resume();
  };
  private readonly tick = (): void => {
    if (this.engine && !this.engine.isSolved) {
      this.statTime.textContent = formatMs(this.stats.elapsedMs);
    }
  };

  constructor(root: HTMLElement) {
    this.board = must(root.querySelector<HTMLElement>('#board'), '#board');
    this.wrap = must(root.querySelector<HTMLElement>('#board-wrap'), '#board-wrap');
    this.hintEl = must(root.querySelector<HTMLElement>('#hint-overlay'), '#hint-overlay');
    this.overlay = must(document.querySelector<HTMLElement>('#result-overlay'), '#result-overlay');
    this.resultSub = must(document.querySelector<HTMLElement>('#result-sub'), '#result-sub');
    this.resultRecords = must(document.querySelector<HTMLElement>('#result-records'), '#result-records');
    this.statTime = must(document.querySelector<HTMLElement>('#stat-time'), '#stat-time');
    this.statMoves = must(document.querySelector<HTMLElement>('#stat-moves'), '#stat-moves');
    this.progressEl = must(document.querySelector<HTMLElement>('#progress'), '#progress');
    this.btnSound = must(root.querySelector<HTMLButtonElement>('#btn-sound'), '#btn-sound');
    this.btnHint = must(root.querySelector<HTMLButtonElement>('#btn-hint'), '#btn-hint');
    this.btnLock = must(root.querySelector<HTMLButtonElement>('#btn-lock'), '#btn-lock');

    must(root.querySelector<HTMLButtonElement>('#btn-back'), '#btn-back').addEventListener('click', () => {
      location.hash = '#/';
    });
    must(root.querySelector<HTMLButtonElement>('#btn-restart'), '#btn-restart').addEventListener('click', () =>
      this.restart(),
    );
    must(document.querySelector<HTMLButtonElement>('#btn-again'), '#btn-again').addEventListener('click', () => {
      this.hideDialog();
      this.restart();
    });
    must(document.querySelector<HTMLButtonElement>('#btn-change'), '#btn-change').addEventListener('click', () => {
      this.hideDialog();
      location.hash = '#/';
    });

    this.btnSound.addEventListener('click', () => {
      this.settings = saveSettings({ soundOn: !this.settings.soundOn });
      this.syncToggleButtons();
    });
    this.btnHint.addEventListener('click', () => {
      this.settings = saveSettings({ hintEnabled: !this.settings.hintEnabled });
      this.applyHint();
      this.syncToggleButtons();
    });
    this.btnLock.addEventListener('click', () => {
      this.settings = saveSettings({ lockOnSnap: !this.settings.lockOnSnap });
      if (this.engine) this.engine.lockOnSnap = this.settings.lockOnSnap;
      this.syncToggleButtons();
    });

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  mount(session: GameSession): void {
    this.unmount(); // 每次进入都全新开局/恢复
    this.session = session;
    this.settings = loadSettings();
    this.rows = session.rows;
    this.cols = session.cols;

    const saved = session.saved;
    this.engine = saved
      ? new PuzzleEngine(this.rows, this.cols, saved.cells, this.settings.lockOnSnap)
      : PuzzleEngine.create(this.rows, this.cols, this.settings.lockOnSnap);
    if (saved) this.engine.restoreMoves(saved.moves);
    this.stats = new StatsService();
    if (saved) this.stats.startWith(saved.elapsedMs);
    else this.stats.start();

    this.board.style.backgroundSize = `${100 / this.cols}% ${100 / this.rows}%`;
    this.hintEl.style.backgroundImage = `url("${session.stage.dataUrl}")`;
    this.hintEl.style.opacity = String(this.settings.hintOpacity);
    this.applyHint();
    this.syncToggleButtons();

    this.buildPieces();
    this.controller = new DragController(this.board, { rows: this.rows, cols: this.cols }, {
      canPick: this.canPick,
      drop: this.drop,
      targetCellChange: this.targetCellChange,
    });
    this.fitBoard();
    this.saveProgressNow();

    // 开局入场动画（F-202）
    this.animating = true;
    this.later(() => {
      this.animating = false;
    }, ENTER_MS);
    this.timers.push(window.setInterval(this.tick, 500));
  }

  unmount(): void {
    this.controller?.destroy();
    this.controller = null;
    this.engine = null;
    this.session = null;
    this.animating = false;
    window.clearTimeout(this.saveTimer);
    for (const t of this.timers) window.clearInterval(t);
    this.timers = [];
    this.board.querySelectorAll('.piece').forEach((el) => el.remove());
    this.board.classList.remove('solved');
    this.hideHint();
    this.overlay.classList.add('hidden');
  }

  // ---------- 构建 / 同步 ----------

  private buildPieces(): void {
    const stage = must(this.session, '对局参数缺失').stage;
    for (const p of must(this.engine, '引擎未初始化').getPieces()) {
      const el = document.createElement('div');
      el.className = 'piece enter';
      el.dataset.pieceId = String(p.id);
      const col = p.id % this.cols;
      const row = Math.floor(p.id / this.cols);
      el.style.width = `${100 / this.cols}%`;
      el.style.height = `${100 / this.rows}%`;
      el.style.backgroundImage = `url("${stage.dataUrl}")`;
      el.style.backgroundSize = `${this.cols * 100}% ${this.rows * 100}%`;
      el.style.backgroundPosition = `${(col / (this.cols - 1)) * 100}% ${(row / (this.rows - 1)) * 100}%`;
      el.style.animationDelay = `${p.id * 22}ms`;
      el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
      this.board.appendChild(el);
    }
    this.syncPieces();
  }

  /** 以引擎状态全量同步 DOM（≤100 块全量同步开销可接受） */
  private syncPieces(): void {
    const engine = must(this.engine, '引擎未初始化');
    for (const p of engine.getPieces()) {
      const el = this.pieceEl(p.id);
      if (!el) continue;
      const col = p.cell % this.cols;
      const row = Math.floor(p.cell / this.cols);
      el.style.left = `${(col * 100) / this.cols}%`;
      el.style.top = `${(row * 100) / this.rows}%`;
      el.dataset.cell = String(p.cell);
      el.classList.toggle('locked', p.locked);
      el.style.zIndex = p.locked ? '0' : '1';
    }
    this.progressEl.textContent = `${engine.placedCount}/${this.rows * this.cols}`;
    this.statMoves.textContent = `${engine.moves} 步`;
  }

  private pieceEl(id: number): HTMLElement | null {
    return this.board.querySelector<HTMLElement>(`[data-piece-id="${id}"]`);
  }

  // ---------- 拖拽回调 ----------

  private canPick = (pieceId: number): boolean => {
    if (!this.engine || this.engine.isSolved || this.animating) return false;
    const ok = !this.engine.piece(pieceId).locked;
    if (ok) playTone('pick', this.settings.soundOn);
    return ok;
  };

  private drop = (pieceId: number, targetCell: number, dx: number, dy: number): DropOutcome => {
    const engine = must(this.engine, '引擎未初始化');
    const dragged = must(this.pieceEl(pieceId), '拖拽块元素缺失');
    const oldDraggedCell = Number(dragged.dataset.cell);
    const displaced = engine.pieceAt(targetCell);
    const oldDisplacedCell =
      displaced.id === pieceId ? oldDraggedCell : Number(this.pieceEl(displaced.id)?.dataset.cell);

    const placedBefore = engine.placedCount;
    const outcome = engine.drop(pieceId, targetCell);
    this.syncPieces();
    this.handleOutcome(outcome, dragged, oldDraggedCell, oldDisplacedCell, dx, dy);

    // 音效（F-203）：归位 chime > 普通落格 > 胜利旋律
    if (outcome.type === 'solved') playTone('win', this.settings.soundOn);
    else if (engine.placedCount > placedBefore) playTone('correct', this.settings.soundOn);
    else playTone('drop', this.settings.soundOn);

    // 进度快照（F-205）
    if (outcome.type === 'solved') clearProgress();
    else this.scheduleSave();

    return outcome;
  };

  private targetCellChange = (cell: number | null): void => {
    if (cell === null) {
      this.hideHint();
      return;
    }
    const col = cell % this.cols;
    const row = Math.floor(cell / this.cols);
    this.hintEl.style.left = `${(col * 100) / this.cols}%`;
    this.hintEl.style.top = `${(row * 100) / this.rows}%`;
    this.hintEl.classList.remove('hidden');
  };

  // ---------- 动画与庆祝 ----------

  private handleOutcome(
    outcome: DropOutcome,
    dragged: HTMLElement,
    oldDraggedCell: number,
    oldDisplacedCell: number,
    dx: number,
    dy: number,
  ): void {
    if (outcome.type === 'snapback' || outcome.type === 'bounce') {
      this.animateBack(dragged);
      return;
    }
    // swap / solved：两块互换滑入动画
    const bEl = this.pieceEl(outcome.b);
    if (bEl) this.animateSwap(dragged, oldDraggedCell, bEl, oldDisplacedCell, dx, dy);
    if (outcome.type === 'solved') this.celebrate();
  }

  /** 松手无效 / 落回原格：清空拖拽 transform，从当前位置平滑归位 */
  private animateBack(el: HTMLElement): void {
    el.style.zIndex = '30';
    this.animating = true;
    this.rAF(() => {
      el.style.transform = '';
    });
    this.later(() => {
      el.style.zIndex = '';
      this.animating = false;
      this.syncPieces();
    }, ANIM_MS);
  }

  /** 互换动画：a 从「旧格 + 拖拽偏移」滑向新格，b 从旧格滑向 a 的旧格 */
  private animateSwap(
    aEl: HTMLElement,
    oldACell: number,
    bEl: HTMLElement,
    oldBCell: number,
    dx: number,
    dy: number,
  ): void {
    const rect = this.board.getBoundingClientRect();
    const cw = rect.width / this.cols;
    const ch = rect.height / this.rows;
    const px = (cell: number) => ({
      x: (cell % this.cols) * cw,
      y: Math.floor(cell / this.cols) * ch,
    });

    const na = px(Number(aEl.dataset.cell));
    const oa = px(oldACell);
    this.jumpTo(aEl, `translate3d(${dx + oa.x - na.x}px, ${dy + oa.y - na.y}px, 0) scale(1.04)`);
    aEl.style.zIndex = '30';

    const nb = px(Number(bEl.dataset.cell));
    const ob = px(oldBCell);
    this.jumpTo(bEl, `translate3d(${ob.x - nb.x}px, ${ob.y - nb.y}px, 0)`);
    bEl.style.zIndex = '20';

    this.animating = true;
    this.rAF(() => {
      aEl.style.transform = '';
      bEl.style.transform = '';
    });
    this.later(() => {
      this.animating = false;
      this.syncPieces(); // 收尾：恢复常规层级
    }, ANIM_MS);
  }

  /** 无过渡跳到起始帧（下一帧再恢复过渡，形成动画起点） */
  private jumpTo(el: HTMLElement, transform: string): void {
    el.classList.add('no-anim');
    el.style.transform = transform;
    void el.offsetWidth; // 强制重排，提交起始帧
    el.classList.remove('no-anim');
  }

  private rAF(fn: () => void): void {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private celebrate(): void {
    this.board.classList.add('solved'); // 拼缝淡出，还原完整图片
    this.stats.pause();
    const engine = must(this.engine, '引擎未初始化');
    const timeMs = Math.round(this.stats.elapsedMs);
    this.statTime.textContent = formatMs(timeMs);

    // 最佳记录（F-204）
    const res = submitResult(this.rows, this.cols, timeMs, engine.moves);
    this.resultSub.textContent = `用时 ${formatMs(timeMs)} · ${engine.moves} 步`;
    this.resultRecords.textContent =
      res.newTimeRecord || res.newMovesRecord
        ? '🏆 新纪录！'
        : `历史最佳 ${formatMs(res.bestTimeMs)} · ${res.bestMoves} 步`;

    this.later(() => {
      startConfetti();
      this.overlay.classList.remove('hidden');
    }, 650);
  }

  // ---------- 设置 ----------

  private applyHint(): void {
    this.hintEl.classList.toggle('hidden', !this.settings.hintEnabled);
  }

  private syncToggleButtons(): void {
    this.btnSound.textContent = this.settings.soundOn ? '🔊' : '🔇';
    this.btnSound.title = this.settings.soundOn ? '音效：开' : '音效：关';
    this.btnSound.classList.toggle('off', !this.settings.soundOn);
    this.btnHint.textContent = '👁';
    this.btnHint.title = this.settings.hintEnabled ? '原图参考：开' : '原图参考：关';
    this.btnHint.classList.toggle('off', !this.settings.hintEnabled);
    this.btnLock.textContent = this.settings.lockOnSnap ? '🔒' : '🔓';
    this.btnLock.title = this.settings.lockOnSnap ? '吸附锁定：开' : '吸附锁定：关';
    this.btnLock.classList.toggle('off', !this.settings.lockOnSnap);
  }

  // ---------- 操作入口 ----------

  /** 重新打乱（F-107 / 再玩一次）：计时步数一并重置 */
  private restart(): void {
    if (!this.engine) return;
    this.board.classList.remove('solved');
    this.engine.reshuffle();
    this.stats.start();
    this.syncPieces();
    this.hideDialog();
    this.saveProgressNow();
  }

  private hideHint(): void {
    this.hintEl.classList.add('hidden');
  }

  private hideDialog(): void {
    this.overlay.classList.add('hidden');
  }

  private fitBoard(): void {
    const stage = this.session?.stage;
    if (!stage) return;
    const wrapRect = this.wrap.getBoundingClientRect();
    if (wrapRect.width === 0 || wrapRect.height === 0) {
      this.rAF(() => this.fitBoard()); // 视图尚不可见，下一帧再测
      return;
    }
    const pad = 28;
    const availW = Math.max(wrapRect.width - pad, 120);
    const availH = Math.max(wrapRect.height - pad, 120);
    let w = availW;
    let h = w / stage.ratio;
    if (h > availH) {
      h = availH;
      w = h * stage.ratio;
    }
    this.board.style.width = `${Math.floor(w)}px`;
    this.board.style.height = `${Math.floor(h)}px`;
  }

  // ---------- 进度快照（F-205） ----------

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveProgressNow(), SAVE_THROTTLE_MS);
  }

  private saveProgressNow(): void {
    const session = this.session;
    const engine = this.engine;
    if (!session || !engine || engine.isSolved) return;
    saveProgress({
      imageRef: session.meta.imageRef,
      imageKind: session.meta.imageKind,
      rows: this.rows,
      cols: this.cols,
      cells: engine.getAssignment(),
      moves: engine.moves,
      elapsedMs: Math.round(this.stats.elapsedMs),
      savedAt: Date.now(),
    });
  }
}
