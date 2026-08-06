import { timeAgo, generateGeometricBackground, LocalDB } from './utils.js';
import { fetchNewsData, fetchImageData, fetchAISummary, fetchFullArticleContent } from './api.js';

const baseCats = [
    { id: 'local', name: '港聞' },
    { id: 'global', name: '國際' },
    { id: 'ent', name: '娛樂' }
];
const systemCats = [
    { id: 'gallery', name: '圖庫' }, 
    { id: 'bookmarks', name: '收藏' },
    { id: 'settings', name: '設定' }
];

let customCats = LocalDB.getCustomCategories();
let categories = [...baseCats, ...customCats, ...systemCats];

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
let enabledSources = LocalDB.getEnabledSources();

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

function initSourceCheckboxes() {
    const checkboxes = document.querySelectorAll('.source-checkbox');
    checkboxes.forEach(box => {
        box.checked = enabledSources.includes(box.value);
        box.addEventListener('change', () => {
            const checkedBoxes = Array.from(document.querySelectorAll('.source-checkbox:checked')).map(cb => cb.value);
            enabledSources = checkedBoxes;
            LocalDB.saveEnabledSources(enabledSources);
            if (categories[currentIndex].id !== 'gallery' && categories[currentIndex].id !== 'settings') {
                renderTiles(false);
            }
        });
    });
}

let wakeLock = null;
async function requestWakeLock() { if ('wakeLock' in navigator) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {} } }
async function releaseWakeLock() { if (wakeLock !== null) { await wakeLock.release(); wakeLock = null; } }
document.addEventListener('visibilitychange', async () => { if (wakeLock !== null && document.visibilityState === 'visible') { await requestWakeLock(); } });

setInterval(() => {
    if (!DOM.newsGrid || DOM.newsGrid.classList.contains('hidden') || currentNewsData.length === 0 || categories[currentIndex].id === 'gallery') return;
    const tiles = Array.from(DOM.newsGrid.querySelectorAll('.metro-tile:not(.expanded)'));
    if (tiles.length === 0) return;
    const randomTile = tiles[Math.floor(Math.random() * tiles.length)];
    randomTile.classList.add('live-tile-flip');
    setTimeout(() => { randomTile.classList.remove('live-tile-flip'); }, 1500); 
}, 3500); 

let currentScale = 1;
let posX = 0;
let posY = 0;
let startX = 0;
let startY = 0;
let isPanning = false;
let isPinching = false;
let initialDistance = 0;
let initialScale = 1;
let lastTapTime = 0;
let isLightboxOpen = false;

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
    }, 300);
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
    currentSearchQuery = ''; 
    DOM.backToTopBtn?.classList.add('hidden-fab'); 
    
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
    renderTiles(false);
    if (currentNewsData.length === 0 && DOM.newsGrid) {
        DOM.newsGrid.innerHTML = '<p class="text-gray-500 text-center mt-10">你的收藏夾空空如也，快去收藏新聞吧！</p>';
    }
}

function toggleBookmark(newsItem, btnElement) {
    if (savedBookmarks[newsItem.link]) {
        delete savedBookmarks[newsItem.link];
        btnElement.classList.remove('saved');
        btnElement.innerHTML = '☆ 收藏';
    } else {
        savedBookmarks[newsItem.link] = newsItem;
        btnElement.classList.add('saved');
        btnElement.innerHTML = '★ 已收藏';
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

async function loadGalleryUI(isAppendMode = false) {
    if (!isAppendMode && DOM.newsGrid) {
        DOM.newsGrid.innerHTML = '';
        DOM.loadingIndicator?.classList.remove('hidden');
    } else {
        DOM.scrollLoading?.classList.remove('hidden');
        isLoadingMore = true;
    }

    const result = await fetchImageData(currentSearchQuery, currentPage);

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
        const animationDelay = `style="animation-delay: ${(relativeIndex % 20) * 0.05}s"`;
        htmlContent += `
            <article class="metro-tile relative group cursor-pointer overflow-hidden bg-black/20 h-48 md:h-64" ${animationDelay}>
                <img src="${imgItem.thumbUrl}" data-full="${imgItem.imageUrl}" class="gallery-img w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" alt="Gallery Image" loading="lazy" referrerpolicy="no-referrer" />
                <div class="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <span class="text-[10px] text-white/80 uppercase tracking-widest leading-tight block truncate">${imgItem.tags}</span>
                </div>
            </article>
        `;
    });

    if (isAppendMode) DOM.newsGrid.insertAdjacentHTML('beforeend', htmlContent);
    else DOM.newsGrid.innerHTML = htmlContent;

    DOM.newsGrid.querySelectorAll('.gallery-img').forEach(img => {
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            openLightbox(e.target.getAttribute('data-full'));
        });
    });
}

