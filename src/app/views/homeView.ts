import { blobToStage, isSupportedImage, urlToStage } from '../../engine/imageProcessor';
import type { StageImage } from '../../engine/imageProcessor';
import { formatMs } from '../../engine/stats';
import { clearProgress, loadProgress, type SavedProgress } from '../../storage/progress';
import { deleteImage, getImage, putImage } from '../../storage/imageStore';
import { must } from '../../utils/dom';
import { SAMPLES as SAMPLE_LIST } from '../samples';
import type { ImageMeta } from '../session';
import { sampleAria, sampleName, t } from '../i18n';
import { showToast } from '../components/toast';

export interface HomeHandlers {
  /** 选定新图片 → 进入难度设置页 */
  onNewStage: (stage: StageImage, meta: ImageMeta) => void;
  /** 继续上局 → 直接进入游戏页（F-205） */
  onResume: (stage: StageImage, meta: ImageMeta, saved: SavedProgress) => void;
}

interface PendingResume {
  saved: SavedProgress;
  load: () => Promise<StageImage>;
}

/** 首页（F-001 / F-002 / F-205）：上传图片、选择示例图、继续上局 */
export function initHomeView(handlers: HomeHandlers): { show: () => void; hide: () => void; refreshI18n: () => void } {
  const root = must(document.querySelector<HTMLElement>('#view-home'), '#view-home');
  const input = must(document.querySelector<HTMLInputElement>('#file-input'), '#file-input');
  const label = must(document.querySelector<HTMLLabelElement>('#upload-label'), '#upload-label');
  const dropZone = must(document.querySelector<HTMLElement>('#drop-zone'), '#drop-zone');
  const grid = must(document.querySelector<HTMLElement>('#sample-grid'), '#sample-grid');
  const resumeCard = must(document.querySelector<HTMLElement>('#resume-card'), '#resume-card');
  const resumeThumb = must(document.querySelector<HTMLImageElement>('#resume-thumb'), '#resume-thumb');
  const resumeMeta = must(document.querySelector<HTMLElement>('#resume-meta'), '#resume-meta');
  const btnResume = must(document.querySelector<HTMLButtonElement>('#btn-resume'), '#btn-resume');
  const btnDiscard = must(document.querySelector<HTMLButtonElement>('#btn-discard'), '#btn-discard');

  let busy = false;
  let pending: PendingResume | null = null;
  let resumeUrl: string | null = null; // objectURL，替换时回收

  // ---------- 示例图 ----------
  function buildSamples(): void {
    grid.innerHTML = '';
    for (const sample of SAMPLE_LIST) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sample';
      btn.style.backgroundImage = `url("${sample.url}")`;
      btn.title = sampleName(sample.id);
      btn.setAttribute('aria-label', sampleAria(sampleName(sample.id)));
      btn.addEventListener('click', () => void run(() => urlToStage(sample.url), { imageRef: sample.url, imageKind: 'sample' }));
      grid.appendChild(btn);
    }
  }
  buildSamples();

  // ---------- 上传 ----------
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = ''; // 允许重复选择同一文件
    if (file) handleFile(file);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  function handleFile(file: File): void {
    if (!isSupportedImage(file)) {
      showToast(t('unsupportedFile'));
      return;
    }
    void run(() => blobToStage(file), null, file);
  }

  async function run(loader: () => Promise<StageImage>, meta: ImageMeta | null, file?: File): Promise<void> {
    if (busy) return;
    busy = true;
    label.classList.add('loading');
    label.textContent = t('processing');
    try {
      const stage = await loader();
      if (meta) {
        handlers.onNewStage(stage, meta);
      } else if (file) {
        // 上传图：先入 IndexedDB 供进度恢复，失败也不阻塞本局
        let resolved: ImageMeta;
        try {
          const id = await putImage(file);
          resolved = { imageRef: id, imageKind: 'upload' };
        } catch {
          resolved = { imageRef: `mem_${Date.now()}`, imageKind: 'upload' };
        }
        handlers.onNewStage(stage, resolved);
      }
    } catch {
      showToast(t('imageFailed'));
    } finally {
      busy = false;
      label.classList.remove('loading');
      label.textContent = t('chooseImage');
    }
  }

  // ---------- 继续上局（F-205） ----------
  btnResume.addEventListener('click', () => {
    if (!pending || busy) return;
    busy = true;
    btnResume.disabled = true;
    void (async () => {
      try {
        const stage = await pending.load();
        handlers.onResume(stage, { imageRef: pending.saved.imageRef, imageKind: pending.saved.imageKind }, pending.saved);
      } catch {
        showToast(t('resumeGone'));
        discard();
      } finally {
        busy = false;
        btnResume.disabled = false;
      }
    })();
  });

  btnDiscard.addEventListener('click', discard);

  function discard(): void {
    const ref = pending?.saved.imageRef;
    if (pending?.saved.imageKind === 'upload' && ref) void deleteImage(ref);
    pending = null;
    clearProgress();
    releaseResumeUrl();
    resumeCard.classList.add('hidden');
  }

  function releaseResumeUrl(): void {
    if (resumeUrl) {
      URL.revokeObjectURL(resumeUrl);
      resumeUrl = null;
    }
  }

  async function refreshResume(): Promise<void> {
    resumeCard.classList.add('hidden');
    pending = null;
    releaseResumeUrl();
    const saved = loadProgress();
    if (!saved) return;
    try {
      let thumbUrl: string;
      let load: () => Promise<StageImage>;
      if (saved.imageKind === 'sample') {
        thumbUrl = saved.imageRef;
        load = () => urlToStage(saved.imageRef);
      } else {
        const blob = await getImage(saved.imageRef);
        if (!blob) throw new Error('图片缓存已清除');
        thumbUrl = URL.createObjectURL(blob);
        resumeUrl = thumbUrl;
        load = () => blobToStage(blob);
      }
      resumeThumb.src = thumbUrl;
      resumeMeta.textContent = `${saved.rows}×${saved.cols} · ${saved.moves} ${t('movesUnit')} · ${formatMs(saved.elapsedMs)}`;
      pending = { saved, load };
      resumeCard.classList.remove('hidden');
    } catch {
      // 图片缓存被清除 → 快照作废（F-205 边界条件）
      clearProgress();
    }
  }

  function show(): void {
    root.classList.remove('hidden');
    void refreshResume();
  }

  function hide(): void {
    root.classList.add('hidden');
  }

  function refreshI18n(): void {
    buildSamples();
    if (pending) {
      resumeMeta.textContent = `${pending.saved.rows}×${pending.saved.cols} · ${pending.saved.moves} ${t('movesUnit')} · ${formatMs(pending.saved.elapsedMs)}`;
    }
  }

  return { show, hide, refreshI18n };
}
