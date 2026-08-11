import { timeAgo, generateGeometricBackground, LocalDB } from './utils.js';
import { fetchNewsData, fetchImageData, fetchAISummary, fetchFullArticleContent } from './api.js';

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
    'latest': '即時',
    'local': '港聞',
    'global': '國際',
    'ent': '娛樂',
    'sports': '體育',
    'china': '中國',
    'hot': '熱話',
    'life': '生活',
    'community': '社區',
    'tech': '科技',
    'video': '影像'
};

const systemCats = [
    { id: 'gallery', name: '圖庫' }, 
    { id: 'bookmarks', name: '收藏' },
    { id: 'settings', name: '設定' }
];

let visibleCatIds = LocalDB.getVisibleCategories();
let customCats = LocalDB.getCustomCategories();

function getActiveBaseCats() {
    return allBaseCats.filter(cat => visibleCatIds.includes(cat.id));
}

let categories = [...getActiveBaseCats(), ...customCats, ...systemCats];

let currentIndex = 0;
let currentNewsData = [];      
let newsCache = {}; 
let currentThemeColor = 'bg-blue-600'; 

let currentPage = 0;
let isLoadingMore = false;
let hasMoreNews = true;
let currentSearchQuery = ''; 

let savedBookmarks = LocalDB.getBookmarks();
let readHistory = LocalDB.getHistory();
let aiSummaryCache = LocalDB.getAISummaries();

const DOM = {
    newsGrid: document.getElementById('news-grid'),
    settingsView: document.getElementById('settings-view'),
    loadingIndicator: document.getElementById('loading-indicator'),
    scrollLoading: document.getElementById('scroll-loading'),
    navMenu: document.getElementById('nav-menu'),
    mainContainer: document.getElementById('main-container'),
    ptrIndicator: document.getElementById('ptr-indicator'),
    lightboxOverlay: document.getElementById('lightbox-overlay'),
    lightboxImg: document.getElementById('lightbox-img'),
    lightboxClose: document.getElementById('lightbox-close'),
    backToTopBtn: document.getElementById('back-to-top'),
    gallerySearchContainer: document.getElementById('gallery-search-container'),
    gallerySearchInput: document.getElementById('gallery-search-input')
};

DOM.gallerySearchInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        DOM.gallerySearchInput.blur();
        currentSearchQuery = DOM.gallerySearchInput.value.trim() || 'Japan travel';
        currentPage = 0;
        loadGalleryUI(false);
    }
});

let wakeLock = null;
let isTileExpandedState = false;

async function requestWakeLock() { 
    if ('wakeLock' in navigator && !wakeLock) { 
        try { wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {} 
    } 
}
async function releaseWakeLock() { 
    if (wakeLock !== null) { 
        try { await wakeLock.release(); } catch(e){}
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

let currentScale = 1, posX = 0, posY = 0, startX = 0, startY = 0;
let isPanning = false, isPinching = false, initialDistance = 0, initialScale = 1, lastTapTime = 0, isLightboxOpen = false;

function updateLightboxTransform() {
    if (DOM.lightboxImg) {
        DOM.lightboxImg.style.transform = `translate(${posX}px, ${posY}px) scale(${currentScale})`;
    }
}

function openLightbox(src) {
    if(!DOM.lightboxImg || !DOM.lightboxOverlay) return;
    DOM.lightboxImg.src = src;
    currentScale = 1; posX = 0; posY = 0;
    updateLightboxTransform();
    DOM.lightboxOverlay.classList.remove('hidden');
    setTimeout(() => DOM.lightboxOverlay.classList.remove('opacity-0'), 10);
    isLightboxOpen = true;
    history.pushState({ lightbox: true }, '');
}

function closeLightbox(fromHardwareBackBtn = false) {
    if(!DOM.lightboxOverlay || DOM.lightboxOverlay.classList.contains('hidden')) return;
    DOM.lightboxOverlay.classList.add('opacity-0');
    setTimeout(() => {
        DOM.lightboxOverlay.classList.add('hidden');
        if(DOM.lightboxImg) DOM.lightboxImg.src = '';
    }, 200);
    isLightboxOpen = false;
    if (!fromHardwareBackBtn) history.back(); 
}

window.addEventListener('popstate', () => { if (isLightboxOpen) closeLightbox(true); });
DOM.lightboxClose?.addEventListener('click', () => closeLightbox(false));
DOM.lightboxOverlay?.addEventListener('click', (e) => { if (e.target === DOM.lightboxOverlay) closeLightbox(false); });

DOM.lightboxImg?.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
        isPanning = true; startX = e.touches[0].clientX - posX; startY = e.touches[0].clientY - posY;
    } else if (e.touches.length === 2) {
        isPanning = false; isPinching = true;
        initialDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        initialScale = currentScale;
    }
}, { passive: false });

