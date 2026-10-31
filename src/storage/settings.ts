import { readJson, writeJson } from './kv';
import { MAX_DIM, MIN_DIM } from '../app/config';

/** 用户偏好（localStorage `tp.settings`，架构文档 §8.1） */
export interface Settings {
  /** 上次使用的难度（下次默认） */
  rows: number;
  cols: number;
  /** 正确落位后是否锁定（F-106） */
  lockOnSnap: boolean;
  /** 原图半透明参考（F-105） */
  hintEnabled: boolean;
  /** 参考底图不透明度 */
  hintOpacity: number;
  /** 音效开关（F-203） */
  soundOn: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  rows: 3,
  cols: 3,
  lockOnSnap: true,
  hintEnabled: false,
  hintOpacity: 0.2,
  soundOn: true,
};

const KEY = 'tp.settings';

function clampInt(v: unknown, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_DIM, Math.max(MIN_DIM, n));
}

function clampBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function loadSettings(): Settings {
  const raw = readJson<Partial<Settings>>(KEY) ?? {};
  return {
    rows: clampInt(raw.rows, DEFAULT_SETTINGS.rows),
    cols: clampInt(raw.cols, DEFAULT_SETTINGS.cols),
    lockOnSnap: clampBool(raw.lockOnSnap, DEFAULT_SETTINGS.lockOnSnap),
    hintEnabled: clampBool(raw.hintEnabled, DEFAULT_SETTINGS.hintEnabled),
    hintOpacity: Math.min(0.6, Math.max(0.05, Number(raw.hintOpacity) || DEFAULT_SETTINGS.hintOpacity)),
    soundOn: clampBool(raw.soundOn, DEFAULT_SETTINGS.soundOn),
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  writeJson(KEY, next);
  return next;
}
