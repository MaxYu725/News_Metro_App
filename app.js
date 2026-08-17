import { timeAgo, generateGeometricBackground, LocalDB } from './utils.js';
import { fetchNewsData, fetchSearchData, fetchImageData, fetchAISummary, fetchFullArticleContent } from './api.js';
import { initLightbox, openLightbox } from './lightbox.js';
import { initGestures } from './gestures.js';
import { initSettings, renderCategoryManager, getThemeClasses } from './settings.js';

const allBaseCats = [
    { id: 'latest', name: '即時' },
    { id: 'local', name: '港聞' },
    { id: 'global', name: '國際' },
    { id: 'ent', name: '娛樂' },
    { id: 'sports', name: '體育' },
    { id: 'china', name: '中國' },
    { id: 'hot', name: '熱話' },
    { id: 'life', name: '生活' },
    { id: 'community', name: '社區' },
    { id: 'tech', name: '科技' },
    { id: 'video', name: '影像' }
];

const categoryMap = {
    latest: '即時',
    local: '港聞',
    global: '國際',
    ent: '娛樂',
    sports: '體育',
    china: '中國',
    hot: '熱話',
    life: '生活',
    community: '社區',
    tech: '科技',
    video: '影像'
};

let visibleCatIds = LocalDB.getVisibleCategories();
let customCats = LocalDB.getCustomCategories();

function getCategories() {
    const activeBase = allBaseCats.filter(cat => visibleCatIds.includes(cat.id));
    return [...activeBase, ...customCats];
}

let categories = getCategories();
let currentIndex = 0;
let activeAppSection = 'news';

let currentNewsData = [];
let newsCache = {};

let currentPage = 0;
let isLoadingMore = false;
let hasMoreNews = true;
let currentSearchQuery = '';

const searchState = {
    query: '',
    data: [],
    page: 0,
    cursor: '',
    mode: 'live',
    hasMore: false
};

const galleryState = {
    query: '',
    data: [],
    page: 0,
    hasMore: false
};

let savedBookmarks = LocalDB.getBookmarks();
let readHistory = LocalDB.getHistory();
let aiSummaryCache = LocalDB.getAISummaries();

const fullArticleRequests = new Map();
const aiSummaryRequests = new Map();

const DOM = {
    newsGrid: document.getElementById('news-grid'),
    settingsView: document.getElementById('settings-view'),
    searchView: document.getElementById('search-view'),
    searchForm: document.getElementById('news-search-form'),
    searchInput: document.getElementById('news-search-input'),
    searchHint: document.getElementById('search-hint'),
    galleryView: document.getElementById('gallery-view'),
    gallerySearchForm: document.getElementById('gallery-search-form'),
    gallerySearchInput: document.getElementById('gallery-search-input'),
    galleryHint: document.getElementById('gallery-hint'),
    galleryBack: document.getElementById('gallery-back'),
    openGalleryBtn: document.getElementById('btn-open-gallery'),
    loadingIndicator: document.getElementById('loading-indicator'),
    scrollLoading: document.getElementById('scroll-loading'),
    navMenu: document.getElementById('nav-menu'),
    categoryStrip: document.getElementById('category-strip'),
    mainContainer: document.getElementById('main-container'),
    ptrIndicator: document.getElementById('ptr-indicator'),
    backToTopBtn: document.getElementById('back-to-top'),
    bottomNav: document.getElementById('bottom-nav'),
    appBgContainer: document.getElementById('app-bg-container')
};

function initRandomBackground() {
    if (DOM.appBgContainer) {
        DOM.appBgContainer.innerHTML = generateGeometricBackground()
            + '<div class="absolute inset-0 bg-gradient-to-b from-[#0a0d1a]/20 via-transparent to-[#0a0d1a]/70"></div>';
    }
}

let wakeLock = null;
let isArticleReaderActive = false;

async function requestWakeLock() {
    if ('wakeLock' in navigator && !wakeLock) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {}
    }
}

async function releaseWakeLock() {
    if (wakeLock !== null) {
        try {
            await wakeLock.release();
        } catch (e) {}
        wakeLock = null;
    }
}

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && isArticleReaderActive) {
        await requestWakeLock();
    } else if (document.visibilityState === 'hidden') {
        wakeLock = null;
    }
});

function setBottomNavState() {
    DOM.bottomNav?.querySelectorAll('.bottom-nav-btn').forEach(btn => {
        const visualSection = activeAppSection === 'gallery' ? 'settings' : activeAppSection;
        const isActive = btn.dataset.section === visualSection;
        btn.classList.toggle('active', isActive);
        if (isActive) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
    });
}

