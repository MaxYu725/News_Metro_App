import {
    TRACKING_CHANGED_EVENT,
    getTrackedKeywords,
    isTrackedKeyword,
    toggleTrackedKeyword,
    normalizeTrackedKeyword
} from './tracking.js';

const RECENT_SEARCH_KEY = 'metro_news_recent_searches_v1';
const MAX_RECENT_SEARCHES = 6;
const SCROLL_KEY_PREFIX = 'metro_news_section_scroll_v2:';
const RESTORE_TIMEOUT_MS = 1600;

let pendingRestore = null;
let restoreTimer = 0;

const CSS = `
#search-view {
    padding-top: 10px;
}

#search-view .view-title-row {
    margin-bottom: 10px;
}

#search-view .search-form {
    position: relative;
    min-height: 44px;
    align-items: stretch;
    border-color: rgba(255, 255, 255, 0.16);
    background: rgba(14, 18, 32, 0.9);
}

#search-view .search-leading-icon {
    width: 40px;
    flex: 0 0 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.46);
    font-size: 1.1rem;
    pointer-events: none;
}

#search-view .search-input {
    min-height: 44px;
    padding: 0 8px 0 0;
    font-size: 0.92rem;
}

#search-view .search-clear {
    width: 40px;
    flex: 0 0 40px;
    display: none;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.55);
    font-size: 1.15rem;
}

#search-view .search-form.has-value .search-clear {
    display: inline-flex;
}

#search-view .search-submit {
    min-width: 58px;
    min-height: 44px;
    padding: 0 12px;
    font-size: 0.72rem;
}

#search-view .search-hint {
    margin-top: 7px;
}

.search-follow-row {
    display: flex;
    justify-content: flex-end;
    min-height: 0;
    margin-top: 7px;
}

.search-follow-row[hidden] {
    display: none !important;
}

.search-follow-btn {
    min-height: 34px;
    max-width: 100%;
    padding: 0 11px;
    border: 1px solid rgba(56, 189, 248, 0.3);
    border-radius: 2px;
    background: rgba(14, 24, 39, 0.72);
    color: rgba(125, 211, 252, 0.95);
    font-size: 0.7rem;
    letter-spacing: 0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.search-follow-btn.is-tracked {
    border-color: rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.055);
    color: rgba(255, 255, 255, 0.6);
}

.search-shortcuts {
    margin: 6px -2px 2px;
}

.search-shortcut-group {
    margin-top: 12px;
}

.search-shortcut-group[hidden] {
    display: none !important;
}

.search-shortcut-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 0 2px 7px;
}

.search-shortcut-label {
    color: rgba(255, 255, 255, 0.42);
    font-size: 0.64rem;
    font-weight: 700;
    letter-spacing: 0.08em;
}

.search-shortcut-clear {
    min-height: 30px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.42);
    font-size: 0.64rem;
}

.search-chip-row {
    display: flex;
    gap: 7px;
    overflow-x: auto;
    padding: 0 2px 3px;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
}

.search-chip-row::-webkit-scrollbar {
    display: none;
}

.search-chip {
    flex: 0 0 auto;
    min-height: 34px;
    max-width: min(72vw, 260px);
    padding: 0 11px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 2px;
    background: rgba(19, 24, 42, 0.68);
    color: rgba(255, 255, 255, 0.78);
    font-size: 0.72rem;
    line-height: 32px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.search-chip:active {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(56, 189, 248, 0.46);
}

.search-chip.search-chip-tracked {
    border-color: rgba(56, 189, 248, 0.25);
    color: rgba(125, 211, 252, 0.92);
}

@media (max-width: 420px) {
    #search-view .view-subtitle {
        display: none;
    }

    #search-view .view-title {
        font-size: 1.55rem;
    }
}
`;

function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

