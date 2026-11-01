import { readJson, writeJson } from '../storage/kv';

/** 界面语言（F-403）：zh-CN / en，默认跟随浏览器并可手动切换 */
export type Lang = 'zh' | 'en';

type Params = Record<string, string>;

interface Dict {
  [key: string]: unknown;
  sampleNames: Record<string, string>;
  presetLabels: Record<string, string>;
  solvedSub: (time: string, moves: number) => string;
  bestRecord: (time: string, moves: number) => string;
  sampleAria: (name: string) => string;
}

const zh: Dict = {
  appTagline: '上传一张图片，把它变成你的拼图',
  chooseImage: '选择图片',
  processing: '处理中…',
  dropHint: '或将图片拖到这里 · 支持 PNG / JPG / WebP',
  orPickSample: '或选择示例图',
  privacyNote: '🔒 图片仅在你的浏览器本地处理，不会上传到任何服务器',
  resumeTitle: '继续上局',
  resumeAction: '继续',
  resumeDiscard: '放弃并清除',
  unsupportedFile: '暂不支持该文件，请选择 PNG / JPG / WebP 图片',
  imageFailed: '图片处理失败，请换一张试试',
  resumeGone: '上局图片已失效，请重新选择',
  backToPick: '‹ 重新选图',
  setupTitle: '选择难度',
  rows: '行',
  cols: '列',
  pieces: '块',
  optShape: '形状',
  optMode: '玩法',
  optAdvanced: '进阶',
  shapeSquare: '方块',
  shapeClassic: '经典凹凸',
  modeSwap: '交换拼合',
  modeFree: '自由摆放',
  rotationOff: '🔄 旋转模式：关',
  rotationOn: '🔄 旋转模式：开',
  start: '开始拼图',
  backToHome: '‹ 换一张图',
  restart: '重新打乱',
  placed: '已归位',
  movesUnit: ' 步',
  titleSoundOn: '音效：开',
  titleSoundOff: '音效：关',
  titleHintRefOn: '原图参考：开',
  titleHintRefOff: '原图参考：关',
  titleLockOn: '吸附锁定：开',
  titleGridOn: '网格编码：开（双击拼图块翻面查看编码）',
  titleGridOff: '网格编码：关',
  titlePhysicsOn: '桌面物理：开（散落块可碰撞推动、丢掷滑行）',
  titlePhysicsOff: '桌面物理：关',
  titleLockOff: '吸附锁定：关',
  titleHelp: '提示（快捷键 H）',
  solved: '拼图完成！',
  solvedSub: (time, moves) => `用时 ${time} · ${moves} 步`,
  newRecord: '🏆 新纪录！',
  bestRecord: (time, moves) => `历史最佳 ${time} · ${moves} 步`,
  playAgain: '再玩一次',
  shareImage: '保存成绩图',
  changeImage: '换一张图',
  shareTitle: '🎉 拼图完成！',
  shareBrand: 'TinyPuzzle · 在线拼图',
  boardAria: '拼图棋盘：方向键移动光标，Enter 拾起或交换，Q/E 左右旋转',
  langSwitch: 'EN',
  sampleNames: {
    'sample-01': '水上庭院',
    'sample-02': '悠闲时光',
    'sample-03': '花冠少女',
    'sample-04': '山间草原',
  },
  presetLabels: {
    p500: '高清',
    p1000: '极清',
    p2000: '挑战',
  },
  sampleAria: (name) => `示例图：${name}`,
};

