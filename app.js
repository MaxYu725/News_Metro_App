import { timeAgo, generateGeometricBackground, LocalDB } from './utils.js';
import { fetchNewsData } from './api.js';

let categories = [
    { id: 'local', name: '港聞' },
    { id: 'global', name: '國際' },
    { id: 'ent', name: '娛樂' },
    { id: 'search', name: '搜尋' },
    { id: 'bookmarks', name: '收藏' },
    { id: 'settings', name: '設定' }
];

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

const DOM = {
    newsGrid: document.getElementById('news-grid'),
    settingsView: document.getElementById('settings-view'),
    loadingIndicator: document.getElementById('loading-indicator'),
    scrollLoading: document.getElementById('scroll-loading'),
    navMenu: document.getElementById('nav-menu'),
    mainContainer: document.getElementById('main-container'),
    ptrIndicator: document.getElementById('ptr-indicator'),
    searchBarContainer: document.getElementById('search-bar-container'),
    searchInput: document.getElementById('search-input'),
    searchBtn: document.getElementById('search-btn')
};

// 搜尋事件綁定
DOM.searchBtn.addEventListener('click', executeSearch);
DOM.searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        DOM.searchInput.blur();
        executeSearch();
    }
});

function executeSearch() {
    const query = DOM.searchInput.value.trim();
    if (!query) return;
    currentSearchQuery = query;
    currentPage = 0;
    loadNewsUI('search', false, false);
}

function renderPivot() {
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
    DOM.mainContainer.scrollTop = 0; 
    currentPage = 0; 
    hasMoreNews = true;
    currentSearchQuery = ''; 
    
    if (currentCat.id === 'settings') {
        DOM.searchBarContainer.classList.add('hidden');
        DOM.newsGrid.classList.add('hidden');
        DOM.settingsView.classList.remove('hidden');
        DOM.settingsView.classList.add('flex');
        renderCategoryManager();
    } else if (currentCat.id === 'bookmarks') {
        DOM.searchBarContainer.classList.add('hidden');
        DOM.settingsView.classList.add('hidden');
        DOM.settingsView.classList.remove('flex');
        DOM.newsGrid.classList.remove('hidden');
        renderBookmarksUI();
    } else if (currentCat.id === 'search') {
        DOM.settingsView.classList.add('hidden');
        DOM.settingsView.classList.remove('flex');
        DOM.searchBarContainer.classList.remove('hidden');
        DOM.newsGrid.classList.remove('hidden');
        DOM.newsGrid.innerHTML = '<p class="text-gray-500 text-center mt-10">請在上方輸入關鍵字，找尋過去的新聞軌跡。</p>';
        currentNewsData = [];
        DOM.searchInput.value = '';
    } else {
        DOM.searchBarContainer.classList.add('hidden');
        DOM.settingsView.classList.add('hidden');
        DOM.settingsView.classList.remove('flex');
        DOM.newsGrid.classList.remove('hidden');
        loadNewsUI(currentCat.id, false, false); 
    }
}

