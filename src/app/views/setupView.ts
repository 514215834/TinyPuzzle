import type { StageImage } from '../../engine/imageProcessor';
import { loadSettings } from '../../storage/settings';
import { MAX_DIM, MIN_DIM, PRESETS } from '../config';
import { must } from '../../utils/dom';

export interface SetupConfig {
  rows: number;
  cols: number;
  shape: 'square' | 'classic';
  mode: 'swap' | 'free';
  rotationEnabled: boolean;
}

export interface SetupHandlers {
  onStart: (config: SetupConfig) => void;
  onBack: () => void;
}

/** 难度设置页（F-101/F-102/F-301/F-302/F-303）：难度 + 形状 + 玩法 + 旋转 */
export function initSetupView(handlers: SetupHandlers): { show: (stage: StageImage) => void; hide: () => void } {
  const root = must(document.querySelector<HTMLElement>('#view-setup'), '#view-setup');
  const thumb = must(root.querySelector<HTMLImageElement>('#setup-thumb'), '#setup-thumb');
  const grid = must(root.querySelector<HTMLElement>('#setup-grid'), '#setup-grid');
  const presetGrid = must(root.querySelector<HTMLElement>('#preset-grid'), '#preset-grid');
  const selRows = must(root.querySelector<HTMLSelectElement>('#sel-rows'), '#sel-rows');
  const selCols = must(root.querySelector<HTMLSelectElement>('#sel-cols'), '#sel-cols');
  const pieceCount = must(root.querySelector<HTMLElement>('#piece-count'), '#piece-count');
  const shapeBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-shape]'));
  const modeBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-mode]'));
  const rotToggle = must(root.querySelector<HTMLButtonElement>('#opt-rotation'), '#opt-rotation');
  const rotWrap = must(root.querySelector<HTMLElement>('#opt-rotation-wrap'), '#opt-rotation-wrap');

  const settings = loadSettings();
  let rows = settings.rows;
  let cols = settings.cols;
  let shape = settings.shape;
  let mode = settings.mode;
  let rotationEnabled = settings.rotationEnabled;

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
  }
  const presetBtns = Array.from(presetGrid.querySelectorAll<HTMLButtonElement>('.preset'));

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

  for (const btn of shapeBtns) {
    btn.addEventListener('click', () => {
      shape = btn.dataset.shape as typeof shape;
      sync();
    });
  }
  for (const btn of modeBtns) {
    btn.addEventListener('click', () => {
      mode = btn.dataset.mode as typeof mode;
      sync();
    });
  }
  rotToggle.addEventListener('click', () => {
    rotationEnabled = !rotationEnabled;
    sync();
  });

  must(root.querySelector<HTMLButtonElement>('#btn-start'), '#btn-start').addEventListener('click', () => {
    handlers.onStart({ rows, cols, shape, mode, rotationEnabled });
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
    for (const btn of shapeBtns) btn.classList.toggle('active', btn.dataset.shape === shape);
    for (const btn of modeBtns) btn.classList.toggle('active', btn.dataset.mode === mode);
    // 旋转模式仅 ≥25 块开放（F-303 验收）
    const rotAllowed = rows * cols >= 25;
    rotWrap.classList.toggle('hidden', !rotAllowed);
    if (!rotAllowed) rotationEnabled = false;
    rotToggle.classList.toggle('active', rotationEnabled);
    rotToggle.textContent = rotationEnabled ? '🔄 旋转模式：开' : '🔄 旋转模式：关';
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
