const API_BASE_URL = 'https://news-proxy.maxyu0725.workers.dev/api/news/';

let categories = [
    { id: 'local', name: '本地' },
    { id: 'finance', name: '財經' },
    { id: 'global', name: '國際' },
    { id: 'tech', name: '科技' },
    { id: 'ent', name: '娛樂' },
    { id: 'settings', name: '設定' }
];

let currentIndex = 0;
let currentNewsData = [];
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
        navMenu.scrollTo({ left: activeLink.offsetLeft - 24, behavior: 'smooth' });
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
        fetchNews(currentCat.id);
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

async function fetchNews(categoryId) {
    newsGrid.innerHTML = '';
    loadingIndicator.classList.remove('hidden');

    try {
        const response = await fetch(`${API_BASE_URL}${categoryId}`);
        const result = await response.json();

        if (result.success && result.data.length > 0) {
            currentNewsData = result.data;
            renderTiles();
        } else {
            newsGrid.innerHTML = '<p class="text-gray-500">目前沒有新聞資料。</p>';
        }
    } catch (error) {
        console.error("Fetch error:", error);
        newsGrid.innerHTML = '<p class="text-red-500">無法連接到伺服器，請檢查網路或 API 設定。</p>';
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

        // 構造右側小縮圖 HTML
        let thumbHtml = '';
        if (news.imageUrl) {
            thumbHtml = `
                <div class="flex-shrink-0 ml-4">
                    <img src="${news.imageUrl}" class="w-24 h-24 md:w-32 md:h-32 object-cover border-2 border-white/10 shadow-md bg-black/20" alt="縮圖" loading="lazy" />
                </div>
            `;
        }

        // 展開後的圖片畫廊 (改用 object-contain 不裁剪)
        let imagesHtml = '';
        if (news.images && news.images.length > 0) {
            imagesHtml = `<div class="flex flex-col space-y-4 my-4">`;
            news.images.forEach(imgUrl => {
                imagesHtml += `<img src="${imgUrl}" class="w-full h-auto max-h-[500px] object-contain border border-white/20 bg-black/40" alt="新聞圖片" loading="lazy" />`;
            });
            imagesHtml += `</div>`;
        }

        htmlContent += `
            <article class="metro-tile ${currentThemeColor}" data-index="${index}" ${animationDelay}>
                ${geoBackground}
                
                <!-- 預覽區塊改為橫向排列 (flex-row) -->
                <div class="tile-preview p-5 flex flex-row justify-between items-start">
                    <div class="flex flex-col justify-between h-full flex-grow pr-2">
                        <h3 class="text-xl md:text-2xl font-bold leading-tight line-clamp-3">${news.title}</h3>
                        <p class="text-xs mt-3 opacity-80 uppercase tracking-widest truncate">
                            ${timeAgo(news.pubDate)}
                        </p>
                    </div>
                    ${thumbHtml}
                </div>
                
                <div class="tile-details">
                    <div class="tile-details-inner flex flex-col justify-between">
                        <div>
                            <div class="flex justify-between items-center mb-3">
                                <span class="text-xs uppercase tracking-widest opacity-80 font-semibold">${news.source} · ${news.category || '即時新聞'}</span>
                                <span class="text-xs uppercase tracking-widest opacity-65">點擊收回 ∧</span>
                            </div>
                            <h3 class="text-2xl md:text-3xl font-light leading-tight mb-4">${news.title}</h3>
                            <p class="text-xs opacity-70 mb-2">${new Date(news.pubDate).toLocaleString()} (${timeAgo(news.pubDate)})</p>
                            
                            ${imagesHtml}

                            <div class="text-base md:text-lg font-light text-gray-100 leading-relaxed space-y-4 bg-black/30 p-5 mt-4">
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
        tile.addEventListener('click', () => {
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
            await fetchNews(currentCat.id);
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
