import type { AppState, Article } from '../types.js';
import { articleCard } from '../components/articleCard.js';
import { icon } from '../components/icon.js';
import { element } from '../lib/dom.js';

interface SavedViewOptions {
  articles: Article[];
  state: AppState;
  onOpen: (article: Article) => void;
  onSave: (article: Article) => void;
  onBrowse: () => void;
}

export function savedView(options: SavedViewOptions): HTMLElement {
  const saved = options.articles.filter((article) => options.state.savedIds.has(article.id));
  const view = element('div', { className: 'view saved-view' }, [
    element('section', { className: 'view-heading' }, [
      element('div', {}, [element('p', { className: 'kicker', text: 'SAVED' }), element('h1', { text: '收藏' })]),
      element('div', { className: 'count-chip', text: String(saved.length), attrs: { 'aria-label': `${saved.length} 篇收藏` } }),
    ]),
  ]);

  if (saved.length === 0) {
    const browse = element('button', { className: 'button button--primary', text: '瀏覽最新新聞', attrs: { type: 'button' } });
    browse.addEventListener('click', options.onBrowse);
    view.append(element('section', { className: 'status-panel' }, [
      element('div', { className: 'status-panel__icon' }, [icon('bookmark')]),
      element('h2', { text: '尚未收藏文章' }),
      element('p', { text: 'Phase 1 的收藏只存在目前分頁記憶體，重新整理後會回復示範狀態。' }),
      browse,
    ]));
    return view;
  }

  const list = element('section', { className: 'article-list', attrs: { 'aria-label': '收藏文章' } });
  for (const article of saved) {
    list.append(articleCard(article, {
      compact: options.state.density === 'compact',
      saved: true,
      read: options.state.readIds.has(article.id),
      onOpen: () => options.onOpen(article),
      onSave: () => options.onSave(article),
    }));
  }
  view.append(list);
  return view;
}
