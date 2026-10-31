/** 难度配置（F-101 / F-102） */
export interface PresetDifficulty {
  rows: number;
  cols: number;
  label: string;
}

export const PRESETS: PresetDifficulty[] = [
  { rows: 3, cols: 3, label: '入门' },
  { rows: 4, cols: 4, label: '简单' },
  { rows: 5, cols: 5, label: '中等' },
  { rows: 6, cols: 6, label: '困难' },
  { rows: 8, cols: 8, label: '大师' },
  { rows: 10, cols: 10, label: '地狱' },
];

export const MIN_DIM = 2;
export const MAX_DIM = 10;
