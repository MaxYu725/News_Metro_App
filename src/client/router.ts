import type { CategoryId, Route } from './types.js';

const validCategories = new Set<CategoryId>(['latest', 'local', 'world', 'finance', 'tech', 'entertainment', 'sports']);

export function parseRoute(): Route {
  const path = window.location.hash.replace(/^#\/?/, '');
  const [section, value] = path.split('/');

  if (section === 'article' && value) return { name: 'article', articleId: decodeURIComponent(value) };
  if (section === 'search') return { name: 'search' };
  if (section === 'saved') return { name: 'saved' };
  if (section === 'settings') return { name: 'settings' };
  if (section === 'feed' && value && validCategories.has(value as CategoryId)) {
    return { name: 'feed', category: value as CategoryId };
  }
  return { name: 'feed', category: 'latest' };
}

export function navigate(path: string): void {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else window.location.hash = target;
}