function renderPivot() {
    if (!DOM.navMenu) return;

    DOM.navMenu.innerHTML = '';
    categories.forEach((cat, index) => {
        const a = document.createElement('a');
        a.className = `nav-link ${index === currentIndex ? 'active' : ''}`;
        a.innerText = cat.name;
        a.dataset.categoryId = cat.id;
        a.setAttribute('role', 'button');
        a.setAttribute('tabindex', '0');

        const activate = () => {
            if (activeAppSection !== 'news') return;
            currentIndex = index;
            handlePageChange();
        };

        a.addEventListener('click', activate);
        a.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activate();
            }
        });
        DOM.navMenu.appendChild(a);
    });

    const activeLink = DOM.navMenu.children[currentIndex];
    if (activeLink) {
        DOM.navMenu.scrollTo({
            left: Math.max(activeLink.offsetLeft - 20, 0),
            behavior: 'smooth'
        });
    }
}

function resetViewState() {
    currentPage = 0;
    hasMoreNews = true;
    isLoadingMore = false;
    currentSearchQuery = '';
    DOM.backToTopBtn?.classList.add('hidden-fab');
    isArticleReaderActive = false;
    releaseWakeLock();
}

function showNewsGrid() {
    DOM.settingsView?.classList.add('hidden');
    DOM.settingsView?.classList.remove('flex');
    DOM.searchView?.classList.add('hidden');
    DOM.galleryView?.classList.add('hidden');
    DOM.newsGrid?.classList.remove('hidden');
    if (DOM.newsGrid) DOM.newsGrid.className = 'grid grid-cols-1 auto-rows-auto';
}

function loadCurrentCategory(forceSync = false, isAppendMode = false) {
    const currentCat = categories[currentIndex];
    if (!currentCat) return Promise.resolve();

    if (currentCat.isCustom) {
        currentSearchQuery = currentCat.query;
        return loadNewsUI('search', forceSync, isAppendMode, currentCat.query);
    }

    currentSearchQuery = '';
    return loadNewsUI(currentCat.id, forceSync, isAppendMode);
}

function handlePageChange() {
    if (activeAppSection !== 'news') return;

    renderPivot();
    showNewsGrid();
    resetViewState();

    if (DOM.mainContainer) DOM.mainContainer.scrollTop = 0;
    loadCurrentCategory(false, false);
}

function renderSearchLanding() {
    currentNewsData = [];
    currentPage = 0;
    hasMoreNews = false;

    if (DOM.newsGrid) {
        DOM.newsGrid.innerHTML = `
            <div class="px-5 py-10 text-center">
                <p class="text-sm text-white/45 font-light">搜尋新聞標題與內容</p>
                <p class="text-xs text-white/25 mt-2 tracking-wide">來源：香港01 · 巴士的報 · 3 個字以上搜尋歷史新聞</p>
            </div>
        `;
    }
}

function showSearchSection() {
    DOM.settingsView?.classList.add('hidden');
    DOM.settingsView?.classList.remove('flex');
    DOM.galleryView?.classList.add('hidden');
    DOM.searchView?.classList.remove('hidden');
    DOM.newsGrid?.classList.remove('hidden');
    if (DOM.newsGrid) DOM.newsGrid.className = 'grid grid-cols-1 auto-rows-auto';

    if (DOM.searchInput && searchState.query && DOM.searchInput.value !== searchState.query) {
        DOM.searchInput.value = searchState.query;
    }

    if (searchState.data.length > 0) {
        currentNewsData = searchState.data;
        currentPage = searchState.page;
        hasMoreNews = searchState.hasMore;
        renderTiles(currentNewsData, false);
        if (DOM.searchHint) DOM.searchHint.textContent = `「${searchState.query}」的搜尋結果${searchState.mode === 'archive' ? ' · 包含歷史新聞' : ''}`;
    } else {
        renderSearchLanding();
        if (DOM.searchHint) DOM.searchHint.textContent = '輸入關鍵字後按搜尋。';
    }
}

function renderGalleryLanding() {
    currentNewsData = [];
    currentPage = 0;
    hasMoreNews = false;

    if (DOM.newsGrid) {
        DOM.newsGrid.className = 'grid grid-cols-2 md:grid-cols-3 gap-2 auto-rows-auto px-4';
        DOM.newsGrid.innerHTML = `
            <div class="col-span-2 md:col-span-3 px-5 py-10 text-center">
                <p class="text-sm text-white/45 font-light">搜尋圖片靈感</p>
            </div>
        `;
    }
}

