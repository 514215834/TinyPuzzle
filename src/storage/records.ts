import { readJson, writeJson } from './kv';

/** 最佳记录（F-204，localStorage `tp.records`，架构文档 §8.1） */
export interface RecordEntry {
  /** 用时 ms */
  time: number;
  /** 步数 */
  moves: number;
  /** 完成时间戳 */
  at: number;
}

export type RecordMap = Record<string, RecordEntry[]>;

const KEY = 'tp.records';
const MAX_ENTRIES = 10; // 每难度档最多保留最近 10 条

export function recordKey(rows: number, cols: number): string {
  return `${rows}x${cols}`;
}

export interface ResultSummary {
  bestTimeMs: number;
  bestMoves: number;
  newTimeRecord: boolean;
  newMovesRecord: boolean;
}

/** 纯函数：把一次成绩并入记录表（每档保留最近 MAX_ENTRIES 条） */
export function applyResult(
  map: RecordMap,
  rows: number,
  cols: number,
  timeMs: number,
  moves: number,
): ResultSummary & { map: RecordMap } {
  const key = recordKey(rows, cols);
  const list = Array.isArray(map[key]) ? map[key] : [];
  const prevBestTime = list.length ? Math.min(...list.map((e) => e.time)) : Infinity;
  const prevBestMoves = list.length ? Math.min(...list.map((e) => e.moves)) : Infinity;

  const entry: RecordEntry = { time: timeMs, moves, at: Date.now() };
  const nextList = [...list, entry].slice(-MAX_ENTRIES);

  return {
    map: { ...map, [key]: nextList },
    bestTimeMs: Math.min(prevBestTime, timeMs),
    bestMoves: Math.min(prevBestMoves, moves),
    newTimeRecord: timeMs < prevBestTime,
    newMovesRecord: moves < prevBestMoves,
  };
}

export function loadRecords(): RecordMap {
  return readJson<RecordMap>(KEY) ?? {};
}

export function saveRecords(map: RecordMap): void {
  writeJson(KEY, map);
}

/** 提交一次成绩并持久化，返回是否破纪录与当前最佳 */
export function submitResult(rows: number, cols: number, timeMs: number, moves: number): ResultSummary {
  const { map, ...summary } = applyResult(loadRecords(), rows, cols, timeMs, moves);
  saveRecords(map);
  return summary;
}