async function loadNewsUI(categoryId, forceSync = false, isAppendMode = false) {
    if (categoryId !== 'search' && !isAppendMode && !forceSync && newsCache[categoryId] && currentPage === 0) {
        currentNewsData = newsCache[categoryId];
        renderTiles(false);
        return;
    }

    if (!isAppendMode && DOM.newsGrid) {
        DOM.newsGrid.innerHTML = '';
        DOM.loadingIndicator?.classList.remove('hidden');
    } else {
        DOM.scrollLoading?.classList.remove('hidden');
        isLoadingMore = true;
    }

    const result = await fetchNewsData(categoryId, currentPage, forceSync, currentSearchQuery);

    if (result.success && result.data.length > 0) {
        hasMoreNews = result.hasMore;
        currentNewsData = isAppendMode ? currentNewsData.concat(result.data) : result.data;
        if (currentPage === 0 && categoryId !== 'search') newsCache[categoryId] = currentNewsData;
        renderTiles(isAppendMode);
    } else {
        hasMoreNews = false;
        if (!isAppendMode && DOM.newsGrid) {
            DOM.newsGrid.innerHTML = categoryId === 'search' 
                ? `<p class="text-gray-500 text-center mt-10">資料庫中找不到符合「${currentSearchQuery}」的新聞，等背景更新後再來看看吧！</p>` 
                : '<p class="text-gray-500 text-center mt-10">目前沒有新聞資料。</p>';
        }
    }

    DOM.loadingIndicator?.classList.add('hidden');
    DOM.scrollLoading?.classList.add('hidden');
    isLoadingMore = false;
}

