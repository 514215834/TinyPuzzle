/** 拼图块（纯数据，DOM 同步由视图层负责） */
export interface PuzzlePiece {
  /** 原始位置索引（row * cols + col），即正确落点 */
  id: number;
  /** 当前所在格索引 */
  cell: number;
  /** 是否已锁定（位于正确格，不可再拖动） */
  locked: boolean;
}

/** 棋盘规格 */
export interface BoardSpec {
  rows: number;
  cols: number;
}

/** 一次放置的结算结果 */
export type DropOutcome =
  | { type: 'snapback' } // 落回原格，无变化
  | { type: 'bounce' } // 无效落点（目标格已锁定），弹回
  | { type: 'swap'; a: number; b: number } // 与目标格的块互换
  | { type: 'solved'; a: number; b: number }; // 互换且全部归位