function normalizeQuery(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function getRecentSearches() {
    const values = readJSON(RECENT_SEARCH_KEY, []);
    if (!Array.isArray(values)) return [];
    return values.map(normalizeQuery).filter(Boolean).slice(0, MAX_RECENT_SEARCHES);
}

function saveRecentSearch(query) {
    const clean = normalizeQuery(query);
    if (!clean) return;

    const lower = clean.toLocaleLowerCase();
    const next = [
        clean,
        ...getRecentSearches().filter(item => item.toLocaleLowerCase() !== lower)
    ].slice(0, MAX_RECENT_SEARCHES);

    try {
        localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
    } catch (error) {}
}

function installStyles() {
    if (document.getElementById('search-ui-styles')) return;
    const style = document.createElement('style');
    style.id = 'search-ui-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
}

function makeChip(query, tracked = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `search-chip${tracked ? ' search-chip-tracked' : ''}`;
    button.dataset.searchShortcut = query;
    button.textContent = query;
    button.setAttribute('aria-label', `搜尋 ${query}`);
    return button;
}

function renderShortcuts() {
    const root = document.getElementById('search-shortcuts');
    if (!root) return;

    const recentGroup = root.querySelector('[data-search-recent]');
    const recentRow = root.querySelector('[data-search-recent-row]');
    const trackedGroup = root.querySelector('[data-search-tracked]');
    const trackedRow = root.querySelector('[data-search-tracked-row]');

    const recent = getRecentSearches();
    if (recentRow && recentGroup) {
        recentRow.replaceChildren(...recent.map(query => makeChip(query, false)));
        recentGroup.toggleAttribute('hidden', recent.length === 0);
    }

    const tracked = getTrackedKeywords().slice(0, 8);
    if (trackedRow && trackedGroup) {
        trackedRow.replaceChildren(...tracked.map(query => makeChip(query, true)));
        trackedGroup.toggleAttribute('hidden', tracked.length === 0);
    }
}

function activeSection() {
    return document.querySelector('.bottom-nav-btn.active')?.dataset.section || '';
}

function isSearchActive() {
    return activeSection() === 'search';
}

function scrollStorageKey(section) {
    return `${SCROLL_KEY_PREFIX}${section}`;
}

function saveSectionScroll(section, top) {
    if (!section || !['news', 'search'].includes(section)) return;
    try {
        sessionStorage.setItem(scrollStorageKey(section), String(Math.max(0, top || 0)));
    } catch (error) {}
}

function readSectionScroll(section) {
    if (!section || !['news', 'search'].includes(section)) return 0;
    try {
        const value = Number(sessionStorage.getItem(scrollStorageKey(section)));
        return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (error) {
        return 0;
    }
}

function clearRestoreTimer() {
    if (!restoreTimer) return;
    clearTimeout(restoreTimer);
    restoreTimer = 0;
}

function attemptPendingRestore() {
    clearRestoreTimer();
    if (!pendingRestore) return;

    const main = document.getElementById('main-container');
    const { section, top, startedAt } = pendingRestore;
    if (!main || activeSection() !== section) return;

    if (top <= 0) {
        pendingRestore = null;
        return;
    }

    const maxTop = Math.max(0, main.scrollHeight - main.clientHeight);
    main.scrollTop = Math.min(top, maxTop);

    if (Math.abs(main.scrollTop - top) <= 2) {
        pendingRestore = null;
        return;
    }

    if (performance.now() - startedAt >= RESTORE_TIMEOUT_MS) {
        pendingRestore = null;
        return;
    }

    restoreTimer = window.setTimeout(attemptPendingRestore, 80);
}

function scheduleSectionRestore(section) {
    const top = readSectionScroll(section);
    pendingRestore = {
        section,
        top,
        startedAt: performance.now()
    };

    requestAnimationFrame(() => {
        requestAnimationFrame(attemptPendingRestore);
    });
}

function currentSearchedQuery() {
    const input = document.getElementById('news-search-input');
    const hint = document.getElementById('search-hint');
    const query = normalizeTrackedKeyword(input?.value);
    const hintText = String(hint?.textContent || '');
    if (!query) return '';

    const isCurrentSearch = hintText.includes(`「${query}」`) || hintText.includes('正在搜尋');
    return isCurrentSearch ? query : '';
}

function syncFollowAction() {
    const row = document.querySelector('[data-search-follow-row]');
    const button = document.querySelector('[data-search-follow]');
    if (!row || !button) return;

    const query = currentSearchedQuery();
    row.hidden = !query;
    if (!query) return;

    const tracked = isTrackedKeyword(query);
    button.classList.toggle('is-tracked', tracked);
    button.textContent = tracked ? `✓ 已追蹤「${query}」` : `＋ 追蹤「${query}」`;
    button.setAttribute('aria-label', tracked ? `取消追蹤 ${query}` : `追蹤 ${query}`);
    button.dataset.keyword = query;
}

function syncSearchStateFromVisibleUI() {
    if (!isSearchActive()) return;

    const input = document.getElementById('news-search-input');
    const hint = document.getElementById('search-hint');
    const query = normalizeQuery(input?.value);
    const hintText = String(hint?.textContent || '');

    if (query && (hintText.includes('搜尋結果') || hintText.includes('正在搜尋'))) {
        saveRecentSearch(query);
    }

    renderShortcuts();
    syncFollowAction();
}

function installSearchChrome() {
    const form = document.getElementById('news-search-form');
    const input = document.getElementById('news-search-input');
    const hint = document.getElementById('search-hint');
    if (!form || !input || !hint || form.dataset.mui4aReady === '1') return;

    form.dataset.mui4aReady = '1';
    input.placeholder = '搜尋 HK01 新聞';

    const icon = document.createElement('span');
    icon.className = 'search-leading-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '⌕';
    form.prepend(icon);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'search-clear';
    clear.setAttribute('aria-label', '清除搜尋');
    clear.textContent = '×';
    const submit = form.querySelector('.search-submit');
    if (submit) form.insertBefore(clear, submit);
    else form.appendChild(clear);

    const shortcuts = document.createElement('div');
    shortcuts.id = 'search-shortcuts';
    shortcuts.className = 'search-shortcuts';
    shortcuts.innerHTML = `
        <section class="search-shortcut-group" data-search-recent hidden>
            <div class="search-shortcut-heading">
                <span class="search-shortcut-label">最近搜尋</span>
                <button type="button" class="search-shortcut-clear" data-clear-recent>清除</button>
            </div>
            <div class="search-chip-row" data-search-recent-row></div>
        </section>
        <section class="search-shortcut-group" data-search-tracked hidden>
            <div class="search-shortcut-heading">
                <span class="search-shortcut-label">追蹤主題</span>
            </div>
            <div class="search-chip-row" data-search-tracked-row></div>
        </section>
    `;
    hint.insertAdjacentElement('afterend', shortcuts);

    const followRow = document.createElement('div');
    followRow.className = 'search-follow-row';
    followRow.dataset.searchFollowRow = '1';
    followRow.hidden = true;
    followRow.innerHTML = '<button type="button" class="search-follow-btn" data-search-follow></button>';
    shortcuts.before(followRow);

    const syncValueState = () => {
        form.classList.toggle('has-value', !!normalizeQuery(input.value));
        syncFollowAction();
    };
    input.addEventListener('input', syncValueState);
    syncValueState();

    clear.addEventListener('click', () => {
        input.value = '';
        syncValueState();
        form.requestSubmit();
        requestAnimationFrame(() => input.focus({ preventScroll: true }));
    });

    form.addEventListener('submit', () => {
        const query = normalizeQuery(input.value);
        if (query) {
            input.value = query;
            saveRecentSearch(query);
            renderShortcuts();
        }
        syncValueState();
    }, true);

    followRow.addEventListener('click', event => {
        const button = event.target.closest('[data-search-follow]');
        if (!button) return;
        const keyword = normalizeTrackedKeyword(button.dataset.keyword);
        if (!keyword) return;
        toggleTrackedKeyword(keyword);
        syncFollowAction();
        renderShortcuts();
    });

    shortcuts.addEventListener('click', event => {
        const clearRecent = event.target.closest('[data-clear-recent]');
        if (clearRecent) {
            try { localStorage.removeItem(RECENT_SEARCH_KEY); } catch (error) {}
            renderShortcuts();
            return;
        }

        const chip = event.target.closest('[data-search-shortcut]');
        if (!chip) return;
        input.value = chip.dataset.searchShortcut || '';
        syncValueState();
        form.requestSubmit();
    });

    new MutationObserver(syncSearchStateFromVisibleUI)
        .observe(hint, { childList: true, characterData: true, subtree: true });
}

function installSectionStateController() {
    const bottomNav = document.getElementById('bottom-nav');
    const main = document.getElementById('main-container');
    const grid = document.getElementById('news-grid');
    const searchView = document.getElementById('search-view');
    if (!bottomNav || !main) return;

    bottomNav.addEventListener('click', event => {
        const button = event.target.closest('.bottom-nav-btn');
        if (!button) return;

        const from = activeSection();
        const to = button.dataset.section || '';
        if (!to || from === to) return;

        saveSectionScroll(from, main.scrollTop);
        if (to === 'news' || to === 'search') scheduleSectionRestore(to);
    }, true);

    const observer = new MutationObserver(() => {
        if (isSearchActive()) syncSearchStateFromVisibleUI();
        attemptPendingRestore();
    });

    observer.observe(bottomNav, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });

    if (grid) {
        observer.observe(grid, { childList: true, subtree: false });
    }

    if (searchView) {
        observer.observe(searchView, {
            attributes: true,
            attributeFilter: ['class']
        });
    }
}

function observeTrackingState() {
    window.addEventListener(TRACKING_CHANGED_EVENT, () => {
        renderShortcuts();
        syncFollowAction();
    });

    window.addEventListener('storage', event => {
        if (event.key === 'metro_news_custom_cats' || event.key === RECENT_SEARCH_KEY) {
            renderShortcuts();
            syncFollowAction();
        }
    });

    const settingsView = document.getElementById('settings-view');
    if (!settingsView) return;
    new MutationObserver(() => {
        if (isSearchActive()) {
            renderShortcuts();
            syncFollowAction();
        }
    }).observe(settingsView, { childList: true, subtree: true });
}

function initSearchUI() {
    installStyles();
    installSearchChrome();
    renderShortcuts();
    installSectionStateController();
    observeTrackingState();
    syncSearchStateFromVisibleUI();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSearchUI, { once: true });
} else {
    initSearchUI();
}
