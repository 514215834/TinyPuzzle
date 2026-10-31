import type { StageImage } from '../../engine/imageProcessor';
import { loadSettings } from '../../storage/settings';
import { MAX_DIM, MIN_DIM, PRESETS } from '../config';
import { must } from '../../utils/dom';

export interface SetupHandlers {
  onStart: (rows: number, cols: number) => void;
  onBack: () => void;
}

/** 难度设置页（F-101 / F-102）：预设档位 + 自定义行列 + 网格预览 */
export function initSetupView(handlers: SetupHandlers): { show: (stage: StageImage) => void; hide: () => void } {
  const root = must(document.querySelector<HTMLElement>('#view-setup'), '#view-setup');
  const thumb = must(root.querySelector<HTMLImageElement>('#setup-thumb'), '#setup-thumb');
  const grid = must(root.querySelector<HTMLElement>('#setup-grid'), '#setup-grid');
  const presetGrid = must(root.querySelector<HTMLElement>('#preset-grid'), '#preset-grid');
  const selRows = must(root.querySelector<HTMLSelectElement>('#sel-rows'), '#sel-rows');
  const selCols = must(root.querySelector<HTMLSelectElement>('#sel-cols'), '#sel-cols');
  const pieceCount = must(root.querySelector<HTMLElement>('#piece-count'), '#piece-count');

  const settings = loadSettings();
  let rows = settings.rows;
  let cols = settings.cols;

  // 预设档位卡片
  const presetBtns: HTMLButtonElement[] = [];
  for (const preset of PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset';
    btn.innerHTML = `<b>${preset.rows}×${preset.cols}</b><span>${preset.rows * preset.cols} 块 · ${preset.label}</span>`;
    btn.addEventListener('click', () => {
      rows = preset.rows;
      cols = preset.cols;
      sync();
    });
    presetGrid.appendChild(btn);
    presetBtns.push(btn);
  }

  // 自定义行列 2–10
  for (let n = MIN_DIM; n <= MAX_DIM; n++) {
    for (const sel of [selRows, selCols]) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = `${n}`;
      sel.appendChild(opt);
    }
  }
  selRows.addEventListener('change', () => {
    rows = Number(selRows.value);
    sync();
  });
  selCols.addEventListener('change', () => {
    cols = Number(selCols.value);
    sync();
  });

  must(root.querySelector<HTMLButtonElement>('#btn-start'), '#btn-start').addEventListener('click', () => {
    handlers.onStart(rows, cols);
  });
  must(root.querySelector<HTMLButtonElement>('#btn-setup-back'), '#btn-setup-back').addEventListener('click', () => {
    handlers.onBack();
  });

  function sync(): void {
    selRows.value = String(rows);
    selCols.value = String(cols);
    pieceCount.textContent = `${rows * cols} 块`;
    presetBtns.forEach((btn, i) => {
      const p = PRESETS[i];
      btn.classList.toggle('active', p.rows === rows && p.cols === cols);
    });
    grid.style.backgroundSize = `${100 / cols}% ${100 / rows}%`;
  }

  function show(stage: StageImage): void {
    thumb.src = stage.dataUrl;
    root.classList.remove('hidden');
    sync();
  }

  function hide(): void {
    root.classList.add('hidden');
  }

  return { show, hide };
}
