const CACHE_NAME = 'metro-news-cache-v1';

// 需要被快取到手機裡的核心靜態檔案
const URLS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './api.js',
    './utils.js',
    './manifest.json',
    './ic_launcher.png',
    'https://cdn.tailwindcss.com'
];

// 安裝階段：將檔案寫入快取
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(URLS_TO_CACHE);
            })
    );
    // 強制立即接管控制權
    self.skipWaiting();
});

// 啟動階段：清除舊版本的快取
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// 攔截網路請求 (Cache First 策略)
self.addEventListener('fetch', event => {
    // 針對 API 請求，我們永遠使用網路抓取最新資料 (Network Only)
    if (event.request.url.includes('/api/news') || event.request.url.includes('/api/search')) {
        return; 
    }

    // 針對靜態檔案 (HTML, CSS, JS)，優先使用快取，沒有快取再找網路
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // 如果快取中有，直接秒回傳
                if (response) {
                    return response;
                }
                // 否則向網路請求
                return fetch(event.request);
            })
    );
});
