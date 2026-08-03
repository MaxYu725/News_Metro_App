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
    },

    getCustomCategories: () => JSON.parse(localStorage.getItem('metro_news_custom_cats')) || [],
    saveCustomCategories: (data) => localStorage.setItem('metro_news_custom_cats', JSON.stringify(data))
};

// ==========================================
// 【黑科技實裝】智慧影像主題色萃取演算法
// ==========================================
export function extractDynamicColor(imageUrl) {
    return new Promise((resolve) => {
        if (!imageUrl) return resolve(null);
        
        const img = new Image();
        img.crossOrigin = 'Anonymous'; // 嘗試突破 CORS 限制
        
        img.onload = () => {
            try {
                // 建立一張極小的隱形畫布來運算，追求極致效能
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 64;
                canvas.height = 64;
                ctx.drawImage(img, 0, 0, 64, 64);
                
                const data = ctx.getImageData(0, 0, 64, 64).data;
                let r = 0, g = 0, b = 0, count = 0;
                
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] < 255) continue; // 跳過透明像素
                    
                    const cr = data[i], cg = data[i + 1], cb = data[i + 2];
                    // 計算像素亮度 (Luma)
                    const brightness = (cr * 299 + cg * 587 + cb * 114) / 1000;
                    
                    // 過濾掉極端的死黑與純白，保留真正構成影像靈魂的色彩
                    if (brightness > 30 && brightness < 220) {
                        r += cr; 
                        g += cg; 
                        b += cb; 
                        count++;
                    }
                }
                
                if (count > 0) {
                    // 將算出的平均色彩壓暗 40%，確保與白色文字形成高對比 (Metro UI 規範)
                    const finalR = Math.floor((r / count) * 0.6);
                    const finalG = Math.floor((g / count) * 0.6);
                    const finalB = Math.floor((b / count) * 0.6);
                    resolve(`rgb(${finalR}, ${finalG}, ${finalB})`);
                } else {
                    resolve(null);
                }
            } catch (e) {
                // 若圖片伺服器阻擋跨域存取 (Tainted canvas)，安靜地返回 null，保留預設主題色
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = imageUrl;
    });
}