function renderTiles(isAppendMode = false) {
    if (!DOM.newsGrid) return;
    
    const filteredNewsData = currentNewsData.filter(item => enabledSources.includes(item.source));

    let htmlContent = '';
    const dataToRender = isAppendMode ? filteredNewsData.slice(currentPage * 20) : filteredNewsData;
    const offsetIndex = isAppendMode ? currentPage * 20 : 0;

    if (dataToRender.length === 0 && !isAppendMode) {
        DOM.newsGrid.innerHTML = '<p class="text-gray-500 text-center mt-10">請在「設定」中至少勾選一個新聞來源！</p>';
        return;
    }

    dataToRender.forEach((news, relativeIndex) => {
        const index = offsetIndex + relativeIndex;
        const animationDelay = `style="animation-delay: ${(relativeIndex % 20) * 0.05}s"`;
        const cleanDescription = (news.description || '暫無詳細內文。').replace(/\n/g, '</p><p>');
        const geoBackground = generateGeometricBackground();
        const isSaved = !!savedBookmarks[news.link];
        const isRead = !!readHistory[news.link]; 
        const titleColorClass = isRead ? 'text-gray-400' : 'text-white';

        let thumbHtml = news.imageUrl 
            ? `<div class="flex-shrink-0 ml-3"><img src="${news.imageUrl}" class="w-20 h-20 md:w-28 md:h-28 object-cover border-2 border-white/10 shadow-sm bg-black/20" alt="縮圖" loading="lazy" referrerpolicy="no-referrer" /></div>` 
            : '';

        let imagesHtml = '';
        if (news.images && news.images.length > 0) {
            let slidesHtml = news.images.map(imgUrl => `<img src="${imgUrl}" class="lightbox-img snap-center flex-shrink-0 w-full max-h-[50vh] object-contain block cursor-pointer active:opacity-70 transition-opacity" alt="新聞圖片" loading="lazy" referrerpolicy="no-referrer" />`).join('');
            
            let navButtons = news.images.length > 1 ? `
                <button onclick="event.stopPropagation(); this.parentElement.querySelector('.img-scroll-box').scrollBy({left: -window.innerWidth, behavior: 'smooth'})" class="absolute left-0 top-1/2 -translate-y-1/2 bg-black/60 text-white px-3 py-4 z-10 shadow-lg active:bg-white active:text-black transition-colors">❮</button>
                <button onclick="event.stopPropagation(); this.parentElement.querySelector('.img-scroll-box').scrollBy({left: window.innerWidth, behavior: 'smooth'})" class="absolute right-0 top-1/2 -translate-y-1/2 bg-black/60 text-white px-3 py-4 z-10 shadow-lg active:bg-white active:text-black transition-colors">❯</button>
                <div class="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-1 rounded tracking-widest z-10 shadow">${news.images.length} 圖</div>
            ` : '';
            
            imagesHtml = `<div class="relative my-4 w-full overflow-hidden group bg-black/30 shadow-md"><div class="img-scroll-box flex items-center overflow-x-auto snap-x snap-mandatory hide-scrollbar" style="scroll-behavior: smooth;">${slidesHtml}</div>${navButtons}</div>`;
        }

        htmlContent += `
            <article class="metro-tile ${currentThemeColor}" data-index="${index}" ${animationDelay}>
                ${geoBackground}
                <div class="tile-preview px-5 py-4 flex flex-row justify-between items-start">
                    <div class="flex flex-col justify-between h-full flex-grow pr-1">
                        <h3 class="news-title text-xl md:text-2xl font-bold leading-tight line-clamp-3 ${titleColorClass}">${news.title}</h3>
                        <div class="flex items-center space-x-2 mt-3">
                            <span class="text-xs opacity-90 uppercase font-semibold text-gray-200 border border-white/20 px-1.5 py-0.5 rounded">${news.source}</span>
                            <span class="text-xs opacity-70 uppercase tracking-widest truncate">${timeAgo(news.pubDate)}</span>
                            ${isSaved ? '<span class="text-xs text-yellow-400">★</span>' : ''}
                        </div>
                    </div>
                    ${thumbHtml}
                </div>
                <div class="tile-details">
                    <div class="tile-details-inner flex flex-col justify-between">
                        <div>
                            <div class="flex justify-between items-center mb-2 mt-2 px-5">
                                <span class="text-xs uppercase tracking-widest opacity-80 font-semibold">${news.source} · ${news.category || '即時新聞'}</span>
                                <div class="flex space-x-4">
                                    <button class="ai-btn text-xs uppercase tracking-widest font-bold text-fuchsia-400 hover:text-fuchsia-300 transition-colors" data-index="${index}">✨ AI 總結</button>
                                    <button class="share-btn text-xs uppercase tracking-widest font-bold opacity-70 hover:opacity-100 transition-colors" data-index="${index}">分享 ↗</button>
                                    <button class="bookmark-btn text-xs uppercase tracking-widest font-bold ${isSaved ? 'saved' : 'opacity-70'}" data-index="${index}">${isSaved ? '★ 已收藏' : '☆ 收藏'}</button>
                                </div>
                            </div>
                            <h3 class="text-2xl md:text-3xl font-light leading-tight mb-3 px-5">${news.title}</h3>
                            <p class="text-xs opacity-70 mb-2 px-5">${new Date(news.pubDate).toLocaleString()} (${timeAgo(news.pubDate)})</p>
                            
                            <div class="ai-box hidden mx-5 my-4 bg-fuchsia-900/30 border border-fuchsia-500/40 p-4 rounded-sm">
                                <div class="flex items-center space-x-2 mb-2">
                                    <span class="text-fuchsia-400 text-sm">✨</span>
                                    <span class="text-[10px] uppercase tracking-widest text-fuchsia-400 font-bold">Cloudflare Workers AI</span>
                                </div>
                                <p class="ai-summary-text text-sm font-light text-gray-200 leading-relaxed tracking-wide"></p>
                            </div>

                            ${imagesHtml}
                            <div class="article-content-body text-base md:text-lg font-light text-gray-100 leading-relaxed space-y-4 bg-black/30 px-5 py-6 mt-3 border border-white/5">
                                <p>${cleanDescription}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </article>
        `;
    });

    if (isAppendMode) DOM.newsGrid.insertAdjacentHTML('beforeend', htmlContent);
    else DOM.newsGrid.innerHTML = htmlContent;
    
    attachTileEvents(isAppendMode ? offsetIndex : 0);
}

