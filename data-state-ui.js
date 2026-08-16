import { DATA_STATE_EVENT } from './api.js';

let banner = null;
let bannerContext = '';
let lastState = null;

const CSS = `
.data-state-banner {
    margin: 8px 16px 2px;
    padding: 9px 11px;
    border: 1px solid rgba(251, 191, 36, 0.22);
    background: rgba(41, 31, 16, 0.74);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: rgba(255, 255, 255, 0.76);
    font-size: 0.7rem;
    line-height: 1.45;
}

.data-state-banner[hidden] {
    display: none !important;
}

.data-state-banner-copy {
    min-width: 0;
    flex: 1 1 auto;
}

.data-state-banner-copy strong {
    color: rgba(253, 230, 138, 0.92);
    font-weight: 600;
}

.data-state-retry {
    min-height: 34px;
    flex: 0 0 auto;
    padding: 0 10px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.045);
    color: rgba(255, 255, 255, 0.88);
    font-size: 0.68rem;
}

.data-state-retry:focus-visible {
    outline: 2px solid rgba(56, 189, 248, 0.78);
    outline-offset: 2px;
}

.data-error-panel {
    margin: 18px 16px 0;
    padding: 22px 18px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(16, 20, 35, 0.78);
    text-align: left;
}

.data-error-panel h3 {
    margin: 0;
    color: rgba(255, 255, 255, 0.9);
    font-size: 1rem;
    font-weight: 500;
}

.data-error-panel p {
    margin: 8px 0 0;
    color: rgba(255, 255, 255, 0.44);
    font-size: 0.76rem;
    line-height: 1.6;
}

.data-error-panel .data-state-retry {
    margin-top: 14px;
}

@media (prefers-reduced-motion: reduce) {
    .data-state-banner,
    .data-state-retry {
        transition: none;
    }
}
`;

function installStyles() {
    if (document.getElementById('data-state-styles')) return;
    const style = document.createElement('style');
    style.id = 'data-state-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
}

function activeContext() {
    const gallery = document.getElementById('gallery-view');
    if (gallery && !gallery.classList.contains('hidden')) return 'gallery';

    const search = document.getElementById('search-view');
    if (search && !search.classList.contains('hidden')) return 'search';

    const activeSection = document.querySelector('.bottom-nav-btn.active')?.dataset.section;
    return activeSection === 'news' ? 'news' : '';
}

function ensureBanner() {
    if (banner?.isConnected) return banner;
    const main = document.getElementById('main-container');
    const grid = document.getElementById('news-grid');
    if (!main || !grid) return null;

    banner = document.createElement('div');
    banner.className = 'data-state-banner';
    banner.hidden = true;
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = `
        <div class="data-state-banner-copy"></div>
        <button type="button" class="data-state-retry">再試一次</button>
    `;
    main.insertBefore(banner, grid);

    banner.querySelector('.data-state-retry')?.addEventListener('click', retryCurrentState);
    return banner;
}

function hideBanner() {
    const node = ensureBanner();
    if (!node) return;
    node.hidden = true;
    bannerContext = '';
}

function formatCacheAge(timestamp) {
    const savedAt = Number(timestamp || 0);
    if (!savedAt) return '上次成功';
    const minutes = Math.max(0, Math.floor((Date.now() - savedAt) / 60000));
    if (minutes < 1) return '剛才';
    if (minutes < 60) return `${minutes} 分鐘前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小時前`;
    return `${Math.floor(hours / 24)} 天前`;
}

function friendlyError(raw) {
    if (!navigator.onLine) return '目前離線，重新連線後再試。';
    const message = String(raw || '').trim();
    if (!message || /failed to fetch|networkerror|load failed/i.test(message)) {
        return '暫時無法連接新聞服務，請稍後再試。';
    }
    return message;
}

function contextTitle(context) {
    if (context === 'search') return '搜尋暫時無法使用';
    if (context === 'gallery') return '圖庫暫時無法載入';
    return '暫時無法更新新聞';
}

function showBanner(detail) {
    const node = ensureBanner();
    if (!node) return;

    const copy = node.querySelector('.data-state-banner-copy');
    if (!copy) return;

    if (detail.status === 'stale') {
        const age = formatCacheAge(detail.cachedAt);
        copy.innerHTML = `<strong>${navigator.onLine ? '暫時無法更新' : '目前離線'}</strong> · 顯示${age}的資料`;
    } else {
        copy.innerHTML = `<strong>${detail.append ? '載入更多失敗' : contextTitle(detail.context)}</strong>`;
    }

    node.hidden = false;
    bannerContext = detail.context;
}

function renderErrorPanel(detail) {
    const grid = document.getElementById('news-grid');
    if (!grid) return;

    grid.className = 'grid grid-cols-1 auto-rows-auto';
    grid.innerHTML = `
        <div class="data-error-panel" role="alert">
            <h3>${contextTitle(detail.context)}</h3>
            <p>${friendlyError(detail.error)}</p>
            <button type="button" class="data-state-retry" data-data-state-retry>再試一次</button>
        </div>
    `;
    grid.querySelector('[data-data-state-retry]')?.addEventListener('click', retryCurrentState);

    if (detail.context === 'search') {
        const hint = document.getElementById('search-hint');
        if (hint) hint.textContent = '搜尋失敗，請稍後再試。';
    }
    if (detail.context === 'gallery') {
        const hint = document.getElementById('gallery-hint');
        if (hint) hint.textContent = '圖庫載入失敗，請稍後再試。';
    }
}

function retryCurrentState() {
    const context = lastState?.context || activeContext();
    hideBanner();

    if (context === 'search') {
        document.getElementById('news-search-form')?.requestSubmit();
        return;
    }

    if (context === 'gallery') {
        document.getElementById('gallery-search-form')?.requestSubmit();
        return;
    }

    if (context === 'news') {
        window.location.reload();
    }
}

function onDataState(event) {
    const detail = event.detail || {};
    if (!['news', 'search', 'gallery'].includes(detail.context)) return;
    if (activeContext() !== detail.context) return;

    lastState = detail;

    if (detail.status === 'ok') {
        if (bannerContext === detail.context) hideBanner();
        return;
    }

    if (detail.status === 'stale') {
        showBanner(detail);
        return;
    }

    if (detail.status === 'error') {
        if (detail.append) showBanner(detail);
        else {
            hideBanner();
            renderErrorPanel(detail);
        }
    }
}

function installNavigationReset() {
    document.getElementById('bottom-nav')?.addEventListener('click', hideBanner, true);
    document.getElementById('btn-open-gallery')?.addEventListener('click', hideBanner, true);
    document.getElementById('gallery-back')?.addEventListener('click', hideBanner, true);
}

function initDataStateUI() {
    installStyles();
    ensureBanner();
    installNavigationReset();
    window.addEventListener(DATA_STATE_EVENT, onDataState);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDataStateUI, { once: true });
} else {
    initDataStateUI();
}
