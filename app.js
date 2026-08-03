const API_BASE_URL = 'https://news-proxy.maxyu0725.workers.dev/api/news/';

// 移除財經與體育，保留最核心的三大板塊
let categories = [
    { id: 'local', name: '港聞' },
    { id: 'global', name: '國際' },
    { id: 'ent', name: '娛樂' },
    { id: 'settings', name: '設定' }
];

let currentIndex = 0;
let currentNewsData = [];
let newsCache = {}; 
let currentThemeColor = 'bg-blue-600'; 

const newsGrid = document.getElementById('news-grid');
const settingsView = document.getElementById('settings-view');
const loadingIndicator = document.getElementById('loading-indicator');
const navMenu = document.getElementById('nav-menu');
const mainContainer = document.getElementById('main-container');
const ptrIndicator = document.getElementById('ptr-indicator');

function renderPivot() {
    navMenu.innerHTML = '';
    categories.forEach((cat, index) => {
        const a = document.createElement('a');
        a.className = `nav-link ${index === currentIndex ? 'active' : ''}`;
        a.innerText = cat.name;
        a.addEventListener('click', () => {
            currentIndex = index;
            handlePageChange();
        });
        navMenu.appendChild(a);
    });
    const activeLink = navMenu.children[currentIndex];
    if (activeLink) {
        navMenu.scrollTo({ left: activeLink.offsetLeft - 16, behavior: 'smooth' });
    }
}

function handlePageChange() {
    renderPivot();
    const currentCat = categories[currentIndex];
    if (currentCat.id === 'settings') {
        newsGrid.classList.add('hidden');
        settingsView.classList.remove('hidden');
        settingsView.classList.add('flex');
        renderCategoryManager();
    } else {
        settingsView.classList.add('hidden');
        settingsView.classList.remove('flex');
        newsGrid.classList.remove('hidden');
        fetchNews(currentCat.id, false); 
    }
}

function timeAgo(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.round(diffMs / 60000);
    
    if (diffMins < 60) return `${diffMins} 分鐘前`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} 小時前`;
    return `${Math.floor(diffHours / 24)} 天前`;
}

function generateGeometricBackground() {
    let svg = `<svg class="geo-bg" viewBox="0 0 400 600" xmlns="http://www.w3.org/2000/svg">`;
    const cx = 50 + Math.random() * 300;
    const cy = 50 + Math.random() * 200;
    const r = 100 + Math.random() * 150;
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" fill-opacity="0.08" />`;
    for (let i = 0; i < (1 + Math.floor(Math.random() * 2)); i++) {
        const x = Math.random() * 300;
        const y = Math.random() * 300;
        const pts = `${x},${y} ${x+250},${y+80} ${x+180},${y+350} ${x-70},${y+270}`;
        svg += `<polygon points="${pts}" fill="white" fill-opacity="0.05" />`;
    }
    svg += `</svg>`;
    return svg;
}