function renderBookmarksUI() {
    const bookmarksArray = Object.values(savedBookmarks);
    bookmarksArray.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    currentNewsData = bookmarksArray;
    hasMoreNews = false; 
    renderTiles(false);
    if (currentNewsData.length === 0) {
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

async function loadNewsUI(categoryId, forceSync = false, isAppendMode = false) {
    if (categoryId !== 'search' && !isAppendMode && !forceSync && newsCache[categoryId] && currentPage === 0) {
        currentNewsData = newsCache[categoryId];
        renderTiles(false);
        return;
    }

    if (!isAppendMode) {
        DOM.newsGrid.innerHTML = '';
        DOM.loadingIndicator.classList.remove('hidden');
    } else {
        DOM.scrollLoading.classList.remove('hidden');
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
        if (!isAppendMode) {
            DOM.newsGrid.innerHTML = categoryId === 'search' 
                ? '<p class="text-gray-500 text-center mt-10">資料庫中找不到符合此關鍵字的新聞。</p>' 
                : '<p class="text-gray-500 text-center mt-10">目前沒有新聞資料。</p>';
        }
    }

    DOM.loadingIndicator.classList.add('hidden');
    DOM.scrollLoading.classList.add('hidden');
    isLoadingMore = false;
}

function renderTiles(isAppendMode = false) {
    let htmlContent = '';
    const dataToRender = isAppendMode ? currentNewsData.slice(currentPage * 20) : currentNewsData;
    const offsetIndex = isAppendMode ? currentPage * 20 : 0;

    dataToRender.forEach((news, relativeIndex) => {
        const index = offsetIndex + relativeIndex;
        const animationDelay = `style="animation-delay: ${(relativeIndex % 20) * 0.05}s"`;
        const cleanDescription = (news.description || '暫無詳細內文。').replace(/\n/g, '</p><p>');
        const geoBackground = generateGeometricBackground();
        const isSaved = !!savedBookmarks[news.link];
        const isRead = !!readHistory[news.link]; 
        const titleColorClass = isRead ? 'text-gray-400' : 'text-white';

        let thumbHtml = news.imageUrl 
            ? `<div class="flex-shrink-0 ml-3"><img src="${news.imageUrl}" class="w-20 h-20 md:w-28 md:h-28 object-cover border-2 border-white/10 shadow-sm bg-black/20" alt="縮圖" loading="lazy" /></div>` 
            : '';

        let imagesHtml = '';
        if (news.images && news.images.length > 0) {
            let slidesHtml = news.images.map(imgUrl => `<img src="${imgUrl}" class="snap-center flex-shrink-0 w-full h-auto block" alt="新聞圖片" loading="lazy" />`).join('');
            let navButtons = news.images.length > 1 ? `
                <button onclick="event.stopPropagation(); this.parentElement.querySelector('.img-scroll-box').scrollBy({left: -window.innerWidth, behavior: 'smooth'})" class="absolute left-0 top-1/2 -translate-y-1/2 bg-black/60 text-white px-3 py-4 z-10 shadow-lg active:bg-white active:text-black transition-colors">❮</button>
                <button onclick="event.stopPropagation(); this.parentElement.querySelector('.img-scroll-box').scrollBy({left: window.innerWidth, behavior: 'smooth'})" class="absolute right-0 top-1/2 -translate-y-1/2 bg-black/60 text-white px-3 py-4 z-10 shadow-lg active:bg-white active:text-black transition-colors">❯</button>
                <div class="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-1 rounded tracking-widest z-10 shadow">${news.images.length} 圖</div>
            ` : '';
            imagesHtml = `<div class="relative my-4 w-full overflow-hidden group bg-black/20 shadow-md"><div class="img-scroll-box flex overflow-x-auto snap-x snap-mandatory hide-scrollbar" style="scroll-behavior: smooth;">${slidesHtml}</div>${navButtons}</div>`;
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
                                    <button class="bookmark-btn text-xs uppercase tracking-widest font-bold ${isSaved ? 'saved' : 'opacity-70'}" data-index="${index}">${isSaved ? '★ 已收藏' : '☆ 收藏'}</button>
                                    <span class="text-xs uppercase tracking-widest opacity-65">點擊收回 ∧</span>
                                </div>
                            </div>
                            <h3 class="text-2xl md:text-3xl font-light leading-tight mb-3 px-5">${news.title}</h3>
                            <p class="text-xs opacity-70 mb-2 px-5">${new Date(news.pubDate).toLocaleString()} (${timeAgo(news.pubDate)})</p>
                            ${imagesHtml}
                            <div class="text-base md:text-lg font-light text-gray-100 leading-relaxed space-y-4 bg-black/30 px-5 py-6 mt-3 border border-white/5"><p>${cleanDescription}</p></div>
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
    const tiles = Array.from(DOM.newsGrid.querySelectorAll('.metro-tile')).slice(startIndex);
    
    tiles.forEach((tile) => {
        const index = tile.getAttribute('data-index');
        const bookmarkBtn = tile.querySelector('.bookmark-btn');
        if (bookmarkBtn) {
            bookmarkBtn.addEventListener('click', (e) => {
                e.stopPropagation(); 
                toggleBookmark(currentNewsData[index], bookmarkBtn);
            });
        }

        tile.addEventListener('click', (e) => {
            if(e.target.tagName === 'BUTTON') return;
            const isCurrentlyExpanded = tile.classList.contains('expanded');
            DOM.newsGrid.querySelectorAll('.metro-tile').forEach(t => t.classList.remove('expanded'));
            
            if (!isCurrentlyExpanded) {
                const titleElement = tile.querySelector('.news-title');
                markAsRead(currentNewsData[index].link, titleElement);
                tile.classList.add('expanded');
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

// 捲動監聽與手勢控制
DOM.mainContainer.addEventListener('scroll', () => {
    if (categories[currentIndex].id !== 'settings' && categories[currentIndex].id !== 'bookmarks') {
        if (categories[currentIndex].id === 'search' && !currentSearchQuery) return;
        if (DOM.mainContainer.scrollTop + DOM.mainContainer.clientHeight >= DOM.mainContainer.scrollHeight - 150) {
            if (!isLoadingMore && hasMoreNews) {
                currentPage++;
                loadNewsUI(categories[currentIndex].id, false, true);
            }
        }
    }
});

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
DOM.mainContainer.addEventListener('touchstart', e => {
    if (DOM.mainContainer.scrollTop === 0) { ptrStartY = e.touches[0].clientY; isPulling = true; }
}, { passive: true });

DOM.mainContainer.addEventListener('touchmove', e => {
    if (!isPulling) return;
    ptrCurrentY = e.touches[0].clientY;
    const pullDist = ptrCurrentY - ptrStartY;
    if (pullDist > 0 && pullDist < 120) {
        DOM.ptrIndicator.style.height = `${pullDist}px`;
        DOM.ptrIndicator.innerHTML = `<div class="loader-small" style="opacity: ${pullDist / 80};"></div>`;
    }
}, { passive: true });

DOM.mainContainer.addEventListener('touchend', async () => {
    if (!isPulling) return;
    isPulling = false;
    if (ptrCurrentY - ptrStartY > 65) {
        DOM.ptrIndicator.style.height = '45px';
        const currentCat = categories[currentIndex];
        if (currentCat.id !== 'settings' && currentCat.id !== 'bookmarks') {
            currentPage = 0;
            if (currentCat.id === 'search' && currentSearchQuery) await loadNewsUI('search', false, false);
            else if (currentCat.id !== 'search') await loadNewsUI(currentCat.id, true, false); 
        }
    }
    DOM.ptrIndicator.style.height = '0px';
    DOM.ptrIndicator.innerHTML = '';
    ptrStartY = 0;
    ptrCurrentY = 0;
}, { passive: true });

function renderCategoryManager() {
    const list = document.getElementById('category-manager-list');
    list.innerHTML = '';
    categories.forEach((cat, index) => {
        if (['search', 'bookmarks', 'settings'].includes(cat.id)) return;
        const row = document.createElement('div');
        row.className = 'flex justify-between items-center bg-white/5 px-4 py-3';
        row.innerHTML = `
            <span class="text-xl font-light text-gray-200">${cat.name} (${cat.id})</span>
            <button class="text-xs uppercase tracking-widest text-red-400 hover:text-red-300 px-3 py-1 border border-red-400/30" onclick="deleteCategory(${index})">刪除</button>
        `;
        list.appendChild(row);
    });
}

window.deleteCategory = function(index) {
    if (['search', 'bookmarks', 'settings'].includes(categories[index].id)) return alert('系統預設板塊無法刪除！');
    if (categories.length <= 4) return; 
    categories.splice(index, 1);
    if (currentIndex >= categories.length) currentIndex = categories.length - 1;
    renderPivot();
    renderCategoryManager();
}

document.getElementById('btn-add-cat').addEventListener('click', () => {
    const input = document.getElementById('new-cat-input');
    const val = input.value.trim();
    if (val) {
        const id = val.toLowerCase().replace(/\s+/g, '_');
        categories.splice(categories.findIndex(c => c.id === 'search'), 0, { id: id, name: val });
        input.value = '';
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
        if (currentNewsData.length > 0) renderTiles();
    });
});

let currentFontSizePercent = 110; 
function updateFontSize() {
    document.getElementById('font-size-display').innerText = currentFontSizePercent + '%';
    document.documentElement.style.fontSize = (16 * (currentFontSizePercent / 100)) + 'px';
}
document.getElementById('btn-font-plus').addEventListener('click', () => { if (currentFontSizePercent < 150) { currentFontSizePercent += 10; updateFontSize(); } });
document.getElementById('btn-font-minus').addEventListener('click', () => { if (currentFontSizePercent > 70) { currentFontSizePercent -= 10; updateFontSize(); } });
document.getElementById('btn-font-reset').addEventListener('click', () => { currentFontSizePercent = 110; updateFontSize(); });

window.addEventListener('DOMContentLoaded', () => {
    updateFontSize();
    renderPivot();
    handlePageChange();
});
