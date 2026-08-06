import type { AppState, Article, CategoryId } from '../types.js';
import { categories } from '../data/mockArticles.js';
import { element } from '../lib/dom.js';
import { articleCard } from '../components/articleCard.js';
import { offlineBanner, skeletonList, statusPanel } from '../components/statusPanel.js';

interface FeedViewOptions {
  articles: Article[];
  state: AppState;
  onCategory: (category: CategoryId) => void;
  onOpen: (article: Article) => void;
  onSave: (article: Article) => void;
  onRetry: () => void;
}

export function feedView(options: FeedViewOptions): HTMLElement {
  const { state } = options;
  const view = element('div', { className: 'view feed-view' });
  const header = element('section', { className: 'view-heading' }, [
    element('div', {}, [
      element('p', { className: 'kicker', text: 'METRO NEWS · PHASE 1' }),
      element('h1', { text: categories.find((category) => category.id === state.activeCategory)?.label ?? '最新' }),
    ]),
    element('div', { className: 'demo-chip', text: '本地假資料' }),
  ]);
  view.append(header);

  const tabs = element('nav', { className: 'category-tabs', attrs: { 'aria-label': '新聞分類' } });
  for (const category of categories) {
    const button = element('button', {
      className: `category-tab${category.id === state.activeCategory ? ' is-active' : ''}`,
      text: category.label,
      attrs: { type: 'button', 'aria-current': category.id === state.activeCategory ? 'page' : 'false' },
    });
    button.addEventListener('click', () => options.onCategory(category.id));
    tabs.append(button);
  }
  view.append(tabs);

  if (state.dataMode === 'loading') {
    view.append(skeletonList());
    return view;
  }
  if (state.dataMode === 'empty' || state.dataMode === 'error') {
    view.append(statusPanel(state.dataMode, options.onRetry));
    return view;
  }
  if (state.dataMode === 'offline' || !state.online) view.append(offlineBanner());

  const filtered = state.activeCategory === 'latest'
    ? options.articles
    : options.articles.filter((article) => article.category === state.activeCategory);

  if (filtered.length === 0) {
    view.append(statusPanel('empty', options.onRetry));
    return view;
  }

  const list = element('section', { className: 'article-list', attrs: { 'aria-label': '新聞列表' } });
  filtered.forEach((article, index) => {
    list.append(articleCard(article, {
      featured: index === 0,
      compact: state.density === 'compact',
      saved: state.savedIds.has(article.id),
      read: state.readIds.has(article.id),
      onOpen: () => options.onOpen(article),
      onSave: () => options.onSave(article),
    }));
  });
  view.append(list, element('p', { className: 'end-note', text: '已顯示全部 Phase 1 示範內容' }));
  return view;
}