DOM.lightboxImg?.addEventListener('touchmove', (e) => {
    e.preventDefault(); 
    if (isPinching && e.touches.length === 2) {
        const currentDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const newScale = Math.min(Math.max(1, initialScale * (currentDistance / initialDistance)), 5);
        const clientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const clientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = DOM.lightboxImg.getBoundingClientRect();
        const dx = clientX - (rect.left + rect.width / 2);
        const dy = clientY - (rect.top + rect.height / 2);
        const scaleRatio = newScale / currentScale;
        posX -= dx * (scaleRatio - 1); posY -= dy * (scaleRatio - 1);
        currentScale = newScale;
        updateLightboxTransform();
    } else if (isPanning && e.touches.length === 1 && currentScale > 1) {
        posX = e.touches[0].clientX - startX; posY = e.touches[0].clientY - startY;
        updateLightboxTransform();
    }
}, { passive: false });

DOM.lightboxImg?.addEventListener('touchend', (e) => {
    isPanning = false; isPinching = false;
    const currentTime = new Date().getTime();
    if (currentTime - lastTapTime < 300 && currentTime - lastTapTime > 0 && e.touches.length === 0) {
        currentScale = 1; posX = 0; posY = 0;
        updateLightboxTransform();
    }
    lastTapTime = currentTime;
});

function renderPivot() {
    if(!DOM.navMenu) return;
    DOM.navMenu.innerHTML = '';
    categories.forEach((cat, index) => {
        const a = document.createElement('a');
        a.className = `nav-link ${index === currentIndex ? 'active' : ''}`;
        a.innerText = cat.name;
        a.addEventListener('click', () => {
            currentIndex = index;
            handlePageChange();
        });
        DOM.navMenu.appendChild(a);
    });
    const activeLink = DOM.navMenu.children[currentIndex];
    if (activeLink) DOM.navMenu.scrollTo({ left: activeLink.offsetLeft - 16, behavior: 'smooth' });
}

function handlePageChange() {
    renderPivot();
    const currentCat = categories[currentIndex];
    if(DOM.mainContainer) DOM.mainContainer.scrollTop = 0; 
    currentPage = 0; 
    hasMoreNews = true;
    isLoadingMore = false;
    currentSearchQuery = ''; 
    DOM.backToTopBtn?.classList.add('hidden-fab'); 
    
    isTileExpandedState = false;
    releaseWakeLock();
    
    DOM.gallerySearchContainer?.classList.add('hidden');
    if(DOM.newsGrid) DOM.newsGrid.className = 'grid grid-cols-1 gap-[2px] auto-rows-auto';

    if (currentCat.id === 'settings') {
        DOM.newsGrid?.classList.add('hidden');
        DOM.settingsView?.classList.remove('hidden');
        DOM.settingsView?.classList.add('flex');
        renderCategoryManager();
    } else if (currentCat.id === 'bookmarks') {
        DOM.settingsView?.classList.add('hidden');
        DOM.settingsView?.classList.remove('flex');
        DOM.newsGrid?.classList.remove('hidden');
        renderBookmarksUI();
    } else if (currentCat.id === 'gallery') {
        DOM.settingsView?.classList.add('hidden');
        DOM.settingsView?.classList.remove('flex');
        DOM.newsGrid?.classList.remove('hidden');
        DOM.gallerySearchContainer?.classList.remove('hidden');
        if(DOM.newsGrid) DOM.newsGrid.className = 'grid grid-cols-2 md:grid-cols-3 gap-[2px] auto-rows-auto px-5'; 
        
        currentSearchQuery = DOM.gallerySearchInput?.value.trim() || 'Japan travel';
        loadGalleryUI(false);
    } else if (currentCat.isCustom) {
        DOM.settingsView?.classList.add('hidden');
        DOM.settingsView?.classList.remove('flex');
        DOM.newsGrid?.classList.remove('hidden');
        currentSearchQuery = currentCat.query; 
        loadNewsUI('search', false, false); 
    } else {
        DOM.settingsView?.classList.add('hidden');
        DOM.settingsView?.classList.remove('flex');
        DOM.newsGrid?.classList.remove('hidden');
        loadNewsUI(currentCat.id, false, false); 
    }
}

