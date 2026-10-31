import { must } from '../../utils/dom';

let timer: number | undefined;

/** 轻提示（自动消失） */
export function showToast(message: string): void {
  const el = must(document.querySelector<HTMLElement>('#toast'), '#toast');
  el.textContent = message;
  el.classList.add('show');
  window.clearTimeout(timer);
  timer = window.setTimeout(() => el.classList.remove('show'), 2400);
}
