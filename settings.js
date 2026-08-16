import { LocalDB } from './utils.js';

let currentThemeBorder = 'border-l-cyan-400';
let currentThemeText = 'text-cyan-400';
let currentThemeBg = 'bg-cyan-500';

export function getThemeClasses() {
    return { currentThemeBorder, currentThemeText, currentThemeBg };
}

export function renderCategoryManager(allBaseCats, getCategories, saveVisibleCategories, saveCustomCategories, onCategoryUpdated) {
    const visibleCatIds = LocalDB.getVisibleCategories();
    const visibilityList = document.getElementById('category-visibility-list');
    
    if (visibilityList) {
        visibilityList.innerHTML = '';
        allBaseCats.forEach((cat) => {
            const isVisible = visibleCatIds.includes(cat.id);
            const label = document.createElement('label');
            label.className = 'flex items-center justify-between bg-[#161a2e]/70 backdrop-blur-md hover:bg-white/10 px-4 py-3 rounded cursor-pointer transition-colors border border-white/10';
            label.innerHTML = `
                <span class="text-base font-light text-gray-200">${cat.name}</span>
                <input type="checkbox" class="w-5 h-5 accent-cyan-500 cursor-pointer" ${isVisible ? 'checked' : ''} data-id="${cat.id}">
            `;
            label.querySelector('input').addEventListener('change', (e) => {
                const targetId = e.target.getAttribute('data-id');
                let updatedVisible = LocalDB.getVisibleCategories();
                if (e.target.checked) {
                    if (!updatedVisible.includes(targetId)) updatedVisible.push(targetId);
                } else {
                    if (updatedVisible.length <= 1) {
                        alert('至少需保留一個板塊顯示！');
                        e.target.checked = true;
                        return;
                    }
                    updatedVisible = updatedVisible.filter(id => id !== targetId);
                }
                saveVisibleCategories(updatedVisible);
                onCategoryUpdated();
            });
            visibilityList.appendChild(label);
        });
    }

    const list = document.getElementById('category-manager-list');
    if (!list) return;
    list.innerHTML = '';
    const categories = getCategories();
    const customCategoriesOnly = categories.filter(cat => cat.isCustom);
    if (customCategoriesOnly.length === 0) {
        list.innerHTML = '<p class="text-gray-400 text-sm py-2">目前沒有自訂追蹤關鍵字。</p>';
        return;
    }
    customCategoriesOnly.forEach((cat) => {
        const realIndex = categories.findIndex(c => c.id === cat.id);
        const row = document.createElement('div');
        row.className = 'flex justify-between items-center bg-[#161a2e]/70 backdrop-blur-md px-4 py-3 mb-2 rounded border border-white/10';
        row.innerHTML = `
            <span class="text-base font-light text-gray-200">${cat.name} <span class="text-[10px] text-cyan-300 ml-1">(關鍵字)</span></span>
            <button class="text-xs uppercase tracking-widest text-red-400 hover:text-red-300 px-3 py-1 border border-red-400/30 rounded" data-delete-index="${realIndex}">刪除</button>
        `;
        row.querySelector('button').addEventListener('click', () => {
            let customCats = LocalDB.getCustomCategories().filter(c => c.id !== cat.id);
            saveCustomCategories(customCats);
            onCategoryUpdated();
        });
        list.appendChild(row);
    });
}

export function initSettings({ onThemeChange, onCategoryUpdated, getCategories, saveVisibleCategories, saveCustomCategories, allBaseCats }) {
    // 1. 新增自訂關鍵字
    document.getElementById('btn-add-cat')?.addEventListener('click', () => {
        const input = document.getElementById('new-cat-input');
        const val = input ? input.value.trim() : '';
        if (val) {
            let customCats = LocalDB.getCustomCategories();
            const newCat = { id: 'custom_' + Date.now(), name: val, isCustom: true, query: val };
            customCats.push(newCat);
            saveCustomCategories(customCats);
            if (input) input.value = ''; 
            onCategoryUpdated();
            renderCategoryManager(allBaseCats, getCategories, saveVisibleCategories, saveCustomCategories, onCategoryUpdated);
        }
    });

    // 2. 主題色彩切換
    const colorButtons = document.querySelectorAll('.color-btn');
    colorButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            colorButtons.forEach(b => { b.classList.remove('border-white'); b.classList.add('border-transparent'); });
            e.target.classList.remove('border-transparent');
            e.target.classList.add('border-white');
            
            currentThemeBg = e.target.getAttribute('data-color');
            currentThemeBorder = e.target.getAttribute('data-border');
            currentThemeText = e.target.getAttribute('data-text');

            onThemeChange();
        });
    });

    // 3. 字型大小調整
    let currentFontSizePercent = parseInt(localStorage.getItem('metro_font_size')) || 110; 
    function updateFontSize() {
        const display = document.getElementById('font-size-display');
        if(display) display.innerText = currentFontSizePercent + '%';
        document.documentElement.style.fontSize = (16 * (currentFontSizePercent / 100)) + 'px';
        localStorage.setItem('metro_font_size', currentFontSizePercent);
    }
    
    document.getElementById('btn-font-minus')?.addEventListener('click', () => { if (currentFontSizePercent > 70) { currentFontSizePercent -= 10; updateFontSize(); } });
    document.getElementById('btn-font-plus')?.addEventListener('click', () => { if (currentFontSizePercent < 150) { currentFontSizePercent += 10; updateFontSize(); } });
    document.getElementById('btn-font-reset')?.addEventListener('click', () => { currentFontSizePercent = 110; updateFontSize(); });

    updateFontSize();
}
