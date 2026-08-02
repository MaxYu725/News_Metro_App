// 設定 API 網址 (Cloudflare Worker)
const API_BASE_URL = 'https://news-proxy.maxyu0725.workers.dev/api/news/';

// Metro UI 經典顏色庫
const METRO_COLORS = [
    'bg-blue-600', 'bg-green-600', 'bg-purple-700', 
    'bg-red-600', 'bg-orange-600', 'bg-teal-600', 'bg-pink-600'
];

// 綁定 DOM 元素
const newsGrid = document.getElementById('news-grid');
const loadingIndicator = document.getElementById('loading-indicator');
const navLinks = document.querySelectorAll('.nav-link');

// 狀態管理
let currentNewsData = [];
let expandedIndex = null;

// ==========================================
// 1. 新聞抓取與渲染邏輯
// ==========================================

// 時間格式化
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

// 取得新聞資料
async function fetchNews(category) {
    newsGrid.innerHTML = '';
    loadingIndicator.classList.remove('hidden');
    expandedIndex = null; // 切換分類時重置展開狀態

    try {
        const response = await fetch(`${API_BASE_URL}${category}`);
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

// 渲染動態磚
function renderTiles() {
    let htmlContent = '';
    
    currentNewsData.forEach((news, index) => {
        const colorClass = METRO_COLORS[index % METRO_COLORS.length];
        const isExpanded = (expandedIndex === index);
        
        // 單欄佈局：收合狀態高度增至 180px
        const minHeightClass = isExpanded ? 'min-h-[320px]' : 'h-[180px]';
        const animationDelay = `style="animation-delay: ${index * 0.03}s"`;

        if (isExpanded) {
            // === 展開的大磚狀態 ===
            const cleanDescription = (news.description || '暫無詳細內文。').replace(/\n/g, '</p><p>');
            htmlContent += `
                <article class="metro-tile ${colorClass} ${minHeightClass} p-6 flex flex-col justify-between shadow-2xl" 
                         data-index="${index}"
                         ${animationDelay}>
                    <div>
                        <div class="flex justify-between items-center mb-3">
                            <span class="text-xs uppercase tracking-widest opacity-80 font-semibold">${news.source} · ${news.category || '即時新聞'}</span>
                            <span class="text-xs uppercase tracking-widest opacity-60">點擊收回 ∧</span>
                        </div>
                        <h3 class="text-2xl md:text-3xl font-light leading-tight mb-4">${news.title}</h3>
                        <p class="text-xs opacity-70 mb-6 pb-4 border-b border-white/20">${new Date(news.pubDate).toLocaleString()} (${timeAgo(news.pubDate)})</p>
                        <div class="text-base md:text-lg font-light text-gray-100 leading-relaxed space-y-4">
                            <p>${cleanDescription}</p>
                        </div>
                    </div>
                    <div class="mt-8 flex justify-end">
                        <button onclick="openExternal(event, '${news.link}')" class="text-xs uppercase tracking-widest bg-black/40 hover:bg-black/60 px-4 py-2 transition-colors border border-white/20">
                            網頁檢視 ↗
                        </button>
                    </div>
                </article>
            `;
        } else {
            // === 收合的小磚狀態 ===
            htmlContent += `
                <article class="metro-tile ${colorClass} ${minHeightClass} p-5 flex flex-col justify-between" 
                         data-index="${index}"
                         ${animationDelay}>
                    <div></div>
                    <div>
                        <h3 class="text-xl md:text-2xl font-bold leading-tight line-clamp-3">${news.title}</h3>
                        <p class="text-xs mt-3 opacity-80 uppercase tracking-widest truncate">
                            ${timeAgo(news.pubDate)}
                        </p>
                    </div>
                </article>
            `;
        }
    });

    newsGrid.innerHTML = htmlContent;
    attachTileEvents();
}

// 綁定動態磚事件
function attachTileEvents() {
    const tiles = newsGrid.querySelectorAll('.metro-tile');

    tiles.forEach(tile => {
        const index = parseInt(tile.getAttribute('data-index'));

        // 點擊展開/收合
        tile.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

            if (expandedIndex === index) {
                expandedIndex = null;
            } else {
                expandedIndex = index;
            }
            renderTiles();

            if (expandedIndex !== null) {
                setTimeout(() => {
                    tile.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }
        });

        // 長按事件
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

function openExternal(e, link) {
    e.stopPropagation();
    window.open(link, '_blank');
}

// 導覽列分類切換
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        navLinks.forEach(l => l.classList.remove('active', 'text-white', 'font-semibold'));
        e.target.classList.add('active', 'text-white', 'font-semibold');
        fetchNews(e.target.getAttribute('data-category'));
    });
});

// ==========================================
// 2. 底部設定面板互動邏輯 (Settings UI)
// ==========================================

// Typography Size (字體大小縮放控制)
let currentFontSizePercent = 110; 
const fontDisplay = document.getElementById('font-size-display');
const rootHtml = document.documentElement; 

function updateFontSize() {
    fontDisplay.innerText = currentFontSizePercent + '%';
    // 透過改變 root font-size (rem 基礎)，達成整個畫面等比例縮放
    rootHtml.style.fontSize = (16 * (currentFontSizePercent / 100)) + 'px';
}

document.getElementById('btn-font-plus').addEventListener('click', () => {
    if (currentFontSizePercent < 150) {
        currentFontSizePercent += 10;
        updateFontSize();
    }
});

document.getElementById('btn-font-minus').addEventListener('click', () => {
    if (currentFontSizePercent > 70) {
        currentFontSizePercent -= 10;
        updateFontSize();
    }
});

document.getElementById('btn-font-reset').addEventListener('click', () => {
    currentFontSizePercent = 110;
    updateFontSize();
});

// Auto Update Frequency (更新頻率按鈕單選邏輯)
const freqButtons = document.querySelectorAll('#update-freq-group .metro-btn');
freqButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        freqButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        // 此處可延伸實作 setInterval 自動更新 API 的邏輯
    });
});

// 啟動初始化
window.addEventListener('DOMContentLoaded', () => {
    updateFontSize(); // 套用預設 110% 字體
    fetchNews('local');
});