function attachTileEvents(startIndex = 0) {
    if(!DOM.newsGrid) return;
    const tiles = Array.from(DOM.newsGrid.querySelectorAll('.metro-tile')).slice(startIndex);
    
    tiles.forEach((tile) => {
        const index = tile.getAttribute('data-index');
        const newsItem = currentNewsData[index];

        const bookmarkBtn = tile.querySelector('.bookmark-btn');
        if (bookmarkBtn) {
            bookmarkBtn.addEventListener('click', (e) => {
                e.stopPropagation(); 
                toggleBookmark(currentNewsData[index], bookmarkBtn);
            });
        }
        
        const shareBtn = tile.querySelector('.share-btn');
        if (shareBtn) {
            shareBtn.addEventListener('click', async (e) => {
                e.stopPropagation(); 
                const news = currentNewsData[index];
                if (navigator.share) {
                    try { await navigator.share({ title: news.title, text: '看看這則新聞！', url: news.link }); } catch (err) {}
                } else {
                    navigator.clipboard.writeText(news.link).then(() => { alert('已複製新聞連結！'); });
                }
            });
        }

        const aiBtn = tile.querySelector('.ai-btn');
        const aiBox = tile.querySelector('.ai-box');
        const aiText = tile.querySelector('.ai-summary-text');

        if (aiBtn && aiBox && aiText) {
            aiBtn.addEventListener('click', async (e) => {
                e.stopPropagation(); 
                if (!aiBox.classList.contains('hidden') && aiText.innerText !== '⚠️ 總結失敗，請稍後再試。') return; 

                aiBox.classList.remove('hidden');
                aiText.innerHTML = '<span class="animate-pulse">正在呼叫 Llama 3 引擎運算中...</span>';

                const news = currentNewsData[index];
                const cleanTextForAI = news.description.replace(/<[^>]*>?/gm, '').trim();

                const res = await fetchAISummary(cleanTextForAI);
                
                if (res.success) {
                    aiText.innerText = res.summary;
                } else {
                    aiText.innerText = '⚠️ 總結失敗，請稍後再試。';
                }
            });
        }

        tile.addEventListener('click', (e) => {
            if(e.target.tagName === 'BUTTON') return;
            if (e.target.classList.contains('lightbox-img')) {
                e.stopPropagation();
                openLightbox(e.target.src);
                return;
            }

            const isCurrentlyExpanded = tile.classList.contains('expanded');
            DOM.newsGrid.querySelectorAll('.metro-tile').forEach(t => t.classList.remove('expanded'));
            releaseWakeLock();
            
            if (!isCurrentlyExpanded) {
                const titleElement = tile.querySelector('.news-title');
                markAsRead(currentNewsData[index].link, titleElement);
                tile.classList.add('expanded');
                requestWakeLock();

                // ✨ 方案 2 核心：展開後才開始請求與處理全文！
                const news = currentNewsData[index];
                const contentBody = tile.querySelector('.article-content-body');

                if (news && !news.isFullContentLoaded && contentBody) {
                    const originalSummary = news.description;
                    
                    // 插入提示狀態與原本的撮要
                    contentBody.innerHTML = `
                        <p>${originalSummary.replace(/\n/g, '</p><p class="mt-4">')}</p>
                        <div class="full-text-loader border-t border-white/10 pt-4 mt-4 flex items-center space-x-2 text-blue-400 text-sm">
                            <span class="loader-small"></span>
                            <span class="animate-pulse">正在為您載入與處理完整文章...</span>
                        </div>
                    `;

                    // 發起全文請求
                    fetchFullArticleContent(news.link).then(res => {
                        if (res.success && res.content && res.content.length > originalSummary.length) {
                            news.description = res.content;
                            news.isFullContentLoaded = true;
                            contentBody.innerHTML = `<p>${res.content.replace(/\n/g, '</p><p class="mt-4">')}</p>`;
                        } else {
                            // 若無更多內容或抓取失敗，移除加載圖示，保留撮要
                            const loader = contentBody.querySelector('.full-text-loader');
                            if (loader) loader.remove();
                            news.isFullContentLoaded = true;
                        }
                    });
                }

                setTimeout(() => { tile.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200);
            }
        });

        let pressTimer = null;
        const startPress = () => {
            clearPress();
            pressTimer = setTimeout(() => { triggerLongPressAction(tile, currentNewsData[index].link); }, 600);
        };
        const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };

        tile.addEventListener('touchstart', startPress);
        tile.addEventListener('touchend', clearPress);
        tile.addEventListener('touchmove', clearPress);
        tile.addEventListener('mousedown', startPress);
        tile.addEventListener('mouseup', clearPress);
        tile.addEventListener('mouseleave', clearPress);
    });
}

