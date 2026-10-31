import './app/styles/main.css';
import { registerSW } from 'virtual:pwa-register';

import { unlockAudio } from './app/audio';
import type { StageImage } from './engine/imageProcessor';
import { loadSettings, saveSettings } from './storage/settings';
import { GameView } from './app/views/gameView';
import { initHomeView } from './app/views/homeView';
import { initSetupView } from './app/views/setupView';
import type { GameSession, ImageMeta } from './app/session';
import type { SavedProgress } from './storage/progress';

registerSW({ immediate: true });

// 首次用户手势时解锁音频（浏览器自动播放策略）
document.addEventListener('pointerdown', () => unlockAudio(), { once: true, capture: true });

const homeEl = document.querySelector<HTMLElement>('#view-home')!;
const setupEl = document.querySelector<HTMLElement>('#view-setup')!;
const gameEl = document.querySelector<HTMLElement>('#view-game')!;

let session: GameSession | null = null;
const gameView = new GameView(gameEl);

const home = initHomeView({
  onNewStage: (stage: StageImage, meta: ImageMeta) => {
    const settings = loadSettings();
    session = { stage, meta, rows: settings.rows, cols: settings.cols };
    location.hash = '#/setup';
  },
  onResume: (stage: StageImage, meta: ImageMeta, saved: SavedProgress) => {
    session = { stage, meta, rows: saved.rows, cols: saved.cols, saved };
    location.hash = '#/play';
  },
});

const setup = initSetupView({
  onStart: (rows: number, cols: number) => {
    if (!session) return;
    session.rows = rows;
    session.cols = cols;
    saveSettings({ rows, cols }); // 记忆难度（F-101）
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
    gameView.mount(session!);
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
