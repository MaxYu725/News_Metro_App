import type { DataMode } from '../types.js';
import { element } from '../lib/dom.js';
import { icon } from './icon.js';

export function skeletonList(): HTMLElement {
  const wrapper = element('div', { className: 'skeleton-list', attrs: { 'aria-label': '正在載入示範內容' } });
  for (let index = 0; index < 5; index += 1) {
    wrapper.append(element('div', { className: 'skeleton-card' }, [
      element('div', { className: 'skeleton-line skeleton-line--short' }),
      element('div', { className: 'skeleton-line skeleton-line--title' }),
      element('div', { className: 'skeleton-line' }),
      element('div', { className: 'skeleton-line skeleton-line--medium' }),
    ]));
  }
  return wrapper;
}

export function statusPanel(mode: Exclude<DataMode, 'ready' | 'loading' | 'offline'>, onRetry: () => void): HTMLElement {
  const copy = mode === 'empty'
    ? { icon: 'search', title: '暫時沒有內容', body: '此狀態用於測試分類或搜尋結果為空時的畫面。', action: '返回最新' }
    : { icon: 'alert', title: '無法載入新聞', body: '這是 Phase 1 的錯誤狀態預覽。正式版本會保留錯誤原因及重試資訊。', action: '重新載入示範' };

  const button = element('button', { className: 'button button--primary', text: copy.action, attrs: { type: 'button' } });
  button.addEventListener('click', onRetry);
  return element('section', { className: 'status-panel', attrs: { 'aria-live': 'polite' } }, [
    element('div', { className: 'status-panel__icon' }, [icon(copy.icon)]),
    element('h2', { text: copy.title }),
    element('p', { text: copy.body }),
    button,
  ]);
}

export function offlineBanner(): HTMLElement {
  return element('div', { className: 'offline-banner', attrs: { role: 'status' } }, [
    icon('wifi-off', 'icon icon--small'),
    element('div', {}, [
      element('strong', { text: '離線狀態預覽' }),
      element('span', { text: '目前顯示上次快取的示範內容。' }),
    ]),
  ]);
}
