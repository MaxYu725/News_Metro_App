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

// 🚀 高對比全螢幕 Metro 幾何背景生成器
export function generateGeometricBackground() {
    let svg = `<svg class="w-full h-full object-cover opacity-75" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">`;
    
    // 1. 高對比點陣網格
    svg += `
        <defs>
            <pattern id="dot-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.2" fill="#ffffff" fill-opacity="0.25"/>
            </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dot-grid)" />
    `;

    // 2. 隨機大幾何圓形 (對比度強化)
    for (let i = 0; i < 3; i++) {
        const cx = Math.floor(Math.random() * 900) + 50;
        const cy = Math.floor(Math.random() * 600) + 50;
        const r = Math.floor(Math.random() * 180) + 100;
        svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" fill-opacity="0.08" stroke="white" stroke-opacity="0.22" stroke-width="1.5" />`;
    }

    // 3. 隨機斜向多邊形 (輪廓強化)
    for (let i = 0; i < 3; i++) {
        const x = Math.floor(Math.random() * 700);
        const y = Math.floor(Math.random() * 400);
        const pts = `${x},${y} ${x + 280 + Math.random() * 100},${y + 60} ${x + 180},${y + 320} ${x - 80},${y + 240}`;
        svg += `<polygon points="${pts}" fill="white" fill-opacity="0.06" stroke="white" stroke-opacity="0.2" stroke-width="1.5" />`;
    }

    // 4. 隨機幾何青藍虛線 (高亮顯示)
    for (let i = 0; i < 4; i++) {
        const x1 = Math.floor(Math.random() * 1000);
        const y1 = Math.floor(Math.random() * 700);
        const x2 = Math.floor(Math.random() * 1000);
        const y2 = Math.floor(Math.random() * 700);
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#38bdf8" stroke-opacity="0.55" stroke-width="1.8" stroke-dasharray="10,6" />`;
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
