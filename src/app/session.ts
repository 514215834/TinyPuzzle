import type { StageImage } from '../engine/imageProcessor';
import type { SavedProgress } from '../storage/progress';

/** 图片引用（上传图走 IndexedDB，示例图走静态 URL） */
export interface ImageMeta {
  imageRef: string;
  imageKind: 'upload' | 'sample';
}

/** 一次待玩/在玩的对局参数 */
export interface GameSession {
  stage: StageImage;
  meta: ImageMeta;
  rows: number;
  cols: number;
  /** 继续上局时的快照（F-205） */
  saved?: SavedProgress;
}
