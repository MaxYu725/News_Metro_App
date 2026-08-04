const API_BASE_URL = 'https://news-proxy.maxyu0725.workers.dev/api/news/';
const SEARCH_API_URL = 'https://news-proxy.maxyu0725.workers.dev/api/search';
const IMAGE_API_URL = 'https://news-proxy.maxyu0725.workers.dev/api/images';
const AI_API_URL = 'https://news-proxy.maxyu0725.workers.dev/api/summarize';

export async function fetchNewsData(categoryId, page, forceSync = false, searchQuery = '') {
    let url;
    if (categoryId === 'search') {
        url = `${SEARCH_API_URL}?q=${encodeURIComponent(searchQuery)}&page=${page}`;
    } else {
        url = `${API_BASE_URL}${categoryId}?page=${page}${forceSync ? '&sync=1' : ''}`;
    }

    try {
        const response = await fetch(url);
        const result = await response.json();
        if (result.success) {
            return { success: true, data: result.data, hasMore: result.hasMore };
        } else {
            return { success: false, data: [], hasMore: false, error: result.error };
        }
    } catch (error) {
        return { success: false, data: [], hasMore: false, error: '無法連接到伺服器' };
    }
}

export async function fetchImageData(query, page) {
    try {
        const response = await fetch(`${IMAGE_API_URL}?q=${encodeURIComponent(query)}&page=${page + 1}`);
        const result = await response.json();
        return result.success ? result : { success: false, data: [], hasMore: false, error: result.error };
    } catch (e) {
        return { success: false, data: [], hasMore: false, error: '圖庫連接失敗' };
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
