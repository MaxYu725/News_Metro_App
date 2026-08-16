import { timeAgo, generateGeometricBackground, LocalDB } from './utils.js';
import { fetchNewsData, fetchImageData, fetchAISummary, fetchFullArticleContent } from './api.js';
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
let isTileExpandedState = false;

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
    if (document.visibilityState === 'visible' && isTileExpandedState) {
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
    isTileExpandedState = false;
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
                <p class="text-xs text-white/25 mt-2 tracking-wide">來源：HK01</p>
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
        if (DOM.searchHint) DOM.searchHint.textContent = `「${searchState.query}」的搜尋結果`;
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

    isTileExpandedState = false;
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

function toggleBookmark(newsItem, btnElement) {
    if (savedBookmarks[newsItem.link]) {
        delete savedBookmarks[newsItem.link];
        if (btnElement) {
            btnElement.classList.remove('saved');
            btnElement.innerHTML = '☆ 收藏';
        }
    } else {
        savedBookmarks[newsItem.link] = newsItem;
        if (btnElement) {
            btnElement.classList.add('saved');
            btnElement.innerHTML = '★ 已收藏';
        }
    }

    LocalDB.saveBookmarks(savedBookmarks);

    if (activeAppSection === 'bookmarks') {
        renderBookmarksUI();
    }
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
        searchState.hasMore = false;
        renderSearchLanding();
        if (DOM.searchHint) DOM.searchHint.textContent = '請先輸入搜尋關鍵字。';
        return;
    }

    const page = isAppendMode ? searchState.page + 1 : 0;

    if (!isAppendMode) {
        renderSkeletonTiles(6);
        if (DOM.searchHint) DOM.searchHint.textContent = `正在搜尋「${query}」…`;
    } else {
        isLoadingMore = true;
        appendBottomSkeletons(3);
    }

    const result = await fetchNewsData('search', page, false, query);

    if (isAppendMode) removeBottomSkeletons();

    if (result.success && result.data.length > 0) {
        const newBatch = result.data;

        searchState.query = query;
        searchState.page = page;
        searchState.hasMore = result.hasMore;

        if (isAppendMode) {
            const startIndex = searchState.data.length;
            searchState.data = searchState.data.concat(newBatch);
            currentNewsData = searchState.data;
            renderTiles(newBatch, true, startIndex);
        } else {
            searchState.data = newBatch;
            currentNewsData = searchState.data;
            renderTiles(currentNewsData, false);
        }

        currentPage = searchState.page;
        hasMoreNews = searchState.hasMore;
        if (DOM.searchHint) DOM.searchHint.textContent = `「${query}」的搜尋結果`;
    } else {
        searchState.query = query;
        searchState.page = page;
        searchState.hasMore = false;
        hasMoreNews = false;

        if (!isAppendMode) {
            searchState.data = [];
            currentNewsData = [];
            if (DOM.newsGrid) {
                DOM.newsGrid.innerHTML = `<p class="text-gray-400 text-center mt-10 px-5">找不到符合「${query}」的新聞。</p>`;
            }
            if (DOM.searchHint) DOM.searchHint.textContent = '沒有搜尋結果。';
        }
    }

    isLoadingMore = false;
}

function formatParagraphs(text) {
    if (!text) return '';

    return text
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => `<p class="mb-4 leading-relaxed">${p}</p>`)
        .join('');
}

function showAISummaryInTile(tile, summaryText) {
    const aiBox = tile.querySelector('.ai-box');
    const aiText = tile.querySelector('.ai-summary-text');
    const imgContainer = tile.querySelector('.img-container');

    if (!aiBox || !aiText) return;

    if (imgContainer) {
        imgContainer.classList.remove('w-full', 'h-52', 'md:h-64');
        imgContainer.classList.add('w-1/2', 'h-48', 'md:h-56');
        aiBox.classList.remove('w-full');
        aiBox.classList.add('w-1/2', 'h-48', 'md:h-56');
    } else {
        aiBox.classList.remove('w-1/2');
        aiBox.classList.add('w-full', 'h-auto');
    }

    aiBox.classList.remove('hidden');
    aiText.innerText = summaryText;
}

