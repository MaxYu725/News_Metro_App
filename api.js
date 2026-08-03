const API_BASE_URL = 'https://news-proxy.maxyu0725.workers.dev/api/news/';
const SEARCH_API_URL = 'https://news-proxy.maxyu0725.workers.dev/api/search';

// 封裝取得新聞的 API 呼叫
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
