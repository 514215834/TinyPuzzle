import { readJson, writeJson } from './kv';
import { MAX_PIECE_TARGET, MIN_PIECE_TARGET } from '../app/config';

/**
 * 用户偏好（localStorage `tp.settings`，架构文档 §8.1）。
 * 形状 / 玩法 / 旋转已固定为经典凹凸 + 自由摆放 + 可旋转，不再作为设置项。
 */
export interface Settings {
  /** 上次使用的目标块数（下次默认；行列按图片比例自适应） */
  pieceTarget: number;
  /** 正确落位后是否锁定（F-106） */
  lockOnSnap: boolean;
  /** 原图半透明参考（F-105） */
  hintEnabled: boolean;
  /** 参考底图不透明度 */
  hintOpacity: number;
  /** 音效开关（F-203） */
  soundOn: boolean;
  /** 网格 / 拼图编码显示（默认关；开启后网格显示 A1 编码、块可双击翻面查看编码） */
  gridCodes: boolean;
  /** 桌面物理碰撞（F-511，默认开）：散落块可被推动 / 丢掷滑行 / 边缘反弹 */
  physicsOn: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  pieceTarget: 1000,
  lockOnSnap: true,
  hintEnabled: false,
  hintOpacity: 0.2,
  soundOn: true,
  gridCodes: false,
  physicsOn: true,
};

const KEY = 'tp.settings';

function clampInt(v: unknown, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_PIECE_TARGET, Math.max(MIN_PIECE_TARGET, n));
}

function clampBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function loadSettings(): Settings {
  const raw = readJson<Partial<Settings>>(KEY) ?? {};
  return {
    pieceTarget: clampInt(raw.pieceTarget, DEFAULT_SETTINGS.pieceTarget),
    lockOnSnap: clampBool(raw.lockOnSnap, DEFAULT_SETTINGS.lockOnSnap),
    hintEnabled: clampBool(raw.hintEnabled, DEFAULT_SETTINGS.hintEnabled),
    hintOpacity: Math.min(0.6, Math.max(0.05, Number(raw.hintOpacity) || DEFAULT_SETTINGS.hintOpacity)),
    soundOn: clampBool(raw.soundOn, DEFAULT_SETTINGS.soundOn),
    gridCodes: clampBool(raw.gridCodes, DEFAULT_SETTINGS.gridCodes),
    physicsOn: clampBool(raw.physicsOn, DEFAULT_SETTINGS.physicsOn),
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  writeJson(KEY, next);
  return next;
}
