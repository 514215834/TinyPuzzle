import type { StageImage } from '../../engine/imageProcessor';
import { loadSettings } from '../../storage/settings';
import { fitGrid, PIECE_PRESETS } from '../config';
import { presetLabel, t } from '../i18n';
import { must } from '../../utils/dom';

export interface SetupConfig {
  /** 目标块数（记忆用）；行列已按图片比例算出 */
  pieceTarget: number;
  rows: number;
  cols: number;
}

export interface SetupHandlers {
  onStart: (config: SetupConfig) => void;
  onBack: () => void;
}

/** 难度设置页（F-101/F-102）：块数预设（行列随图片比例自适应）；形状/玩法/旋转已固定 */
export function initSetupView(handlers: SetupHandlers): {
  show: (stage: StageImage) => void;
  hide: () => void;
  refreshI18n: () => void;
} {
  const root = must(document.querySelector<HTMLElement>('#view-setup'), '#view-setup');
  const thumb = must(root.querySelector<HTMLImageElement>('#setup-thumb'), '#setup-thumb');
  const grid = must(root.querySelector<HTMLElement>('#setup-grid'), '#setup-grid');
  const presetGrid = must(root.querySelector<HTMLElement>('#preset-grid'), '#preset-grid');

  const settings = loadSettings();
  let pieceTarget = settings.pieceTarget;
  let stageRatio = 1;

  /** 当前预设对应的行列 */
  const gridOf = (target: number): { rows: number; cols: number } => fitGrid(stageRatio, target);

  const presetLabelHtml = (target: number, labelKey: string): string => {
    const { rows, cols } = gridOf(target);
    return `<b>${cols}×${rows}</b><span>${rows * cols} ${t('pieces')} · ${presetLabel(labelKey)}</span>`;
  };
  for (const preset of PIECE_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset';
    btn.innerHTML = presetLabelHtml(preset.target, preset.labelKey);
    btn.addEventListener('click', () => {
      pieceTarget = preset.target;
      sync();
    });
    presetGrid.appendChild(btn);
  }
  const presetBtns = Array.from(presetGrid.querySelectorAll<HTMLButtonElement>('.preset'));


  must(root.querySelector<HTMLButtonElement>('#btn-start'), '#btn-start').addEventListener('click', () => {
    const { rows, cols } = gridOf(pieceTarget);
    handlers.onStart({ pieceTarget, rows, cols });
  });
  must(root.querySelector<HTMLButtonElement>('#btn-setup-back'), '#btn-setup-back').addEventListener('click', () => {
    handlers.onBack();
  });

  function sync(): void {
    presetBtns.forEach((btn, i) => {
      const p = PIECE_PRESETS[i];
      btn.classList.toggle('active', p.target === pieceTarget);
    });
    const { rows, cols } = gridOf(pieceTarget);
    grid.style.backgroundSize = `${100 / cols}% ${100 / rows}%`;
  }

  function show(stage: StageImage): void {
    thumb.src = stage.dataUrl;
    stageRatio = stage.ratio;
    root.classList.remove('hidden');
    presetBtns.forEach((btn, i) => {
      btn.innerHTML = presetLabelHtml(PIECE_PRESETS[i].target, PIECE_PRESETS[i].labelKey);
    });
    sync();
  }

  function hide(): void {
    root.classList.add('hidden');
  }

  function refreshI18n(): void {
    presetBtns.forEach((btn, i) => {
      btn.innerHTML = presetLabelHtml(PIECE_PRESETS[i].target, PIECE_PRESETS[i].labelKey);
    });
    sync();
  }

  return { show, hide, refreshI18n };
}
