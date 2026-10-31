import { readJson, removeKey, writeJson } from './kv';

/** 对局快照（F-205，localStorage `tp.progress`；图片本体在 IndexedDB） */
export interface SavedProgress {
  /** IndexedDB 图片 id（上传图）或示例图 URL */
  imageRef: string;
  imageKind: 'upload' | 'sample';
  rows: number;
  cols: number;
  /** cells[cell] = pieceId */
  cells: number[];
  moves: number;
  elapsedMs: number;
  savedAt: number;
}

const KEY = 'tp.progress';

export function loadProgress(): SavedProgress | null {
  const raw = readJson<SavedProgress>(KEY);
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as SavedProgress;
  const n = p.rows * p.cols;
  const dimsOk =
    Number.isInteger(p.rows) && Number.isInteger(p.cols) && p.rows >= 2 && p.cols >= 2 && p.rows <= 10 && p.cols <= 10;
  const cellsOk =
    Array.isArray(p.cells) &&
    p.cells.length === n &&
    [...p.cells].sort((a, b) => a - b).every((v, i) => v === i); // 双射校验
  const numsOk = typeof p.moves === 'number' && typeof p.elapsedMs === 'number' && p.elapsedMs >= 0;
  const refOk = typeof p.imageRef === 'string' && p.imageRef.length > 0;
  if (!dimsOk || !cellsOk || !numsOk || !refOk || (p.imageKind !== 'upload' && p.imageKind !== 'sample')) return null;
  return p;
}

export function saveProgress(p: SavedProgress): void {
  writeJson(KEY, p);
}

export function clearProgress(): void {
  removeKey(KEY);
}
