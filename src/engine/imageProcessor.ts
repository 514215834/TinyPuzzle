/**
 * 图片处理（F-001）：解码（含 EXIF 方向修正）→ 居中裁剪到棋盘比例 → 缩放至舞台尺寸。
 * 全程在浏览器本地完成，无任何网络请求。
 */

export interface StageImage {
  /** 处理后的位图 dataURL（拼图块背景图来源） */
  dataUrl: string;
  width: number;
  height: number;
  /** 宽高比 width / height */
  ratio: number;
}

/** 舞台最长边（像素），限制大图内存占用 */
export const STAGE_MAX = 1024;
/** 棋盘宽高比夹取范围：过扁/过长的图片居中裁剪到该范围，保证格子形状合理 */
export const MIN_RATIO = 3 / 4;
export const MAX_RATIO = 4 / 3;

const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function isSupportedImage(file: File): boolean {
  return SUPPORTED_TYPES.includes(file.type);
}

export function clampBoardRatio(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/** 在原图上取居中的目标比例裁剪区（cover） */
export function computeCrop(
  imgW: number,
  imgH: number,
  ratio: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (imgW / imgH > ratio) {
    const sw = imgH * ratio;
    return { sx: (imgW - sw) / 2, sy: 0, sw, sh: imgH };
  }
  const sh = imgW / ratio;
  return { sx: 0, sy: (imgH - sh) / 2, sw: imgW, sh };
}

/** 舞台像素尺寸：最长边 = STAGE_MAX */
export function computeStageSize(ratio: number): { w: number; h: number } {
  return ratio >= 1
    ? { w: STAGE_MAX, h: Math.round(STAGE_MAX / ratio) }
    : { w: Math.round(STAGE_MAX * ratio), h: STAGE_MAX };
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeViaImage(blob: Blob): Promise<Decoded> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  try {
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

async function decode(blob: Blob): Promise<Decoded> {
  // SVG 走 Image 路径（部分浏览器不支持 createImageBitmap 处理 SVG）
  if (blob.type === 'image/svg+xml') return decodeViaImage(blob);
  if (typeof createImageBitmap === 'function') {
    try {
      // imageOrientation: from-image 按 EXIF 信息自动转正
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      // 参数不受支持等场景，降级到 Image
    }
  }
  return decodeViaImage(blob);
}

function exportDataUrl(canvas: HTMLCanvasElement): string {
  const webp = canvas.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.9);
}

/** Blob / File → 舞台图 */
export async function blobToStage(blob: Blob): Promise<StageImage> {
  const img = await decode(blob);
  try {
    const ratio = clampBoardRatio(img.width / img.height);
    const { w, h } = computeStageSize(ratio);
    const { sx, sy, sw, sh } = computeCrop(img.width, img.height, ratio);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w);
    canvas.height = Math.round(h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 上下文不可用');
    ctx.fillStyle = '#ffffff'; // 透明底兜底（导出 JPEG 时避免黑底）
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img.source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    return {
      dataUrl: exportDataUrl(canvas),
      width: canvas.width,
      height: canvas.height,
      ratio: canvas.width / canvas.height,
    };
  } finally {
    img.release();
  }
}

/** 内置示例图 / 任意同源 URL → 舞台图 */
export async function urlToStage(url: string): Promise<StageImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`图片加载失败：${res.status}`);
  return blobToStage(await res.blob());
}
