import { buildPieces } from './slicer';
import { resolveDrop } from './snapSolver';
import { shuffledAssignment } from './shuffle';
import type { DropOutcome, PlaceOutcome, PuzzlePiece } from './types';

export interface EngineOptions {
  /** 正确落位后是否锁定（F-106，默认开） */
  lockOnSnap?: boolean;
  /** 旋转模式（F-303，默认关） */
  rotationEnabled?: boolean;
  /** 交换式 / 自由摆放（F-302，默认交换式） */
  mode?: 'swap' | 'free';
  /** 初始朝向（按 pieceId 索引，仅旋转模式生效；用于进度恢复） */
  rots?: number[];
}

/**
 * 一局对局的状态容器：持有拼图块状态，对外提供放置结算与重开。
 * 纯数据操作，不触碰 DOM（视图层负责渲染同步）。
 */
export class PuzzleEngine {
  private pieces: PuzzlePiece[];
  private movesCount = 0;

  /** 是否在正确落位后锁定（可随时切换，仅影响后续落子） */
  lockOnSnap: boolean;
  readonly rotationEnabled: boolean;
  readonly mode: 'swap' | 'free';

  constructor(
    readonly rows: number,
    readonly cols: number,
    assignment: number[],
    opts: EngineOptions = {},
  ) {
    const lockOnSnap = opts.lockOnSnap ?? true;
    this.rotationEnabled = opts.rotationEnabled ?? false;
    this.mode = opts.mode ?? 'swap';
    this.lockOnSnap = lockOnSnap;
    this.pieces = buildPieces(assignment, lockOnSnap, opts.rots, this.rotationEnabled, this.mode === 'free');
  }

  static create(rows: number, cols: number, opts: EngineOptions = {}, rng: () => number = Math.random): PuzzleEngine {
    // 自由摆放开局全部散置（cell = -1），不使用打乱布局
    const assignment = opts.mode === 'free'
      ? new Array<number>(rows * cols).fill(-1)
      : shuffledAssignment(rows * cols, rng);
    return new PuzzleEngine(rows, cols, assignment, {
      ...opts,
      rots: opts.rotationEnabled ? randomRots(rows * cols, rng) : opts.rots,
    });
  }

  getPieces(): readonly PuzzlePiece[] {
    return this.pieces;
  }

  piece(id: number): PuzzlePiece {
    const p = this.pieces.find((it) => it.id === id);
    if (!p) throw new Error(`拼图块不存在：${id}`);
    return p;
  }

  pieceAt(cell: number): PuzzlePiece {
    const p = this.pieces.find((it) => it.cell === cell);
    if (!p) throw new Error(`格子上没有拼图块：${cell}`);
    return p;
  }

  /** 朝向与位置都正确才算归位 */
  private settled(p: PuzzlePiece): boolean {
    return p.cell === p.id && (!this.rotationEnabled || p.rot === 0);
  }

  /** 已归位块数 */
  get placedCount(): number {
    return this.pieces.reduce((n, p) => n + (this.settled(p) ? 1 : 0), 0);
  }

  get isSolved(): boolean {
    return this.pieces.every((p) => this.settled(p));
  }

  /** 有效交换步数（F-104，弹回不计） */
  get moves(): number {
    return this.movesCount;
  }

  restoreMoves(count: number): void {
    this.movesCount = Math.max(0, Math.round(count));
  }

  /** 自由摆放模式：成功归位计一步 */
  countMove(): void {
    this.movesCount += 1;
  }

  /** cells[cell] = pieceId；自由摆放模式未归位的块记为 -1（进度快照用） */
  getAssignment(): number[] {
    const cells = new Array<number>(this.rows * this.cols).fill(-1);
    for (const p of this.pieces) {
      if (p.cell >= 0) cells[p.cell] = p.id;
    }
    return cells;
  }

  /** 朝向表（按 pieceId 索引，进度快照用） */
  getRots(): number[] {
    return this.pieces.map((p) => p.rot);
  }

  /** 交换式放置结算：更新内部状态并返回结果 */
  drop(pieceId: number, targetCell: number): DropOutcome {
    const { outcome, next } = resolveDrop(this.pieces, pieceId, targetCell, this.lockOnSnap, this.rotationEnabled);
    this.pieces = next;
    if (outcome.type === 'swap' || outcome.type === 'solved') this.movesCount += 1;
    return outcome;
  }

  /** 自由摆放：吸附到正确格（F-302）。朝向不对时仅记录位置、不锁定 */
  lockPiece(pieceId: number): PlaceOutcome {
    const p = this.piece(pieceId);
    p.cell = p.id;
    p.locked = this.lockOnSnap && (!this.rotationEnabled || p.rot === 0);
    return this.isSolved ? { type: 'solved' } : { type: 'placed' };
  }

  /** 自由摆放：停到指定格（不判正确性；占用校验由视图层负责），永不锁定 */
  placeOnCell(pieceId: number, cell: number): void {
    const p = this.piece(pieceId);
    p.cell = cell;
    p.locked = false;
  }

  /** 自由摆放：从格上拿回散置（cell = -1） */
  scatterPiece(pieceId: number): void {
    const p = this.piece(pieceId);
    p.cell = -1;
    p.locked = false;
  }

  /** 旋转一块（F-303）：dir=1 顺时针、-1 逆时针；停放在正确格的块会因朝向变化解除锁定 */
  rotatePiece(pieceId: number, dir: 1 | -1 = 1): number {
    const p = this.piece(pieceId);
    p.rot = (p.rot + (dir === 1 ? 1 : 3)) % 4;
    p.locked = this.lockOnSnap && p.cell === p.id && (!this.rotationEnabled || p.rot === 0);
    return p.rot;
  }

  /** 同图重新打乱（F-107），步数与进度一并重置 */
  reshuffle(rng: () => number = Math.random): void {
    const rots = this.rotationEnabled ? randomRots(this.rows * this.cols, rng) : undefined;
    // 自由摆放与开局一致：全部散置（cell = -1），由视图层重新散布
    const assignment = this.mode === 'free'
      ? new Array<number>(this.rows * this.cols).fill(-1)
      : shuffledAssignment(this.rows * this.cols, rng);
    this.pieces = buildPieces(assignment, this.lockOnSnap, rots, this.rotationEnabled, this.mode === 'free');
    this.movesCount = 0;
  }
}

function randomRots(n: number, rng: () => number): number[] {
  return Array.from({ length: n }, () => Math.floor(rng() * 4));
}