function renderTiles(articlesToRender, isAppendMode = false, startIndex = 0) {
    if (!DOM.newsGrid) return;

    if (articlesToRender.length === 0 && !isAppendMode) {
        DOM.newsGrid.innerHTML = '<p class="text-gray-400 text-center mt-10">目前沒有新聞。</p>';
        return;
    }

    const { currentThemeBorder, currentThemeText, currentThemeBg } = getThemeClasses();
    let htmlContent = '';

    articlesToRender.forEach((news, relativeIndex) => {
        const index = startIndex + relativeIndex;
        const animationDelay = `style="animation-delay: ${(relativeIndex % 20) * 0.03}s"`;
        const cleanDescription = formatParagraphs(news.description || '暫無詳細內文。');
        const isSaved = !!savedBookmarks[news.link];
        const isRead = !!readHistory[news.link];
        const hasCachedAI = !!aiSummaryCache[news.link];
        const titleColorClass = isRead ? 'text-gray-400' : 'text-white';
        const catName = categoryMap[news.category] || news.category || '即時';

        const thumbHtml = news.imageUrl
            ? `<div class="flex-shrink-0 ml-3"><img src="${news.imageUrl}" class="w-20 h-20 md:w-24 md:h-24 object-cover border border-white/15 shadow-sm bg-black/30" alt="縮圖" loading="lazy" referrerpolicy="no-referrer" /></div>`
            : '';

        let imagesHtml = '';
        if (news.images && news.images.length > 0) {
            const slidesHtml = news.images
                .map(imgUrl => `<img src="${imgUrl}" class="lightbox-img snap-center flex-shrink-0 w-full h-full object-cover block cursor-pointer active:opacity-70 transition-opacity" alt="新聞圖片" loading="lazy" referrerpolicy="no-referrer" />`)
                .join('');

            const navButtons = news.images.length > 1 ? `
                <button class="btn-prev-img absolute left-0 top-1/2 -translate-y-1/2 bg-black/60 text-white px-2 py-2 text-xs z-10 active:bg-white active:text-black">❮</button>
                <button class="btn-next-img absolute right-0 top-1/2 -translate-y-1/2 bg-black/60 text-white px-2 py-2 text-xs z-10 active:bg-white active:text-black">❯</button>
                <div class="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded tracking-widest z-10">${news.images.length} 圖</div>
            ` : '';

            imagesHtml = `
                <div class="img-container relative w-full h-52 md:h-64 flex-shrink-0 overflow-hidden bg-black/30 border border-white/10 rounded-xs shadow-md transition-all duration-200">
                    <div class="img-scroll-box flex items-center h-full overflow-x-auto snap-x snap-mandatory hide-scrollbar" style="scroll-behavior: smooth;">${slidesHtml}</div>
                    ${navButtons}
                </div>
            `;
        }

        htmlContent += `
            <article class="metro-tile ${currentThemeBorder}" data-index="${index}" ${animationDelay}>
                <div class="tile-preview flex flex-col w-full p-4 bg-transparent">
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center space-x-2">
                            <span class="text-xs font-bold tracking-wider uppercase ${currentThemeText}">${catName}</span>
                            ${hasCachedAI ? '<span class="text-[10px] bg-fuchsia-950/70 text-fuchsia-300 border border-fuchsia-500/30 px-1.5 py-0.5 rounded font-bold">✨ AI 摘要</span>' : ''}
                        </div>
                        <div class="flex items-center space-x-2">
                            <span class="text-xs text-white/50 tracking-wider font-medium">${timeAgo(news.pubDate)}</span>
                            ${isSaved ? '<span class="text-xs text-yellow-300">★</span>' : ''}
                        </div>
                    </div>

                    <div class="flex flex-row items-center justify-between min-h-[75px]">
                        <div class="flex-grow pr-2 flex flex-col justify-center">
                            <h3 class="news-title text-base md:text-lg font-bold leading-snug line-clamp-3 ${titleColorClass}">${news.title}</h3>
                        </div>
                        ${thumbHtml}
                    </div>
                </div>

                <div class="tile-details bg-transparent border-t border-white/10">
                    <div class="tile-details-inner flex flex-col justify-between">
                        <div>
                            <div class="flex justify-between items-center mb-2 mt-2 px-5">
                                <span class="${currentThemeBg} text-white text-[10px] px-2.5 py-1 rounded-xs font-bold tracking-wider uppercase border border-white/10">${catName}</span>
                                <div class="flex space-x-4">
                                    <button class="ai-btn text-xs uppercase tracking-widest font-bold text-fuchsia-400 hover:text-fuchsia-300 transition-colors">✨ AI 總結</button>
                                    <button class="share-btn text-xs uppercase tracking-widest font-bold opacity-70 hover:opacity-100 transition-colors">分享 ↗</button>
                                    <button class="bookmark-btn text-xs uppercase tracking-widest font-bold ${isSaved ? 'saved' : 'opacity-70'}">${isSaved ? '★ 已收藏' : '☆ 收藏'}</button>
                                </div>
                            </div>
                            <h3 class="text-2xl md:text-3xl font-light leading-tight mb-2 px-5 mt-2 text-white">${news.title}</h3>
                            <p class="text-xs opacity-60 mb-4 px-5">${new Date(news.pubDate).toLocaleString()} (${timeAgo(news.pubDate)})</p>

                            <div class="media-ai-wrapper px-5 mb-4 flex flex-row gap-3 items-start">
                                ${imagesHtml}
                                <div class="ai-box hidden w-full flex-shrink-0 transition-all duration-200 bg-fuchsia-950/50 border border-fuchsia-500/40 p-3 rounded-xs flex flex-col justify-start min-h-[192px] md:min-h-[224px]">
                                    <div class="flex items-center space-x-1.5 mb-2 flex-shrink-0">
                                        <span class="text-fuchsia-400 text-xs">✨</span>
                                        <span class="text-[10px] uppercase tracking-widest text-fuchsia-400 font-bold">Workers AI 摘要</span>
                                    </div>
                                    <p class="ai-summary-text text-xs md:text-sm font-light text-gray-200 leading-relaxed tracking-wide min-h-0 flex-1 overflow-y-auto hide-scrollbar pr-1 pb-2"></p>
                                </div>
                            </div>

                            <div class="article-content-body text-base md:text-lg font-light text-gray-100 leading-relaxed bg-black/25 px-5 py-6 border-t border-white/10">
                                ${cleanDescription}
                            </div>
                        </div>
                    </div>
                </div>
            </article>
        `;
    });

    if (isAppendMode) DOM.newsGrid.insertAdjacentHTML('beforeend', htmlContent);
    else DOM.newsGrid.innerHTML = htmlContent;
}