function showGallerySection() {
    DOM.settingsView?.classList.add('hidden');
    DOM.settingsView?.classList.remove('flex');
    DOM.searchView?.classList.add('hidden');
    DOM.galleryView?.classList.remove('hidden');
    DOM.newsGrid?.classList.remove('hidden');

    if (DOM.gallerySearchInput && galleryState.query && DOM.gallerySearchInput.value !== galleryState.query) {
        DOM.gallerySearchInput.value = galleryState.query;
    }

    if (galleryState.data.length > 0) {
        currentNewsData = galleryState.data;
        currentPage = galleryState.page;
        hasMoreNews = galleryState.hasMore;
        if (DOM.newsGrid) DOM.newsGrid.className = 'grid grid-cols-2 md:grid-cols-3 gap-2 auto-rows-auto px-4';
        renderGalleryTiles(false);
        if (DOM.galleryHint) DOM.galleryHint.textContent = `「${galleryState.query}」的圖片結果`;
    } else {
        renderGalleryLanding();
        if (DOM.galleryHint) DOM.galleryHint.textContent = '輸入關鍵字後按搜尋。';
    }
}

function renderGallerySkeletonTiles(count = 6) {
    if (!DOM.newsGrid) return;

    DOM.newsGrid.className = 'grid grid-cols-2 md:grid-cols-3 gap-2 auto-rows-auto px-4';

    let skeletonHtml = '';
    for (let i = 0; i < count; i++) {
        skeletonHtml += `
            <div class="metro-tile relative overflow-hidden bg-white/5 h-48 md:h-64 pointer-events-none border border-white/5 opacity-100">
                <div class="w-full h-full skeleton-pulse"></div>
            </div>
        `;
    }

    DOM.newsGrid.innerHTML = skeletonHtml;
}

async function loadGalleryUI(isAppendMode = false) {
    const query = isAppendMode
        ? galleryState.query
        : (DOM.gallerySearchInput?.value.trim() || '');

    if (!query) {
        galleryState.query = '';
        galleryState.data = [];
        galleryState.page = 0;
        galleryState.hasMore = false;
        renderGalleryLanding();
        if (DOM.galleryHint) DOM.galleryHint.textContent = '請先輸入搜尋關鍵字。';
        return;
    }

    const page = isAppendMode ? galleryState.page + 1 : 0;

    if (!isAppendMode) {
        renderGallerySkeletonTiles(6);
        if (DOM.galleryHint) DOM.galleryHint.textContent = `正在搜尋「${query}」…`;
    } else {
        isLoadingMore = true;
        appendBottomSkeletons(2);
    }

    const result = await fetchImageData(query, page);

    if (isAppendMode) removeBottomSkeletons();

    if (result.success && result.data.length > 0) {
        galleryState.query = query;
        galleryState.page = page;
        galleryState.hasMore = result.hasMore;

        if (isAppendMode) {
            galleryState.data = galleryState.data.concat(result.data);
            currentNewsData = galleryState.data;
            renderGalleryTiles(true, result.data);
        } else {
            galleryState.data = result.data;
            currentNewsData = galleryState.data;
            renderGalleryTiles(false);
        }

        currentPage = galleryState.page;
        hasMoreNews = galleryState.hasMore;
        if (DOM.galleryHint) DOM.galleryHint.textContent = `「${query}」的圖片結果`;
    } else {
        galleryState.query = query;
        galleryState.page = page;
        galleryState.hasMore = false;
        hasMoreNews = false;

        if (!isAppendMode) {
            galleryState.data = [];
            currentNewsData = [];
            if (DOM.newsGrid) {
                DOM.newsGrid.className = 'grid grid-cols-2 md:grid-cols-3 gap-2 auto-rows-auto px-4';
                DOM.newsGrid.innerHTML = `<p class="text-gray-400 text-center mt-10 col-span-2 md:col-span-3">找不到符合「${query}」的圖片。</p>`;
            }
            if (DOM.galleryHint) DOM.galleryHint.textContent = '沒有搜尋結果。';
        }
    }

    isLoadingMore = false;
}

function renderGalleryTiles(isAppendMode = false, batch = null) {
    if (!DOM.newsGrid) return;

    DOM.newsGrid.className = 'grid grid-cols-2 md:grid-cols-3 gap-2 auto-rows-auto px-4';
    const dataToRender = batch || galleryState.data;
    let htmlContent = '';

    dataToRender.forEach((imgItem, relativeIndex) => {
        const animationDelay = `style="animation-delay: ${(relativeIndex % 20) * 0.03}s"`;
        htmlContent += `
            <article class="metro-tile relative group cursor-pointer overflow-hidden h-48 md:h-64 border border-white/10" ${animationDelay}>
                <img
                    src="${imgItem.thumbUrl}"
                    data-full="${imgItem.imageUrl}"
                    class="gallery-img w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    alt="Gallery Image"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                />
                <div class="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <span class="text-[10px] text-white/80 uppercase tracking-widest leading-tight block truncate">${imgItem.tags}</span>
                </div>
            </article>
        `;
    });

    if (isAppendMode) DOM.newsGrid.insertAdjacentHTML('beforeend', htmlContent);
    else DOM.newsGrid.innerHTML = htmlContent;
}

