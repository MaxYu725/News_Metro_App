const API_BASE_URL = 'https://news-proxy.maxyu0725.workers.dev/api/news/';
const SEARCH_API_URL = 'https://news-proxy.maxyu0725.workers.dev/api/search';
// 全新：圖庫 API 路由
const IMAGE_API_URL = 'https://news-proxy.maxyu0725.workers.dev/api/images';

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

// 專門用於獲取圖庫資料的函數
export async function fetchImageData(query, page) {
    try {
        // 我們的頁數從 0 開始，但 Pixabay 從 1 開始，所以 page + 1
        const response = await fetch(`${IMAGE_API_URL}?q=${encodeURIComponent(query)}&page=${page + 1}`);
        const result = await response.json();
        return result.success ? result : { success: false, data: [], hasMore: false, error: result.error };
    } catch (e) {
        return { success: false, data: [], hasMore: false, error: '圖庫連接失敗' };
    }
}