const en: Dict = {
  appTagline: 'Upload an image and turn it into your jigsaw puzzle',
  chooseImage: 'Choose Image',
  processing: 'Processing…',
  dropHint: 'or drop an image here · PNG / JPG / WebP',
  orPickSample: 'or pick a sample',
  privacyNote: '🔒 Images stay in your browser — never uploaded',
  resumeTitle: 'Resume last game',
  resumeAction: 'Resume',
  resumeDiscard: 'Discard progress',
  unsupportedFile: 'Unsupported file. Please choose a PNG / JPG / WebP image',
  imageFailed: 'Failed to process the image. Try another one',
  resumeGone: 'Last game is no longer available. Pick a new image',
  backToPick: '‹ Change image',
  setupTitle: 'Choose difficulty',
  rows: 'Rows',
  cols: 'Cols',
  pieces: 'pieces',
  optShape: 'Shape',
  optMode: 'Mode',
  optAdvanced: 'Extra',
  shapeSquare: 'Square',
  shapeClassic: 'Classic jigsaw',
  modeSwap: 'Swap',
  modeFree: 'Free play',
  rotationOff: '🔄 Rotation: off',
  rotationOn: '🔄 Rotation: on',
  start: 'Start Puzzle',
  backToHome: '‹ Change image',
  restart: 'Shuffle',
  placed: 'Placed',
  movesUnit: ' moves',
  titleSoundOn: 'Sound: on',
  titleSoundOff: 'Sound: off',
  titleHintRefOn: 'Reference: on',
  titleHintRefOff: 'Reference: off',
  titleLockOn: 'Snap lock: on',
  titleGridOn: 'Grid codes: on (double-click a piece to flip it)',
  titleGridOff: 'Grid codes: off',
  titlePhysicsOn: 'Tabletop physics: on (scattered pieces collide, slide and bounce)',
  titlePhysicsOff: 'Tabletop physics: off',
  titleLockOff: 'Snap lock: off',
  titleHelp: 'Hint (key: H)',
  solved: 'Puzzle Solved!',
  solvedSub: (time, moves) => `Time ${time} · ${moves} moves`,
  newRecord: '🏆 New record!',
  bestRecord: (time, moves) => `Best ${time} · ${moves} moves`,
  playAgain: 'Play again',
  shareImage: 'Save result card',
  changeImage: 'Change image',
  shareTitle: '🎉 Puzzle Solved!',
  shareBrand: 'TinyPuzzle · Online Jigsaw',
  boardAria: 'Puzzle board: arrows to move, Enter to pick/swap, Q/E to rotate',
  langSwitch: '中文',
  sampleNames: {
    'sample-01': 'Flooded Courtyard',
    'sample-02': 'Lazy Afternoon',
    'sample-03': 'Flower Girls',
    'sample-04': 'Alpine Meadow',
  },
  presetLabels: {
    p500: 'HD',
    p1000: 'Ultra',
    p2000: 'Extreme',
  },
  sampleAria: (name) => `Sample: ${name}`,
};

const dicts: Record<Lang, Dict> = { zh, en };
void ({} as Params);

const KEY = 'tp.lang';
let current: Lang = detectDefault();

function detectDefault(): Lang {
  const saved = readJson<Lang>(KEY);
  if (saved === 'zh' || saved === 'en') return saved;
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  writeJson(KEY, lang);
  applyStatic();
}

export function t(key: string): string {
  const v = dicts[current][key] ?? dicts.zh[key];
  return typeof v === 'string' ? v : key;
}

export function sampleName(id: string): string {
  return dicts[current].sampleNames[id] ?? dicts.zh.sampleNames[id] ?? id;
}

export function presetLabel(key: string): string {
  return dicts[current].presetLabels[key] ?? dicts.zh.presetLabels[key] ?? key;
}

export function sampleAria(name: string): string {
  return dicts[current].sampleAria(name);
}

export function solvedSub(time: string, moves: number): string {
  return dicts[current].solvedSub(time, moves);
}

export function bestRecord(time: string, moves: number): string {
  return dicts[current].bestRecord(time, moves);
}

/** 静态 DOM 文案替换：index.html 中带 data-i18n / data-i18n-title 的节点 */
export function applyStatic(): void {
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const v = t(el.dataset.i18n ?? '');
    if (v) el.textContent = v;
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const v = t(el.dataset.i18nTitle ?? '');
    if (v) el.title = v;
  });
}
