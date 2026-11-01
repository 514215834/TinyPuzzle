import './app/styles/main.css';
import { registerSW } from 'virtual:pwa-register';

import { unlockAudio } from './app/audio';
import { fitGrid } from './app/config';
import { applyStatic, getLang, setLang } from './app/i18n';
import type { StageImage } from './engine/imageProcessor';
import { loadSettings, saveSettings } from './storage/settings';
import { GameView } from './app/views/gameView';
import { initHomeView } from './app/views/homeView';
import { initSetupView } from './app/views/setupView';
import type { GameSession, ImageMeta } from './app/session';
import type { SavedProgress } from './storage/progress';

registerSW({ immediate: true });
applyStatic();

// 首次用户手势时解锁音频（浏览器自动播放策略）
document.addEventListener('pointerdown', () => unlockAudio(), { once: true, capture: true });

// 语言切换（F-403）：按钮始终显示目标语言
document.getElementById('btn-lang')?.addEventListener('click', () => {
  setLang(getLang() === 'zh' ? 'en' : 'zh');
  const btnLang = document.getElementById('btn-lang');
  if (btnLang) btnLang.textContent = getLang() === 'zh' ? 'EN' : '中文';
  home.refreshI18n();
  setup.refreshI18n();
});

const homeEl = document.querySelector<HTMLElement>('#view-home')!;
const setupEl = document.querySelector<HTMLElement>('#view-setup')!;
const gameEl = document.querySelector<HTMLElement>('#view-game')!;

let session: GameSession | null = null;
const gameView = new GameView(gameEl);

/** 换局时回收上一局的舞台图 Blob URL（F-513） */
function releaseStageUrl(): void {
  if (session?.stage.url.startsWith('blob:')) URL.revokeObjectURL(session.stage.url);
}

const home = initHomeView({
  onNewStage: (stage: StageImage, meta: ImageMeta) => {
    releaseStageUrl();
    const s = loadSettings();
    const { rows, cols } = fitGrid(stage.ratio, s.pieceTarget);
    session = {
      stage,
      meta,
      rows,
      cols,
      // 玩法固定：经典凹凸 + 自由摆放 + 可旋转（不再作为设置项）
      opts: { mode: 'free', shape: 'classic', rotationEnabled: true },
    };
    location.hash = '#/setup';
  },
  onResume: (stage: StageImage, meta: ImageMeta, saved: SavedProgress) => {
    releaseStageUrl();
    session = {
      stage,
      meta,
      rows: saved.rows,
      cols: saved.cols,
      opts: { mode: saved.mode, shape: saved.shape, rotationEnabled: saved.rotationEnabled },
      saved,
    };
    location.hash = '#/play';
  },
});

const setup = initSetupView({
  onStart: (config) => {
    if (!session) return;
    session.rows = config.rows;
    session.cols = config.cols;
    session.opts = { mode: 'free', shape: 'classic', rotationEnabled: true };
    saveSettings({ pieceTarget: config.pieceTarget }); // 记忆块数（F-101）
    location.hash = '#/play';
  },
  onBack: () => {
    location.hash = '#/';
  },
});

/** hash 路由：#/ 首页，#/setup 难度设置，#/play 游戏 */
function route(): void {
  const hash = location.hash;
  const wantSetup = hash === '#/setup' && session !== null;
  const wantPlay = hash === '#/play' && session !== null;

  if (wantPlay) {
    homeEl.classList.add('hidden');
    setupEl.classList.add('hidden');
    gameEl.classList.remove('hidden'); // 先显示再挂载，fitBoard 才能测到真实尺寸
    void gameView.mount(session!);
    return;
  }

  gameView.unmount();
  if (wantSetup) {
    setupEl.classList.remove('hidden');
    setup.show(session!.stage);
    homeEl.classList.add('hidden');
    gameEl.classList.add('hidden');
    return;
  }

  setup.hide();
  gameEl.classList.add('hidden');
  if (hash === '#/setup' || hash === '#/play') {
    location.hash = '#/'; // 无对局参数（如直接输入 URL）→ 回首页
    return;
  }
  home.show();
  homeEl.classList.remove('hidden');
}

window.addEventListener('hashchange', route);
route();
