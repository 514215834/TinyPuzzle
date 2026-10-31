/**
 * localStorage 安全封装：隐私模式 / 配额写满时静默降级到内存，
 * 保证存储故障不会导致功能崩溃（架构文档 §12 风险对策）。
 */
const memory = new Map<string, string>();

function backend(): Storage | null {
  try {
    const s = globalThis.localStorage;
    s.setItem('__tp_probe__', '1');
    s.removeItem('__tp_probe__');
    return s;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string): T | null {
  try {
    const s = backend();
    const raw = s ? s.getItem(key) : (memory.get(key) ?? null);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    const raw = JSON.stringify(value);
    const s = backend();
    if (s) s.setItem(key, raw);
    else memory.set(key, raw);
  } catch {
    // 配额写满等场景静默降级
  }
}

export function removeKey(key: string): void {
  try {
    const s = backend();
    if (s) s.removeItem(key);
    else memory.delete(key);
  } catch {
    // ignore
  }
}
