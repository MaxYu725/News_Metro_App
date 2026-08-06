import type { AppState, Article } from '../types.js';
import { element } from '../lib/dom.js';
import { articleCard } from '../components/articleCard.js';
import { icon } from '../components/icon.js';
import { statusPanel } from '../components/statusPanel.js';

interface SearchViewOptions {
  articles: Article[];
  state: AppState;
  onQuery: (query: string) => void;
  onOpen: (article: Article) => void;
  onSave: (article: Article) => void;
}

export function searchView(options: SearchViewOptions): HTMLElement {
  const query = options.state.searchQuery.trim();
  const normalized = query.toLocaleLowerCase('zh-HK');
  const results = normalized
    ? options.articles.filter((article) => [article.title, article.excerpt, article.source, ...article.tags]
      .some((value) => value.toLocaleLowerCase('zh-HK').includes(normalized)))
    : [];

  const input = element('input', {
    className: 'search-input',
    attrs: {
      type: 'search',
      value: options.state.searchQuery,
      placeholder: '搜尋示範標題、摘要、來源或標籤',
      autocomplete: 'off',
      enterkeyhint: 'search',
      'aria-label': '搜尋新聞',
    },
  });
  input.addEventListener('input', () => options.onQuery(input.value));

  const form = element('div', { className: 'search-box' }, [icon('search'), input]);
  const view = element('div', { className: 'view search-view' }, [
    element('section', { className: 'view-heading' }, [
      element('div', {}, [element('p', { className: 'kicker', text: 'SEARCH' }), element('h1', { text: '搜尋' })]),
    ]),
    form,
  ]);

  const suggestions = element('div', { className: 'suggestion-row', attrs: { 'aria-label': '搜尋建議' } });
  for (const suggestion of ['交通', '安全', '市場', '示範']) {
    const button = element('button', { className: 'suggestion-chip', text: suggestion, attrs: { type: 'button' } });
    button.addEventListener('click', () => options.onQuery(suggestion));
    suggestions.append(button);
  }
  view.append(suggestions);

  if (!query) {
    view.append(element('section', { className: 'search-intro' }, [
      element('h2', { text: '搜尋正式版本將使用 D1 FTS5' }),
      element('p', { text: 'Phase 1 只會即時搜尋本地假資料，不會發出任何網絡請求。' }),
    ]));
    return view;
  }

  view.append(element('p', { className: 'result-count', text: `找到 ${results.length} 項示範結果` }));
  if (results.length === 0) {
    view.append(statusPanel('empty', () => options.onQuery('')));
    return view;
  }

  const list = element('section', { className: 'article-list', attrs: { 'aria-label': '搜尋結果' } });
  for (const article of results) {
    list.append(articleCard(article, {
      compact: options.state.density === 'compact',
      saved: options.state.savedIds.has(article.id),
      read: options.state.readIds.has(article.id),
      onOpen: () => options.onOpen(article),
      onSave: () => options.onSave(article),
    }));
  }
  view.append(list);
  return view;
}
