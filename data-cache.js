const FEED_CACHE_KEY = 'metro_news_feed_cache_v1';
const MAX_ENTRIES = 8;
const MAX_ITEMS_PER_ENTRY = 24;
const MAX_DESCRIPTION_CHARS = 1400;

function readStore() {
    try {
        const parsed = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
}

function writeStore(store) {
    try {
        localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(store));
        return true;
    } catch (error) {
        return false;
    }
}

function normalizeQuery(value = '') {
    return String(value).replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function cacheKey(categoryId, searchQuery = '') {
    if (categoryId === 'search') {
        return `search:${encodeURIComponent(normalizeQuery(searchQuery))}`;
    }
    return `news:${String(categoryId || 'latest')}`;
}

function sanitizeArticle(article) {
    if (!article || typeof article !== 'object') return null;
    const copy = { ...article };
    delete copy.isFullContentLoaded;
    if (typeof copy.description === 'string' && copy.description.length > MAX_DESCRIPTION_CHARS) {
        copy.description = `${copy.description.slice(0, MAX_DESCRIPTION_CHARS).trim()}…`;
    }
    return copy;
}

function pruneStore(store) {
    const entries = Object.entries(store)
        .filter(([, value]) => value && Array.isArray(value.data))
        .sort((a, b) => Number(b[1].savedAt || 0) - Number(a[1].savedAt || 0));

    return Object.fromEntries(entries.slice(0, MAX_ENTRIES));
}

export function getCachedFeed(categoryId, searchQuery = '') {
    const store = readStore();
    const entry = store[cacheKey(categoryId, searchQuery)];
    if (!entry || !Array.isArray(entry.data) || entry.data.length === 0) return null;

    return {
        data: entry.data,
        hasMore: !!entry.hasMore,
        savedAt: Number(entry.savedAt || 0)
    };
}

export function saveCachedFeed(categoryId, searchQuery, data, hasMore = false) {
    if (!Array.isArray(data) || data.length === 0) return false;

    const sanitized = data
        .slice(0, MAX_ITEMS_PER_ENTRY)
        .map(sanitizeArticle)
        .filter(Boolean);

    if (sanitized.length === 0) return false;

    const store = readStore();
    store[cacheKey(categoryId, searchQuery)] = {
        categoryId,
        query: categoryId === 'search' ? String(searchQuery || '').trim() : '',
        savedAt: Date.now(),
        hasMore: !!hasMore,
        data: sanitized
    };

    return writeStore(pruneStore(store));
}