function renderBookmarksUI() {
    const bookmarksArray = Object.values(savedBookmarks);
    bookmarksArray.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    currentNewsData = bookmarksArray;
    currentPage = 0;
    hasMoreNews = false;
    isLoadingMore = false;

    if (!DOM.newsGrid) return;

    if (currentNewsData.length === 0) {
        DOM.newsGrid.innerHTML = `
            <div class="section-heading">
                <h2>收藏</h2>
                <span>0 篇</span>
            </div>
            <div class="px-5 py-10 text-center">
                <p class="text-gray-400 tracking-wider font-light">目前未有收藏新聞。</p>
            </div>
        `;
        return;
    }

    renderTiles(currentNewsData, false);
    DOM.newsGrid.insertAdjacentHTML('afterbegin', `
        <div class="section-heading">
            <h2>收藏</h2>
            <span>${currentNewsData.length} 篇</span>
        </div>
    `);
}

function showSettingsSection() {
    DOM.searchView?.classList.add('hidden');
    DOM.galleryView?.classList.add('hidden');
    DOM.newsGrid?.classList.add('hidden');
    DOM.settingsView?.classList.remove('hidden');
    DOM.settingsView?.classList.add('flex');
    hasMoreNews = false;

    renderCategoryManager(
        allBaseCats,
        getCategories,
        LocalDB.saveVisibleCategories,
        LocalDB.saveCustomCategories,
        onCategoryUpdated
    );
}

