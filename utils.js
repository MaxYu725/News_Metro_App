// 計算時間差
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

// 隨機生成 Metro 風格幾何背景
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

// 本機資料管理庫
export const LocalDB = {
    getBookmarks: () => JSON.parse(localStorage.getItem('metro_news_bookmarks')) || {},
    saveBookmarks: (data) => localStorage.setItem('metro_news_bookmarks', JSON.stringify(data)),
    
    getHistory: () => JSON.parse(localStorage.getItem('metro_news_read_history')) || {},
    saveHistory: (data) => {
        const keys = Object.keys(data);
        if (keys.length > 1000) {
            const sortedKeys = keys.sort((a, b) => data[b] - data[a]);
            const keysToKeep = sortedKeys.slice(0, 500);
            const newHistory = {};
            keysToKeep.forEach(k => newHistory[k] = data[k]);
            data = newHistory;
        }
        localStorage.setItem('metro_news_read_history', JSON.stringify(data));
    }
};
