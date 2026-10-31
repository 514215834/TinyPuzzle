/**
 * 最近图片缓存（F-205，IndexedDB `tinypuzzle/images`）。
 * 仅缓存本地 Blob，不上传服务器；容量上限 5 张（架构文档 §8.2）。
 * IndexedDB 不可用时所有方法安全降级（进度恢复自动失效）。
 */
const DB_NAME = 'tinypuzzle';
const STORE = 'images';
const MAX_IMAGES = 5;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打开数据库失败'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('数据库操作失败'));
    });
  } finally {
    db.close();
  }
}

/** 写入图片，返回引用 id；超出上限自动清理最旧的 */
export async function putImage(blob: Blob): Promise<string> {
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await withStore('readwrite', (s) => s.put(blob, id));
  await pruneImages(id);
  return id;
}

export async function getImage(id: string): Promise<Blob | null> {
  try {
    const blob = await withStore<Blob | undefined>('readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>);
    return blob ?? null;
  } catch {
    return null;
  }
}

export async function deleteImage(id: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(id));
  } catch {
    // ignore
  }
}

/** 只保留最近 MAX_IMAGES 张（id 含时间戳前缀，可按序清理） */
export async function pruneImages(keepId?: string): Promise<void> {
  try {
    const keys = await withStore<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    const sorted = keys.map(String).sort();
    const stale = sorted.filter((k) => k !== keepId).slice(0, Math.max(0, sorted.length - MAX_IMAGES));
    for (const k of stale) await deleteImage(k);
  } catch {
    // ignore
  }
}
