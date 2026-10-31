/** 难度配置（F-101 / F-102）；labelKey 为 i18n 词条（F-403） */
export interface PresetDifficulty {
  rows: number;
  cols: number;
  labelKey: string;
}

export const PRESETS: PresetDifficulty[] = [
  { rows: 3, cols: 3, labelKey: 'beginner' },
  { rows: 4, cols: 4, labelKey: 'easy' },
  { rows: 5, cols: 5, labelKey: 'medium' },
  { rows: 6, cols: 6, labelKey: 'hard' },
  { rows: 8, cols: 8, labelKey: 'master' },
  { rows: 10, cols: 10, labelKey: 'hell' },
];

export const MIN_DIM = 2;
export const MAX_DIM = 10;
