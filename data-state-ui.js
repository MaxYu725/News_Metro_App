import { DATA_STATE_EVENT } from './api.js';

const SUCCESS_HIDE_DELAY_MS = 1800;
const RETRY_MARKER_KEY = 'metro_news_retry_context';

let banner = null;
let bannerContext = '';
let lastState = null;
let retryingContext = '';
let successTimer = 0;

const degradedContexts = new Set();

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

.data-state-banner.is-success {
    border-color: rgba(56, 189, 248, 0.24);
    background: rgba(12, 31, 43, 0.72);
}

.data-state-banner-copy {
    min-width: 0;
    flex: 1 1 auto;
}

.data-state-banner-copy strong {
    color: rgba(253, 230, 138, 0.92);
    font-weight: 600;
}

.data-state-banner.is-success .data-state-banner-copy strong {
    color: rgba(125, 211, 252, 0.96);
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

.data-state-retry:disabled {
    opacity: 0.42;
    cursor: default;
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

function clearSuccessTimer() {
    if (!successTimer) return;
    window.clearTimeout(successTimer);
    successTimer = 0;
}

function hideBanner() {
    const node = ensureBanner();
    if (!node) return;
    clearSuccessTimer();
    node.hidden = true;
    node.classList.remove('is-success');
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

function formatClock(timestamp) {
    const date = new Date(Number(timestamp || Date.now()));
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('zh-HK', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function friendlyError(raw) {
    if (!navigator.onLine) return '沒有可用的上次資料，重新連線後再試。';
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

function setRetryControl(button, context) {
    if (!button) return;
    const busy = retryingContext === context;
    if (!navigator.onLine) {
        button.disabled = true;
        button.textContent = '等待連線';
        return;
    }
    if (busy) {
        button.disabled = true;
        button.textContent = '重試中…';
        return;
    }
    button.disabled = false;
    button.textContent = '再試一次';
}

function syncRetryControls() {
    const context = lastState?.context || activeContext();
    document.querySelectorAll('.data-state-retry').forEach(button => setRetryControl(button, context));
}

function showBanner(detail) {
    const node = ensureBanner();
    if (!node) return;

    clearSuccessTimer();
    node.classList.remove('is-success');

    const copy = node.querySelector('.data-state-banner-copy');
    const retry = node.querySelector('.data-state-retry');
    if (!copy || !retry) return;

    retry.hidden = false;

    if (detail.status === 'stale') {
        const age = formatCacheAge(detail.cachedAt);
        const clock = formatClock(detail.cachedAt);
        if (navigator.onLine) {
            copy.innerHTML = `<strong>暫時無法更新</strong> · 顯示${age}的資料${clock ? `（${clock}）` : ''}`;
        } else {
            copy.innerHTML = `<strong>顯示上次資料</strong> · ${age}${clock ? `（${clock}）` : ''}`;
        }
    } else if (retryingContext === detail.context) {
        copy.innerHTML = '<strong>正在重新載入…</strong>';
    } else {
        copy.innerHTML = `<strong>${detail.append ? '載入更多失敗' : contextTitle(detail.context)}</strong>`;
    }

    node.hidden = false;
    bannerContext = detail.context;
    setRetryControl(retry, detail.context);
}

function showSuccess(context, updatedAt) {
    const node = ensureBanner();
    if (!node) return;

    clearSuccessTimer();
    const copy = node.querySelector('.data-state-banner-copy');
    const retry = node.querySelector('.data-state-retry');
    if (!copy || !retry) return;

    node.classList.add('is-success');
    copy.innerHTML = `<strong>已更新</strong> · ${formatClock(updatedAt)}`;
    retry.hidden = true;
    node.hidden = false;
    bannerContext = context;

    successTimer = window.setTimeout(() => {
        if (bannerContext === context) hideBanner();
    }, SUCCESS_HIDE_DELAY_MS);
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
    const retry = grid.querySelector('[data-data-state-retry]');
    retry?.addEventListener('click', retryCurrentState);
    setRetryControl(retry, detail.context);

    if (detail.context === 'search') {
        const hint = document.getElementById('search-hint');
        if (hint) hint.textContent = '搜尋失敗，請稍後再試。';
    }
    if (detail.context === 'gallery') {
        const hint = document.getElementById('gallery-hint');
        if (hint) hint.textContent = '圖庫載入失敗，請稍後再試。';
    }
}

function saveRetryMarker(context) {
    try { sessionStorage.setItem(RETRY_MARKER_KEY, context); } catch (error) {}
}

function readRetryMarker() {
    try { return sessionStorage.getItem(RETRY_MARKER_KEY) || ''; } catch (error) { return ''; }
}

function clearRetryMarker() {
    try { sessionStorage.removeItem(RETRY_MARKER_KEY); } catch (error) {}
}

function retryCurrentState() {
    const context = lastState?.context || activeContext();
    if (!context || !navigator.onLine) {
        syncRetryControls();
        return;
    }

    retryingContext = context;
    saveRetryMarker(context);
    syncRetryControls();

    if (lastState?.status === 'stale') showBanner(lastState);

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

function resetRetryState(context) {
    if (retryingContext === context) retryingContext = '';
    if (readRetryMarker() === context) clearRetryMarker();
}

function onDataState(event) {
    const detail = event.detail || {};
    if (!['news', 'search', 'gallery'].includes(detail.context)) return;
    if (activeContext() !== detail.context) return;

    lastState = detail;

    if (detail.status === 'ok') {
        const recovered = degradedContexts.has(detail.context)
            || retryingContext === detail.context
            || readRetryMarker() === detail.context;

        degradedContexts.delete(detail.context);
        resetRetryState(detail.context);
        if (bannerContext === detail.context) hideBanner();

        if (recovered && !detail.append) {
            showSuccess(detail.context, detail.updatedAt || Date.now());
        }
        return;
    }

    degradedContexts.add(detail.context);
    resetRetryState(detail.context);

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

function refreshConnectivityState() {
    if (!lastState || activeContext() !== lastState.context) {
        syncRetryControls();
        return;
    }

    if (lastState.status === 'stale') {
        showBanner(lastState);
        return;
    }

    if (lastState.status === 'error' && !lastState.append) {
        renderErrorPanel(lastState);
        return;
    }

    syncRetryControls();
}

function installNavigationReset() {
    document.getElementById('bottom-nav')?.addEventListener('click', hideBanner, true);
    document.getElementById('btn-open-gallery')?.addEventListener('click', hideBanner, true);
    document.getElementById('gallery-back')?.addEventListener('click', hideBanner, true);
}

function installConnectivitySync() {
    window.addEventListener('online', refreshConnectivityState);
    window.addEventListener('offline', refreshConnectivityState);
}

function initDataStateUI() {
    installStyles();
    ensureBanner();
    installNavigationReset();
    installConnectivitySync();
    retryingContext = readRetryMarker();
    window.addEventListener(DATA_STATE_EVENT, onDataState);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDataStateUI, { once: true });
} else {
    initDataStateUI();
}
