import { getCachedFeed, saveCachedFeed } from './data-cache.js';

const API_BASE_URL = 'https://news-proxy.maxyu0725us.workers.dev/api/news/';
const SEARCH_API_URL = 'https://news-proxy.maxyu0725us.workers.dev/api/search';
const IMAGE_API_URL = 'https://news-proxy.maxyu0725us.workers.dev/api/images';
const AI_API_URL = 'https://news-proxy.maxyu0725us.workers.dev/api/summarize';
const ARTICLE_FULL_API_URL = 'https://news-proxy.maxyu0725us.workers.dev/api/article-full';

export const DATA_STATE_EVENT = 'metro:data-state';

function emitDataState(detail) {
    if (typeof window === 'undefined') return;
    window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(DATA_STATE_EVENT, { detail }));
    }, 0);
}

function newsContext(categoryId) {
    return categoryId === 'search' ? 'search' : 'news';
}

function errorMessage(error, fallback) {
    const message = String(error?.message || error || '').trim();
    return message || fallback;
}

function fallbackNewsResult(categoryId, page, searchQuery, error, append = false) {
    const context = newsContext(categoryId);
    const message = errorMessage(error, '暫時無法連接新聞服務');
    const cached = page === 0 ? getCachedFeed(categoryId, searchQuery) : null;

    if (cached?.data?.length) {
        emitDataState({
            context,
            status: 'stale',
            error: message,
            cachedAt: cached.savedAt,
            query: searchQuery,
            append
        });
        return {
            success: true,
            data: cached.data,
            hasMore: false,
            stale: true,
            cachedAt: cached.savedAt,
            error: message
        };
    }

    emitDataState({
        context,
        status: 'error',
        error: message,
        query: searchQuery,
        append
    });
    return { success: false, data: [], hasMore: false, error: message };
}

function searchCodePointLength(value) {
    return Array.from(String(value || '')).length;
}

function fallbackSearchResult(searchQuery, error, { append = false, mode = 'live' } = {}) {
    const message = errorMessage(error, '暫時無法連接搜尋服務');
    const cached = !append ? getCachedFeed('search', searchQuery) : null;

    if (cached?.data?.length) {
        emitDataState({
            context: 'search',
            status: 'stale',
            error: message,
            cachedAt: cached.savedAt,
            query: searchQuery,
            append
        });
        return {
            success: true,
            data: cached.data,
            hasMore: false,
            nextCursor: '',
            mode,
            stale: true,
            cachedAt: cached.savedAt,
            error: message
        };
    }

    emitDataState({ context: 'search', status: 'error', error: message, query: searchQuery, append });
    return { success: false, data: [], hasMore: false, nextCursor: '', mode, error: message };
}

export async function fetchNewsData(categoryId, page, forceSync = false, searchQuery = '') {
    let url;
    if (categoryId === 'search') {
        url = `${SEARCH_API_URL}?q=${encodeURIComponent(searchQuery)}&page=${page}`;
    } else {
        url = `${API_BASE_URL}${categoryId}?page=${page}${forceSync ? '&sync=1' : ''}`;
    }

    const context = newsContext(categoryId);

    try {
        const response = await fetch(url);
        let result;
        try {
            result = await response.json();
        } catch (parseError) {
            throw new Error(`伺服器回應格式錯誤 (${response.status || 'unknown'})`);
        }

        if (!response.ok) {
            return fallbackNewsResult(
                categoryId,
                page,
                searchQuery,
                result?.error || `新聞服務暫時無法回應 (${response.status})`,
                page > 0
            );
        }

        if (result.success) {
            const updatedAt = Date.now();
            if (page === 0 && Array.isArray(result.data) && result.data.length > 0) {
                saveCachedFeed(categoryId, searchQuery, result.data, result.hasMore);
            }
            emitDataState({ context, status: 'ok', query: searchQuery, append: page > 0, updatedAt });
            return { success: true, data: result.data || [], hasMore: !!result.hasMore, updatedAt };
        }

        return fallbackNewsResult(
            categoryId,
            page,
            searchQuery,
            result.error || '新聞服務暫時無法回應',
            page > 0
        );
    } catch (error) {
        return fallbackNewsResult(categoryId, page, searchQuery, error, page > 0);
    }
}

export async function fetchSearchData(searchQuery, { cursor = '', page = 0, includeArchive = true } = {}) {
    const query = String(searchQuery || '').trim();
    const useArchive = includeArchive && searchCodePointLength(query) >= 3;
    const mode = useArchive ? 'archive' : 'live';
    const append = useArchive ? !!cursor : page > 0;
    const params = new URLSearchParams({ q: query });

    if (useArchive) {
        params.set('scope', 'all');
        if (cursor) params.set('cursor', cursor);
    } else {
        params.set('page', String(page));
    }

    try {
        const response = await fetch(`${SEARCH_API_URL}?${params.toString()}`);
        let result;
        try {
            result = await response.json();
        } catch {
            throw new Error(`搜尋服務回應格式錯誤 (${response.status || 'unknown'})`);
        }

        if (!response.ok || !result.success) {
            return fallbackSearchResult(
                query,
                result?.error || `搜尋服務暫時無法回應 (${response.status})`,
                { append, mode }
            );
        }

        const updatedAt = Date.now();
        const data = Array.isArray(result.data) ? result.data : [];
        if (!append && data.length > 0) {
            saveCachedFeed('search', query, data, !!result.hasMore);
        }
        emitDataState({ context: 'search', status: 'ok', query, append, updatedAt });
        return {
            success: true,
            data,
            hasMore: !!result.hasMore,
            nextCursor: useArchive ? String(result.nextCursor || '') : '',
            mode,
            page,
            updatedAt
        };
    } catch (error) {
        return fallbackSearchResult(query, error, { append, mode });
    }
}

export async function fetchImageData(query, page) {
    try {
        const response = await fetch(`${IMAGE_API_URL}?q=${encodeURIComponent(query)}&page=${page + 1}`);
        let result;
        try {
            result = await response.json();
        } catch (parseError) {
            throw new Error(`圖庫回應格式錯誤 (${response.status || 'unknown'})`);
        }

        if (!response.ok || !result.success) {
            const message = result?.error || `圖庫服務暫時無法回應 (${response.status})`;
            emitDataState({ context: 'gallery', status: 'error', error: message, query, append: page > 0 });
            return { success: false, data: [], hasMore: false, error: message };
        }

        const updatedAt = Date.now();
        emitDataState({ context: 'gallery', status: 'ok', query, append: page > 0, updatedAt });
        return { ...result, updatedAt };
    } catch (error) {
        const message = errorMessage(error, '圖庫連接失敗');
        emitDataState({ context: 'gallery', status: 'error', error: message, query, append: page > 0 });
        return { success: false, data: [], hasMore: false, error: message };
    }
}

export async function fetchAISummary(text) {
    try {
        const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const result = await response.json();
        return result.success ? result : { success: false, error: result.error };
    } catch (e) {
        return { success: false, error: 'AI 伺服器無回應' };
    }
}

export async function fetchFullArticleContent(targetUrl) {
    try {
        const response = await fetch(`${ARTICLE_FULL_API_URL}?url=${encodeURIComponent(targetUrl)}`);
        const result = await response.json();
        return result.success ? result : { success: false, error: result.error };
    } catch (e) {
        return { success: false, error: '擷取全文失敗' };
    }
}