async function fetchNews(categoryId, forceRefresh = false) {
    if (!forceRefresh && newsCache[categoryId]) {
        currentNewsData = newsCache[categoryId];
        renderTiles();
        return;
    }

    if (!forceRefresh || !newsCache[categoryId]) {
        newsGrid.innerHTML = '';
        loadingIndicator.classList.remove('hidden');
    }

    try {
        const response = await fetch(`${API_BASE_URL}${categoryId}`);
        const result = await response.json();

        if (result.success && result.data.length > 0) {
            currentNewsData = result.data;
            newsCache[categoryId] = result.data;
            renderTiles();
        } else {
            if (!newsCache[categoryId]) {
                newsGrid.innerHTML = '<p class="text-gray-500 text-center mt-10">目前沒有新聞資料。</p>';
            }
        }
    } catch (error) {
        if (!newsCache[categoryId]) {
            newsGrid.innerHTML = '<p class="text-red-500 text-center mt-10">無法連接到伺服器，或目標網站阻擋了連線。</p>';
        }
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}

function renderTiles() {
    let htmlContent = '';
    currentNewsData.forEach((news, index) => {
        const animationDelay = `style="animation-delay: ${index * 0.05}s"`;
        const cleanDescription = (news.description || '暫無詳細內文。').replace(/\n/g, '</p><p>');
        const geoBackground = generateGeometricBackground();

        let thumbHtml = '';
        if (news.imageUrl) {
            thumbHtml = `
                <div class="flex-shrink-0 ml-3">
                    <img src="${news.imageUrl}" class="w-20 h-20 md:w-28 md:h-28 object-cover border-2 border-white/10 shadow-sm bg-black/20" alt="縮圖" loading="lazy" />
                </div>
            `;
        }

        let imagesHtml = '';
        if (news.images && news.images.length > 0) {
            let slidesHtml = news.images.map(imgUrl => 
                `<img src="${imgUrl}" class="snap-center flex-shrink-0 w-full h-auto block" alt="新聞圖片" loading="lazy" />`
            ).join('');
            
            let navButtons = '';
            if (news.images.length > 1) {
                navButtons = `
                    <button onclick="event.stopPropagation(); this.parentElement.querySelector('.img-scroll-box').scrollBy({left: -window.innerWidth, behavior: 'smooth'})" class="absolute left-0 top-1/2 -translate-y-1/2 bg-black/60 text-white px-3 py-4 z-10 shadow-lg active:bg-white active:text-black transition-colors">❮</button>
                    <button onclick="event.stopPropagation(); this.parentElement.querySelector('.img-scroll-box').scrollBy({left: window.innerWidth, behavior: 'smooth'})" class="absolute right-0 top-1/2 -translate-y-1/2 bg-black/60 text-white px-3 py-4 z-10 shadow-lg active:bg-white active:text-black transition-colors">❯</button>
                    <div class="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-1 rounded tracking-widest z-10 shadow">${news.images.length} 圖</div>
                `;
            }

            imagesHtml = `
                <div class="relative my-4 w-full overflow-hidden group bg-black/20 shadow-md">
                    <div class="img-scroll-box flex overflow-x-auto snap-x snap-mandatory hide-scrollbar" style="scroll-behavior: smooth;">
                        ${slidesHtml}
                    </div>
                    ${navButtons}
                </div>
            `;
        }

        htmlContent += `
            <article class="metro-tile ${currentThemeColor}" data-index="${index}" ${animationDelay}>
                ${geoBackground}
                
                <div class="tile-preview px-5 py-4 flex flex-row justify-between items-start">
                    <div class="flex flex-col justify-between h-full flex-grow pr-1">
                        <h3 class="text-xl md:text-2xl font-bold leading-tight line-clamp-3">${news.title}</h3>
                        <div class="flex items-center space-x-2 mt-3">
                            <span class="text-xs opacity-90 uppercase font-semibold text-gray-200 border border-white/20 px-1.5 py-0.5 rounded">${news.source}</span>
                            <span class="text-xs opacity-70 uppercase tracking-widest truncate">
                                ${timeAgo(news.pubDate)}
                            </span>
                        </div>
                    </div>
                    ${thumbHtml}
                </div>
                
                <div class="tile-details">
                    <div class="tile-details-inner flex flex-col justify-between">
                        <div>
                            <div class="flex justify-between items-center mb-2 mt-2 px-5">
                                <span class="text-xs uppercase tracking-widest opacity-80 font-semibold">${news.source} · ${news.category || '即時新聞'}</span>
                                <span class="text-xs uppercase tracking-widest opacity-65">點擊收回 ∧</span>
                            </div>
                            <h3 class="text-2xl md:text-3xl font-light leading-tight mb-3 px-5">${news.title}</h3>
                            <p class="text-xs opacity-70 mb-2 px-5">${new Date(news.pubDate).toLocaleString()} (${timeAgo(news.pubDate)})</p>
                            
                            ${imagesHtml}

                            <div class="text-base md:text-lg font-light text-gray-100 leading-relaxed space-y-4 bg-black/30 px-5 py-6 mt-3 border border-white/5">
                                <p>${cleanDescription}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </article>
        `;
    });
    newsGrid.innerHTML = htmlContent;
    attachTileEvents();
}

function attachTileEvents() {
    const tiles = newsGrid.querySelectorAll('.metro-tile');
    tiles.forEach((tile, index) => {
        tile.addEventListener('click', (e) => {
            if(e.target.tagName === 'BUTTON') return;

            const isCurrentlyExpanded = tile.classList.contains('expanded');
            tiles.forEach(t => t.classList.remove('expanded'));
            if (!isCurrentlyExpanded) {
                tile.classList.add('expanded');
                setTimeout(() => {
                    tile.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 200);
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

let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

document.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();
}, { passive: true });

function handleSwipe() {
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 60) {
        if (deltaX > 0) {
            currentIndex = (currentIndex - 1 + categories.length) % categories.length;
        } else {
            currentIndex = (currentIndex + 1) % categories.length;
        }
        handlePageChange();
    }
}

let ptrStartY = 0;
let ptrCurrentY = 0;
let isPulling = false;

mainContainer.addEventListener('touchstart', e => {
    if (mainContainer.scrollTop === 0) {
        ptrStartY = e.touches[0].clientY;
        isPulling = true;
    }
}, { passive: true });

mainContainer.addEventListener('touchmove', e => {
    if (!isPulling) return;
    ptrCurrentY = e.touches[0].clientY;
    const pullDist = ptrCurrentY - ptrStartY;
    if (pullDist > 0 && pullDist < 120) {
        ptrIndicator.style.height = `${pullDist}px`;
        ptrIndicator.innerHTML = `<div class="loader-small" style="opacity: ${pullDist / 80};"></div>`;
    }
}, { passive: true });

mainContainer.addEventListener('touchend', async () => {
    if (!isPulling) return;
    isPulling = false;
    const pullDist = ptrCurrentY - ptrStartY;
    if (pullDist > 65) {
        ptrIndicator.style.height = '45px';
        const currentCat = categories[currentIndex];
        if (currentCat.id !== 'settings') {
            await fetchNews(currentCat.id, true); 
        }
    }
    ptrIndicator.style.height = '0px';
    ptrIndicator.innerHTML = '';
    ptrStartY = 0;
    ptrCurrentY = 0;
}, { passive: true });

function renderCategoryManager() {
    const list = document.getElementById('category-manager-list');
    list.innerHTML = '';
    categories.forEach((cat, index) => {
        if (cat.id === 'settings') return;
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
    if (categories.length <= 2) return;
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
        categories.splice(categories.length - 1, 0, { id: id, name: val });
        input.value = '';
        renderPivot();
        renderCategoryManager();
    }
});

const colorButtons = document.querySelectorAll('.color-btn');
colorButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        colorButtons.forEach(b => {
            b.classList.remove('border-white');
            b.classList.add('border-transparent');
        });
        e.target.classList.remove('border-transparent');
        e.target.classList.add('border-white');
        
        currentThemeColor = e.target.getAttribute('data-color');
        if (currentNewsData.length > 0) renderTiles();
    });
});

let currentFontSizePercent = 110; 
const fontDisplay = document.getElementById('font-size-display');
const rootHtml = document.documentElement; 

function updateFontSize() {
    fontDisplay.innerText = currentFontSizePercent + '%';
    rootHtml.style.fontSize = (16 * (currentFontSizePercent / 100)) + 'px';
}

document.getElementById('btn-font-plus').addEventListener('click', () => {
    if (currentFontSizePercent < 150) { currentFontSizePercent += 10; updateFontSize(); }
});
document.getElementById('btn-font-minus').addEventListener('click', () => {
    if (currentFontSizePercent > 70) { currentFontSizePercent -= 10; updateFontSize(); }
});
document.getElementById('btn-font-reset').addEventListener('click', () => {
    currentFontSizePercent = 110; updateFontSize();
});

const freqButtons = document.querySelectorAll('#update-freq-group .metro-btn');
freqButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        freqButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
    });
});

window.addEventListener('DOMContentLoaded', () => {
    updateFontSize();
    renderPivot();
    handlePageChange();
});