function renderBookmarksUI() {
    const bookmarksArray = Object.values(savedBookmarks);
    bookmarksArray.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    currentNewsData = bookmarksArray;
    hasMoreNews = false; 
    renderTiles(currentNewsData, false);
    if (currentNewsData.length === 0 && DOM.newsGrid) {
        DOM.newsGrid.innerHTML = '<p class="text-gray-500 text-center mt-10">你的收藏夾空空如也，快去收藏新聞吧！</p>';
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
    if (categories[currentIndex].id === 'bookmarks') renderBookmarksUI();
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

/* ✨ 全新全寬頂欄 + 全黑主體 骨架屏 */
function renderSkeletonTiles(count = 6) {
    if (!DOM.newsGrid) return;
    let skeletonHtml = '';
    for (let i = 0; i < count; i++) {
        skeletonHtml += `
            <div class="metro-tile bg-black border-b border-white/10 flex flex-col pointer-events-none opacity-100">
                <div class="w-full bg-white/10 px-5 py-2 flex justify-between items-center">
                    <div class="w-12 h-3.5 skeleton-pulse rounded-xs"></div>
                    <div class="w-16 h-3.5 skeleton-pulse rounded-xs"></div>
                </div>
                <div class="bg-black px-5 py-4 flex flex-row items-center justify-between min-h-[105px]">
                    <div class="flex-grow pr-3 space-y-2">
                        <div class="w-full h-5 skeleton-pulse rounded-xs"></div>
                        <div class="w-4/5 h-5 skeleton-pulse rounded-xs"></div>
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
    let skeletonHtml = '';
    for (let i = 0; i < count; i++) {
        skeletonHtml += `
            <div class="bottom-skeleton-item metro-tile bg-black border-b border-white/10 flex flex-col pointer-events-none opacity-100">
                <div class="w-full bg-white/10 px-5 py-2 flex justify-between items-center">
                    <div class="w-12 h-3.5 skeleton-pulse rounded-xs"></div>
                    <div class="w-16 h-3.5 skeleton-pulse rounded-xs"></div>
                </div>
                <div class="bg-black px-5 py-4 flex flex-row items-center justify-between min-h-[105px]">
                    <div class="flex-grow pr-3 space-y-2">
                        <div class="w-full h-5 skeleton-pulse rounded-xs"></div>
                        <div class="w-3/4 h-5 skeleton-pulse rounded-xs"></div>
                    </div>
                    <div class="w-20 h-20 skeleton-pulse flex-shrink-0 ml-2 rounded-xs"></div>
                </div>
            </div>
        `;
    }
    DOM.newsGrid.insertAdjacentHTML('beforeend', skeletonHtml);
}

function removeBottomSkeletons() {
    if (!DOM.newsGrid) return;
    DOM.newsGrid.querySelectorAll('.bottom-skeleton-item').forEach(el => el.remove());
}

function renderGallerySkeletonTiles(count = 6) {
    if (!DOM.newsGrid) return;
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
    if (!isAppendMode && DOM.newsGrid) {
        renderGallerySkeletonTiles(6);
    } else {
        isLoadingMore = true;
        appendBottomSkeletons(2);
    }

    const result = await fetchImageData(currentSearchQuery, currentPage);

    if (isAppendMode) removeBottomSkeletons();

    if (result.success && result.data.length > 0) {
        hasMoreNews = result.hasMore;
        currentNewsData = isAppendMode ? currentNewsData.concat(result.data) : result.data;
        renderGalleryTiles(isAppendMode);
    } else {
        hasMoreNews = false;
        if (!isAppendMode && DOM.newsGrid) {
            const errorMsg = result.error ? `錯誤: ${result.error}` : '找不到相關圖片，換個關鍵字試試看吧！';
            DOM.newsGrid.innerHTML = `<p class="text-gray-500 text-center mt-10 col-span-2">${errorMsg}</p>`;
        }
    }

    DOM.loadingIndicator?.classList.add('hidden');
    DOM.scrollLoading?.classList.add('hidden');
    isLoadingMore = false;
}

function renderGalleryTiles(isAppendMode = false) {
    if (!DOM.newsGrid) return;
    let htmlContent = '';
    const dataToRender = isAppendMode ? currentNewsData.slice(currentPage * 20) : currentNewsData;

    dataToRender.forEach((imgItem, relativeIndex) => {
        const animationDelay = `style="animation-delay: ${(relativeIndex % 20) * 0.03}s"`;
        htmlContent += `
            <article class="metro-tile relative group cursor-pointer overflow-hidden bg-black/20 h-48 md:h-64" ${animationDelay}>
                <img src="${imgItem.thumbUrl}" data-full="${imgItem.imageUrl}" class="gallery-img w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" alt="Gallery Image" loading="lazy" referrerpolicy="no-referrer" />
                <div class="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <span class="text-[10px] text-white/80 uppercase tracking-widest leading-tight block truncate">${imgItem.tags}</span>
                </div>
            </article>
        `;
    });

    if (isAppendMode) DOM.newsGrid.insertAdjacentHTML('beforeend', htmlContent);
    else DOM.newsGrid.innerHTML = htmlContent;
}

async function loadNewsUI(categoryId, forceSync = false, isAppendMode = false) {
    if (categoryId !== 'search' && !isAppendMode && !forceSync && newsCache[categoryId] && currentPage === 0) {
        currentNewsData = newsCache[categoryId];
        renderTiles(currentNewsData, false);
        return;
    }

    if (!isAppendMode && DOM.newsGrid) {
        renderSkeletonTiles(6);
    } else {
        isLoadingMore = true;
        appendBottomSkeletons(3);
    }

    const result = await fetchNewsData(categoryId, currentPage, forceSync, currentSearchQuery);

    if (isAppendMode) removeBottomSkeletons();

    if (result.success && result.data.length > 0) {
        hasMoreNews = result.hasMore;
        const newBatch = result.data;

        if (isAppendMode) {
            const startIndex = currentNewsData.length;
            currentNewsData = currentNewsData.concat(newBatch);
            renderTiles(newBatch, true, startIndex);
        } else {
            currentNewsData = newBatch;
            if (currentPage === 0 && categoryId !== 'search') newsCache[categoryId] = currentNewsData;
            renderTiles(currentNewsData, false);
        }
    } else {
        hasMoreNews = false;
        if (!isAppendMode && DOM.newsGrid) {
            DOM.newsGrid.innerHTML = categoryId === 'search' 
                ? `<p class="text-gray-500 text-center mt-10">資料庫中找不到符合「${currentSearchQuery}」的新聞，請嘗試其他關鍵字！</p>` 
                : '<p class="text-gray-500 text-center mt-10">目前沒有新聞資料。</p>';
        }
    }

    DOM.loadingIndicator?.classList.add('hidden');
    DOM.scrollLoading?.classList.add('hidden');
    isLoadingMore = false;
}

function formatParagraphs(text) {
    if (!text) return '';
    return text
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => `<p class="mb-4">${p}</p>`)
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

/* ✨ 重點精修：全寬強調色頂欄 + 全黑置中內容區域 */
function renderTiles(articlesToRender, isAppendMode = false, startIndex = 0) {
    if (!DOM.newsGrid) return;

    if (articlesToRender.length === 0 && !isAppendMode) {
        DOM.newsGrid.innerHTML = '<p class="text-gray-500 text-center mt-10">目前沒有新聞！</p>';
        return;
    }

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

        let thumbHtml = news.imageUrl 
            ? `<div class="flex-shrink-0 ml-3"><img src="${news.imageUrl}" class="w-20 h-20 md:w-24 md:h-24 object-cover border border-white/10 shadow-sm bg-black/40" alt="縮圖" loading="lazy" referrerpolicy="no-referrer" /></div>` 
            : '';

        let imagesHtml = '';
        if (news.images && news.images.length > 0) {
            let slidesHtml = news.images.map(imgUrl => `<img src="${imgUrl}" class="lightbox-img snap-center flex-shrink-0 w-full h-full object-cover block cursor-pointer active:opacity-70 transition-opacity" alt="新聞圖片" loading="lazy" referrerpolicy="no-referrer" />`).join('');
            
            let navButtons = news.images.length > 1 ? `
                <button class="btn-prev-img absolute left-0 top-1/2 -translate-y-1/2 bg-black/70 text-white px-2 py-2 text-xs z-10 active:bg-white active:text-black">❮</button>
                <button class="btn-next-img absolute right-0 top-1/2 -translate-y-1/2 bg-black/70 text-white px-2 py-2 text-xs z-10 active:bg-white active:text-black">❯</button>
                <div class="absolute bottom-1 right-1 bg-black/80 text-white text-[9px] px-1.5 py-0.5 rounded tracking-widest z-10">${news.images.length} 圖</div>
            ` : '';
            
            imagesHtml = `
                <div class="img-container relative w-full h-52 md:h-64 flex-shrink-0 overflow-hidden bg-black/40 border border-white/10 rounded-xs shadow-md transition-all duration-200">
                    <div class="img-scroll-box flex items-center h-full overflow-x-auto snap-x snap-mandatory hide-scrollbar" style="scroll-behavior: smooth;">${slidesHtml}</div>
                    ${navButtons}
                </div>
            `;
        }

        htmlContent += `
            <article class="metro-tile bg-black border-b border-white/10" data-index="${index}" ${animationDelay}>
                <div class="tile-preview flex flex-col w-full">
                    <!-- 全寬強調色頂欄：類別在左，更新時間在右 -->
                    <div class="tile-header w-full ${currentThemeColor} px-5 py-2 flex items-center justify-between shadow-sm">
                        <div class="flex items-center space-x-2">
                            <span class="text-xs font-bold tracking-wider text-white uppercase">${catName}</span>
                            ${hasCachedAI ? '<span class="text-[10px] bg-black/30 text-fuchsia-200 px-1.5 py-0.5 rounded font-bold">✨ AI 摘要</span>' : ''}
                        </div>
                        <div class="flex items-center space-x-2">
                            <span class="text-xs text-white/90 font-medium tracking-wide">${timeAgo(news.pubDate)}</span>
                            ${isSaved ? '<span class="text-xs text-yellow-300">★</span>' : ''}
                        </div>
                    </div>
                    
                    <!-- 全黑背景主體區域：標題與縮圖置中對齊 -->
                    <div class="tile-body bg-black px-5 py-4 flex flex-row items-center justify-between min-h-[95px]">
                        <div class="flex-grow pr-2 flex flex-col justify-center">
                            <h3 class="news-title text-lg md:text-xl font-bold leading-snug line-clamp-3 ${titleColorClass}">${news.title}</h3>
                        </div>
                        ${thumbHtml}
                    </div>
                </div>

                <!-- 展開詳情區域 -->
                <div class="tile-details bg-black">
                    <div class="tile-details-inner flex flex-col justify-between">
                        <div>
                            <div class="flex justify-between items-center mb-2 mt-2 px-5">
                                <span class="${currentThemeColor} text-white text-[10px] px-2.5 py-1 rounded-xs font-bold tracking-wider uppercase border border-white/10">${catName}</span>
                                <div class="flex space-x-4">
                                    <button class="ai-btn text-xs uppercase tracking-widest font-bold text-fuchsia-400 hover:text-fuchsia-300 transition-colors">✨ AI 總結</button>
                                    <button class="share-btn text-xs uppercase tracking-widest font-bold opacity-70 hover:opacity-100 transition-colors">分享 ↗</button>
                                    <button class="bookmark-btn text-xs uppercase tracking-widest font-bold ${isSaved ? 'saved' : 'opacity-70'}">${isSaved ? '★ 已收藏' : '☆ 收藏'}</button>
                                </div>
                            </div>
                            <h3 class="text-2xl md:text-3xl font-light leading-tight mb-2 px-5 mt-2">${news.title}</h3>
                            <p class="text-xs opacity-70 mb-4 px-5">${new Date(news.pubDate).toLocaleString()} (${timeAgo(news.pubDate)})</p>
                            
                            <div class="media-ai-wrapper px-5 mb-4 flex flex-row gap-3 items-start">
                                ${imagesHtml}
                                <div class="ai-box hidden w-full flex-shrink-0 transition-all duration-200 bg-fuchsia-900/30 border border-fuchsia-500/40 p-3 rounded-xs flex flex-col justify-start min-h-[192px] md:min-h-[224px]">
                                    <div class="flex items-center space-x-1.5 mb-2 flex-shrink-0">
                                        <span class="text-fuchsia-400 text-xs">✨</span>
                                        <span class="text-[10px] uppercase tracking-widest text-fuchsia-400 font-bold">Workers AI 摘要</span>
                                    </div>
                                    <p class="ai-summary-text text-xs md:text-sm font-light text-gray-200 leading-relaxed tracking-wide min-h-0 flex-1 overflow-y-auto hide-scrollbar pr-1 pb-2"></p>
                                </div>
                            </div>

                            <div class="article-content-body text-base md:text-lg font-light text-gray-100 leading-relaxed bg-black/50 px-5 py-6 border-t border-white/10">
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

// 🚀 全站事件委派 (Event Delegation) 系統
DOM.newsGrid?.addEventListener('click', async (e) => {
    const target = e.target;

    // 1. 圖片燈箱觸發
    if (target.classList.contains('lightbox-img') || target.classList.contains('gallery-img')) {
        e.stopPropagation();
        const fullSrc = target.getAttribute('data-full') || target.src;
        if (fullSrc) openLightbox(fullSrc);
        return;
    }

    // 2. 輪播上一張 / 下一張按鈕
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

    // 3. AI 總結按鈕
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
        if (aiBox && aiText && !aiBox.classList.contains('hidden') && aiText.innerText !== '⚠️ 總結失敗，請稍後再試。') return;

        showAISummaryInTile(tile, '');
        if (aiText) aiText.innerHTML = '<span class="animate-pulse">正在呼叫 Llama 3 引擎運算中...</span>';

        const cleanTextForAI = news.description.replace(/<[^>]*>?/gm, '').trim();
        const res = await fetchAISummary(cleanTextForAI);

        if (res.success) {
            if (aiText) aiText.innerText = res.summary;
            aiSummaryCache[news.link] = res.summary;
            LocalDB.saveAISummary(news.link, res.summary);
        } else {
            if (aiText) aiText.innerText = '⚠️ 總結失敗，請稍後再試。';
        }
        return;
    }

    // 4. 收藏按鈕
    const bookmarkBtn = target.closest('.bookmark-btn');
    if (bookmarkBtn) {
        e.stopPropagation();
        const tile = bookmarkBtn.closest('.metro-tile');
        const index = parseInt(tile.getAttribute('data-index'));
        if (currentNewsData[index]) toggleBookmark(currentNewsData[index], bookmarkBtn);
        return;
    }

    // 5. 分享按鈕
    const shareBtn = target.closest('.share-btn');
    if (shareBtn) {
        e.stopPropagation();
        const tile = shareBtn.closest('.metro-tile');
        const index = parseInt(tile.getAttribute('data-index'));
        const news = currentNewsData[index];
        if (news) {
            if (navigator.share) {
                try { await navigator.share({ title: news.title, text: '看看這則新聞！', url: news.link }); } catch (err) {}
            } else {
                navigator.clipboard.writeText(news.link).then(() => { alert('已複製新聞連結！'); });
            }
        }
        return;
    }

    // 6. 磚塊 (Tile) 展開 / 收起觸發
    const tile = target.closest('.metro-tile');
    if (tile && !target.closest('button')) {
        const index = parseInt(tile.getAttribute('data-index'));
        const news = currentNewsData[index];
        const isCurrentlyExpanded = tile.classList.contains('expanded');
        
        releaseWakeLock();

        if (isCurrentlyExpanded) {
            tile.classList.remove('expanded');
            isTileExpandedState = false;
        } else {
            DOM.newsGrid.querySelectorAll('.metro-tile.expanded').forEach(t => t.classList.remove('expanded'));

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
                        <div class="flex items-center space-x-2 text-blue-400 text-xs mb-4">
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

            setTimeout(() => { tile.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 80);
        }
    }
});

DOM.mainContainer?.addEventListener('scroll', () => {
    if (DOM.mainContainer.scrollTop > window.innerHeight * 1.5) {
        DOM.backToTopBtn?.classList.remove('hidden-fab');
    } else {
        DOM.backToTopBtn?.classList.add('hidden-fab');
    }

    if (categories[currentIndex].id !== 'settings' && categories[currentIndex].id !== 'bookmarks') {
        if (categories[currentIndex].isCustom && !currentSearchQuery) return;
        if (DOM.mainContainer.scrollTop + DOM.mainContainer.clientHeight >= DOM.mainContainer.scrollHeight - 180) {
            if (!isLoadingMore && hasMoreNews) {
                isLoadingMore = true;
                currentPage++;
                if (categories[currentIndex].id === 'gallery') {
                    loadGalleryUI(true);
                } else {
                    const isCustom = categories[currentIndex].isCustom;
                    const catId = isCustom ? 'search' : categories[currentIndex].id;
                    loadNewsUI(catId, false, true);
                }
            }
        }
    }
}, { passive: true });

DOM.backToTopBtn?.addEventListener('click', () => { DOM.mainContainer?.scrollTo({ top: 0, behavior: 'smooth' }); });

let touchStartX = 0, touchStartY = 0, touchEndX = 0, touchEndY = 0;
document.addEventListener('touchstart', e => { 
    touchStartX = e.changedTouches[0].screenX; 
    touchStartY = e.changedTouches[0].screenY; 
}, { passive: true });

document.addEventListener('touchend', e => { 
    if (e.target.closest('#nav-menu, .img-scroll-box, #lightbox-overlay, input, #category-visibility-list')) return;
    
    touchEndX = e.changedTouches[0].screenX; 
    touchEndY = e.changedTouches[0].screenY; 
    handleSwipe(); 
}, { passive: true });

function handleSwipe() {
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 60) {
        if (deltaX > 0) currentIndex = (currentIndex - 1 + categories.length) % categories.length;
        else currentIndex = (currentIndex + 1) % categories.length;
        handlePageChange();
    }
}

let ptrStartY = 0, ptrCurrentY = 0, isPulling = false;
DOM.mainContainer?.addEventListener('touchstart', e => {
    if (DOM.mainContainer.scrollTop === 0) { ptrStartY = e.touches[0].clientY; isPulling = true; }
}, { passive: true });

DOM.mainContainer?.addEventListener('touchmove', e => {
    if (!isPulling) return;
    ptrCurrentY = e.touches[0].clientY;
    const pullDist = ptrCurrentY - ptrStartY;
    if (pullDist > 0 && pullDist < 120 && DOM.ptrIndicator) {
        DOM.ptrIndicator.style.height = `${pullDist}px`;
        DOM.ptrIndicator.innerHTML = `<div class="loader-small" style="opacity: ${pullDist / 80};"></div>`;
    }
}, { passive: true });

DOM.mainContainer?.addEventListener('touchend', async () => {
    if (!isPulling) return;
    isPulling = false;
    if (ptrCurrentY - ptrStartY > 65) {
        if(DOM.ptrIndicator) DOM.ptrIndicator.style.height = '45px';
        const currentCat = categories[currentIndex];
        if (currentCat.id !== 'settings' && currentCat.id !== 'bookmarks') {
            currentPage = 0;
            if (currentCat.id === 'gallery') {
                await loadGalleryUI(false);
            } else if (currentCat.isCustom) {
                await loadNewsUI('search', false, false);
            } else {
                await loadNewsUI(currentCat.id, true, false); 
            }
        }
    }
    if(DOM.ptrIndicator) { DOM.ptrIndicator.style.height = '0px'; DOM.ptrIndicator.innerHTML = ''; }
    ptrStartY = 0; ptrCurrentY = 0;
}, { passive: true });

function renderCategoryManager() {
    const visibilityList = document.getElementById('category-visibility-list');
    if (visibilityList) {
        visibilityList.innerHTML = '';
        allBaseCats.forEach((cat) => {
            const isVisible = visibleCatIds.includes(cat.id);
            const label = document.createElement('label');
            label.className = 'flex items-center justify-between bg-white/5 hover:bg-white/10 px-4 py-3 rounded cursor-pointer transition-colors border border-white/5';
            label.innerHTML = `
                <span class="text-base font-light text-gray-200">${cat.name}</span>
                <input type="checkbox" class="w-5 h-5 accent-blue-600 cursor-pointer" ${isVisible ? 'checked' : ''} data-id="${cat.id}">
            `;
            label.querySelector('input').addEventListener('change', (e) => {
                const targetId = e.target.getAttribute('data-id');
                if (e.target.checked) {
                    if (!visibleCatIds.includes(targetId)) visibleCatIds.push(targetId);
                } else {
                    if (visibleCatIds.length <= 1) {
                        alert('至少需保留一個板塊顯示！');
                        e.target.checked = true;
                        return;
                    }
                    visibleCatIds = visibleCatIds.filter(id => id !== targetId);
                }
                LocalDB.saveVisibleCategories(visibleCatIds);
                categories = [...getActiveBaseCats(), ...customCats, ...systemCats];
                if (currentIndex >= categories.length) currentIndex = 0;
                renderPivot();
            });
            visibilityList.appendChild(label);
        });
    }

    const list = document.getElementById('category-manager-list');
    if(!list) return;
    list.innerHTML = '';
    const customCategoriesOnly = categories.filter(cat => cat.isCustom);
    if (customCategoriesOnly.length === 0) {
        list.innerHTML = '<p class="text-gray-500 text-sm py-2">目前沒有自訂追蹤關鍵字。</p>';
        return;
    }
    customCategoriesOnly.forEach((cat) => {
        const realIndex = categories.findIndex(c => c.id === cat.id);
        const row = document.createElement('div');
        row.className = 'flex justify-between items-center bg-white/5 px-4 py-3 mb-2 rounded border border-white/5';
        row.innerHTML = `
            <span class="text-base font-light text-gray-200">${cat.name} <span class="text-[10px] text-blue-300 ml-1">(關鍵字)</span></span>
            <button class="text-xs uppercase tracking-widest text-red-400 hover:text-red-300 px-3 py-1 border border-red-400/30 rounded" onclick="deleteCategory(${realIndex})">刪除</button>
        `;
        list.appendChild(row);
    });
}

window.deleteCategory = function(index) {
    const target = categories[index];
    if (!target.isCustom) return alert('系統預設板塊無法刪除！');
    if (target.isCustom) { customCats = customCats.filter(c => c.id !== target.id); LocalDB.saveCustomCategories(customCats); }
    categories.splice(index, 1);
    if (currentIndex >= categories.length) currentIndex = 0;
    handlePageChange();
}

document.getElementById('btn-add-cat')?.addEventListener('click', () => {
    const input = document.getElementById('new-cat-input');
    const val = input ? input.value.trim() : '';
    if (val) {
        const newCat = { id: 'custom_' + Date.now(), name: val, isCustom: true, query: val };
        customCats.push(newCat); LocalDB.saveCustomCategories(customCats);
        categories = [...getActiveBaseCats(), ...customCats, ...systemCats];
        if (input) input.value = ''; 
        renderPivot(); 
        renderCategoryManager();
    }
});

const colorButtons = document.querySelectorAll('.color-btn');
colorButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        colorButtons.forEach(b => { b.classList.remove('border-white'); b.classList.add('border-transparent'); });
        e.target.classList.remove('border-transparent');
        e.target.classList.add('border-white');
        currentThemeColor = e.target.getAttribute('data-color');
        if (currentNewsData.length > 0 && categories[currentIndex].id !== 'gallery') renderTiles(currentNewsData, false);
    });
});

let currentFontSizePercent = parseInt(localStorage.getItem('metro_font_size')) || 110; 
function updateFontSize() {
    const display = document.getElementById('font-size-display');
    if(display) display.innerText = currentFontSizePercent + '%';
    document.documentElement.style.fontSize = (16 * (currentFontSizePercent / 100)) + 'px';
    localStorage.setItem('metro_font_size', currentFontSizePercent);
}
document.getElementById('btn-font-minus')?.addEventListener('click', () => { if (currentFontSizePercent < 150) { currentFontSizePercent += 10; updateFontSize(); } });
document.getElementById('btn-font-plus')?.addEventListener('click', () => { if (currentFontSizePercent > 70) { currentFontSizePercent -= 10; updateFontSize(); } });
document.getElementById('btn-font-reset')?.addEventListener('click', () => { currentFontSizePercent = 110; updateFontSize(); });

window.addEventListener('DOMContentLoaded', () => { 
    updateFontSize(); 
    renderPivot(); 
    handlePageChange(); 
});