function triggerLongPressAction(tile, link) {
    if (tile.querySelector('.long-press-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'long-press-overlay absolute inset-0 bg-black/80 z-20 flex flex-col items-center justify-center p-4 animate-fade-in';
    overlay.innerHTML = `
        <p class="text-xs uppercase tracking-widest text-gray-400 mb-3">快捷操作</p>
        <a href="${link}" target="_blank" onclick="event.stopPropagation()" class="bg-white text-black font-bold px-6 py-3 text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors shadow-lg">網頁檢視 ↗</a>
        <span class="text-[10px] text-gray-500 mt-4">點擊任意處關閉</span>
    `;
    overlay.addEventListener('click', (e) => { e.stopPropagation(); overlay.remove(); });
    tile.appendChild(overlay);
}

DOM.mainContainer?.addEventListener('scroll', () => {
    if (DOM.mainContainer.scrollTop > window.innerHeight * 1.5) {
        DOM.backToTopBtn?.classList.remove('hidden-fab');
    } else {
        DOM.backToTopBtn?.classList.add('hidden-fab');
    }

    if (categories[currentIndex].id !== 'settings' && categories[currentIndex].id !== 'bookmarks') {
        if (categories[currentIndex].isCustom && !currentSearchQuery) return;
        if (DOM.mainContainer.scrollTop + DOM.mainContainer.clientHeight >= DOM.mainContainer.scrollHeight - 150) {
            if (!isLoadingMore && hasMoreNews) {
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
});

DOM.backToTopBtn?.addEventListener('click', () => { DOM.mainContainer?.scrollTo({ top: 0, behavior: 'smooth' }); });

let touchStartX = 0, touchStartY = 0, touchEndX = 0, touchEndY = 0;
document.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; touchStartY = e.changedTouches[0].screenY; }, { passive: true });
document.addEventListener('touchend', e => { touchEndX = e.changedTouches[0].screenX; touchEndY = e.changedTouches[0].screenY; handleSwipe(); }, { passive: true });

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
    const list = document.getElementById('category-manager-list');
    if(!list) return;
    list.innerHTML = '';
    const customCategoriesOnly = categories.filter(cat => cat.isCustom);
    if (customCategoriesOnly.length === 0) {
        list.innerHTML = '<p class="text-gray-500 text-sm py-4">目前沒有自訂追蹤關鍵字。</p>';
        return;
    }
    customCategoriesOnly.forEach((cat) => {
        const realIndex = categories.findIndex(c => c.id === cat.id);
        const row = document.createElement('div');
        row.className = 'flex justify-between items-center bg-white/5 px-4 py-3 mb-2 rounded';
        row.innerHTML = `
            <span class="text-xl font-light text-gray-200">${cat.name} <span class="text-[10px] text-blue-300 ml-1">(追蹤)</span></span>
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
    if (currentIndex >= categories.length) currentIndex = categories.length - 1;
    renderPivot(); renderCategoryManager();
}

document.getElementById('btn-add-cat')?.addEventListener('click', () => {
    const input = document.getElementById('new-cat-input');
    const val = input.value.trim();
    if (val) {
        const newCat = { id: 'custom_' + Date.now(), name: val, isCustom: true, query: val };
        customCats.push(newCat); LocalDB.saveCustomCategories(customCats);
        categories = [...baseCats, ...customCats, ...systemCats];
        input.value = ''; renderPivot(); renderCategoryManager();
    }
});

const colorButtons = document.querySelectorAll('.color-btn');
colorButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        colorButtons.forEach(b => { b.classList.remove('border-white'); b.classList.add('border-transparent'); });
        e.target.classList.remove('border-transparent');
        e.target.classList.add('border-white');
        currentThemeColor = e.target.getAttribute('data-color');
        if (currentNewsData.length > 0 && categories[currentIndex].id !== 'gallery') renderTiles();
    });
});

let currentFontSizePercent = 110; 
function updateFontSize() {
    const display = document.getElementById('font-size-display');
    if(display) display.innerText = currentFontSizePercent + '%';
    document.documentElement.style.fontSize = (16 * (currentFontSizePercent / 100)) + 'px';
}
document.getElementById('btn-font-plus')?.addEventListener('click', () => { if (currentFontSizePercent < 150) { currentFontSizePercent += 10; updateFontSize(); } });
document.getElementById('btn-font-minus')?.addEventListener('click', () => { if (currentFontSizePercent > 70) { currentFontSizePercent -= 10; updateFontSize(); } });
document.getElementById('btn-font-reset')?.addEventListener('click', () => { currentFontSizePercent = 110; updateFontSize(); });

window.addEventListener('DOMContentLoaded', () => { 
    updateFontSize(); 
    initSourceCheckboxes(); 
    renderPivot(); 
    handlePageChange(); 
});
