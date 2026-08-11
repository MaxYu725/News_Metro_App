export function timeAgo(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.round(diffMs / 60000);
    
    if (diffMins < 60) return `${diffMins} 分鐘前`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} 小時前`;
    return `${Math.floor(diffHours / 24)} 天前`;
}

// 🚀 低端機 GPU 優化：極簡化 SVG 背景，大幅降低繪製負擔
export function generateGeometricBackground() {
    const cx = 80 + Math.floor(Math.random() * 200);
    const cy = 60 + Math.floor(Math.random() * 150);
    const r = 80 + Math.floor(Math.random() * 80);
    return `<svg class="geo-bg" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><circle cx="${cx}" cy="${cy}" r="${r}" fill="white" fill-opacity="0.04" /></svg>`;
}

export const LocalDB = {
    getBookmarks: () => {
        try { const data = localStorage.getItem('metro_news_bookmarks'); return data ? JSON.parse(data) : {}; } 
        catch (e) { return {}; }
    },
    saveBookmarks: (data) => {
        try { localStorage.setItem('metro_news_bookmarks', JSON.stringify(data)); } 
        catch (e) { alert('⚠️ 系統儲存空間不足！'); }
    },
    getHistory: () => {
        try { return JSON.parse(localStorage.getItem('metro_news_read_history')) || {}; } catch(e){ return {}; }
    },
    saveHistory: (data) => {
        const keys = Object.keys(data);
        if (keys.length > 500) {
            const sortedKeys = keys.sort((a, b) => data[b] - data[a]);
            const newHistory = {};
            sortedKeys.slice(0, 300).forEach(k => newHistory[k] = data[k]);
            data = newHistory;
        }
        try { localStorage.setItem('metro_news_read_history', JSON.stringify(data)); } catch(e){}
    },
    getCustomCategories: () => {
        try { return JSON.parse(localStorage.getItem('metro_news_custom_cats')) || []; } catch(e){ return []; }
    },
    saveCustomCategories: (data) => {
        try { localStorage.setItem('metro_news_custom_cats', JSON.stringify(data)); } catch(e){}
    },
    getVisibleCategories: () => {
        try {
            const data = localStorage.getItem('metro_news_visible_cats');
            return data ? JSON.parse(data) : ['latest', 'local', 'global'];
        } catch (e) {
            return ['latest', 'local', 'global'];
        }
    },
    saveVisibleCategories: (data) => {
        try { localStorage.setItem('metro_news_visible_cats', JSON.stringify(data)); } catch(e){}
    },
    getAISummaries: () => {
        try { return JSON.parse(localStorage.getItem('metro_news_ai_cache')) || {}; } catch(e){ return {}; }
    },
    saveAISummary: (link, summary) => {
        try {
            const cache = LocalDB.getAISummaries();
            cache[link] = summary;
            const keys = Object.keys(cache);
            if (keys.length > 300) {
                delete cache[keys[0]];
            }
            localStorage.setItem('metro_news_ai_cache', JSON.stringify(cache));
        } catch(e){}
    }
};
