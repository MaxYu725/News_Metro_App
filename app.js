
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
        
        // 單欄佈局：收合狀態高度增至 180px 以容納較大文字
        const minHeightClass = isExpanded ? 'min-h-[320px]' : 'h-[180px]';
        const animationDelay = `style="animation-delay: ${index * 0.03}s"`;

        if (isExpanded) {
            // === 展開的大磚狀態 (沉浸式排版) ===
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
            // === 一般收合的小磚狀態 (加大字體) ===
            htmlContent += `
                <article class="metro-tile ${colorClass} ${minHeightClass} p-5 flex flex-col justify-between" 
                         data-index="${index}"
                         ${animationDelay}>
                    <div></div>
                    <div>
                        <!-- 字體放大：text-xl/2xl -->
                        <h3 class="text-xl md:text-2xl font-bold leading-tight line-clamp-3">${news.title}</h3>
                        <!-- 時間放大：text-xs -->
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

// 綁定動態磚的互動事件 (點擊與長按)
function attachTileEvents() {
    const tiles = newsGrid.querySelectorAll('.metro-tile');

    tiles.forEach(tile => {
        const index = parseInt(tile.getAttribute('data-index'));

        // 點擊事件
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
                    tile.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 100);
            }
        });

        // 長按邏輯
        let pressTimer = null;

        const startPress = () => {
            clearPress();
            pressTimer = setTimeout(() => {
                triggerLongPressAction(tile, currentNewsData[index].link);
            }, 600);
        };

        const clearPress = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };

        tile.addEventListener('touchstart', startPress);
        tile.addEventListener('touchend', clearPress);
        tile.addEventListener('touchmove', clearPress);
        tile.addEventListener('mousedown', startPress);
        tile.addEventListener('mouseup', clearPress);
        tile.addEventListener('mouseleave', clearPress);
    });
}

// 長按觸發的動作：在磚上直接浮現快捷按鈕
function triggerLongPressAction(tile, link) {
    if (tile.querySelector('.long-press-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'long-press-overlay absolute inset-0 bg-black/80 z-20 flex flex-col items-center justify-center p-4 animate-fade-in';
    overlay.innerHTML = `
        <p class="text-xs uppercase tracking-widest text-gray-400 mb-3">快捷操作</p>
        <a href="${link}" target="_blank" onclick="event.stopPropagation()" class="bg-white text-black font-bold px-6 py-3 text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors shadow-lg">
            網頁檢視 ↗
        </a>
        <span class="text-[10px] text-gray-500 mt-4">點擊任意處關閉</span>
    `;

    overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        overlay.remove();
    });

    tile.appendChild(overlay);
}

// 獨立外部連結開啟函式
function openExternal(e, link) {
    e.stopPropagation();
    window.open(link, '_blank');
}

// 導覽列點擊事件監聽
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        navLinks.forEach(l => l.classList.remove('active', 'text-white', 'font-semibold'));
        
        const target = e.target;
        target.classList.add('active', 'text-white', 'font-semibold');
        
        const cat = target.getAttribute('data-category');
        fetchNews(cat);
    });
});

// 程式啟動時，預設抓取「本地」新聞
window.addEventListener('DOMContentLoaded', () => {
    fetchNews('local');
});
