/**
 * 图片处理（F-001）：解码（含 EXIF 方向修正）→ 按真实宽高比等比缩放至舞台尺寸（不裁剪）。
 * 全程在浏览器本地完成，无任何网络请求。
 */

export interface StageImage {
  /** 处理后的位图 dataURL（拼图块背景图来源） */
  dataUrl: string;
  width: number;
  height: number;
  /** 宽高比 width / height（与原图一致） */
  ratio: number;
}

/** 舞台最长边（像素）；预留缩放查看的高清余量，限制大图内存占用 */
export const STAGE_MAX = 2048;

const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function isSupportedImage(file: File): boolean {
  return SUPPORTED_TYPES.includes(file.type);
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

/** Blob / File → 舞台图（保留原图完整内容与真实比例） */
export async function blobToStage(blob: Blob): Promise<StageImage> {
  const img = await decode(blob);
  try {
    return renderStage(img, img.width / img.height);
  } finally {
    img.release();
  }
}

/** 舞台渲染：整图等比缩放到舞台尺寸（最长边 = STAGE_MAX，不裁剪） */
function renderStage(img: Decoded, ratio: number): StageImage {
  const { w, h } = computeStageSize(ratio);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 上下文不可用');
  ctx.fillStyle = '#ffffff'; // 透明底兜底（导出 JPEG 时避免黑底）
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img.source, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);

  return {
    dataUrl: exportDataUrl(canvas),
    width: canvas.width,
    height: canvas.height,
    ratio: canvas.width / canvas.height,
  };
}

/** 内置示例图 / 任意同源 URL → 舞台图 */
export async function urlToStage(url: string): Promise<StageImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`图片加载失败：${res.status}`);
  return blobToStage(await res.blob());
}
