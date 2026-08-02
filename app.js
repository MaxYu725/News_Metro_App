const API_BASE_URL = 'https://news-proxy.maxyu0725.workers.dev/api/news/';

const METRO_COLORS = [
    'bg-blue-600', 'bg-green-600', 'bg-purple-700', 
    'bg-red-600', 'bg-orange-600', 'bg-teal-600', 'bg-pink-600'
];

const newsGrid = document.getElementById('news-grid');
const settingsView = document.getElementById('settings-view');
const loadingIndicator = document.getElementById('loading-indicator');
const navLinks = document.querySelectorAll('.nav-link');

let currentNewsData = [];

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
    
    for (let i = 0; i < 6; i++) {
        const x1 = Math.random() * 400;
        const y1 = Math.random() * 600;
        const x2 = Math.random() * 400;
        const y2 = Math.random() * 600;
        const opacity = (10 + Math.random() * 20) / 100;
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="white" stroke-width="${1 + Math.random() * 2}" stroke-opacity="${opacity}" />`;
    }
    
    for (let i = 0; i < 4; i++) {
        const p1 = `${Math.random()*400},${Math.random()*600}`;
        const p2 = `${Math.random()*400},${Math.random()*600}`;
        const p3 = `${Math.random()*400},${Math.random()*600}`;
        const opacity = (10 + Math.random() * 20) / 100;
        svg += `<polygon points="${p1} ${p2} ${p3}" fill="white" fill-opacity="${opacity}" />`;
    }

    for (let i = 0; i < 3; i++) {
        const cx = Math.random() * 400;
        const cy = Math.random() * 600;
        const r = 10 + Math.random() * 25;
        const opacity = (10 + Math.random() * 15) / 100;
        svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" fill-opacity="${opacity}" />`;
    }

    svg += `</svg>`;
    return svg;
}

async function fetchNews(category) {
    newsGrid.innerHTML = '';
    loadingIndicator.classList.remove('hidden');

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

function renderTiles() {
    let htmlContent = '';
    
    currentNewsData.forEach((news, index) => {
        const colorClass = METRO_COLORS[index % METRO_COLORS.length];
        const animationDelay = `style="animation-delay: ${index * 0.05}s"`;
        const cleanDescription = (news.description || '暫無詳細內文。').replace(/\n/g, '</p><p>');
        const geoBackground = generateGeometricBackground();

        htmlContent += `
            <article class="metro-tile ${colorClass}" data-index="${index}" ${animationDelay}>
                ${geoBackground}
                <div class="tile-preview p-5">
                    <div></div>
                    <div>
                        <h3 class="text-xl md:text-2xl font-bold leading-tight line-clamp-3">${news.title}</h3>
                        <p class="text-xs mt-3 opacity-80 uppercase tracking-widest truncate">
                            ${timeAgo(news.pubDate)}
                        </p>
                    </div>
                </div>
                <div class="tile-details">
                    <div class="tile-details-inner flex flex-col justify-between">
                        <div>
                            <div class="flex justify-between items-center mb-3">
                                <span class="text-xs uppercase tracking-widest opacity-80 font-semibold">${news.source} · ${news.category || '即時新聞'}</span>
                                <span class="text-xs uppercase tracking-widest opacity-65">點擊收回 ∧</span>
                            </div>
                            <h3 class="text-2xl md:text-3xl font-light leading-tight mb-4">${news.title}</h3>
                            <p class="text-xs opacity-70 mb-6 pb-4 border-b border-white/20">${new Date(news.pubDate).toLocaleString()} (${timeAgo(news.pubDate)})</p>
                            <div class="text-base md:text-lg font-light text-gray-100 leading-relaxed space-y-4">
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

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        navLinks.forEach(l => l.classList.remove('active', 'text-white', 'font-semibold'));
        e.target.classList.add('active', 'text-white', 'font-semibold');
        
        const category = e.target.getAttribute('data-category');
        if (category === 'settings') {
            newsGrid.classList.add('hidden');
            settingsView.classList.remove('hidden');
            settingsView.classList.add('flex');
        } else {
            settingsView.classList.add('hidden');
            settingsView.classList.remove('flex');
            newsGrid.classList.remove('hidden');
            fetchNews(category);
        }
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
    fetchNews('local');
});
