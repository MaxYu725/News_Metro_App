import type { Article } from '../types.js';
import { element } from '../lib/dom.js';
import { formatRelativeTime } from '../lib/format.js';
import { icon } from './icon.js';

interface ArticleCardOptions {
  featured?: boolean;
  saved: boolean;
  read: boolean;
  compact?: boolean;
  onOpen: () => void;
  onSave: () => void;
}

export function articleCard(article: Article, options: ArticleCardOptions): HTMLElement {
  const card = element('article', {
    className: [
      'article-card',
      options.featured ? 'article-card--featured' : '',
      options.compact ? 'article-card--compact' : '',
      options.read ? 'is-read' : '',
    ].filter(Boolean).join(' '),
  });

  const openButton = element('button', {
    className: 'article-card__open',
    attrs: { type: 'button', 'aria-label': `閱讀：${article.title}` },
  });

  if (article.image) {
    const media = element('div', { className: 'article-card__media' });
    const image = element('img', {
      className: 'article-card__image',
      attrs: { src: article.image, alt: article.imageAlt ?? '', loading: options.featured ? 'eager' : 'lazy' },
    });
    media.append(image);
    openButton.append(media);
  }

  const content = element('div', { className: 'article-card__content' });
  const eyebrow = element('div', { className: 'article-card__eyebrow' });
  if (article.breaking) eyebrow.append(element('span', { className: 'badge badge--breaking', text: '焦點示例' }));
  eyebrow.append(element('span', { className: 'source-label', text: article.source }));

  const title = element('h2', { className: 'article-card__title', text: article.title });
  const excerpt = element('p', { className: 'article-card__excerpt', text: article.excerpt });
  const meta = element('div', { className: 'article-card__meta' }, [
    icon('clock', 'icon icon--small'),
    element('time', { text: formatRelativeTime(article.publishedAt), attrs: { datetime: article.publishedAt } }),
  ]);
  content.append(eyebrow, title, excerpt, meta);
  openButton.append(content);
  openButton.addEventListener('click', options.onOpen);

  const saveButton = element('button', {
    className: `icon-button article-card__save${options.saved ? ' is-active' : ''}`,
    attrs: {
      type: 'button',
      'aria-label': options.saved ? `取消收藏：${article.title}` : `收藏：${article.title}`,
      'aria-pressed': String(options.saved),
    },
  }, [icon(options.saved ? 'bookmark-filled' : 'bookmark')]);
  saveButton.addEventListener('click', options.onSave);

  card.append(openButton, saveButton);
  return card;
}
