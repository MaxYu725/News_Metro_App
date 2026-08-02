const MetroNews = (function() {
    const PIVOT_NAMES = ['latest', 'local', 'entertainment', 'tech', 'pinned', 'settings'];
    const PIVOT_COUNT = PIVOT_NAMES.length;
    const WORKER_URL = 'https://metro-news-api.maxyu0725.workers.dev/';
    const CACHE_KEY = 'metro_news_cache_v1';
    const PINNED_KEY = 'metro_news_pinned_v1';
    const SETTINGS_KEY = 'metro_news_settings_v1';

    let currentPivotIndex = 0;
    let touchStartX = 0;
    let touchEndX = 0;
    const swipeThreshold = 100;
    let isPivotAnimating = false;
    let expandedTileId = null;

    let newsData = {
        latest: [],
        local: [],
        entertainment: [],
        tech: []
    };
    let pinnedArticles = [];
    let fontSizePercent = 110;
    let updateIntervalMins = 5;
    let autoUpdateTimer = null;

    // --- Core Initialization ---
    async function init() {
        initSettings();
        loadPinned();
        initSwipe();
        initHeaderClicks();
        initCustomScrollBounce();
        initVisibilityAPI();

        await loadNewsData();

        const overlay = document.getElementById('loading-overlay');
        const appContainer = document.getElementById('app-container');

        overlay.classList.add('slide-up');
        renderAllPivots();
        startAutoUpdate();

        setTimeout(() => {
            overlay.classList.add('hidden');
            appContainer.classList.add('unfold-down');
        }, 800);
    }

    // --- Custom Rubber-banding ---
    function initCustomScrollBounce() {
        const scrollContainers = document.querySelectorAll('.pivot-item');
        scrollContainers.forEach(container => {
            let startY = 0;
            let currentTranslate = 0;

            container.addEventListener('touchstart', e => {
                if (e.target.closest('button')) return;
                startY = e.touches[0].clientY;
                container.style.transition = 'none';
            }, { passive: true });

            container.addEventListener('touchmove', e => {
                const y = e.touches[0].clientY;
                const deltaY = y - startY;
                const scrollTop = container.scrollTop;
                const scrollHeight = container.scrollHeight;
                const clientHeight = container.clientHeight;

                const isAtTop = scrollTop <= 0;
                const isAtBottom = Math.ceil(scrollTop + clientHeight) >= scrollHeight - 1;

                if (isAtTop && deltaY > 0) {
                    currentTranslate = deltaY * 0.35;
                    container.style.setProperty('--ty', `${currentTranslate}px`);
                    if (e.cancelable) e.preventDefault();
                } else if (isAtBottom && deltaY < 0) {
                    currentTranslate = deltaY * 0.35;
                    container.style.setProperty('--ty', `${currentTranslate}px`);
                    if (e.cancelable) e.preventDefault();
                } else {
                    currentTranslate = 0;
                    container.style.setProperty('--ty', '0px');
                }
            }, { passive: false });

            const endTouch = () => {
                if (currentTranslate !== 0) {
                    container.style.transition = 'transform 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)';
                    container.style.setProperty('--ty', '0px');
                    currentTranslate = 0;
                } else {
                    container.style.transition = '';
                }
            };
            container.addEventListener('touchend', endTouch);
            container.addEventListener('touchcancel', endTouch);
        });
    }

    // --- News API Loading & Caching ---
    async function loadNewsData() {
        try {
            const res = await fetch(WORKER_URL);
            if (res.ok) {
                const data = await res.json();
                newsData = data.categories || data;
                localStorage.setItem(CACHE_KEY, JSON.stringify({
                    timestamp: Date.now(),
                    data: newsData
                }));
                updateStatusMessages(`updated: ${new Date().toLocaleTimeString()}`);
                return;
            }
        } catch (e) {
            console.warn('Backend offline or unreachable, using cache/fallback.', e);
        }

        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            const parsed = JSON.parse(cached);
            newsData = parsed.data;
            updateStatusMessages(`offline cache: ${new Date(parsed.timestamp).toLocaleTimeString()}`);
        } else {
            newsData = generateFallbackNews();
            updateStatusMessages('demo headlines loaded');
        }
    }

    function generateFallbackNews() {
        return {
            latest: [
                { id: 'lat-1', title: 'Hong Kong Observatory Forecasts Significant Weather Change', source: 'RTHK', time: '10 mins ago', content: 'The Hong Kong Observatory announced that a strong northeast monsoon will bring cooler temperatures and patchy rains across the coastal areas. Citizens are advised to bring umbrellas.' },
                { id: 'lat-2', title: 'New Metro Line Expansion Phase Concluded Ahead of Schedule', source: 'HK News', time: '25 mins ago', content: 'Transport authorities confirmed the completion of safety inspections for the upcoming transit extension, enabling faster cross-district connectivity.' }
            ],
            local: [
                { id: 'loc-1', title: 'Community Arts Center Opens in West Kowloon District', source: 'Gov News', time: '1 hour ago', content: 'A newly designed multi-purpose arts hub open to the public today, featuring digital interactive galleries and outdoor amphitheaters.' },
                { id: 'loc-2', title: 'Smart Mobility Initiatives Implemented Across Kowloon', source: 'HK News', time: '3 hours ago', content: 'New AI-driven traffic light optimization systems have been rolled out across major intersections to reduce vehicular congestion during peak hours.' }
            ],
            entertainment: [
                { id: 'ent-1', title: 'Annual Asian Film Festival Unveils This Year Lineup', source: 'MingPao Ent', time: '2 hours ago', content: 'Over 40 international feature films and independent documentaries will be screened in cinemas across Hong Kong starting next month.' }
            ],
            tech: [
                { id: 'tec-1', title: 'Next-Generation AI Edge Models Run Natively on Mobile Devices', source: 'Unwire', time: '40 mins ago', content: 'Technological benchmarks show astonishing efficiency gains as quantized language models execute offline on modern smartphone processors without cloud latency.' }
            ]
        };
    }

    function updateStatusMessages(text) {
        PIVOT_NAMES.slice(0, 4).forEach(category => {
            const el = document.getElementById(`status-${category}`);
            if (el) el.innerText = text;
        });
    }

    // --- Fixed Anchor Geometric Pattern Generator ---
    function generateGeometrySvg(seedStr, accentColor) {
        let hash = 0;
        for (let i = 0; i < seedStr.length; i++) {
            hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
        }
        const absHash = Math.abs(hash);
        let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 1200" preserveAspectRatio="none">`;
        const numPolys = 8 + (absHash % 6);
        for (let i = 0; i < numPolys; i++) {
            const x1 = (absHash * (i + 1) * 37) % 400;
            const y1 = (absHash * (i + 2) * 83) % 1100;
            const x2 = (x1 + 120 + ((i * 45) % 180)) % 400;
            const y2 = y1 + 80 + ((i * 70) % 200);
            const x3 = Math.max(0, x1 - 50);
            const y3 = y2 + 40;
            const opacity = 0.12 + ((i % 3) * 0.05);
            svgContent += `<polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3}" fill="${accentColor}" fill-opacity="${opacity}" />`;
        }
        svgContent += `</svg>`;
        return `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`;
    }

    // --- Rendering News Tiles ---
    function renderAllPivots() {
        renderCategoryList('latest', newsData.latest || []);
        renderCategoryList('local', newsData.local || []);
        renderCategoryList('entertainment', newsData.entertainment || []);
        renderCategoryList('tech', newsData.tech || []);
        renderPinnedList();
        updateSettingsDisplay();
    }

    function renderCategoryList(category, articles) {
        const container = document.getElementById(`list-${category}`);
        if (!container) return;
        if (!articles || articles.length === 0) {
            container.innerHTML = `<div class="empty-state-text">no articles available in ${category}.</div>`;
            return;
        }

        const currentAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#339933';
        container.innerHTML = '';
        const fragment = document.createDocumentFragment();

        articles.forEach(article => {
            const tile = createTileElement(article, currentAccent, false);
            fragment.appendChild(tile);
        });
        container.appendChild(fragment);
    }

    function renderPinnedList() {
        const container = document.getElementById('list-pinned');
        const statusEl = document.getElementById('status-pinned');
        if (!container) return;
        if (pinnedArticles.length === 0) {
            container.innerHTML = '<div class="empty-state-text">you have not pinned any news articles yet.</div>';
            if (statusEl) statusEl.innerText = '0 pinned articles';
            return;
        }

        if (statusEl) statusEl.innerText = `${pinnedArticles.length} pinned article(s)`;
        const currentAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#339933';
        container.innerHTML = '';
        const fragment = document.createDocumentFragment();

        pinnedArticles.forEach(article => {
            const tile = createTileElement(article, currentAccent, true);
            fragment.appendChild(tile);
        });
        container.appendChild(fragment);
    }

    function createTileElement(article, accentColor, isPinnedView) {
        const tile = document.createElement('div');
        tile.className = 'news-tile';
        tile.id = `tile-${article.id}`;

        const isPinned = pinnedArticles.some(item => item.id === article.id);
        const pinBtnText = isPinned ? 'unpin article' : 'pin to start';

        const svgBgUrl = generateGeometrySvg(article.id, accentColor);

        tile.innerHTML = `
            <div class="tile-geometry-bg" style="background-image: url('${svgBgUrl}'); background-size: 100% 1200px;"></div>
            <div class="tile-content-layer">
                <div class="tile-source-bar">
                    <span class="tile-source-name">${article.source || 'METRO NEWS'}</span>
                    <span class="tile-time">${article.time || 'recent'}</span>
                </div>
                <h3 class="tile-headline">${article.title}</h3>
                <div class="tile-expanded-wrapper" id="wrapper-${article.id}">
                    <div class="tile-expanded-inner">
                        <div class="tile-body-content">${article.content || 'No detailed content available.'}</div>
                        <div class="tile-actions">
                            <button class="metro-btn accent mb-0" onclick="MetroNews.togglePin('${article.id}', event)">${pinBtnText}</button>
                            <button class="metro-btn mb-0" onclick="MetroNews.closeTile('${article.id}', event)">close</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        tile.onclick = (e) => {
            if (!e.target.closest('button')) {
                toggleTileExpansion(article.id, tile);
            }
        };
        return tile;
    }

    // --- Auto-Snap to Top Expansion ---
    function toggleTileExpansion(articleId, tileElement) {
        const wrapper = document.getElementById(`wrapper-${articleId}`);
        if (!wrapper) return;

        const isOpening = !wrapper.classList.contains('open');

        if (expandedTileId && expandedTileId !== articleId) {
            const prevWrapper = document.getElementById(`wrapper-${expandedTileId}`);
            const prevTile = document.getElementById(`tile-${expandedTileId}`);
            if (prevWrapper) prevWrapper.classList.remove('open');
            if (prevTile) prevTile.classList.remove('open');
        }

        if (isOpening) {
            wrapper.classList.add('open');
            tileElement.classList.add('open');
            expandedTileId = articleId;
            snapTileToTop(tileElement);
        } else {
            wrapper.classList.remove('open');
            tileElement.classList.remove('open');
            expandedTileId = null;
        }
    }

    function closeTile(articleId, event) {
        if (event) event.stopPropagation();
        const wrapper = document.getElementById(`wrapper-${articleId}`);
        const tile = document.getElementById(`tile-${articleId}`);
        if (wrapper) wrapper.classList.remove('open');
        if (tile) tile.classList.remove('open');
        expandedTileId = null;
    }

    function snapTileToTop(tileElement) {
        setTimeout(() => {
            const currentPivot = document.querySelector('.pivot-item.active');
            if (currentPivot && tileElement) {
                const targetTop = tileElement.offsetTop - 10;
                currentPivot.scrollTo({
                    top: targetTop,
                    behavior: 'smooth'
                });
            }
        }, 150);
    }

    // --- Infinite Looping Pivot Navigation ---
    function initSwipe() {
        const pivotBody = document.getElementById('pivot-body');
        pivotBody.addEventListener('touchstart', e => {
            if (e.target.closest('button')) return;
            touchStartX = e.touches[0].clientX;
        }, { passive: true });

        pivotBody.addEventListener('touchend', e => {
            if (e.target.closest('button')) return;
            touchEndX = e.changedTouches[0].clientX;
            handleSwipe();
        }, { passive: true });
    }

    function handleSwipe() {
        if (touchStartX - touchEndX > swipeThreshold) {
            const nextIdx = (currentPivotIndex + 1) % PIVOT_COUNT;
            switchPivot(nextIdx, 'right');
        } else if (touchEndX - touchStartX > swipeThreshold) {
            const prevIdx = (currentPivotIndex - 1 + PIVOT_COUNT) % PIVOT_COUNT;
            switchPivot(prevIdx, 'left');
        }
    }

    function initHeaderClicks() {
        document.getElementById('pivot-header-container').addEventListener('click', (e) => {
            if (e.target.classList.contains('pivot-header')) {
                const clickedIndex = parseInt(e.target.getAttribute('data-index'), 10);
                if (clickedIndex === currentPivotIndex || isPivotAnimating) return;
                let dir = (currentPivotIndex + 1) % PIVOT_COUNT === clickedIndex ? 'right' : 'left';
                switchPivot(clickedIndex, dir);
            }
        });
    }

    function switchPivot(targetIndex, direction = 'right') {
        if (targetIndex === currentPivotIndex || isPivotAnimating) return;
        isPivotAnimating = true;
        currentPivotIndex = targetIndex;

        const items = document.querySelectorAll('.pivot-item');
        items.forEach((item, i) => {
            if (i === targetIndex) {
                item.classList.toggle('slide-from-left', direction === 'left');
                void item.offsetWidth;
                item.classList.add('active');
                item.classList.remove('slide-from-left');
            } else {
                item.classList.remove('active');
            }
        });

        const headerContainer = document.getElementById('pivot-header-container');
        const headers = Array.from(headerContainer.children);

        headers.forEach(h => {
            const idx = parseInt(h.getAttribute('data-index'), 10);
            h.classList.toggle('active', idx === targetIndex);
        });

        if (direction === 'right') {
            headerContainer.style.transition = 'transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)';
            const moveDist = headerContainer.firstElementChild.offsetWidth + 24;
            headerContainer.style.transform = `translateX(-${moveDist}px)`;
            setTimeout(() => {
                headerContainer.style.transition = 'none';
                headerContainer.appendChild(headerContainer.firstElementChild);
                headerContainer.style.transform = 'translateX(0)';
                isPivotAnimating = false;
            }, 600);
        } else {
            headerContainer.style.transition = 'none';
            headerContainer.insertBefore(headerContainer.lastElementChild, headerContainer.firstElementChild);
            const moveDist = headerContainer.firstElementChild.offsetWidth + 24;
            headerContainer.style.transform = `translateX(-${moveDist}px)`;
            void headerContainer.offsetWidth;
            headerContainer.style.transition = 'transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)';
            headerContainer.style.transform = 'translateX(0)';
            setTimeout(() => { isPivotAnimating = false; }, 600);
        }
    }

    // --- Pinned Articles Storage ---
    function loadPinned() {
        const saved = localStorage.getItem(PINNED_KEY);
        if (saved) {
            try { pinnedArticles = JSON.parse(saved); } catch (e) { pinnedArticles = []; }
        }
    }

    function savePinned() {
        localStorage.setItem(PINNED_KEY, JSON.stringify(pinnedArticles));
        renderPinnedList();
    }

    function togglePin(articleId, event) {
        if (event) event.stopPropagation();
        const allArticles = [
            ...newsData.latest,
            ...newsData.local,
            ...newsData.entertainment,
            ...newsData.tech
        ];
        const article = allArticles.find(item => item.id === articleId) || pinnedArticles.find(item => item.id === articleId);
        if (!article) return;

        const existIndex = pinnedArticles.findIndex(item => item.id === articleId);
        if (existIndex > -1) {
            pinnedArticles.splice(existIndex, 1);
        } else {
            pinnedArticles.push(article);
        }
        savePinned();
        renderAllPivots();
    }

    // --- Settings & Accent Color Control ---
    function initSettings() {
        const settingsStr = localStorage.getItem(SETTINGS_KEY);
        if (settingsStr) {
            try {
                const conf = JSON.parse(settingsStr);
                if (conf.accentColor) setAccentColor(conf.accentColor, false);
                if (conf.fontSize) { fontSizePercent = conf.fontSize; applyFontSize(); }
                if (conf.updateFreq) updateIntervalMins = conf.updateFreq;
            } catch (e) {}
        }
    }

    function setAccentColor(hexColor, save = true) {
        document.documentElement.style.setProperty('--accent-color', hexColor);
        if (save) saveSettings();
        renderAllPivots();
    }

    function changeFontSize(delta) {
        fontSizePercent = Math.max(80, Math.min(150, fontSizePercent + delta));
        applyFontSize();
        saveSettings();
    }

    function resetFontSize() {
        fontSizePercent = 110;
        applyFontSize();
        saveSettings();
    }

    function applyFontSize() {
        document.documentElement.style.fontSize = `${fontSizePercent}%`;
        const label = document.getElementById('font-size-label');
        if (label) label.innerText = `${fontSizePercent}%`;
    }

    function setUpdateFreq(mins) {
        updateIntervalMins = mins;
        saveSettings();
        startAutoUpdate();
        updateSettingsDisplay();
    }

    function saveSettings() {
        const currentAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({
            accentColor: currentAccent,
            fontSize: fontSizePercent,
            updateFreq: updateIntervalMins
        }));
    }

    function updateSettingsDisplay() {
        [5, 15, 30].forEach(m => {
            const btn = document.getElementById(`btn-freq-${m}`);
            if (btn) btn.classList.toggle('accent', m === updateIntervalMins);
        });

        const cacheText = document.getElementById('cache-size-text');
        if (cacheText) {
            const totalItems = (newsData.latest?.length || 0) + (newsData.local?.length || 0) +
                               (newsData.entertainment?.length || 0) + (newsData.tech?.length || 0);
            cacheText.innerText = `cached items: ${totalItems} article(s)`;
        }
    }

    function clearCache() {
        localStorage.removeItem(CACHE_KEY);
        alert('Offline cache cleared.');
        loadNewsData().then(renderAllPivots);
    }

    async function checkApiStatus() {
        const statusText = document.getElementById('api-status-text');
        if (!statusText) return;
        statusText.innerText = 'backend: checking...';
        try {
            const start = Date.now();
            const res = await fetch(WORKER_URL);
            const elapsed = Date.now() - start;
            if (res.ok) {
                statusText.innerText = `backend: 🟢 normal (${elapsed}ms)`;
            } else {
                statusText.innerText = `backend: 🟡 status ${res.status}`;
            }
        } catch (e) {
            statusText.innerText = 'backend: 🔴 offline or unreachable';
        }
    }

    function startAutoUpdate() {
        clearInterval(autoUpdateTimer);
        autoUpdateTimer = setInterval(() => {
            loadNewsData().then(renderAllPivots);
        }, updateIntervalMins * 60 * 1000);
    }

    function initVisibilityAPI() {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                loadNewsData().then(renderAllPivots);
            }
        });
    }

    return {
        init,
        setAccentColor,
        changeFontSize,
        resetFontSize,
        setUpdateFreq,
        clearCache,
        checkApiStatus,
        togglePin,
        closeTile
    };
})();

window.MetroNews = MetroNews;
document.addEventListener('DOMContentLoaded', MetroNews.init);
