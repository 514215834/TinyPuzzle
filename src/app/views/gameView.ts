import { audioOutputLatency, playTone } from '../audio';
import { startConfetti } from '../components/confetti';
import { DragController } from '../../engine/dragController';
import { PuzzleEngine } from '../../engine/game';
import type { PhysRect } from '../../engine/physics';
import { PhysWorld } from '../../engine/physics';
import { buildBlurredStageUrl, buildPieceShapes, buildShapeSpec } from '../../engine/shaper';
import { StatsService, formatMs } from '../../engine/stats';
import type { DropOutcome, PuzzlePiece } from '../../engine/types';
import { clearProgress, saveProgress } from '../../storage/progress';
import { submitResult } from '../../storage/records';
import { loadSettings, saveSettings } from '../../storage/settings';
import { must } from '../../utils/dom';
import { bestRecord, solvedSub, t } from '../i18n';
import type { GameSession } from '../session';

/** 交换动画时长（与 CSS transition 保持一致） */
const ANIM_MS = 240;
/** 开局入场动画时长 */
const ENTER_MS = 950;
/** 爆散开场（F-512）各阶段时长：完整亮相 → 定格蓄力 → 爆散飞落 */
const INTRO_REVEAL_MS = 420; // 完整拼图整体淡入亮相
const INTRO_HOLD_MS = 520; // 定格蓄力，给玩家看清原图的时间
const INTRO_FLY_MS = 760; // 碎块爆散飞行
const INTRO_STAGGER_MS = 110; // 冲击波由内向外传播的起爆延迟上限
/** 进度快照节流间隔 */
const SAVE_THROTTLE_MS = 400;
/** 吸附阈值系数（架构文档 §7.5） */
/** 自由摆放吸附容差（占格子边长比例）：靠近正确格松手即自动归位（F-302） */
const SNAP_RATIO = 0.6;
/** 提示次数上限（F-304） */
const MAX_HINTS = 3;

