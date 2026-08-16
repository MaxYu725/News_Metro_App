const CACHE_NAME = 'metro-news-cache-v8-mui3c';

const URLS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './feed-ui.css',
    './reader-ui.css',
    './app.js',
    './feed-ui.js',
    './reader-ui.js',
    './api.js',
    './utils.js',
    './gestures.js',
    './settings.js',
    './lightbox.js',
    './manifest.json',
    './ic_launcher.png',
    'https://cdn.tailwindcss.com'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(URLS_TO_CACHE))
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
    if (event.request.url.includes('/api/') || event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});
