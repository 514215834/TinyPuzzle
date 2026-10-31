import { readJson, removeKey, writeJson } from './kv';

/**
 * 对局快照（F-205/F-206 v2，localStorage `tp.progress`；图片本体在 IndexedDB）。
 * v2 新增：形状/玩法/旋转与朝向、自由摆放散布位置、剩余提示次数。
 */
export interface SavedProgress {
  v: 2;
  /** IndexedDB 图片 id（上传图）或示例图 URL */
  imageRef: string;
  imageKind: 'upload' | 'sample';
  rows: number;
  cols: number;
  /** cells[cell] = pieceId；自由摆放未归位记 -1 */
  cells: number[];
  /** 按 pieceId 索引的朝向（非旋转模式全 0） */
  rots: number[];
  mode: 'swap' | 'free';
  shape: 'square' | 'classic';
  rotationEnabled: boolean;
  /** 自由摆放：按 pieceId 索引的散布位置（棋盘像素坐标），null 表示交换式 */
  freePos: Array<[number, number]> | null;
  /** 剩余提示次数（F-304） */
  hintsLeft: number;
  moves: number;
  elapsedMs: number;
  savedAt: number;
}

const KEY = 'tp.progress';
/** 单边最大格数（与 config.MAX_DIM 一致，极端比例大块数网格） */
const MAX_DIM = 220;

export function loadProgress(): SavedProgress | null {
  const raw = readJson<SavedProgress>(KEY);
  if (!raw || typeof raw !== 'object' || (raw as SavedProgress).v !== 2) return null;
  const p = raw as SavedProgress;
  const n = p.rows * p.cols;
  const dimsOk =
    Number.isInteger(p.rows) && Number.isInteger(p.cols) && p.rows >= 2 && p.cols >= 2 && p.rows <= MAX_DIM && p.cols <= MAX_DIM;
  if (!dimsOk || !Array.isArray(p.cells) || p.cells.length !== n) return null;
  if (p.mode === 'swap') {
    // 交换式：双射校验
    const sorted = [...p.cells].sort((a, b) => a - b);
    if (!sorted.every((v, i) => v === i)) return null;
  } else {
    // 自由摆放：-1 表示未归位，其余为唯一 pieceId
    const seen = new Set<number>();
    for (const v of p.cells) {
      if (v === -1) continue;
      if (!Number.isInteger(v) || v < 0 || v >= n || seen.has(v)) return null;
      seen.add(v);
    }
  }
  const numsOk =
    typeof p.moves === 'number' && typeof p.elapsedMs === 'number' && p.elapsedMs >= 0 &&
    typeof p.hintsLeft === 'number' && p.hintsLeft >= 0 && p.hintsLeft <= 3;
  const refOk = typeof p.imageRef === 'string' && p.imageRef.length > 0;
  const rotsOk = Array.isArray(p.rots) && p.rots.length === n && p.rots.every((r) => Number.isInteger(r) && r >= 0 && r <= 3);
  const shapeOk = p.shape === 'square' || p.shape === 'classic';
  const freePosOk = p.freePos === null || (Array.isArray(p.freePos) && p.freePos.length === n);
  if (!numsOk || !refOk || !rotsOk || !shapeOk || !freePosOk) return null;
  if (p.imageKind !== 'upload' && p.imageKind !== 'sample') return null;
  return p;
}

export function saveProgress(p: SavedProgress): void {
  writeJson(KEY, p);
}

export function clearProgress(): void {
  removeKey(KEY);
}
