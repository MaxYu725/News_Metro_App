import type { AppState, Article } from '../types.js';
import { categories } from '../data/mockArticles.js';
import { element } from '../lib/dom.js';
import { formatDateTime, formatRelativeTime } from '../lib/format.js';
import { icon } from '../components/icon.js';

interface ArticleViewOptions {
  article: Article;
  state: AppState;
  onBack: () => void;
  onSave: () => void;
  onShare: () => void;
}

export function articleView(options: ArticleViewOptions): HTMLElement {
  const { article, state } = options;
  const saved = state.savedIds.has(article.id);
  const categoryLabel = categories.find((category) => category.id === article.category)?.label ?? '';

  const back = element('button', { className: 'text-button', attrs: { type: 'button', 'aria-label': '返回新聞列表' } }, [
    icon('back', 'icon icon--small'),
    element('span', { text: '返回' }),
  ]);
  back.addEventListener('click', options.onBack);

  const save = element('button', {
    className: `button button--secondary${saved ? ' is-active' : ''}`,
    attrs: { type: 'button', 'aria-pressed': String(saved) },
  }, [icon(saved ? 'bookmark-filled' : 'bookmark', 'icon icon--small'), element('span', { text: saved ? '已收藏' : '收藏' })]);
  save.addEventListener('click', options.onSave);

  const share = element('button', { className: 'button button--secondary', attrs: { type: 'button' } }, [
    icon('share', 'icon icon--small'),
    element('span', { text: '分享' }),
  ]);
  share.addEventListener('click', options.onShare);

  const view = element('article', { className: 'view article-view' });
  view.append(element('div', { className: 'article-toolbar' }, [back, element('div', { className: 'article-toolbar__actions' }, [save, share])]));

  const header = element('header', { className: 'article-header' }, [
    element('div', { className: 'article-header__eyebrow' }, [
      element('span', { className: 'badge', text: categoryLabel }),
      element('span', { className: 'source-label', text: article.source }),
    ]),
    element('h1', { text: article.title }),
    element('p', { className: 'article-header__excerpt', text: article.excerpt }),
    element('div', { className: 'article-byline' }, [
      element('time', { text: formatDateTime(article.publishedAt), attrs: { datetime: article.publishedAt } }),
      element('span', { text: formatRelativeTime(article.publishedAt) }),
      element('span', { text: '假資料' }),
    ]),
  ]);
  view.append(header);

  if (article.image) {
    view.append(element('figure', { className: 'article-figure' }, [
      element('img', { attrs: { src: article.image, alt: article.imageAlt ?? '' } }),
      element('figcaption', { text: 'Phase 1 本地抽象示意圖；不是圖片搜尋結果。' }),
    ]));
  }

  const body = element('div', { className: 'article-body' });
  for (const paragraph of article.body) body.append(element('p', { text: paragraph }));
  const sourceLink = element('a', {
    className: 'source-link',
    attrs: { href: article.sourceUrl, target: '_blank', rel: 'noopener noreferrer' },
  }, [element('span', { text: '開啟示範來源' }), icon('external', 'icon icon--small')]);
  body.append(sourceLink);
  view.append(body);
  return view;
}
