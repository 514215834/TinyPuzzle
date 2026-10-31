import type { DropOutcome, PuzzlePiece } from './types';

export interface DropResult {
  outcome: DropOutcome;
  /** 更新后的完整状态；无变化（snapback/bounce）时与入参同引用 */
  next: PuzzlePiece[];
}

/**
 * 放置结算（F-004 / F-005，纯函数）：
 * 1. 落回自己的格子 → snapback；
 * 2. 目标格的块已锁定 → bounce（无效落点）；
 * 3. 目标格为其他未锁定块 → 两块互换，落对且朝向正确的块按 lockOnSnap 决定是否锁定（F-106/F-303）；
 * 4. 互换后全部归位（按格子与朝向判断，与是否锁定无关）→ solved。
 */
export function resolveDrop(
  pieces: PuzzlePiece[],
  pieceId: number,
  targetCell: number,
  lockOnSnap = true,
  rotationEnabled = false,
): DropResult {
  const piece = pieces.find((p) => p.id === pieceId);
  if (!piece) return { outcome: { type: 'snapback' }, next: pieces };

  if (targetCell === piece.cell) return { outcome: { type: 'snapback' }, next: pieces };

  const target = pieces.find((p) => p.cell === targetCell);
  if (!target) return { outcome: { type: 'snapback' }, next: pieces };
  if (target.locked) return { outcome: { type: 'bounce' }, next: pieces };

  const rotOk = (p: PuzzlePiece): boolean => !rotationEnabled || p.rot === 0;
  const next = pieces.map((p): PuzzlePiece => {
    if (p.id === pieceId) {
      return { ...p, cell: targetCell, locked: lockOnSnap && targetCell === p.id && rotOk(p) };
    }
    if (p.id === target.id) {
      return { ...p, cell: piece.cell, locked: lockOnSnap && piece.cell === p.id && rotOk(p) };
    }
    return p;
  });

  const solved = next.every((p) => p.cell === p.id && rotOk(p));
  const outcome: DropOutcome = solved
    ? { type: 'solved', a: pieceId, b: target.id }
    : { type: 'swap', a: pieceId, b: target.id };
  return { outcome, next };
}