/** 网格编码：列字母 + 行号（0,0→A1，1,0→B1，0,1→A2，26 列起 AA…） */
function cellCode(col: number, row: number): string {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s + String(row + 1);
}

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
  private readonly btnCode: HTMLButtonElement;
  private readonly btnPhysics: HTMLButtonElement;
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
  /** 爆散开场进行中（块位置由开场动画接管，禁止夹取/同步干扰） */
  private introPlaying = false;
  private timers: number[] = [];
  private saveTimer: number | undefined;

  // V0.4：形状 / 自由摆放 / 旋转 / 提示
  private spec: ReturnType<typeof buildShapeSpec> | null = null;
  private shapes: ReturnType<typeof buildPieceShapes> | null = null;
  /** 拼图块元素缓存（id 即下标，构建时填充，F-513）：避免 syncPieces 逐块 querySelector 的 O(n²) 扫描 */
  private pieceEls: HTMLElement[] = [];
  /** 全场共享的模糊折射图层（Blob URL，F-513 图集化） */
  private blurUrl: string | null = null;
  private hitCtx: CanvasRenderingContext2D | null = null;
  private freePos = new Map<number, { x: number; y: number }>();
  private hintsLeft = MAX_HINTS;

  // F-511 桌面物理：散置块的俯视碰撞（世界坐标 = 棋盘局部 px）
  private phys: PhysWorld | null = null;
  private physRunning = false;
  private physRaf = 0;
  private physLast = 0;
  /** 拖拽中的块（kinematic body），无则 null */
  private physHeldId: number | null = null;
  private physHeldMovedAt = 0;
  /**
   * 物理运动锚点（F-513）：运动期只写 transform（合成器路径，不触发布局），
   * left/top 保持锚点不动；静置 / 被拾起时一次性落回 left/top。
   */
  private physAnchors = new Map<number, { x: number; y: number }>();

  private readonly onResize = (): void => {
    this.fitBoard();
    this.controller?.invalidateLayout(); // 棋盘布局尺寸变化，拖拽量测缓存失效（F-513）
    this.clampAllFreePos();
    this.clampPan();
    this.applyViewport();
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
    this.btnCode = must(root.querySelector<HTMLButtonElement>('#btn-code'), '#btn-code');
    this.btnPhysics = must(root.querySelector<HTMLButtonElement>('#btn-physics'), '#btn-physics');
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
    this.btnCode.addEventListener('click', () => {
      this.settings = saveSettings({ gridCodes: !this.settings.gridCodes });
      this.renderCellCodes();
      this.syncToggleButtons();
    });
    this.btnPhysics.addEventListener('click', () => {
      this.settings = saveSettings({ physicsOn: !this.settings.physicsOn });
      if (this.settings.physicsOn) this.initPhysics();
      else {
        this.commitPhysAnchors(); // 关闭物理前先把锚点位移落回 left/top（F-513）
        this.stopPhysLoop();
        this.phys?.clear();
        this.phys = null;
        this.physHeldId = null;
      }
      this.syncToggleButtons();
    });
    this.btnHelp.addEventListener('click', () => this.useHint());

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.wrap.addEventListener('wheel', this.onWheel, { passive: false });
    this.wrap.addEventListener('pointerdown', this.onViewportPointerDown);
    this.wrap.addEventListener('pointermove', this.onViewportPointerMove);
    this.wrap.addEventListener('pointerup', this.onViewportPointerUp);
    this.wrap.addEventListener('pointercancel', this.onViewportPointerUp);
    // 双击翻面查看背面编码（编码开关开启时）
    this.board.addEventListener('dblclick', this.onBoardDblClick);
  }

  // ---------- 网格 / 拼图编码（默认关） ----------

  private readonly onBoardDblClick = (e: MouseEvent): void => {
    if (!this.engine || this.animating || !this.settings.gridCodes) return;
    const el = this.pickAt(e.clientX, e.clientY);
    if (!el) return;
    this.toggleFlip(Number(el.dataset.pieceId));
  };

  /** 双击翻面：显示背面（背面印有该块的正确格编码） */
  private toggleFlip(pieceId: number): void {
    const el = this.pieceEl(pieceId);
    const p = this.engine?.piece(pieceId);
    if (!el || !p) return;
    let back = el.querySelector<HTMLElement>('.piece-back');
    if (!back) {
      back = document.createElement('div');
      back.className = 'piece-back';
      const cols = this.cols;
      back.textContent = cellCode(p.id % cols, Math.floor(p.id / cols));
      back.style.fontSize = `${Math.max(9, Math.round((this.board.offsetWidth / cols) * 0.34))}px`;
      el.appendChild(back);
    }
    const flipped = el.classList.toggle('flipped');
    el.dataset.flipped = flipped ? '1' : '0';
    this.restTransform(el);
    playTone('pick', this.settings.soundOn);
  }


  /** 渲染 / 隐藏网格编码层（A1、B3…） */
  private renderCellCodes(): void {
    const layer = document.getElementById('cell-codes');
    if (!layer) return;
    if (!this.settings.gridCodes || !this.engine) {
      layer.classList.add('hidden');
      layer.innerHTML = '';
      return;
    }
    const { w: lw } = this.localSize();
    const fs = Math.max(7, Math.round((lw / this.cols) * 0.24));
    layer.style.fontSize = `${fs}px`;
    layer.style.gridTemplateColumns = `repeat(${this.cols}, 1fr)`;
    layer.style.gridTemplateRows = `repeat(${this.rows}, 1fr)`;
    const frag = document.createDocumentFragment();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const span = document.createElement('span');
        span.textContent = cellCode(c, r);
        frag.appendChild(span);
      }
    }
    layer.innerHTML = '';
    layer.appendChild(frag);
    layer.classList.remove('hidden');
  }

  // ---------- 视口缩放 / 平移（拼图区域支持滚轮 / 双指缩放、空白拖拽平移） ----------

  private zoom = 1;
  private panX = 0;
  private panY = 0;
  /** 视口手势进行中的指针集合（不含落在拼图块上的指针） */
  private viewportPointers = new Map<number, { x: number; y: number }>();

  private static readonly ZOOM_MIN = 0.5;
  private static readonly ZOOM_MAX = 6;

  /** 棋盘视觉缩放系数（client px / 局部 px） */
  private scaleFactor(): number {
    const rect = this.board.getBoundingClientRect();
    return rect.width / (this.board.offsetWidth || 1);
  }

  private applyViewport(): void {
    this.controller?.invalidateLayout(); // 平移 / 缩放改变棋盘 client 原点，拖拽量测缓存失效（F-513）
    this.board.style.transformOrigin = '0 0';
    this.board.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  private resetViewport(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.viewportPointers.clear();
    this.applyViewport();
  }

  /** 以某个屏幕点为锚缩放（保持该点下的棋盘内容不动） */
  private zoomAt(clientX: number, clientY: number, factor: number): void {
    if (!this.engine) return;
    const rect = this.board.getBoundingClientRect();
    const layoutLeft = rect.left - this.panX;
    const layoutTop = rect.top - this.panY;
    const next = Math.min(GameView.ZOOM_MAX, Math.max(GameView.ZOOM_MIN, this.zoom * factor));
    if (next === this.zoom) return;
    const localX = (clientX - layoutLeft - this.panX) / this.zoom;
    const localY = (clientY - layoutTop - this.panY) / this.zoom;
    this.zoom = next;
    this.panX = clientX - layoutLeft - localX * this.zoom;
    this.panY = clientY - layoutTop - localY * this.zoom;
    this.clampPan();
    this.applyViewport();
  }

  /** 平移夹取：棋盘至少保留 60px 与场地相交；棋盘小于场地时居中 */
  private clampPan(): void {
    if (!this.engine) return;
    const wrapRect = this.wrap.getBoundingClientRect();
    const rect = this.board.getBoundingClientRect();
    const layoutLeft = rect.left - this.panX;
    const layoutTop = rect.top - this.panY;
    const bw = this.board.offsetWidth * this.zoom;
    const bh = this.board.offsetHeight * this.zoom;
    const margin = 60;
    const clampAxis = (layout: number, size: number, wrapStart: number, wrapSize: number, pan: number): number => {
      const min = wrapStart + margin - layout - size;
      const max = wrapStart + wrapSize - margin - layout;
      if (min > max) return wrapStart + wrapSize / 2 - layout - size / 2;
      return Math.min(max, Math.max(min, pan));
    };
    this.panX = clampAxis(layoutLeft, bw, wrapRect.left, wrapRect.width, this.panX);
    this.panY = clampAxis(layoutTop, bh, wrapRect.top, wrapRect.height, this.panY);
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.engine) return;
    e.preventDefault();
    this.wrap.classList.add('gesturing'); // 手势期降级 backdrop-filter，避免逐帧重光栅化（F-513）
    window.clearTimeout(this.wheelGestureTimer);
    this.wheelGestureTimer = window.setTimeout(() => this.wrap.classList.remove('gesturing'), 180);
    this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  };
  private wheelGestureTimer: number | undefined;

  private readonly onViewportPointerDown = (e: PointerEvent): void => {
    if (!this.engine) return;
    if ((e.target as HTMLElement | null)?.closest('.piece')) return; // 拼图块交给 DragController
    this.viewportPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.viewportPointers.size === 1) {
      e.preventDefault();
      this.wrap.classList.add('gesturing'); // 平移 / 双指缩放期间关闭玻璃模糊（F-513）
    }
  };

  private readonly onViewportPointerMove = (e: PointerEvent): void => {
    if (!this.engine || !this.viewportPointers.has(e.pointerId)) return;
    if (this.controller?.dragging) {
      this.viewportPointers.delete(e.pointerId);
      return;
    }
    const prev = this.viewportPointers.get(e.pointerId)!;
    const curr = { x: e.clientX, y: e.clientY };
    this.viewportPointers.set(e.pointerId, curr);
    e.preventDefault();

    if (this.viewportPointers.size >= 2) {
      // 双指捏合：以另一指为锚，张缩比缩放、质心位移平移
      const others = [...this.viewportPointers.entries()].filter(([id]) => id !== e.pointerId).map(([, p]) => p);
      const anchor = others[0] ?? prev;
      const dist0 = Math.hypot(anchor.x - prev.x, anchor.y - prev.y) || 1;
      const dist1 = Math.hypot(anchor.x - curr.x, anchor.y - curr.y) || 1;
      const cent0 = { x: (anchor.x + prev.x) / 2, y: (anchor.y + prev.y) / 2 };
      const cent1 = { x: (anchor.x + curr.x) / 2, y: (anchor.y + curr.y) / 2 };
      this.zoomAt(cent1.x, cent1.y, dist1 / dist0);
      this.panX += cent1.x - cent0.x;
      this.panY += cent1.y - cent0.y;
      this.clampPan();
      this.applyViewport();
      return;
    }

    // 单指 / 鼠标：空白处拖拽平移
    this.panX += curr.x - prev.x;
    this.panY += curr.y - prev.y;
    this.clampPan();
    this.applyViewport();
  };

  private readonly onViewportPointerUp = (e: PointerEvent): void => {
    this.viewportPointers.delete(e.pointerId);
    if (this.viewportPointers.size === 0) this.wrap.classList.remove('gesturing');
  };

  // ---------- 键盘无障碍（F-402，交换式玩法）+ 旋转快捷键 ----------

  /** 光标所在格（null = 未激活） */
  private cursorCell: number | null = null;
  /** 键盘拾起的块 */
  private heldId: number | null = null;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.engine || this.engine.isSolved || this.animating) return;
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;

    // 旋转快捷键：Q 逆时针 / E、R 顺时针；拖拽中的块随时可转
    const key = e.key.toLowerCase();
    if (key === 'q' || key === 'e' || key === 'r') {
      const held = this.controller?.heldPieceId ?? null;
      if (held !== null) {
        e.preventDefault();
        const rot = this.engine.rotatePiece(held, key === 'q' ? -1 : 1);
        this.controller!.refreshHeldRot(rot);
        playTone('drop', this.settings.soundOn);
        this.scheduleSave();
        return;
      }
    }

    if (this.session?.opts.mode !== 'swap') return; // 其余键盘操作仅交换式玩法
    const move = (dc: number, dr: number): void => {
      e.preventDefault();
      const base = this.cursorCell ?? this.firstMovableCell();
      if (base === null) return;
      const col = Math.min(this.cols - 1, Math.max(0, (base % this.cols) + dc));
      const row = Math.min(this.rows - 1, Math.max(0, Math.floor(base / this.cols) + dr));
      this.setCursor(row * this.cols + col);
    };

    switch (e.key) {
      case 'ArrowLeft':
        move(-1, 0);
        break;
      case 'ArrowRight':
        move(1, 0);
        break;
      case 'ArrowUp':
        move(0, -1);
        break;
      case 'ArrowDown':
        move(0, 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.keyboardAction();
        break;
      case 'r':
      case 'R':
      case 'e':
      case 'E':
      case 'q':
      case 'Q':
        if (this.session?.opts.rotationEnabled) {
          const id = this.heldId ?? this.movableAt(this.cursorCell);
          if (id !== null) {
            e.preventDefault();
            const rot = this.engine.rotatePiece(id, key === 'q' ? -1 : 1);
            const el = this.pieceEl(id);
            if (el) {
              el.dataset.rot = String(rot);
              this.restTransform(el);
            }
            playTone('drop', this.settings.soundOn);
            this.scheduleSave();
          }
        }
        break;
      case 'h':
      case 'H':
        this.useHint();
        break;
      case 'Escape':
        this.releaseHeld();
        break;
    }
  };

  private firstMovableCell(): number | null {
    const p = this.engine?.getPieces().find((it) => !it.locked);
    return p ? p.cell : null;
  }

  private movableAt(cell: number | null): number | null {
    if (cell === null || !this.engine) return null;
    const p = this.engine.getPieces().find((it) => it.cell === cell);
    return p && !p.locked ? p.id : null;
  }

  private setCursor(cell: number): void {
    this.cursorCell = cell;
    this.renderCursor();
    playTone('pick', this.settings.soundOn);
  }

  private renderCursor(): void {
    this.board.querySelectorAll('.piece').forEach((el) => el.classList.remove('cursor', 'held'));
    if (this.cursorCell !== null) {
      const id = this.engine?.getPieces().find((it) => it.cell === this.cursorCell)?.id;
      const el = id !== undefined ? this.pieceEl(id) : null;
      el?.classList.add('cursor');
      if (this.heldId !== null) this.pieceEl(this.heldId)?.classList.add('held');
    }
  }

  private keyboardAction(): void {
    if (this.cursorCell === null) {
      this.setCursor(this.firstMovableCell() ?? 0);
      return;
    }
    if (this.heldId === null) {
      const id = this.movableAt(this.cursorCell);
      if (id !== null) {
        this.heldId = id;
        this.renderCursor();
        playTone('pick', this.settings.soundOn);
      }
      return;
    }
    // 交换：复用放置结算（无指针偏移）
    if (this.heldId !== null) {
      this.drop(this.heldId, this.cursorCell, 0, 0, 0, 0);
      this.heldId = null;
      this.renderCursor();
    }
  }

  private releaseHeld(): void {
    if (this.heldId !== null) {
      this.heldId = null;
      this.renderCursor();
    }
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
    this.board.setAttribute('aria-label', t('boardAria'));
    this.cursorCell = null;
    this.heldId = null;
    this.resetViewport();
    this.hintEl.style.backgroundImage = `url("${session.stage.url}")`;
    this.hintEl.style.opacity = String(this.settings.hintOpacity);
    this.applyHint();
    this.syncToggleButtons();

    // 先量好棋盘尺寸再散布：#board 的尺寸只能来自 fitBoard 的内联样式，
    // 否则 scatterFree 测到 0 宽会推迟散布，buildPieces→syncPieces 立即同步执行
    // 就会因 freePos 为空而中断挂载（首次进入自由摆放必现）
    this.fitBoard();
    this.renderCellCodes();
    // 自由摆放：恢复或重新散布
    this.freePos.clear();
    if (mode === 'free') {
      if (saved?.freePos) {
        saved.freePos.forEach(([x, y], id) => this.freePos.set(id, { x, y }));
      } else {
        this.scatterFree();
      }
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const intro = !saved && !reducedMotion; // 新局才播爆散开场；续局与减动效走错落入场
    this.animating = true; // 构建含分片让出（F-513），期间拦截拖拽 / 键盘 / 重开，直到入场动画接管
    await this.buildPieces(intro);
    if (!this.session || !this.engine) return; // 构建期间被卸载，不再继续挂载
    this.controller = new DragController(this.board, { rows: this.rows, cols: this.cols }, {
      canPick: this.canPick,
      pickAt: this.pickAt,
      drop: this.drop,
      hoverChange: this.hoverChange,
      dragMove: this.onDragMove,
      rotate: rotationEnabled ? this.rotate : undefined,
    });
    this.clampAllFreePos();
    this.initPhysics();
    this.saveProgressNow();

    // 开局入场动画（F-202 / F-512）：新局播「完整图亮相 → 爆散」开场，其余走错落入场
    if (intro) {
      this.playExplosionIntro();
    } else {
      this.animating = true;
      this.later(() => {
        this.animating = false;
      }, ENTER_MS);
    }
    this.timers.push(window.setInterval(this.tick, 500));
  }

  unmount(): void {
    this.controller?.destroy();
    this.controller = null;
    this.engine = null;
    this.session = null;
    this.spec = null;
    this.shapes = null;
    this.pieceEls = [];
    if (this.blurUrl) {
      URL.revokeObjectURL(this.blurUrl);
      this.blurUrl = null;
    }
    document.getElementById('piece-clips')?.remove();
    this.freePos.clear();
    this.animating = false;
    this.introPlaying = false;
    this.stopPhysLoop();
    this.phys?.clear();
    this.phys = null;
    this.physHeldId = null;
    this.physAnchors.clear();
    const cellCodes = document.getElementById('cell-codes');
    if (cellCodes) cellCodes.classList.add('hidden');
    this.resetViewport();
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

  private async buildPieces(intro: boolean): Promise<void> {
    const stage = must(this.session, '对局参数缺失').stage;
    const engine = must(this.engine, '引擎未初始化');

    if (this.session?.opts.shape === 'classic') {
      this.spec = buildShapeSpec(this.rows, this.cols, stage.width, stage.height);
      this.shapes = buildPieceShapes(this.spec); // 纯几何瞬时完成（F-513 图集化：不再逐块光栅位图）
      // 折射强度随格子尺寸衰减（同原 paintGlass：a = cell/90）
      const refraction = 0.16 + 0.1 * Math.min(1, Math.min(stage.width / this.cols, stage.height / this.rows) / 90);
      this.blurUrl = await buildBlurredStageUrl(stage.url, refraction); // 全场共享一张模糊折射图层
      if (!this.session || !this.engine) return; // 切图期间被卸载
      this.injectPieceClips();
    } else {
      this.spec = null;
      this.shapes = null;
    }

    this.pieceEls = new Array(engine.getPieces().length);
    for (const p of engine.getPieces()) {
      const el = document.createElement('div');
      el.className = 'piece';
      el.dataset.pieceId = String(p.id);
      el.dataset.rot = String(p.rot);
      this.applyPieceGeometry(el, p.id);
      this.pieceEls[p.id] = el;
      if (intro) {
        // 爆散开场：先整体隐藏，亮相位姿由 playExplosionIntro 接管
        el.style.opacity = '0';
      } else {
        el.classList.add('enter');
        // 大块数下按总量压缩入场间隔，整体入场控制在约 1.2s 内
        const step = Math.min(18, Math.max(1, Math.round(1200 / engine.getPieces().length)));
        el.style.animationDelay = `${p.id * step}ms`;
        el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
      }
      this.board.appendChild(el);
    }
    this.syncPieces();
  }

  /** 异形块画布四周的 margin 留白（棋盘宽度百分比）：元素定位需反向偏移，格子部分才与网格线对齐 */
  private marginPct(): { mx: number; my: number } {
    const stage = this.session?.stage;
    if (!this.spec || !stage) return { mx: 0, my: 0 };
    return { mx: (this.spec.margin / stage.width) * 100, my: (this.spec.margin / stage.height) * 100 };
  }

  /** 同上，按棋盘像素计（用于 px 定位与命中/吸附判定的坐标修正） */
  private marginPx(rect: { width: number; height: number }): { mx: number; my: number } {
    const stage = this.session?.stage;
    if (!this.spec || !stage) return { mx: 0, my: 0 };
    return { mx: (this.spec.margin / stage.width) * rect.width, my: (this.spec.margin / stage.height) * rect.height };
  }

  /** 按形状/模式设置块的尺寸与初始位置 */
  private applyPieceGeometry(el: HTMLElement, id: number): void {
    const stage = must(this.session, '对局参数缺失').stage;
    if (this.shapes && this.spec && this.blurUrl) {
      const shape = this.shapes[id];
      const { mx, my } = this.marginPct();
      el.classList.add('shaped');
      el.style.width = `${100 / this.cols + mx * 2}%`;
      el.style.height = `${100 / this.rows + my * 2}%`;
      // 块面：共享舞台图 + 模糊折射 + CSS 渐变玻璃（F-510），不再逐块 canvas
      const cw = stage.width / this.cols;
      const ch = stage.height / this.rows;
      const m = this.spec.margin;
      const a = Math.min(1, Math.min(cw, ch) / 90); // 小格子降低玻璃强度，保证图像可辨识
      const sizeX = (stage.width / (cw + m * 2)) * 100; // 舞台图铺到元素坐标的比例
      const sizeY = (stage.height / (ch + m * 2)) * 100;
      const col = id % this.cols;
      const row = Math.floor(id / this.cols);
      // bg-position 百分比：offset / (元素 - 图) ，把舞台图平移到本块格子外扩 margin 的位置
      const posX = ((m - col * cw) / (cw + m * 2 - stage.width)) * 100;
      const posY = ((m - row * ch) / (ch + m * 2 - stage.height)) * 100;
      // 正面下沉为子层（F-513 回归修复）：背景 + 裁形挂 .piece-front 并隐藏背面，
      // 双击翻面才显示背面卡而非镜像图；滤镜（锁定辉光 / 提示脉冲）留在父级，
      // 在裁剪之外渲染，drop-shadow 轮廓光才不会被元素自身的 clip-path 裁掉
      const front = document.createElement('div');
      front.className = 'piece-front';
      front.style.clipPath = `url(#${shape.clipId})`;
      front.style.backgroundImage = [
        `linear-gradient(135deg, rgba(255,255,255,${(0.22 * a + 0.04).toFixed(3)}) 0%, rgba(255,255,255,${(0.05 * a).toFixed(3)}) 32%, rgba(255,255,255,0) 68%, rgba(255,255,255,${(0.09 * a + 0.02).toFixed(3)}) 100%)`,
        `url("${this.blurUrl}")`,
        `linear-gradient(315deg, rgba(0,0,0,${(0.06 + 0.1 * a).toFixed(3)}) 0%, rgba(0,0,0,0) 42%, rgba(255,255,255,${(0.06 + 0.1 * a).toFixed(3)}) 100%)`,
        `url("${stage.url}")`,
      ].join(', ');
      front.style.backgroundSize = `100% 100%, ${sizeX * 1.06}% ${sizeY * 1.06}%, 100% 100%, ${sizeX}% ${sizeY}%`;
      front.style.backgroundPosition = '0 0, 50% 50%, 0 0, ' + `${posX}% ${posY}%`;
      front.style.backgroundBlendMode = 'normal, screen, overlay, normal';
      front.style.backgroundRepeat = 'no-repeat';
      el.appendChild(front);
    } else {
      el.style.width = `${100 / this.cols}%`;
      el.style.height = `${100 / this.rows}%`;
      el.style.backgroundImage = `url("${stage.url}")`;
      el.style.backgroundSize = `${this.cols * 100}% ${this.rows * 100}%`;
      const col = id % this.cols;
      const row = Math.floor(id / this.cols);
      el.style.backgroundPosition = `${(col / (this.cols - 1)) * 100}% ${(row / (this.rows - 1)) * 100}%`;
    }
  }

  /** 注入全部异形块的共享 <clipPath> 定义（objectBoundingBox 归一化，一份 DOM 服务所有块） */
  private injectPieceClips(): void {
    if (!this.shapes) return;
    document.getElementById('piece-clips')?.remove();
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.id = 'piece-clips';
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    const frag = document.createDocumentFragment();
    for (const s of this.shapes) {
      const clip = document.createElementNS(NS, 'clipPath');
      clip.setAttribute('id', s.clipId);
      clip.setAttribute('clipPathUnits', 'objectBoundingBox'); // 0-1 归一化坐标随元素尺寸缩放
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', s.clipD);
      clip.appendChild(path);
      frag.appendChild(clip);
    }
    svg.appendChild(frag);
    document.body.appendChild(svg);
  }

  private restTransform(el: HTMLElement): void {
    el.style.transform = this.poseSuffix(el).trim();
  }

  /** 以引擎状态全量同步 DOM */
  private syncPieces(): void {
    const engine = this.engine;
    if (!engine) return; // 已卸载（延迟回调可能晚于 unmount 触发）
    const { mx, my } = this.marginPct(); // 异形块元素含留白，定位需反向偏移
    for (const p of engine.getPieces()) {
      const el = this.pieceEl(p.id);
      if (!el) continue;
      el.dataset.rot = String(p.rot);
      this.restTransform(el);
      el.classList.toggle('locked', p.locked);
      el.style.zIndex = p.locked ? '0' : '1';
      if (this.session?.opts.mode === 'free' && p.cell < 0) {
        const pos = this.freePos.get(p.id);
        if (!pos) continue; // 散布尚未完成（棋盘未量到尺寸），等散布后的补同步，不致命
        el.style.left = `${pos.x}px`;
        el.style.top = `${pos.y}px`;
        el.dataset.cell = '-1';
        el.dataset.px = String(pos.x);
        el.dataset.py = String(pos.y);
      } else {
        const col = p.cell % this.cols;
        const row = Math.floor(p.cell / this.cols);
        el.style.left = `${(col * 100) / this.cols - mx}%`;
        el.style.top = `${(row * 100) / this.rows - my}%`;
        el.dataset.cell = String(p.cell);
      }
    }
    this.progressEl.textContent = `${engine.placedCount}/${this.rows * this.cols}`;
    this.statMoves.textContent = `${engine.moves}${t('movesUnit')}`;
    this.btnHelp.textContent = `💡${this.hintsLeft}`;
    this.btnHelp.title = t('titleHelp');
    this.btnHelp.classList.toggle('off', this.hintsLeft <= 0);
    this.btnHelp.disabled = this.hintsLeft <= 0;
  }

  private pieceEl(id: number): HTMLElement | null {
    return this.pieceEls[id] ?? null; // 数组缓存 O(1)（F-513），原 querySelector 全表扫描为 O(n)
  }

  // ---------- 开局爆散开场（F-512） ----------

  /** 碎块最终散点（棋盘局部 px）：自由摆放取散布点，交换式取格子左上角 */
  private finalPiecePosPx(p: PuzzlePiece): { x: number; y: number } {
    const { w: lw, h: lh } = this.localSize();
    const { mx, my } = this.marginPx({ width: lw, height: lh });
    if (this.session?.opts.mode === 'free' && p.cell < 0) {
      const pos = this.freePos.get(p.id);
      if (pos) return { x: pos.x, y: pos.y };
    }
    const cell = p.cell >= 0 ? p.cell : p.id; // 散布点缺失时退回正确格
    return {
      x: ((cell % this.cols) * lw) / this.cols - mx,
      y: (Math.floor(cell / this.cols) * lh) / this.rows - my,
    };
  }

  /**
   * 开局爆散开场：完整拼图先整体亮相定格，随后白闪 + 冲击波 + 震屏，
   * 碎块从爆心由内向外依次炸飞到各自散布点（带翻滚与回弹落定），约 1.9s。
   * 期间 animating 拦截拖拽 / 键盘操作。
   */
  private playExplosionIntro(): void {
    const engine = this.engine;
    if (!engine) return;
    const { w: lw, h: lh } = this.localSize();
    if (lw === 0 || this.wrap.getBoundingClientRect().width === 0) {
      this.rAF(() => {
        if (this.engine) this.playExplosionIntro(); // 棋盘未量到尺寸（同 scatterFree 推迟），量到后重试
      });
      return;
    }
    const cw = lw / this.cols;
    const ch = lh / this.rows;
    const { mx, my } = this.marginPx({ width: lw, height: lh });
    const cx = lw / 2;
    const cy = lh / 2;
    const maxD = Math.hypot(cx, cy) || 1;

    // 预演算每块：完整图位（正确格）→ 最终散点的位移、起爆延迟（由内向外传播）与关键位姿。
    // reveal/land 保持同一变换函数序列（translate3d → rotate → rotateY → scale），保证逐段平滑插值。
    const flights: Array<{
      el: HTMLElement;
      fx: number;
      fy: number;
      dx: number;
      dy: number;
      delay: number;
      reveal: string;
      land: string;
    }> = [];
    for (const p of engine.getPieces()) {
      const el = this.pieceEl(p.id);
      if (!el) continue;
      const ax = ((p.id % this.cols) * lw) / this.cols - mx; // 正确格左上角 = 完整图位
      const ay = (Math.floor(p.id / this.cols) * lh) / this.rows - my;
      const fin = this.finalPiecePosPx(p);
      const dist = Math.min(1, Math.hypot(ax + cw / 2 - cx, ay + ch / 2 - cy) / maxD);
      const rot = Number(el.dataset.rot ?? 0) * 90;
      const flip = el.dataset.flipped === '1' ? ' rotateY(180deg)' : ' rotateY(0deg)';
      flights.push({
        el,
        fx: fin.x,
        fy: fin.y,
        dx: fin.x - ax,
        dy: fin.y - ay,
        delay: Math.round(dist * INTRO_STAGGER_MS),
        reveal: `translate3d(${-fin.x + ax}px, ${-fin.y + ay}px, 0) rotate(0deg)${flip} scale(1)`,
        land: `translate3d(0, 0, 0) rotate(${rot}deg)${flip} scale(1)`,
      });
    }

    this.animating = true;
    this.introPlaying = true;

    // 阶段一：碎块瞬移到完整图位姿（透明、微缩）→ 整体淡入放大亮相
    for (const f of flights) {
      const el = f.el;
      el.classList.remove('locked'); // 重开时清掉上局的锁定态描边，完整图才干净
      el.style.zIndex = '1';
      el.classList.add('no-anim');
      el.style.left = `${f.fx}px`;
      el.style.top = `${f.fy}px`;
      el.style.opacity = '0';
      el.style.transform = f.reveal;
      el.classList.remove('no-anim');
      el.animate(
        [
          { opacity: 0, transform: f.reveal.replace(' scale(1)', ' scale(0.92)') },
          { opacity: 1, transform: f.reveal },
        ],
        { duration: INTRO_REVEAL_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
      );
    }

    // 阶段二：定格蓄力后引爆——白闪 + 冲击波 + 震屏，碎块带随机翻滚向外炸飞。
    // 声音先起播，其可闻点滞后 = 输出链路延迟；视觉爆点按该延迟后移对齐可闻时刻（F-512）
    this.later(() => {
      if (!this.engine) return; // 已卸载
      playTone('explosion', this.settings.soundOn);
      const visualDelay = Math.round(audioOutputLatency(this.settings.soundOn) * 1000);
      this.later(() => {
        if (!this.engine) return; // 已卸载
        this.spawnExplosionFx();
        for (const f of flights) {
          const spin = Math.round(Math.random() * 56 - 28); // 起爆瞬间碎块的随机翻滚量
          f.el.animate(
            [
              { transform: f.reveal, offset: 0, easing: 'cubic-bezier(0.5, 0, 0.75, 0.6)' },
              {
                transform: f.reveal
                  .replace('rotate(0deg)', `rotate(${spin}deg)`)
                  .replace(' scale(1)', ' scale(1.06)'),
                offset: 0.14,
                easing: 'cubic-bezier(0.16, 0.84, 0.26, 1.02)', // 快出缓收 + 轻微过冲回弹
              },
              { transform: f.land, offset: 1 },
            ],
            { duration: INTRO_FLY_MS, delay: f.delay, fill: 'both' },
          );
        }
      }, visualDelay);
      // 阶段三：收尾——随视觉引爆顺延，确保碎块飞完再恢复常态（引擎同步 + 夹取 + 入快照）
      this.later(() => {
        for (const f of flights) {
          const el = f.el;
          el.classList.add('no-anim');
          el.style.opacity = '';
          el.style.transform = this.poseSuffix(el);
          el.classList.remove('no-anim');
          for (const a of el.getAnimations()) a.cancel();
        }
        this.introPlaying = false;
        this.animating = false;
        this.syncPieces();
        this.clampAllFreePos();
        this.saveProgressNow();
      }, visualDelay + INTRO_STAGGER_MS + INTRO_FLY_MS + 80);
    }, INTRO_REVEAL_MS + INTRO_HOLD_MS);
  }

  /** 爆炸瞬间特效：白闪 + 冲击波光环 + 场地震屏（CSS 动画结束自毁） */
  private spawnExplosionFx(): void {
    const { w: lw, h: lh } = this.localSize();
    const ring = document.createElement('div');
    ring.className = 'shockwave';
    const d = Math.round(Math.max(lw, lh) * 2.5);
    ring.style.width = `${d}px`;
    ring.style.height = `${d}px`;
    ring.style.left = `${lw / 2}px`;
    ring.style.top = `${lh / 2}px`;
    ring.addEventListener('animationend', () => ring.remove(), { once: true });
    this.board.appendChild(ring);

    const flash = document.createElement('div');
    flash.className = 'board-flash';
    flash.addEventListener('animationend', () => flash.remove(), { once: true });
    this.board.appendChild(flash);

    this.wrap.classList.add('shaking');
    this.later(() => this.wrap.classList.remove('shaking'), 620); // 动画时长 0.5s + 兜底
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
    // 画布逻辑尺寸为 stage 像素，路径坐标同源，直接映射（考虑旋转后）
    const lx = ((dx + hw) / (hw * 2)) * shape.logicalW;
    const ly = ((dy + hh) / (hh * 2)) * shape.logicalH;
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
    velocity?: { vx: number; vy: number },
  ): DropOutcome => {
    if (this.session?.opts.mode === 'free') {
      this.handleFreeDrop(pieceId, dx, dy, cx, cy, velocity);
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

  /** 目标格是否被其他块占用（自由摆放吸附前置校验） */
  private cellOccupied(cell: number, exceptPieceId: number): boolean {
    return !!this.engine?.getPieces().some((q) => q.cell === cell && q.id !== exceptPieceId);
  }

  /** 元素当前未变换位置的棋盘坐标（格上块按百分比定位，散置块按 px 定位） */
  private elementPosPx(el: HTMLElement, boardWidth: number, boardHeight: number): { x: number; y: number } {
    const lx = parseFloat(el.style.left);
    const ly = parseFloat(el.style.top);
    return {
      x: Number.isFinite(lx) && el.style.left.endsWith('%') ? (lx / 100) * boardWidth : Number.isFinite(lx) ? lx : 0,
      y: Number.isFinite(ly) && el.style.top.endsWith('%') ? (ly / 100) * boardHeight : Number.isFinite(ly) ? ly : 0,
    };
  }

  /**
   * 松手接续动画：把元素瞬移到最终位置，同时用位移把视觉接回松手点，
   * 随后平滑滑入目标格。避免「left 瞬变 + 拖拽位移残留」造成的抖动。
   */
  private settleTo(el: HTMLElement, pieceId: number, dx: number, dy: number, oldLeft: number, oldTop: number, left: number, top: number, z: string): void {
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.dataset.px = String(left);
    el.dataset.py = String(top);
    this.freePos.delete(pieceId);
    this.jumpTo(el, `translate3d(${oldLeft + dx - left}px, ${oldTop + dy - top}px, 0) scale(1.04)${this.poseSuffix(el)}`);
    el.style.zIndex = z;
    this.animating = true;
    this.rAF(() => {
      el.style.transform = this.poseSuffix(el); // 滑入最终姿态，朝向全程保持
    });
    this.later(() => {
      this.animating = false;
      this.syncPieces();
    }, ANIM_MS);
  }

  /** 自由摆放落子（F-302）：正确格吸附锁定；落在棋盘内吸附到所在格；其余原地散置 */
  private handleFreeDrop(pieceId: number, dx: number, dy: number, cx: number, cy: number, velocity?: { vx: number; vy: number }): void {
    const engine = must(this.engine, '引擎未初始化');
    const el = must(this.pieceEl(pieceId), '拖拽块元素缺失');
    const { w: lw, h: lh } = this.localSize();
    const cw = lw / this.cols;
    const ch = lh / this.rows;
    const { mx, my } = this.marginPx({ width: lw, height: lh });
    const p = engine.piece(pieceId);
    const { x: oldLeft, y: oldTop } = this.elementPosPx(el, lw, lh);
    this.physHeldId = null; // 拖拽结束

    // 拖拽回调的 cx/cy 坐标基准分两种（见 DragController.centerOf）：
    // 格上块按格中心（已含 margin 修正）；散置块按元素左上角（需加回 margin 才是格子部分中心）
    const off = p.cell < 0 ? { x: mx, y: my } : { x: 0, y: 0 };
    const px = cx + off.x;
    const py = cy + off.y;

    const ccx = ((p.id % this.cols) + 0.5) * cw;
    const ccy = (Math.floor(p.id / this.cols) + 0.5) * ch;
    const threshold = SNAP_RATIO * Math.min(cw, ch);
    const rotOk = !engine.rotationEnabled || p.rot === 0;

    // 1) 靠近正确格 + 朝向正确 + 该格空闲 → 吸附归位并锁定
    if (Math.hypot(px - ccx, py - ccy) < threshold && rotOk && !this.cellOccupied(p.id, pieceId)) {
      const outcome = engine.lockPiece(pieceId);
      engine.countMove();
      this.phys?.removeBody(pieceId); // 已定位块退出物理世界
      const newLeft = ccx - cw / 2 - mx;
      const newTop = ccy - ch / 2 - my;
      this.settleTo(el, pieceId, dx, dy, oldLeft, oldTop, newLeft, newTop, '30');
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

    // 2) 落点在棋盘内、目标格空闲 → 吸附到该格（网格对齐，不锁定）
    const col = Math.min(this.cols - 1, Math.max(0, Math.floor(px / cw)));
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor(py / ch)));
    const onBoard = px >= 0 && px <= lw && py >= 0 && py <= lh;
    const target = row * this.cols + col;
    if (onBoard && target !== p.cell && !this.cellOccupied(target, pieceId)) {
      engine.placeOnCell(pieceId, target);
      engine.countMove();
      this.phys?.removeBody(pieceId); // 已定位块退出物理世界
      const cellLeft = col * cw - mx;
      const cellTop = row * ch - my;
      this.settleTo(el, pieceId, dx, dy, oldLeft, oldTop, cellLeft, cellTop, '20');
      playTone('drop', this.settings.soundOn);
      this.scheduleSave();
      return;
    }

    // 3) 原地散置（含从格上拖出棋盘的情形）：引擎状态与视觉同步为散置
    // 点击未拖动的格上块视为无操作（避免误散置，也给双击翻面让路）
    const moved = Math.hypot(dx, dy) > 2;
    if (p.cell >= 0 && !moved && px >= 0 && px <= lw && py >= 0 && py <= lh) {
      this.restTransform(el);
      return;
    }
    if (p.cell >= 0) engine.scatterPiece(pieceId);
    const field = this.fieldRect();
    const box = this.freePieceBox();
    const clampedX = Math.min(Math.max(oldLeft + dx, field.fx), field.fx + field.fw - box.w);
    const clampedY = Math.min(Math.max(oldTop + dy, field.fy), field.fy + field.fh - box.h);
    this.freePos.set(pieceId, { x: clampedX, y: clampedY });
    el.style.left = `${clampedX}px`;
    el.style.top = `${clampedY}px`;
    el.dataset.cell = '-1';
    el.dataset.px = String(clampedX);
    el.dataset.py = String(clampedY);
    // 瞬时清掉拖拽位移（left 已是最终位置，视觉无跳变），随后平滑缩回
    this.jumpTo(el, `scale(1.04)${this.poseSuffix(el)}`);
    this.rAF(() => this.restTransform(el));
    this.later(() => this.syncPieces(), ANIM_MS);
    playTone('drop', this.settings.soundOn);
    this.scheduleSave();

    // 物理散置（F-511）：注入松手速度，块带惯性滑行 / 推挤邻居 / 撞墙反弹后入睡。
    // physicsOn 关闭时 world 为 null，行为完全回退为静置。
    if (this.phys) {
      if (!this.phys.has(pieceId)) {
        // 从棋盘拖出的块此前不在物理世界里，先补建
        this.phys.ensureBody(pieceId, clampedX + box.w / 2, clampedY + box.h / 2, this.physRadius());
      }
      const launched = this.phys.launch(
        pieceId,
        clampedX + box.w / 2,
        clampedY + box.h / 2,
        velocity?.vx ?? 0,
        velocity?.vy ?? 0,
      );
      if (launched) this.startPhysLoop();
    }
  }

  // ---------- 桌面物理（F-511） ----------

  /** 散落场地即物理边界（棋盘局部 px） */
  private physBounds(): PhysRect {
    const f = this.fieldRect();
    return { x: f.fx, y: f.fy, w: f.fw, h: f.fh };
  }

  /** 物理碰撞半径：块占位盒（含异形留白）短边的圆近似 */
  private physRadius(): number {
    const box = this.freePieceBox();
    return Math.min(box.w, box.h) * 0.46;
  }

  /**
   * 构建 / 重建物理世界：散置块全部以 static 入场（静置不互挤），
   * 被拖拽、丢掷或碰撞时才转 dynamic。
   */
  private initPhysics(): void {
    this.stopPhysLoop();
    this.phys = null;
    this.physHeldId = null;
    if (!this.settings.physicsOn || !this.engine) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (this.localSize().w === 0 || this.wrap.getBoundingClientRect().width === 0) {
      // 棋盘尚未量到尺寸（与 scatterFree 同款推迟），量到后重建
      this.rAF(() => {
        if (this.engine && this.settings.physicsOn) this.initPhysics();
      });
      return;
    }
    const world = new PhysWorld();
    world.setBounds(this.physBounds());
    const r = this.physRadius();
    const box = this.freePieceBox();
    for (const p of this.engine.getPieces()) {
      if (p.cell >= 0) continue;
      const pos = this.freePos.get(p.id);
      if (pos) world.ensureBody(p.id, pos.x + box.w / 2, pos.y + box.h / 2, r);
    }
    this.phys = world;
  }

  /** 拖拽移动：被拖块作为 kinematic 同步进物理世界，推挤散落邻居 */
  private onDragMove = (pieceId: number, cx: number, cy: number, vx: number, vy: number): void => {
    const phys = this.phys;
    const engine = this.engine;
    if (!phys || !engine) return;
    const { w: lw, h: lh } = this.localSize();
    const { mx, my } = this.marginPx({ width: lw, height: lh });
    const p = engine.piece(pieceId);
    const off = p.cell < 0 ? { x: mx, y: my } : { x: 0, y: 0 };
    const bx = cx + off.x;
    const by = cy + off.y;
    const anchor = this.physAnchors.get(pieceId);
    if (anchor) {
      // 拾起运动中的块（F-513）：先把物理位置落回 left/top，控制权交给指针
      const box = this.freePieceBox();
      const pos = phys.bodyPos(pieceId);
      const x = (pos ? pos.x : anchor.x + box.w / 2) - box.w / 2;
      const y = (pos ? pos.y : anchor.y + box.h / 2) - box.h / 2;
      this.freePos.set(pieceId, { x, y });
      const el = this.pieceEl(pieceId);
      if (el) {
        el.classList.add('no-anim');
        el.style.transition = '';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.dataset.px = String(x);
        el.dataset.py = String(y);
        // 与拖拽控制器同构的位移串，接住指针起点避免跳变
        const dx0 = bx - (anchor.x + box.w / 2);
        const dy0 = by - (anchor.y + box.h / 2);
        const rot = Number(el.dataset.rot ?? 0);
        el.style.transform = `translate3d(${dx0}px, ${dy0}px, 0) scale(1.04)${rot ? ` rotate(${rot * 90}deg)` : ''}`;
        el.classList.remove('no-anim');
      }
      this.physAnchors.delete(pieceId);
    }
    if (!phys.has(pieceId)) phys.ensureBody(pieceId, bx, by, this.physRadius());
    phys.setKinematic(pieceId, bx, by, vx, vy);
    this.physHeldId = pieceId;
    this.physHeldMovedAt = performance.now();
    this.startPhysLoop();
  };

  /** 物理主循环：有醒着的 body 才跑；每帧把移动过的块写回 left/top 与 freePos */
  private readonly physLoop = (now: number): void => {
    const phys = this.phys;
    if (!phys || !this.physRunning) return;
    const dt = this.physLast ? Math.min(0.05, (now - this.physLast) / 1000) : 0;
    this.physLast = now;
    // 指针停住后清零 kinematic 速度，避免持续推挤
    if (this.physHeldId !== null && now - this.physHeldMovedAt > 90) phys.haltKinematic(this.physHeldId);
    const movedIds = phys.step(dt);
    if (movedIds.length) {
      const box = this.freePieceBox();
      const half = { w: box.w / 2, h: box.h / 2 };
      for (const id of movedIds) {
        if (id === this.physHeldId) continue; // 拖拽块位置由指针控制
        const pos = phys.bodyPos(id);
        if (!pos) continue;
        const x = pos.x - half.w;
        const y = pos.y - half.h;
        let anchor = this.physAnchors.get(id);
        if (!anchor) {
          anchor = { x, y }; // 首次运动：以当前 left/top 为锚，运动期仅写 transform
          this.physAnchors.set(id, anchor);
          const el0 = this.pieceEl(id);
          if (el0) el0.style.transition = 'none';
        }
        this.freePos.set(id, { x, y });
        const el = this.pieceEl(id);
        if (el) {
          el.style.transform = `translate3d(${x - anchor.x}px, ${y - anchor.y}px, 0)${this.poseSuffix(el)}`;
        }
      }
    }
    if (phys.isSettled && this.physHeldId === null) {
      this.commitPhysAnchors();
      this.physRunning = false;
      this.physRaf = 0;
      this.scheduleSave(); // 静置后的散布位置入快照
      return;
    }
    this.physRaf = requestAnimationFrame(this.physLoop);
  };

  /** 物理静置：把锚定期的 transform 位移一次性落回 left/top（单帧提交，F-513） */
  private commitPhysAnchors(): void {
    if (!this.physAnchors.size) return;
    const phys = this.phys;
    const box = this.freePieceBox();
    for (const [id, anchor] of this.physAnchors) {
      const pos = phys?.bodyPos(id);
      const x = (pos ? pos.x : anchor.x + box.w / 2) - box.w / 2;
      const y = (pos ? pos.y : anchor.y + box.h / 2) - box.h / 2;
      this.freePos.set(id, { x, y });
      const el = this.pieceEl(id);
      if (el) {
        el.classList.add('no-anim');
        el.style.transition = '';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.dataset.px = String(x);
        el.dataset.py = String(y);
        this.restTransform(el);
        el.classList.remove('no-anim');
      }
    }
    this.physAnchors.clear();
  }

  private startPhysLoop(): void {
    if (this.physRunning || !this.phys) return;
    this.physRunning = true;
    this.physLast = performance.now();
    this.physRaf = requestAnimationFrame(this.physLoop);
  }

  private stopPhysLoop(): void {
    this.physRunning = false;
    if (this.physRaf) {
      cancelAnimationFrame(this.physRaf);
      this.physRaf = 0;
    }
  }

  private hoverChange = (info: { pieceId: number; cell: number | null; cx: number; cy: number } | null): void => {
    if (!info) {
      this.hideCellHint();
      return;
    }
    if (this.session?.opts.mode === 'free') {
      // 自由摆放：高亮「松手后会吸附的格」——靠近的正确格，或落点所在空格（与吸附判定同一坐标基准）
      const engine = this.engine;
      if (!engine) return;
      const { w: lw, h: lh } = this.localSize();
      const cw = lw / this.cols;
      const ch = lh / this.rows;
      const { mx, my } = this.marginPx({ width: lw, height: lh });
      const p = engine.piece(info.pieceId);
      const off = p.cell < 0 ? { x: mx, y: my } : { x: 0, y: 0 };
      const px = info.cx + off.x;
      const py = info.cy + off.y;
      const rotOk = !engine.rotationEnabled || p.rot === 0;
      const ccx = ((p.id % this.cols) + 0.5) * cw;
      const ccy = (Math.floor(p.id / this.cols) + 0.5) * ch;
      if (
        Math.hypot(px - ccx, py - ccy) < SNAP_RATIO * Math.min(cw, ch) &&
        rotOk &&
        !this.cellOccupied(p.id, p.id)
      ) {
        this.showCellHint(p.id);
        return;
      }
      const onBoard = px >= 0 && px <= lw && py >= 0 && py <= lh;
      const col = Math.min(this.cols - 1, Math.max(0, Math.floor(px / cw)));
      const row = Math.min(this.rows - 1, Math.max(0, Math.floor(py / ch)));
      const target = row * this.cols + col;
      if (onBoard && target !== p.cell && !this.cellOccupied(target, p.id)) {
        this.showCellHint(target);
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
    const { w: lw, h: lh } = this.localSize();
    const cw = lw / this.cols;
    const ch = lh / this.rows;
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

  /** 静止姿态后缀：朝向旋转 + 背面翻面（与 restTransform 一致） */
  private poseSuffix(el: HTMLElement): string {
    const rot = Number(el.dataset.rot ?? 0);
    return (rot ? ` rotate(${rot * 90}deg)` : '') + (el.dataset.flipped === '1' ? ' rotateY(180deg)' : '');
  }

  private rotSuffix(el: HTMLElement): string {
    return this.poseSuffix(el);
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
    this.resultSub.textContent = solvedSub(formatMs(timeMs), engine.moves);
    this.resultRecords.textContent =
      res.newTimeRecord || res.newMovesRecord
        ? t('newRecord')
        : bestRecord(formatMs(res.bestTimeMs), res.bestMoves);

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
    img.src = session.stage.url;
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
    ctx.fillText(t('shareTitle'), W / 2, H - 168);
    ctx.font = '30px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`${this.rows}×${this.cols} · ${this.rows * this.cols} 块`, W / 2, H - 116);
    ctx.font = '600 36px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#ffb454';
    ctx.fillText(solvedSub(this.statTime.textContent, engine.moves), W / 2, H - 66);
    ctx.font = '18px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(238, 240, 248, 0.7)';
    ctx.fillText(t('shareBrand'), W / 2, H - 26);

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
    this.btnSound.title = this.settings.soundOn ? t('titleSoundOn') : t('titleSoundOff');
    this.btnSound.classList.toggle('off', !this.settings.soundOn);
    this.btnHint.textContent = '👁';
    this.btnHint.title = this.settings.hintEnabled ? t('titleHintRefOn') : t('titleHintRefOff');
    this.btnHint.classList.toggle('off', !this.settings.hintEnabled);
    this.btnLock.textContent = this.settings.lockOnSnap ? '🔒' : '🔓';
    this.btnLock.title = this.settings.lockOnSnap ? t('titleLockOn') : t('titleLockOff');
    this.btnLock.classList.toggle('off', !this.settings.lockOnSnap);
    this.btnCode.textContent = 'A1';
    this.btnCode.title = this.settings.gridCodes ? t('titleGridOn') : t('titleGridOff');
    this.btnCode.classList.toggle('active', this.settings.gridCodes);
    this.btnPhysics.textContent = '🎱';
    this.btnPhysics.title = this.settings.physicsOn ? t('titlePhysicsOn') : t('titlePhysicsOff');
    this.btnPhysics.classList.toggle('off', !this.settings.physicsOn);
  }

  // ---------- 操作入口 ----------

  private restart(): void {
    if (!this.engine || this.animating) return; // 动画进行中不重开（避免开场序列重叠）
    this.commitPhysAnchors(); // 物理运动中重开：先把锚点位移落盘再重散布（F-513）
    this.board.classList.remove('solved');
    this.engine.reshuffle();
    this.hintsLeft = MAX_HINTS;
    if (this.session?.opts.mode === 'free') this.scatterFree();
    this.initPhysics();
    this.stats.start();
    this.hideDialog();
    this.saveProgressNow();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.syncPieces(); // 减动效：直接落位
    } else {
      this.playExplosionIntro(); // 重新打乱同样以爆散开场亮相
    }
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

  /** 棋盘局部像素尺寸（layout 单位；块定位、散布、吸附判定全部使用该坐标系） */
  private localSize(): { w: number; h: number } {
    return { w: this.board.offsetWidth, h: this.board.offsetHeight };
  }

  /** 自由模式下块的实际占位（含异形留白），用于散布与夹取 */
  private freePieceBox(): { w: number; h: number } {
    const { w: lw } = this.localSize();
    const stage = must(this.session, '对局参数缺失').stage;
    const scale = lw / stage.width;
    const m = (this.spec?.margin ?? 0) * scale;
    return { w: lw / this.cols + m * 2, h: this.localSize().h / this.rows + m * 2 };
  }

  /**
   * 散落场地：以棋盘为中心四周各外扩 50%（棋盘的 2 倍见方）的局部坐标区域，
   * 至少覆盖整个可见视口。配合缩放 / 平移，散落块可分布在视口之外，
   * 场地与当前视口位置无关（平移 / 缩放后再夹取不会漂移）。
   */
  private fieldRect(): { fx: number; fy: number; fw: number; fh: number; lw: number; lh: number } {
    const wrapRect = this.wrap.getBoundingClientRect();
    const scale = this.scaleFactor();
    const { w: lw, h: lh } = this.localSize();
    const viewW = wrapRect.width / scale;
    const viewH = wrapRect.height / scale;
    const fw = Math.max(lw * 2, viewW);
    const fh = Math.max(lh * 2, viewH);
    return {
      fx: (lw - fw) / 2,
      fy: (lh - fh) / 2,
      fw,
      fh,
      lw,
      lh,
    };
  }

  /** 把未归位块随机散布在棋盘四周的场地内（避开棋盘区域） */
  private scatterFree(): void {
    if (!this.engine || !this.session) return;
    if (this.localSize().w === 0 || this.wrap.getBoundingClientRect().width === 0) {
      this.rAF(() => {
        if (!this.engine) return; // 已卸载
        this.scatterFree();
        this.syncPieces(); // 散布完成后补一次同步，把块摆到散布位置
        this.initPhysics(); // 散布位置就绪后再建物理世界
      });
      return;
    }
    const field = this.fieldRect();
    const box = this.freePieceBox();
    const engine = must(this.engine, '引擎未初始化');
    for (const p of engine.getPieces()) {
      if (p.cell >= 0) continue;
      let x = 0;
      let y = 0;
      let ok = false;
      for (let attempt = 0; attempt < 50 && !ok; attempt++) {
        x = field.fx + Math.random() * Math.max(field.fw - box.w, 1);
        y = field.fy + Math.random() * Math.max(field.fh - box.h, 1);
        // 避开棋盘区域（留 6px 缓冲）
        const intersects = x + box.w > 6 && x < field.lw - 6 && y + box.h > 6 && y < field.lh - 6;
        ok = !intersects;
      }
      this.freePos.set(p.id, { x, y });
    }
  }

  /** 视口尺寸变化后把散布块夹回场地内 */
  private clampAllFreePos(): void {
    if (this.introPlaying) return; // 爆散开场进行中：位置由开场动画接管，结束后再夹取
    if (this.session?.opts.mode !== 'free' || !this.engine) return;
    if (this.localSize().w === 0 || this.wrap.getBoundingClientRect().width === 0) return;
    const box = this.freePieceBox();
    const field = this.fieldRect();
    for (const p of this.engine.getPieces()) {
      if (p.cell >= 0) continue;
      if (this.physAnchors.has(p.id)) continue; // 运动中的块由物理锚点接管（F-513）
      const pos = this.freePos.get(p.id);
      if (!pos) continue;
      pos.x = Math.min(Math.max(pos.x, field.fx), field.fx + field.fw - box.w);
      pos.y = Math.min(Math.max(pos.y, field.fy), field.fy + field.fh - box.h);
      const el = this.pieceEl(p.id);
      if (el) {
        el.style.left = `${pos.x}px`;
        el.style.top = `${pos.y}px`;
        el.dataset.px = String(pos.x);
        el.dataset.py = String(pos.y);
      }
    }
    // 物理世界同步：边界更新 + 静置块位置对齐（运动中的块交由边界反弹接管）
    if (this.phys) {
      this.phys.setBounds(this.physBounds());
      this.phys.clampIntoBounds();
      for (const p of this.engine.getPieces()) {
        if (p.cell >= 0) continue;
        const pos = this.freePos.get(p.id);
        if (pos) this.phys.placeStatic(p.id, pos.x + box.w / 2, pos.y + box.h / 2);
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
