const CACHE_NAME = 'metro-news-cache-v2';

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

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache v2');
                return cache.addAll(URLS_TO_CACHE);
            })
    );
    self.skipWaiting();
});

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

self.addEventListener('fetch', event => {
    // 修正：所有 API 請求（含 /api/news, /api/summarize, /api/article-full 等）及非 GET 請求均跳過 Service Worker
    if (event.request.url.includes('/api/') || event.request.method !== 'GET') {
        return; 
    }
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});
