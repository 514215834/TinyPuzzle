import { buildPieces } from './slicer';
import { resolveDrop } from './snapSolver';
import { shuffledAssignment } from './shuffle';
import type { DropOutcome, PuzzlePiece } from './types';

/**
 * 一局对局的状态容器：持有拼图块状态，对外提供放置结算与重开。
 * 纯数据操作，不触碰 DOM（视图层负责渲染同步）。
 */
export class PuzzleEngine {
  private pieces: PuzzlePiece[];
  private movesCount = 0;

  /** 是否在正确落位后锁定（F-106，可随时切换，仅影响后续落子） */
  lockOnSnap: boolean;

  constructor(
    readonly rows: number,
    readonly cols: number,
    assignment: number[],
    lockOnSnap = true,
  ) {
    this.pieces = buildPieces(assignment, lockOnSnap);
    this.lockOnSnap = lockOnSnap;
  }

  static create(rows: number, cols: number, lockOnSnap = true, rng: () => number = Math.random): PuzzleEngine {
    return new PuzzleEngine(rows, cols, shuffledAssignment(rows * cols, rng), lockOnSnap);
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

  /** 已归位块数（按格子判断，与锁定开关无关） */
  get placedCount(): number {
    return this.pieces.reduce((n, p) => n + (p.cell === p.id ? 1 : 0), 0);
  }

  get isSolved(): boolean {
    return this.pieces.every((p) => p.cell === p.id);
  }

  /** 有效交换步数（F-104，弹回不计） */
  get moves(): number {
    return this.movesCount;
  }

  restoreMoves(count: number): void {
    this.movesCount = Math.max(0, Math.round(count));
  }

  /** cells[cell] = pieceId（进度快照用） */
  getAssignment(): number[] {
    const cells = new Array<number>(this.rows * this.cols).fill(0);
    for (const p of this.pieces) cells[p.cell] = p.id;
    return cells;
  }

  /** 放置结算：更新内部状态并返回结果 */
  drop(pieceId: number, targetCell: number): DropOutcome {
    const { outcome, next } = resolveDrop(this.pieces, pieceId, targetCell, this.lockOnSnap);
    this.pieces = next;
    if (outcome.type === 'swap' || outcome.type === 'solved') this.movesCount += 1;
    return outcome;
  }

  /** 同图重新打乱（F-107），步数与进度一并重置 */
  reshuffle(rng: () => number = Math.random): void {
    this.pieces = buildPieces(shuffledAssignment(this.rows * this.cols, rng), this.lockOnSnap);
    this.movesCount = 0;
  }
}
