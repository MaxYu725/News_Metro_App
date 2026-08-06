import { mockArticles } from './data/mockArticles.js';
import { clear, element } from './lib/dom.js';
import { navigate, parseRoute } from './router.js';
import { store } from './state/store.js';
import type { Article, CategoryId, Route } from './types.js';
import { icon } from './components/icon.js';
import { articleView } from './views/articleView.js';
import { feedView } from './views/feedView.js';
import { savedView } from './views/savedView.js';
import { searchView } from './views/searchView.js';
import { settingsView } from './views/settingsView.js';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('找不到 #app 根節點');
const root: HTMLDivElement = appRoot;

let route: Route = parseRoute();
let previousFeedHash = '#/feed/latest';

function showToast(message: string): void {
  const region = document.querySelector<HTMLDivElement>('#toast-region');
  if (!region) return;
  const toast = element('div', { className: 'toast', text: message, attrs: { role: 'status' } });
  region.append(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

function openArticle(article: Article): void {
  store.markRead(article.id);
  if (route.name === 'feed') previousFeedHash = window.location.hash || '#/feed/latest';
  navigate(`/article/${encodeURIComponent(article.id)}`);
}

function toggleSave(article: Article): void {
  const wasSaved = store.getState().savedIds.has(article.id);
  store.toggleSaved(article.id);
  showToast(wasSaved ? '已取消收藏' : '已加入收藏');
}

function setCategory(category: CategoryId): void {
  store.setCategory(category);
  navigate(`/feed/${category}`);
}

function renderBrand(): HTMLElement {
  const logo = element('img', { className: 'brand__logo', attrs: { src: '/icons/icon-192.png', alt: '' } });
  return element('a', { className: 'brand', attrs: { href: '#/feed/latest', 'aria-label': 'Metro News 首頁' } }, [
    logo,
    element('div', {}, [element('strong', { text: 'Metro News' }), element('span', { text: 'Phase 1' })]),
  ]);
}

function navItem(path: string, label: string, iconName: string, active: boolean): HTMLAnchorElement {
  return element('a', {
    className: `app-nav__item${active ? ' is-active' : ''}`,
    attrs: { href: `#${path}`, 'aria-current': active ? 'page' : 'false' },
  }, [icon(iconName), element('span', { text: label })]);
}

function renderShell(content: HTMLElement): void {
  const state = store.getState();
  document.documentElement.style.setProperty('--font-scale', String(state.fontScale));
  document.documentElement.dataset.motion = state.reducedMotion ? 'reduced' : 'full';
  document.documentElement.dataset.density = state.density;

  const isFeed = route.name === 'feed';
  const header = element('header', { className: 'app-header' }, [
    element('div', { className: 'app-header__inner' }, [
      renderBrand(),
      element('div', { className: `connection-status${state.online ? '' : ' is-offline'}`, attrs: { role: 'status' } }, [
        element('span', { className: 'connection-status__dot' }),
        element('span', { text: state.online ? '假資料模式' : '瀏覽器離線' }),
      ]),
    ]),
  ]);

  const nav = element('nav', { className: 'app-nav', attrs: { 'aria-label': '主要導覽' } }, [
    navItem('/feed/latest', '最新', 'home', isFeed),
    navItem('/search', '搜尋', 'search', route.name === 'search'),
    navItem('/saved', '收藏', 'bookmark', route.name === 'saved'),
    navItem('/settings', '設定', 'settings', route.name === 'settings'),
  ]);

  const main = element('main', { className: 'app-main', attrs: { id: 'main-content', tabindex: '-1' } }, [content]);
  clear(root);
  root.append(element('div', { className: 'app-shell' }, [header, main, nav]));
}

async function shareArticle(article: Article): Promise<void> {
  const shareData = { title: article.title, text: article.excerpt, url: window.location.href };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast('已複製文章連結');
  } catch {
    showToast('未能複製連結');
  }
}

function render(): void {
  const currentRoute = parseRoute();
  route = currentRoute;
  const state = store.getState();
  let content: HTMLElement;

  if (currentRoute.name === 'feed') {
    if (state.activeCategory !== currentRoute.category) store.setCategory(currentRoute.category);
    content = feedView({
      articles: mockArticles,
      state: store.getState(),
      onCategory: setCategory,
      onOpen: openArticle,
      onSave: toggleSave,
      onRetry: () => store.setDataMode('ready'),
    });
  } else if (currentRoute.name === 'search') {
    content = searchView({
      articles: mockArticles,
      state,
      onQuery: (query) => store.setSearchQuery(query),
      onOpen: openArticle,
      onSave: toggleSave,
    });
  } else if (currentRoute.name === 'saved') {
    content = savedView({
      articles: mockArticles,
      state,
      onOpen: openArticle,
      onSave: toggleSave,
      onBrowse: () => navigate('/feed/latest'),
    });
  } else if (currentRoute.name === 'settings') {
    content = settingsView({
      state,
      onFontScale: (value) => store.setFontScale(value),
      onReducedMotion: (value) => store.setReducedMotion(value),
      onDensity: (value) => store.setDensity(value),
      onDataMode: (value) => store.setDataMode(value),
    });
  } else {
    const article = mockArticles.find((item) => item.id === currentRoute.articleId);
    if (!article) {
      navigate('/feed/latest');
      return;
    }
    content = articleView({
      article,
      state,
      onBack: () => {
        if (window.history.length > 1) window.history.back();
        else window.location.hash = previousFeedHash;
      },
      onSave: () => toggleSave(article),
      onShare: () => void shareArticle(article),
    });
  }
  renderShell(content);
}

window.addEventListener('hashchange', render);
window.addEventListener('online', () => store.setOnline(true));
window.addEventListener('offline', () => store.setOnline(false));
store.subscribe(render);
render();