function showAppSection(section) {
    if (!['news', 'search', 'bookmarks', 'settings', 'gallery'].includes(section)) return;

    if (section === activeAppSection) {
        if (section === 'search') {
            DOM.searchInput?.focus();
        } else {
            DOM.mainContainer?.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return;
    }

    activeAppSection = section;
    setBottomNavState();
    DOM.categoryStrip?.classList.toggle('hidden', section !== 'news');

    isArticleReaderActive = false;
    releaseWakeLock();
    DOM.backToTopBtn?.classList.add('hidden-fab');
    if (DOM.mainContainer) DOM.mainContainer.scrollTop = 0;

    if (section === 'news') {
        showNewsGrid();
        renderPivot();
        resetViewState();
        loadCurrentCategory(false, false);
        return;
    }

    if (section === 'search') {
        resetViewState();
        showSearchSection();
        return;
    }

    if (section === 'gallery') {
        resetViewState();
        showGallerySection();
        return;
    }

    if (section === 'bookmarks') {
        DOM.settingsView?.classList.add('hidden');
        DOM.settingsView?.classList.remove('flex');
        DOM.searchView?.classList.add('hidden');
        DOM.galleryView?.classList.add('hidden');
        DOM.newsGrid?.classList.remove('hidden');
        if (DOM.newsGrid) DOM.newsGrid.className = 'grid grid-cols-1 auto-rows-auto';
        renderBookmarksUI();
        return;
    }

    resetViewState();
    showSettingsSection();
}

function onCategoryUpdated() {
    visibleCatIds = LocalDB.getVisibleCategories();
    customCats = LocalDB.getCustomCategories();
    categories = getCategories();

    if (currentIndex >= categories.length) currentIndex = 0;
    renderPivot();

    if (activeAppSection === 'news' && categories.length > 0) {
        handlePageChange();
    }
}

function toggleBookmark(newsItem, btnElement, { deferRender = false } = {}) {
    if (savedBookmarks[newsItem.link]) {
        delete savedBookmarks[newsItem.link];
        if (btnElement) {
            btnElement.classList.remove('saved');
            btnElement.innerHTML = '☆ 收藏';
        }
    } else {
        savedBookmarks[newsItem.link] = { ...newsItem };
        if (btnElement) {
            btnElement.classList.add('saved');
            btnElement.innerHTML = '★ 已收藏';
        }
    }

    LocalDB.saveBookmarks(savedBookmarks);

    if (!deferRender && activeAppSection === 'bookmarks') {
        renderBookmarksUI();
    }

    return !!savedBookmarks[newsItem.link];
}

function markAsRead(link, titleElement) {
    if (!readHistory[link]) {
        readHistory[link] = Date.now();
        LocalDB.saveHistory(readHistory);
        if (titleElement) {
            titleElement.classList.remove('text-white');
            titleElement.classList.add('text-gray-400');
        }
    }
}

function stripHtml(text) {
    return String(text || '')
        .replace(/<[^>]*>?/gm, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function deckText(newsItem) {
    const title = stripHtml(newsItem?.title);
    let text = stripHtml(newsItem?.description || '暫無詳細內文。');
    if (title && text.startsWith(title)) text = text.slice(title.length).trim();
    if (text.length > 110) text = `${text.slice(0, 110).trim()}…`;
    return escapeHtml(text);
}

export function getReaderArticle(tile) {
    const index = Number.parseInt(tile?.dataset?.index || '', 10);
    if (!Number.isInteger(index) || index < 0) return null;
    return currentNewsData[index] || null;
}

export function getReaderArticleState(newsItem) {
    if (!newsItem?.link) {
        return { saved: false, aiSummary: '', category: '新聞', section: activeAppSection };
    }

    return {
        saved: !!savedBookmarks[newsItem.link],
        aiSummary: aiSummaryCache[newsItem.link] || '',
        category: categoryMap[newsItem.category] || newsItem.category || '新聞',
        section: activeAppSection
    };
}

export function markReaderArticleRead(newsItem, tile) {
    if (!newsItem?.link) return;
    markAsRead(newsItem.link, tile?.querySelector('.news-title'));
}

export async function setArticleReaderActive(active) {
    isArticleReaderActive = !!active;
    if (isArticleReaderActive) await requestWakeLock();
    else await releaseWakeLock();
}

export async function loadReaderArticle(newsItem) {
    if (!newsItem?.link) {
        return { success: false, content: newsItem?.description || '', error: '缺少新聞連結' };
    }

    if (newsItem.isFullContentLoaded) {
        return { success: true, content: newsItem.description || '', cached: true };
    }

    if (fullArticleRequests.has(newsItem.link)) {
        return fullArticleRequests.get(newsItem.link);
    }

    const request = (async () => {
        const originalSummary = newsItem.description || '';
        const result = await fetchFullArticleContent(newsItem.link);

        if (result.success) {
            if (result.content && result.content.length > originalSummary.length) {
                newsItem.description = result.content;
            }
            newsItem.isFullContentLoaded = true;

            if (savedBookmarks[newsItem.link]) {
                savedBookmarks[newsItem.link] = { ...savedBookmarks[newsItem.link], ...newsItem };
                LocalDB.saveBookmarks(savedBookmarks);
            }

            return { success: true, content: newsItem.description || originalSummary };
        }

        return {
            success: false,
            content: originalSummary,
            error: result.error || '擷取全文失敗'
        };
    })().finally(() => fullArticleRequests.delete(newsItem.link));

    fullArticleRequests.set(newsItem.link, request);
    return request;
}

export async function summarizeReaderArticle(newsItem) {
    if (!newsItem?.link) return { success: false, error: '缺少新聞資料' };

    if (aiSummaryCache[newsItem.link]) {
        return { success: true, summary: aiSummaryCache[newsItem.link], cached: true };
    }

    if (aiSummaryRequests.has(newsItem.link)) {
        return aiSummaryRequests.get(newsItem.link);
    }

    const request = (async () => {
        await loadReaderArticle(newsItem);
        const cleanTextForAI = stripHtml(newsItem.description);
        if (!cleanTextForAI) return { success: false, error: '沒有可供摘要的內容' };

        const result = await fetchAISummary(cleanTextForAI);
        if (result.success) {
            aiSummaryCache[newsItem.link] = result.summary;
            LocalDB.saveAISummary(newsItem.link, result.summary);
        }
        return result;
    })().finally(() => aiSummaryRequests.delete(newsItem.link));

    aiSummaryRequests.set(newsItem.link, request);
    return request;
}

export function toggleReaderBookmark(newsItem) {
    if (!newsItem?.link) return false;
    return toggleBookmark(newsItem, null, { deferRender: true });
}

export function syncReaderSourceTile(tile, newsItem) {
    if (!tile || !newsItem?.link) return;
    const saved = !!savedBookmarks[newsItem.link];
    const hasAI = !!aiSummaryCache[newsItem.link];
    tile.querySelector('.feed-bookmark-indicator')?.classList.toggle('hidden', !saved);
    tile.querySelector('.feed-ai-indicator')?.classList.toggle('hidden', !hasAI);
}

export function refreshReaderViewAfterClose(tile, newsItem, { bookmarkChanged = false } = {}) {
    if (activeAppSection === 'bookmarks' && bookmarkChanged) {
        renderBookmarksUI();
        return;
    }
    syncReaderSourceTile(tile, newsItem);
}

function renderSkeletonTiles(count = 6) {
    if (!DOM.newsGrid) return;

    const { currentThemeBorder } = getThemeClasses();
    let skeletonHtml = '';

    for (let i = 0; i < count; i++) {
        skeletonHtml += `
            <div class="metro-tile ${currentThemeBorder} flex flex-col pointer-events-none opacity-100 p-4">
                <div class="w-full flex justify-between items-center mb-3">
                    <div class="w-12 h-3 skeleton-pulse rounded-xs"></div>
                    <div class="w-16 h-3 skeleton-pulse rounded-xs"></div>
                </div>
                <div class="flex flex-row items-center justify-between min-h-[75px]">
                    <div class="flex-grow pr-3 space-y-2">
                        <div class="w-full h-4 skeleton-pulse rounded-xs"></div>
                        <div class="w-4/5 h-4 skeleton-pulse rounded-xs"></div>
                    </div>
                    <div class="w-20 h-20 md:w-24 md:h-24 skeleton-pulse flex-shrink-0 ml-2 rounded-xs"></div>
                </div>
            </div>
        `;
    }

    DOM.newsGrid.innerHTML = skeletonHtml;
}

function appendBottomSkeletons(count = 3) {
    if (!DOM.newsGrid) return;

    const { currentThemeBorder } = getThemeClasses();
    let skeletonHtml = '';

    for (let i = 0; i < count; i++) {
        skeletonHtml += `
            <div class="bottom-skeleton-item metro-tile ${currentThemeBorder} flex flex-col pointer-events-none opacity-100 p-4">
                <div class="w-full flex justify-between items-center mb-3">
                    <div class="w-12 h-3 skeleton-pulse rounded-xs"></div>
                    <div class="w-16 h-3 skeleton-pulse rounded-xs"></div>
                </div>
                <div class="flex flex-row items-center justify-between min-h-[75px]">
                    <div class="flex-grow pr-3 space-y-2">
                        <div class="w-full h-4 skeleton-pulse rounded-xs"></div>
                        <div class="w-3/4 h-4 skeleton-pulse rounded-xs"></div>
                    </div>
                    <div class="w-20 h-20 skeleton-pulse flex-shrink-0 ml-2 rounded-xs"></div>
                </div>
            </div>
        `;
    }

    DOM.newsGrid.insertAdjacentHTML('beforeend', skeletonHtml);
}

function removeBottomSkeletons() {
    DOM.newsGrid?.querySelectorAll('.bottom-skeleton-item').forEach(el => el.remove());
}

async function loadNewsUI(categoryId, forceSync = false, isAppendMode = false, searchQueryOverride = '') {
    const cacheKey = categoryId === 'search' ? null : categoryId;

    if (
        cacheKey
        && !isAppendMode
        && !forceSync
        && newsCache[cacheKey]
        && currentPage === 0
    ) {
        currentNewsData = newsCache[cacheKey];
        renderTiles(currentNewsData, false);
        return;
    }

    if (!isAppendMode) {
        renderSkeletonTiles(6);
    } else {
        isLoadingMore = true;
        appendBottomSkeletons(3);
    }

    const query = searchQueryOverride || currentSearchQuery;
    const result = await fetchNewsData(categoryId, currentPage, forceSync, query);

    if (isAppendMode) removeBottomSkeletons();

    if (result.success && result.data.length > 0) {
        hasMoreNews = result.hasMore;
        const newBatch = result.data;

        if (isAppendMode) {
            const startIndex = currentNewsData.length;
            currentNewsData = currentNewsData.concat(newBatch);
            renderTiles(newBatch, true, startIndex);
            if (cacheKey) newsCache[cacheKey] = currentNewsData;
        } else {
            currentNewsData = newBatch;
            if (currentPage === 0 && cacheKey) newsCache[cacheKey] = currentNewsData;
            renderTiles(currentNewsData, false);
        }
    } else {
        hasMoreNews = false;
        if (!isAppendMode && DOM.newsGrid) {
            DOM.newsGrid.innerHTML = categoryId === 'search'
                ? `<p class="text-gray-400 text-center mt-10 px-5">資料庫中找不到符合「${query}」的新聞，請嘗試其他關鍵字。</p>`
                : '<p class="text-gray-400 text-center mt-10">目前沒有新聞資料。</p>';
        }
    }

    DOM.loadingIndicator?.classList.add('hidden');
    DOM.scrollLoading?.classList.add('hidden');
    isLoadingMore = false;
}

async function loadSearchUI(isAppendMode = false) {
    const query = isAppendMode
        ? searchState.query
        : (DOM.searchInput?.value.trim() || '');

    if (!query) {
        searchState.query = '';
        searchState.data = [];
        searchState.page = 0;
        searchState.cursor = '';
        searchState.mode = 'live';
        searchState.hasMore = false;
        renderSearchLanding();
        if (DOM.searchHint) DOM.searchHint.textContent = '請先輸入搜尋關鍵字。';
        return;
    }

    const useArchive = Array.from(query).length >= 3;
    const mode = useArchive ? 'archive' : 'live';
    const page = isAppendMode && mode === 'live' ? searchState.page + 1 : 0;
    const cursor = isAppendMode && mode === 'archive' ? searchState.cursor : '';

    if (!isAppendMode) {
        renderSkeletonTiles(6);
        if (DOM.searchHint) DOM.searchHint.textContent = `正在搜尋「${query}」…`;
    } else {
        isLoadingMore = true;
        appendBottomSkeletons(3);
    }

    const result = await fetchSearchData(query, {
        cursor,
        page,
        includeArchive: useArchive
    });

    if (isAppendMode) removeBottomSkeletons();

    if (result.success && result.data.length > 0) {
        const newBatch = result.data;

        searchState.query = query;
        searchState.page = mode === 'live' ? page : 0;
        searchState.cursor = mode === 'archive' ? (result.nextCursor || '') : '';
        searchState.mode = result.mode || mode;
        searchState.hasMore = result.hasMore;

        if (isAppendMode) {
            const existingKeys = new Set(
                searchState.data.map(item => String(item?.id || item?.link || ''))
            );
            const uniqueBatch = newBatch.filter(item => {
                const key = String(item?.id || item?.link || '');
                return key && !existingKeys.has(key);
            });
            const startIndex = searchState.data.length;
            searchState.data = searchState.data.concat(uniqueBatch);
            currentNewsData = searchState.data;
            if (uniqueBatch.length > 0) renderTiles(uniqueBatch, true, startIndex);
        } else {
            searchState.data = newBatch;
            currentNewsData = searchState.data;
            renderTiles(currentNewsData, false);
        }

        currentPage = searchState.page;
        hasMoreNews = searchState.hasMore;
        if (DOM.searchHint) {
            DOM.searchHint.textContent = `「${query}」的搜尋結果${searchState.mode === 'archive' ? ' · 包含歷史新聞' : ''}`;
        }
    } else {
        searchState.query = query;
        searchState.page = mode === 'live' ? page : 0;
        searchState.cursor = '';
        searchState.mode = mode;
        searchState.hasMore = false;
        hasMoreNews = false;

        if (!isAppendMode) {
            searchState.data = [];
            currentNewsData = [];
            if (DOM.newsGrid) {
                DOM.newsGrid.innerHTML = `<p class="text-gray-400 text-center mt-10 px-5">找不到符合「${query}」的新聞。</p>`;
            }
            if (DOM.searchHint) {
                DOM.searchHint.textContent = result.success ? '沒有搜尋結果。' : '搜尋服務暫時無法回應。';
            }
        }
    }

    isLoadingMore = false;
}

function renderTiles(articlesToRender, isAppendMode = false, startIndex = 0) {
    if (!DOM.newsGrid) return;

    if (articlesToRender.length === 0 && !isAppendMode) {
        DOM.newsGrid.innerHTML = '<p class="text-gray-400 text-center mt-10">目前沒有新聞。</p>';
        return;
    }

    const { currentThemeBorder, currentThemeText } = getThemeClasses();
    let htmlContent = '';

    articlesToRender.forEach((news, relativeIndex) => {
        const index = startIndex + relativeIndex;
        const animationDelay = `style="animation-delay: ${(relativeIndex % 20) * 0.03}s"`;
        const isSaved = !!savedBookmarks[news.link];
        const isRead = !!readHistory[news.link];
        const hasCachedAI = !!aiSummaryCache[news.link];
        const titleColorClass = isRead ? 'text-gray-400' : 'text-white';
        const catName = categoryMap[news.category] || news.category || '即時';
        const sourceName = stripHtml(news.source || '香港01');
        const deck = deckText(news);

        const thumbHtml = news.imageUrl
            ? `<div class="flex-shrink-0 ml-3"><img src="${news.imageUrl}" class="w-20 h-20 md:w-24 md:h-24 object-cover border border-white/15 shadow-sm bg-black/30" alt="縮圖" loading="lazy" referrerpolicy="no-referrer" /></div>`
            : '';

        htmlContent += `
            <article class="metro-tile ${currentThemeBorder}" data-index="${index}" ${animationDelay}>
                <div class="tile-preview flex flex-col w-full p-4 bg-transparent">
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center space-x-2">
                            <span class="text-xs font-bold tracking-wider uppercase ${currentThemeText}">${catName}</span>
                            <span class="text-[10px] text-white/35 tracking-wider">· ${escapeHtml(sourceName)}</span>
                            <span class="feed-ai-indicator text-[10px] bg-fuchsia-950/70 text-fuchsia-300 border border-fuchsia-500/30 px-1.5 py-0.5 rounded font-bold ${hasCachedAI ? '' : 'hidden'}">✨ AI 摘要</span>
                        </div>
                        <div class="flex items-center space-x-2">
                            <span class="text-xs text-white/50 tracking-wider font-medium">${timeAgo(news.pubDate)}</span>
                            <span class="feed-bookmark-indicator text-xs text-yellow-300 ${isSaved ? '' : 'hidden'}">★</span>
                        </div>
                    </div>

                    <div class="flex flex-row items-center justify-between min-h-[75px]">
                        <div class="flex-grow pr-2 flex flex-col justify-center">
                            <h3 class="news-title text-base md:text-lg font-bold leading-snug line-clamp-3 ${titleColorClass}">${news.title}</h3>
                            <p class="feed-deck">${deck}</p>
                        </div>
                        ${thumbHtml}
                    </div>
                </div>
            </article>
        `;
    });

    if (isAppendMode) DOM.newsGrid.insertAdjacentHTML('beforeend', htmlContent);
    else DOM.newsGrid.innerHTML = htmlContent;
}

DOM.newsGrid?.addEventListener('click', e => {
    const target = e.target;

    if (target.classList.contains('gallery-img')) {
        e.stopPropagation();
        const fullSrc = target.getAttribute('data-full') || target.src;
        if (fullSrc) openLightbox(fullSrc);
    }
});

DOM.searchForm?.addEventListener('submit', async e => {
    e.preventDefault();
    if (activeAppSection !== 'search') return;
    await loadSearchUI(false);
});

DOM.gallerySearchForm?.addEventListener('submit', async e => {
    e.preventDefault();
    if (activeAppSection !== 'gallery') return;
    await loadGalleryUI(false);
});

DOM.openGalleryBtn?.addEventListener('click', () => {
    showAppSection('gallery');
});

DOM.galleryBack?.addEventListener('click', () => {
    showAppSection('settings');
});

DOM.bottomNav?.addEventListener('click', e => {
    const btn = e.target.closest('.bottom-nav-btn');
    if (!btn) return;
    showAppSection(btn.dataset.section);
});

DOM.mainContainer?.addEventListener('scroll', () => {
    if (activeAppSection !== 'settings' && DOM.mainContainer.scrollTop > window.innerHeight * 1.5) {
        DOM.backToTopBtn?.classList.remove('hidden-fab');
    } else {
        DOM.backToTopBtn?.classList.add('hidden-fab');
    }

    if (activeAppSection === 'news') {
        if (
            DOM.mainContainer.scrollTop + DOM.mainContainer.clientHeight
            >= DOM.mainContainer.scrollHeight - 180
            && !isLoadingMore
            && hasMoreNews
        ) {
            isLoadingMore = true;
            currentPage++;
            loadCurrentCategory(false, true);
        }
        return;
    }

    if (activeAppSection === 'search') {
        if (
            DOM.mainContainer.scrollTop + DOM.mainContainer.clientHeight
            >= DOM.mainContainer.scrollHeight - 180
            && !isLoadingMore
            && searchState.hasMore
            && searchState.query
        ) {
            isLoadingMore = true;
            loadSearchUI(true);
        }
    }

    if (activeAppSection === 'gallery') {
        if (
            DOM.mainContainer.scrollTop + DOM.mainContainer.clientHeight
            >= DOM.mainContainer.scrollHeight - 180
            && !isLoadingMore
            && galleryState.hasMore
            && galleryState.query
        ) {
            isLoadingMore = true;
            loadGalleryUI(true);
        }
    }
}, { passive: true });

DOM.backToTopBtn?.addEventListener('click', () => {
    DOM.mainContainer?.scrollTo({ top: 0, behavior: 'smooth' });
});

window.addEventListener('DOMContentLoaded', () => {
    initRandomBackground();
    initLightbox();

    initGestures({
        mainContainer: DOM.mainContainer,
        ptrIndicator: DOM.ptrIndicator,
        canSwipe: () => activeAppSection === 'news' && !isArticleReaderActive,
        canRefresh: () => activeAppSection === 'news' && !isArticleReaderActive,
        onSwipe: dir => {
            const nextIndex = dir === 'prev' ? currentIndex - 1 : currentIndex + 1;
            if (nextIndex < 0 || nextIndex >= categories.length) return;
            currentIndex = nextIndex;
            handlePageChange();
        },
        onRefresh: async () => {
            if (activeAppSection !== 'news') return;
            currentPage = 0;
            await loadCurrentCategory(true, false);
        }
    });

    initSettings({
        allBaseCats,
        getCategories,
        saveVisibleCategories: LocalDB.saveVisibleCategories,
        saveCustomCategories: LocalDB.saveCustomCategories,
        onCategoryUpdated,
        onThemeChange: () => {
            if (activeAppSection === 'bookmarks') {
                renderBookmarksUI();
                return;
            }

            if (
                currentNewsData.length > 0
                && activeAppSection !== 'settings'
                && activeAppSection !== 'gallery'
            ) {
                renderTiles(currentNewsData, false);
            }
        }
    });

    renderPivot();
    setBottomNavState();
    DOM.categoryStrip?.classList.remove('hidden');
    showNewsGrid();
    resetViewState();
    loadCurrentCategory(false, false);
});
