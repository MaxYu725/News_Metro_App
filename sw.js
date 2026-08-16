const APP_CACHE_PREFIX = 'metro-news-';
const SHELL_CACHE = 'metro-news-shell-v15-mui5b';
const RUNTIME_CACHE = 'metro-news-runtime-v1';

const SHELL_URLS = [
    './',
    './index.html',
    './style.css',
    './feed-ui.css',
    './reader-ui.css',
    './app.js',
    './feed-ui.js',
    './search-ui.js',
    './reader-ui.js',
    './data-state-ui.js',
    './pwa-state.js',
    './api.js',
    './data-cache.js',
    './utils.js',
    './tracking.js',
    './gestures.js',
    './settings.js',
    './lightbox.js',
    './manifest.json',
    './ic_launcher.png'
];

const OPTIONAL_RUNTIME_URLS = [
    'https://cdn.tailwindcss.com'
];

async function precacheShell() {
    const shellCache = await caches.open(SHELL_CACHE);
    await shellCache.addAll(SHELL_URLS);

    const runtimeCache = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(
        OPTIONAL_RUNTIME_URLS.map(url => runtimeCache.add(url))
    );
}

async function cleanupOldCaches() {
    const cacheNames = await caches.keys();
    await Promise.all(
        cacheNames.map(cacheName => {
            if (!cacheName.startsWith(APP_CACHE_PREFIX)) return Promise.resolve(false);
            if (cacheName === SHELL_CACHE || cacheName === RUNTIME_CACHE) return Promise.resolve(false);
            return caches.delete(cacheName);
        })
    );
}

async function networkFirst(request, fallbackUrl) {
    try {
        const response = await fetch(request);
        if (response?.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (fallbackUrl) {
            const fallback = await caches.match(fallbackUrl);
            if (fallback) return fallback;
        }
        throw error;
    }
}

async function staleWhileRevalidate(request) {
    const cached = await caches.match(request);
    const networkPromise = fetch(request)
        .then(async response => {
            if (response?.ok) {
                const cache = await caches.open(SHELL_CACHE);
                await cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);

    if (cached) {
        networkPromise.catch(() => {});
        return cached;
    }

    const network = await networkPromise;
    if (network) return network;
    return Response.error();
}

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response?.ok || response?.type === 'opaque') {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(request, response.clone()).catch(() => {});
    }
    return response;
}

self.addEventListener('install', event => {
    event.waitUntil(precacheShell());
});

self.addEventListener('activate', event => {
    event.waitUntil(
        cleanupOldCaches().then(() => self.clients.claim())
    );
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const isApiRequest = url.hostname === 'news-proxy.maxyu0725us.workers.dev'
        || url.pathname.includes('/api/');

    if (isApiRequest) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, './index.html'));
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    if (OPTIONAL_RUNTIME_URLS.some(runtimeUrl => request.url.startsWith(runtimeUrl))) {
        event.respondWith(cacheFirst(request));
    }
});
