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
    }
};

export function extractDynamicColor(imageUrl) {
    return new Promise((resolve) => {
        if (!imageUrl) return resolve(null);
        const img = new Image();
        img.crossOrigin = 'Anonymous'; 
        const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}&w=64&h=64&fit=cover`;
        
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 64;
                canvas.height = 64;
                ctx.drawImage(img, 0, 0, 64, 64);
                
                const data = ctx.getImageData(0, 0, 64, 64).data;
                let r = 0, g = 0, b = 0, count = 0;
                
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] < 255) continue; 
                    const cr = data[i], cg = data[i + 1], cb = data[i + 2];
                    const brightness = (cr * 299 + cg * 587 + cb * 114) / 1000;
                    const colorfulness = Math.max(cr, cg, cb) - Math.min(cr, cg, cb);
                    if (brightness > 40 && brightness < 220 && colorfulness > 30) {
                        r += cr; g += cg; b += cb; count++;
                    }
                }
                
                if (count < 50) {
                    r = 0; g = 0; b = 0; count = 0;
                    for (let i = 0; i < data.length; i += 4) {
                        if (data[i + 3] < 255) continue; 
                        const cr = data[i], cg = data[i + 1], cb = data[i + 2];
                        const brightness = (cr * 299 + cg * 587 + cb * 114) / 1000;
                        if (brightness > 30 && brightness < 230) { r += cr; g += cg; b += cb; count++; }
                    }
                }
                
                if (count > 0) {
                    const finalR = Math.floor((r / count) * 0.85);
                    const finalG = Math.floor((g / count) * 0.85);
                    const finalB = Math.floor((b / count) * 0.85);
                    resolve(`rgb(${finalR}, ${finalG}, ${finalB})`);
                } else {
                    resolve(null);
                }
            } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = proxyUrl;
    });
}
