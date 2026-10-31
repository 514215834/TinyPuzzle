/** 拼图块（纯数据，DOM 同步由视图层负责） */
export interface PuzzlePiece {
  /** 原始位置索引（row * cols + col），即正确落点 */
  id: number;
  /** 当前所在格索引（自由摆放模式下，未归位时为 -1） */
  cell: number;
  /** 是否已锁定（位于正确格且朝向正确，不可再拖动） */
  locked: boolean;
  /** 旋转次数（0-3，各 90°；仅旋转模式启用） */
  rot: number;
}

/** 棋盘规格 */
export interface BoardSpec {
  rows: number;
  cols: number;
}

/** 玩法选项（V0.4） */
export interface GameOptions {
  /** 交换式 / 自由摆放（F-302） */
  mode: 'swap' | 'free';
  /** 方块 / 经典凹凸（F-301） */
  shape: 'square' | 'classic';
  /** 旋转模式（F-303，仅 ≥25 块开放） */
  rotationEnabled: boolean;
}

/** 一次放置的结算结果（交换式） */
export type DropOutcome =
  | { type: 'snapback' } // 落回原格，无变化
  | { type: 'bounce' } // 无效落点（目标格已锁定），弹回
  | { type: 'swap'; a: number; b: number } // 与目标格的块互换
  | { type: 'solved'; a: number; b: number }; // 互换且全部归位

/** 自由摆放的放置结算 */
export type PlaceOutcome =
  | { type: 'placed' }
  | { type: 'solved' };
