import { playTone } from '../audio';
import { startConfetti } from '../components/confetti';
import { DragController } from '../../engine/dragController';
import { PuzzleEngine } from '../../engine/game';
import { buildPieceShapes, buildShapeSpec } from '../../engine/shaper';
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
/** 吸附阈值系数（架构文档 §7.5） */
const SNAP_RATIO = 0.35;
/** 提示次数上限（F-304） */
const MAX_HINTS = 3;

/** 游戏页（F-003~F-007 / F-101~F-106 / F-201~F-206 / F-301~F-305） */
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
  private readonly btnHelp: HTMLButtonElement;
  private readonly btnShare: HTMLButtonElement;

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

  // V0.4：形状 / 自由摆放 / 旋转 / 提示
  private spec: ReturnType<typeof buildShapeSpec> | null = null;
  private shapes: Awaited<ReturnType<typeof buildPieceShapes>> | null = null;
  private hitCtx: CanvasRenderingContext2D | null = null;
  private freePos = new Map<number, { x: number; y: number }>();
  private hintsLeft = MAX_HINTS;

  private readonly onResize = (): void => {
    this.fitBoard();
    this.clampAllFreePos();
  };
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
    this.btnHelp = must(root.querySelector<HTMLButtonElement>('#btn-help'), '#btn-help');
    this.btnShare = must(document.querySelector<HTMLButtonElement>('#btn-share'), '#btn-share');

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
    this.btnShare.addEventListener('click', () => void this.shareResult());

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
    this.btnHelp.addEventListener('click', () => this.useHint());

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get mounted(): boolean {
    return this.engine !== null;
  }

  async mount(session: GameSession): Promise<void> {
    this.unmount();
    this.session = session;
    this.settings = loadSettings();
    this.rows = session.rows;
    this.cols = session.cols;
    const { mode, rotationEnabled } = session.opts;

    const saved = session.saved;
    this.engine = saved
      ? new PuzzleEngine(this.rows, this.cols, saved.cells, {
          lockOnSnap: this.settings.lockOnSnap,
          rotationEnabled,
          mode,
          rots: saved.rots,
        })
      : PuzzleEngine.create(this.rows, this.cols, {
          lockOnSnap: this.settings.lockOnSnap,
          rotationEnabled,
          mode,
        });
    if (saved) this.engine.restoreMoves(saved.moves);
    this.hintsLeft = saved ? saved.hintsLeft : MAX_HINTS;
    this.stats = new StatsService();
    if (saved) this.stats.startWith(saved.elapsedMs);
    else this.stats.start();

    this.board.style.backgroundSize = `${100 / this.cols}% ${100 / this.rows}%`;
    this.hintEl.style.backgroundImage = `url("${session.stage.dataUrl}")`;
    this.hintEl.style.opacity = String(this.settings.hintOpacity);
    this.applyHint();
    this.syncToggleButtons();

    // 自由摆放：恢复或重新散布
    this.freePos.clear();
    if (mode === 'free') {
      if (saved?.freePos) {
        saved.freePos.forEach(([x, y], id) => this.freePos.set(id, { x, y }));
      } else {
        this.scatterFree();
      }
    }

    await this.buildPieces();
    this.controller = new DragController(this.board, { rows: this.rows, cols: this.cols }, {
      canPick: this.canPick,
      pickAt: this.pickAt,
      drop: this.drop,
      hoverChange: this.hoverChange,
      rotate: rotationEnabled ? this.rotate : undefined,
    });
    this.fitBoard();
    this.clampAllFreePos();
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
    this.spec = null;
    this.shapes = null;
    this.freePos.clear();
    this.animating = false;
    window.clearTimeout(this.saveTimer);
    for (const t of this.timers) window.clearInterval(t);
    this.timers = [];
    this.board.querySelectorAll('.piece').forEach((el) => el.remove());
    this.board.classList.remove('solved');
    this.hideHint();
    this.hideCellHint();
    this.overlay.classList.add('hidden');
  }

  // ---------- 构建 / 同步 ----------

  private async buildPieces(): Promise<void> {
    const stage = must(this.session, '对局参数缺失').stage;
    const engine = must(this.engine, '引擎未初始化');

    if (this.session?.opts.shape === 'classic') {
      this.spec = buildShapeSpec(this.rows, this.cols, stage.width, stage.height);
      this.shapes = await buildPieceShapes(this.spec, stage.dataUrl);
    } else {
      this.spec = null;
      this.shapes = null;
    }

    for (const p of engine.getPieces()) {
      const el = document.createElement('div');
      el.className = 'piece enter';
      el.dataset.pieceId = String(p.id);
      el.dataset.rot = String(p.rot);
      this.applyPieceGeometry(el, p.id);
      el.style.animationDelay = `${p.id * 18}ms`;
      el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
      this.board.appendChild(el);
    }
    this.syncPieces();
  }

  /** 按形状/模式设置块的尺寸与初始位置 */
  private applyPieceGeometry(el: HTMLElement, id: number): void {
    const stage = must(this.session, '对局参数缺失').stage;
    if (this.shapes && this.spec) {
      const shape = this.shapes[id];
      const mx = (this.spec.margin / stage.width) * 100;
      const my = (this.spec.margin / stage.height) * 100;
      el.classList.add('shaped');
      el.style.width = `${100 / this.cols + mx * 2}%`;
      el.style.height = `${100 / this.rows + my * 2}%`;
      el.appendChild(shape.canvas);
      shape.canvas.className = 'piece-canvas';
    } else {
      el.style.width = `${100 / this.cols}%`;
      el.style.height = `${100 / this.rows}%`;
      el.style.backgroundImage = `url("${stage.dataUrl}")`;
      el.style.backgroundSize = `${this.cols * 100}% ${this.rows * 100}%`;
      const col = id % this.cols;
      const row = Math.floor(id / this.cols);
      el.style.backgroundPosition = `${(col / (this.cols - 1)) * 100}% ${(row / (this.rows - 1)) * 100}%`;
    }
  }

  private restTransform(el: HTMLElement): void {
    const rot = Number(el.dataset.rot ?? 0);
    el.style.transform = rot ? `rotate(${rot * 90}deg)` : '';
  }

  /** 以引擎状态全量同步 DOM */
  private syncPieces(): void {
    const engine = must(this.engine, '引擎未初始化');
    for (const p of engine.getPieces()) {
      const el = this.pieceEl(p.id);
      if (!el) continue;
      el.dataset.rot = String(p.rot);
      this.restTransform(el);
      el.classList.toggle('locked', p.locked);
      el.style.zIndex = p.locked ? '0' : '1';
      if (this.session?.opts.mode === 'free' && p.cell < 0) {
        const pos = must(this.freePos.get(p.id), '自由块缺少位置');
        el.style.left = `${pos.x}px`;
        el.style.top = `${pos.y}px`;
        el.dataset.cell = '-1';
        el.dataset.px = String(pos.x);
        el.dataset.py = String(pos.y);
      } else {
        const col = p.cell % this.cols;
        const row = Math.floor(p.cell / this.cols);
        el.style.left = `${(col * 100) / this.cols}%`;
        el.style.top = `${(row * 100) / this.rows}%`;
        el.dataset.cell = String(p.cell);
      }
    }
    this.progressEl.textContent = `${engine.placedCount}/${this.rows * this.cols}`;
    this.statMoves.textContent = `${engine.moves} 步`;
    this.btnHelp.textContent = `💡${this.hintsLeft}`;
    this.btnHelp.classList.toggle('off', this.hintsLeft <= 0);
    this.btnHelp.disabled = this.hintsLeft <= 0;
  }

  private pieceEl(id: number): HTMLElement | null {
    return this.board.querySelector<HTMLElement>(`[data-piece-id="${id}"]`);
  }

  // ---------- 命中测试（含异形路径，F-301） ----------

  private pickAt = (clientX: number, clientY: number): HTMLElement | null => {
    const engine = this.engine;
    if (!engine) return null;
    const candidates: Array<{ el: HTMLElement; z: number; dom: number }> = [];
    engine.getPieces().forEach((p, index) => {
      if (p.locked) return;
      const el = this.pieceEl(p.id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
      if (!this.shapeHit(el, p.id, clientX, clientY)) return;
      candidates.push({ el, z: Number(el.style.zIndex || 0), dom: index });
    });
    candidates.sort((a, b) => b.z - a.z || b.dom - a.dom);
    return candidates[0]?.el ?? null;
  };

  /** 异形块按路径命中（考虑旋转）；方块恒命中 */
  private shapeHit(el: HTMLElement, id: number, clientX: number, clientY: number): boolean {
    const shape = this.shapes?.[id];
    if (!shape || !this.spec) return true;
    if (!this.hitCtx) {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      this.hitCtx = c.getContext('2d');
    }
    const ctx = this.hitCtx;
    if (!ctx) return true;

    const rect = el.getBoundingClientRect();
    const rot = Number(el.dataset.rot ?? 0);
    const swapAxes = rot % 2 === 1;
    const hw = (swapAxes ? rect.height : rect.width) / 2;
    const hh = (swapAxes ? rect.width : rect.height) / 2;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    if (rot) {
      const rad = (-rot * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      [dx, dy] = [dx * cos - dy * sin, dx * sin + dy * cos];
    }
    const lx = ((dx + hw) / (hw * 2)) * shape.canvas.width;
    const ly = ((dy + hh) / (hh * 2)) * shape.canvas.height;
    return ctx.isPointInPath(shape.path, lx, ly);
  }

  // ---------- 拖拽回调 ----------

  private canPick = (pieceId: number): boolean => {
    if (!this.engine || this.engine.isSolved || this.animating) return false;
    const ok = !this.engine.piece(pieceId).locked;
    if (ok) playTone('pick', this.settings.soundOn);
    return ok;
  };

  private drop = (
    pieceId: number,
    targetCell: number,
    dx: number,
    dy: number,
    cx: number,
    cy: number,
  ): DropOutcome => {
    if (this.session?.opts.mode === 'free') {
      this.handleFreeDrop(pieceId, dx, dy, cx, cy);
      return { type: 'snapback' }; // 自由模式不使用交换结算
    }

    const engine = must(this.engine, '引擎未初始化');
    const dragged = must(this.pieceEl(pieceId), '拖拽块元素缺失');
    const oldDraggedCell = Number(dragged.dataset.cell);
    const displaced = engine.pieceAt(targetCell);
    const oldDisplacedCell =
      displaced.id === pieceId ? oldDraggedCell : Number(this.pieceEl(displaced.id)?.dataset.cell);

    const placedBefore = engine.placedCount;
    const outcome = engine.drop(pieceId, targetCell);
    this.syncPieces();
    this.handleSwapOutcome(outcome, dragged, oldDraggedCell, oldDisplacedCell, dx, dy);

    if (outcome.type === 'solved') playTone('win', this.settings.soundOn);
    else if (engine.placedCount > placedBefore) playTone('correct', this.settings.soundOn);
    else playTone('drop', this.settings.soundOn);

    if (outcome.type === 'solved') clearProgress();
    else this.scheduleSave();
    return outcome;
  };

  /** 自由摆放落子（F-302）：仅正确格 + 朝向正确才吸附 */
  private handleFreeDrop(pieceId: number, dx: number, dy: number, cx: number, cy: number): void {
    const engine = must(this.engine, '引擎未初始化');
    const el = must(this.pieceEl(pieceId), '拖拽块元素缺失');
    const rect = this.board.getBoundingClientRect();
    const cw = rect.width / this.cols;
    const ch = rect.height / this.rows;
    const p = engine.piece(pieceId);

    const ccx = ((p.id % this.cols) + 0.5) * cw;
    const ccy = (Math.floor(p.id / this.cols) + 0.5) * ch;
    const threshold = SNAP_RATIO * Math.min(cw, ch);
    const rotOk = !engine.rotationEnabled || p.rot === 0;

    if (Math.hypot(cx - ccx, cy - ccy) < threshold && rotOk) {
      const outcome = engine.lockPiece(pieceId);
      engine.countMove();
      // 从当前视觉位置滑入正确格
      const oldLeft = Number(el.dataset.px ?? 0);
      const oldTop = Number(el.dataset.py ?? 0);
      const newLeft = ccx - cw / 2;
      const newTop = ccy - ch / 2;
      this.freePos.delete(pieceId);
      this.jumpTo(el, `translate3d(${oldLeft + dx - newLeft}px, ${oldTop + dy - newTop}px, 0) scale(1.04)`);
      el.style.zIndex = '30';
      this.animating = true;
      this.rAF(() => {
        el.style.transform = '';
      });
      this.later(() => {
        this.animating = false;
        this.syncPieces();
      }, ANIM_MS);
      if (outcome.type === 'solved') {
        clearProgress();
        this.later(() => this.celebrate(), ANIM_MS);
        playTone('win', this.settings.soundOn);
      } else {
        this.scheduleSave();
        playTone('correct', this.settings.soundOn);
      }
      return;
    }

    // 未命中：原地散置（夹取到场地范围内）
    const wrapRect = this.wrap.getBoundingClientRect();
    const boardRect = this.board.getBoundingClientRect();
    const box = this.freePieceBox();
    const fx = wrapRect.left - boardRect.left;
    const fy = wrapRect.top - boardRect.top;
    const clampedX = Math.min(Math.max(Number(el.dataset.px ?? 0) + dx, fx), fx + wrapRect.width - box.w);
    const clampedY = Math.min(Math.max(Number(el.dataset.py ?? 0) + dy, fy), fy + wrapRect.height - box.h);
    this.freePos.set(pieceId, { x: clampedX, y: clampedY });
    el.style.left = `${clampedX}px`;
    el.style.top = `${clampedY}px`;
    el.dataset.cell = '-1';
    el.dataset.px = String(clampedX);
    el.dataset.py = String(clampedY);
    this.restTransform(el);
    this.later(() => this.syncPieces(), ANIM_MS);
    playTone('drop', this.settings.soundOn);
    this.scheduleSave();
  }

  private hoverChange = (info: { pieceId: number; cell: number | null; cx: number; cy: number } | null): void => {
    if (!info) {
      this.hideCellHint();
      return;
    }
    if (this.session?.opts.mode === 'free') {
      // 自由摆放：仅当接近该块的正确格时高亮
      const rect = this.board.getBoundingClientRect();
      const cw = rect.width / this.cols;
      const ch = rect.height / this.rows;
      const ccx = ((info.pieceId % this.cols) + 0.5) * cw;
      const ccy = (Math.floor(info.pieceId / this.cols) + 0.5) * ch;
      if (Math.hypot(info.cx - ccx, info.cy - ccy) < SNAP_RATIO * Math.min(cw, ch)) {
        this.showCellHint(info.pieceId);
      } else {
        this.hideCellHint();
      }
      return;
    }
    if (info.cell === null) {
      this.hideCellHint();
      return;
    }
    this.showCellHint(info.cell);
  };

  private showCellHint(cell: number): void {
    const col = cell % this.cols;
    const row = Math.floor(cell / this.cols);
    const cellHint = must(document.getElementById('drop-hint'), '#drop-hint');
    cellHint.style.width = `${100 / this.cols}%`;
    cellHint.style.height = `${100 / this.rows}%`;
    cellHint.style.left = `${(col * 100) / this.cols}%`;
    cellHint.style.top = `${(row * 100) / this.rows}%`;
    cellHint.classList.remove('hidden');
  }

  private hideCellHint(): void {
    document.getElementById('drop-hint')?.classList.add('hidden');
  }

  private rotate = (pieceId: number): void => {
    if (!this.engine || this.engine.isSolved || this.animating) return;
    if (this.engine.piece(pieceId).locked) return;
    const rot = this.engine.rotatePiece(pieceId);
    const el = this.pieceEl(pieceId);
    if (el) {
      el.dataset.rot = String(rot);
      this.restTransform(el);
    }
    playTone('drop', this.settings.soundOn);
    this.syncPieces();
    this.scheduleSave();
  };

  // ---------- 动画与庆祝 ----------

  private handleSwapOutcome(
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
    const bEl = this.pieceEl(outcome.b);
    if (bEl) this.animateSwap(dragged, oldDraggedCell, bEl, oldDisplacedCell, dx, dy);
    if (outcome.type === 'solved') this.celebrate();
  }

  private animateBack(el: HTMLElement): void {
    el.style.zIndex = '30';
    this.animating = true;
    this.rAF(() => {
      this.restTransform(el);
    });
    this.later(() => {
      el.style.zIndex = '';
      this.animating = false;
      this.syncPieces();
    }, ANIM_MS);
  }

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
    this.jumpTo(aEl, `translate3d(${dx + oa.x - na.x}px, ${dy + oa.y - na.y}px, 0) scale(1.04)${this.rotSuffix(aEl)}`);
    aEl.style.zIndex = '30';

    const nb = px(Number(bEl.dataset.cell));
    const ob = px(oldBCell);
    this.jumpTo(bEl, `translate3d(${ob.x - nb.x}px, ${ob.y - nb.y}px, 0)${this.rotSuffix(bEl)}`);
    bEl.style.zIndex = '20';

    this.animating = true;
    this.rAF(() => {
      this.restTransform(aEl);
      this.restTransform(bEl);
    });
    this.later(() => {
      this.animating = false;
      this.syncPieces();
    }, ANIM_MS);
  }

  private rotSuffix(el: HTMLElement): string {
    const rot = Number(el.dataset.rot ?? 0);
    return rot ? ` rotate(${rot * 90}deg)` : '';
  }

  private jumpTo(el: HTMLElement, transform: string): void {
    el.classList.add('no-anim');
    el.style.transform = transform;
    void el.offsetWidth;
    el.classList.remove('no-anim');
  }

  private rAF(fn: () => void): void {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private celebrate(): void {
    this.board.classList.add('solved');
    this.stats.pause();
    const engine = must(this.engine, '引擎未初始化');
    const timeMs = Math.round(this.stats.elapsedMs);
    this.statTime.textContent = formatMs(timeMs);

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

  /** 结算成绩分享图（F-305）：本地 canvas 合成并下载 */
  private async shareResult(): Promise<void> {
    const session = this.session;
    const engine = this.engine;
    if (!session || !engine) return;
    const W = 960;
    const H = 720;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = session.stage.dataUrl;
    await img.decode();
    // cover 铺满
    const scale = Math.max(W / img.width, H / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    // 底部渐变遮罩
    const grad = ctx.createLinearGradient(0, H * 0.45, 0, H);
    grad.addColorStop(0, 'rgba(10, 11, 20, 0)');
    grad.addColorStop(1, 'rgba(10, 11, 20, 0.88)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#eef0f8';
    ctx.textAlign = 'center';
    ctx.font = '600 44px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('🎉 拼图完成！', W / 2, H - 168);
    ctx.font = '30px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`${this.rows}×${this.cols} · ${this.rows * this.cols} 块`, W / 2, H - 116);
    ctx.font = '600 36px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#ffb454';
    ctx.fillText(`用时 ${this.statTime.textContent} · ${engine.moves} 步`, W / 2, H - 66);
    ctx.font = '18px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(238, 240, 248, 0.7)';
    ctx.fillText('TinyPuzzle · 在线拼图', W / 2, H - 26);

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `tinypuzzle-${this.rows}x${this.cols}-${formatMs(Math.round(this.stats.elapsedMs)).replace(':', 'm')}s.png`;
    a.click();
  }

  // ---------- 提示（F-304） ----------

  private useHint(): void {
    const engine = this.engine;
    if (!engine || this.hintsLeft <= 0 || engine.isSolved || this.animating) return;
    const candidates = engine.getPieces().filter((p) => !p.locked && (p.cell !== p.id || p.rot !== 0));
    if (!candidates.length) return;
    this.hintsLeft -= 1;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const el = this.pieceEl(target.id);
    if (el) {
      el.classList.add('hinted');
      this.later(() => el.classList.remove('hinted'), 2000);
    }
    this.showCellHint(target.id);
    this.later(() => this.hideCellHint(), 2000);
    this.syncPieces();
    this.scheduleSave();
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

  private restart(): void {
    if (!this.engine) return;
    this.board.classList.remove('solved');
    this.engine.reshuffle();
    this.hintsLeft = MAX_HINTS;
    if (this.session?.opts.mode === 'free') this.scatterFree();
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
      this.rAF(() => this.fitBoard());
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

  // ---------- 自由摆放散布 ----------

  /** 自由模式下块的实际占位（含异形留白），用于散布与夹取 */
  private freePieceBox(): { w: number; h: number } {
    const rect = this.board.getBoundingClientRect();
    const stage = must(this.session, '对局参数缺失').stage;
    const scale = rect.width / stage.width;
    const m = (this.spec?.margin ?? 0) * scale;
    return { w: rect.width / this.cols + m * 2, h: rect.height / this.rows + m * 2 };
  }

  /** 把未归位块随机散布在棋盘四周的场地内（避开棋盘区域） */
  private scatterFree(): void {
    const rect = this.board.getBoundingClientRect();
    const wrapRect = this.wrap.getBoundingClientRect();
    if (rect.width === 0 || wrapRect.width === 0) {
      this.rAF(() => this.scatterFree());
      return;
    }
    const box = this.freePieceBox();
    const fx = wrapRect.left - rect.left; // 场地左缘（棋盘坐标，≤0）
    const fy = wrapRect.top - rect.top;
    const fw = wrapRect.width;
    const fh = wrapRect.height;
    const engine = must(this.engine, '引擎未初始化');
    for (const p of engine.getPieces()) {
      if (p.cell >= 0) continue;
      let x = 0;
      let y = 0;
      let ok = false;
      for (let attempt = 0; attempt < 50 && !ok; attempt++) {
        x = fx + Math.random() * Math.max(fw - box.w, 1);
        y = fy + Math.random() * Math.max(fh - box.h, 1);
        // 避开棋盘区域（留 6px 缓冲）
        const intersects = x + box.w > 6 && x < rect.width - 6 && y + box.h > 6 && y < rect.height - 6;
        ok = !intersects;
      }
      this.freePos.set(p.id, { x, y });
    }
  }

  /** 视口尺寸变化后把散布块夹回场地内 */
  private clampAllFreePos(): void {
    if (this.session?.opts.mode !== 'free' || !this.engine) return;
    const rect = this.board.getBoundingClientRect();
    const wrapRect = this.wrap.getBoundingClientRect();
    if (rect.width === 0 || wrapRect.width === 0) return;
    const box = this.freePieceBox();
    const fx = wrapRect.left - rect.left;
    const fy = wrapRect.top - rect.top;
    for (const p of this.engine.getPieces()) {
      if (p.cell >= 0) continue;
      const pos = this.freePos.get(p.id);
      if (!pos) continue;
      pos.x = Math.min(Math.max(pos.x, fx), fx + wrapRect.width - box.w);
      pos.y = Math.min(Math.max(pos.y, fy), fy + wrapRect.height - box.h);
      const el = this.pieceEl(p.id);
      if (el) {
        el.style.left = `${pos.x}px`;
        el.style.top = `${pos.y}px`;
        el.dataset.px = String(pos.x);
        el.dataset.py = String(pos.y);
      }
    }
  }

  // ---------- 进度快照（F-205 v2） ----------

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveProgressNow(), SAVE_THROTTLE_MS);
  }

  private saveProgressNow(): void {
    const session = this.session;
    const engine = this.engine;
    if (!session || !engine || engine.isSolved) return;
    saveProgress({
      v: 2,
      imageRef: session.meta.imageRef,
      imageKind: session.meta.imageKind,
      rows: this.rows,
      cols: this.cols,
      cells: engine.getAssignment(),
      rots: engine.getRots(),
      mode: session.opts.mode,
      shape: session.opts.shape,
      rotationEnabled: session.opts.rotationEnabled,
      freePos:
        session.opts.mode === 'free'
          ? engine.getPieces().map((p) => {
              const pos = this.freePos.get(p.id);
              return [pos?.x ?? 0, pos?.y ?? 0] as [number, number];
            })
          : null,
      hintsLeft: this.hintsLeft,
      moves: engine.moves,
      elapsedMs: Math.round(this.stats.elapsedMs),
      savedAt: Date.now(),
    });
  }
}