DOM.newsGrid?.addEventListener('click', async e => {
    const target = e.target;

    if (target.classList.contains('lightbox-img') || target.classList.contains('gallery-img')) {
        e.stopPropagation();
        const fullSrc = target.getAttribute('data-full') || target.src;
        if (fullSrc) openLightbox(fullSrc);
        return;
    }

    if (target.classList.contains('btn-prev-img')) {
        e.stopPropagation();
        const scrollBox = target.closest('.img-container')?.querySelector('.img-scroll-box');
        if (scrollBox) scrollBox.scrollBy({ left: -scrollBox.clientWidth, behavior: 'smooth' });
        return;
    }

    if (target.classList.contains('btn-next-img')) {
        e.stopPropagation();
        const scrollBox = target.closest('.img-container')?.querySelector('.img-scroll-box');
        if (scrollBox) scrollBox.scrollBy({ left: scrollBox.clientWidth, behavior: 'smooth' });
        return;
    }

    if (activeAppSection === 'gallery') return;

    const aiBtn = target.closest('.ai-btn');
    if (aiBtn) {
        e.stopPropagation();
        const tile = aiBtn.closest('.metro-tile');
        const index = parseInt(tile.getAttribute('data-index'));
        const news = currentNewsData[index];
        if (!news) return;

        if (aiSummaryCache[news.link]) {
            showAISummaryInTile(tile, aiSummaryCache[news.link]);
            return;
        }

        const aiBox = tile.querySelector('.ai-box');
        const aiText = tile.querySelector('.ai-summary-text');
        if (
            aiBox
            && aiText
            && !aiBox.classList.contains('hidden')
            && aiText.innerText !== '⚠️ 總結失敗，請稍後再試。'
        ) return;

        showAISummaryInTile(tile, '');
        if (aiText) aiText.innerHTML = '<span class="animate-pulse">正在呼叫 Llama 3 引擎運算中...</span>';

        const cleanTextForAI = news.description.replace(/<[^>]*>?/gm, '').trim();
        const res = await fetchAISummary(cleanTextForAI);

        if (res.success) {
            if (aiText) aiText.innerText = res.summary;
            aiSummaryCache[news.link] = res.summary;
            LocalDB.saveAISummary(news.link, res.summary);
        } else if (aiText) {
            aiText.innerText = '⚠️ 總結失敗，請稍後再試。';
        }
        return;
    }

    const bookmarkBtn = target.closest('.bookmark-btn');
    if (bookmarkBtn) {
        e.stopPropagation();
        const tile = bookmarkBtn.closest('.metro-tile');
        const index = parseInt(tile.getAttribute('data-index'));
        if (currentNewsData[index]) {
            toggleBookmark(currentNewsData[index], bookmarkBtn);
        }
        return;
    }

    const shareBtn = target.closest('.share-btn');
    if (shareBtn) {
        e.stopPropagation();
        const tile = shareBtn.closest('.metro-tile');
        const index = parseInt(tile.getAttribute('data-index'));
        const news = currentNewsData[index];

        if (news) {
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: news.title,
                        text: '看看這則新聞！',
                        url: news.link
                    });
                } catch (err) {}
            } else {
                navigator.clipboard.writeText(news.link)
                    .then(() => alert('已複製新聞連結！'));
            }
        }
        return;
    }

    const tile = target.closest('.metro-tile');
    if (tile && !target.closest('button')) {
        const index = parseInt(tile.getAttribute('data-index'));
        const news = currentNewsData[index];
        const isCurrentlyExpanded = tile.classList.contains('expanded');

        releaseWakeLock();

        if (isCurrentlyExpanded) {
            tile.classList.remove('expanded');
            isTileExpandedState = false;
            return;
        }

        DOM.newsGrid.querySelectorAll('.metro-tile.expanded')
            .forEach(t => t.classList.remove('expanded'));

        const titleElement = tile.querySelector('.news-title');
        if (news) markAsRead(news.link, titleElement);

        tile.classList.add('expanded');
        isTileExpandedState = true;
        requestWakeLock();

        if (news && aiSummaryCache[news.link]) {
            showAISummaryInTile(tile, aiSummaryCache[news.link]);
        }

        const contentBody = tile.querySelector('.article-content-body');

        if (news && !news.isFullContentLoaded && contentBody) {
            const originalSummary = news.description;

            const articleSkeletonHtml = `
                <div class="article-skeleton-container border-t border-white/10 pt-4 mt-4">
                    <div class="flex items-center space-x-2 text-cyan-400 text-xs mb-4">
                        <span class="loader-small"></span>
                        <span class="animate-pulse font-bold tracking-wider">正在載入完整文章...</span>
                    </div>
                    <div class="space-y-3 opacity-60">
                        <div class="w-full h-4 skeleton-pulse rounded-xs"></div>
                        <div class="w-11/12 h-4 skeleton-pulse rounded-xs"></div>
                        <div class="w-4/5 h-4 skeleton-pulse rounded-xs"></div>
                        <div class="w-full h-4 skeleton-pulse rounded-xs"></div>
                        <div class="w-3/4 h-4 skeleton-pulse rounded-xs mb-2"></div>
                        <div class="w-full h-4 skeleton-pulse rounded-xs"></div>
                        <div class="w-5/6 h-4 skeleton-pulse rounded-xs"></div>
                    </div>
                </div>
            `;

            contentBody.innerHTML = `
                ${formatParagraphs(originalSummary)}
                ${articleSkeletonHtml}
            `;

            fetchFullArticleContent(news.link).then(res => {
                if (res.success && res.content && res.content.length > originalSummary.length) {
                    news.description = res.content;
                    news.isFullContentLoaded = true;

                    contentBody.style.opacity = '0.3';
                    setTimeout(() => {
                        contentBody.innerHTML = formatParagraphs(res.content);
                        contentBody.style.opacity = '1';
                    }, 120);
                } else {
                    const skeleton = contentBody.querySelector('.article-skeleton-container');
                    if (skeleton) skeleton.remove();
                    news.isFullContentLoaded = true;
                }
            });
        }

        setTimeout(() => {
            tile.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 80);
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
        canSwipe: () => activeAppSection === 'news' && !isTileExpandedState,
        canRefresh: () => activeAppSection === 'news' && !isTileExpandedState,
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
