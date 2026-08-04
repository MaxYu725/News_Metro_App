// 升級至 v3，強制手機與電腦更新！
const CACHE_NAME = 'metro-news-cache-v3';

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
                console.log('Opened cache v3');
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
    if (event.request.url.includes('/api/news') || event.request.url.includes('/api/search') || event.request.url.includes('/api/images') || event.request.url.includes('/api/summarize')) {
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
