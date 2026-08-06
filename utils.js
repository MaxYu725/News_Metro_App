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

export function generateGeometricBackground() {
    let svg = `<svg class="geo-bg" viewBox="0 0 400 600" xmlns="http://www.w3.org/2000/svg">`;
    const cx = 50 + Math.random() * 300;
    const cy = 50 + Math.random() * 200;
    const r = 100 + Math.random() * 150;
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" fill-opacity="0.08" />`;
    for (let i = 0; i < (1 + Math.floor(Math.random() * 2)); i++) {
        const x = Math.random() * 300;
        const y = Math.random() * 300;
        const pts = `${x},${y} ${x+250},${y+80} ${x+180},${y+350} ${x-70},${y+270}`;
        svg += `<polygon points="${pts}" fill="white" fill-opacity="0.05" />`;
    }
    svg += `</svg>`;
    return svg;
}

export const LocalDB = {
    getBookmarks: () => {
        try { const data = localStorage.getItem('metro_news_bookmarks'); return data ? JSON.parse(data) : {}; } 
        catch (e) { return {}; }
    },
    saveBookmarks: (data) => {
        try { localStorage.setItem('metro_news_bookmarks', JSON.stringify(data)); } 
        catch (e) { alert('⚠️ 系統儲存空間不足！請嘗試清理手機瀏覽器快取。'); }
    },
    getHistory: () => {
        try { return JSON.parse(localStorage.getItem('metro_news_read_history')) || {}; } catch(e){ return {}; }
    },
    saveHistory: (data) => {
        const keys = Object.keys(data);
        if (keys.length > 1000) {
            const sortedKeys = keys.sort((a, b) => data[b] - data[a]);
            const newHistory = {};
            sortedKeys.slice(0, 500).forEach(k => newHistory[k] = data[k]);
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
    // 新增：新聞來源偏好儲存
    getEnabledSources: () => {
        try { return JSON.parse(localStorage.getItem('metro_news_sources')) || ['明報', '香港01', '東網']; } catch(e){ return ['明報', '香港01', '東網']; }
    },
    saveEnabledSources: (data) => {
        try { localStorage.setItem('metro_news_sources', JSON.stringify(data)); } catch(e){}
    }
};
