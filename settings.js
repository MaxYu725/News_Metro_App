import { LocalDB } from './utils.js';
import {
    TRACKING_CHANGED_EVENT,
    getTrackedCategories,
    trackKeyword,
    untrackKeyword,
    normalizeTrackedKeyword
} from './tracking.js';

let currentThemeBorder = 'border-l-cyan-400';
let currentThemeText = 'text-cyan-400';
let currentThemeBg = 'bg-cyan-500';

export function getThemeClasses() {
    return { currentThemeBorder, currentThemeText, currentThemeBg };
}

function installTrackingSettingChrome() {
    const list = document.getElementById('category-manager-list');
    const input = document.getElementById('new-cat-input');
    const button = document.getElementById('btn-add-cat');
    const section = list?.parentElement;
    if (!list || !input || !button || !section) return;

    const heading = section.querySelector(':scope > p');
    if (heading) heading.textContent = '追蹤主題';

    if (!section.querySelector('[data-tracking-help]')) {
        const help = document.createElement('p');
        help.dataset.trackingHelp = '1';
        help.className = 'text-xs text-white/35 leading-relaxed -mt-1';
        help.textContent = '追蹤後會直接加入新聞分類；亦可在搜尋結果一鍵追蹤或取消。';
        heading?.insertAdjacentElement('afterend', help);
    }

    input.placeholder = '輸入主題，例如：天氣';
    input.setAttribute('aria-label', '輸入要追蹤的新聞主題');
    button.textContent = '追蹤';

    if (!section.querySelector('[data-tracking-status]')) {
        const status = document.createElement('p');
        status.dataset.trackingStatus = '1';
        status.className = 'text-xs text-cyan-300/70 min-h-[1rem]';
        status.setAttribute('role', 'status');
        section.appendChild(status);
    }
}

function setTrackingStatus(message = '') {
    const status = document.querySelector('[data-tracking-status]');
    if (status) status.textContent = message;
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

    installTrackingSettingChrome();

    const list = document.getElementById('category-manager-list');
    if (!list) return;
    list.innerHTML = '';

    const tracked = getTrackedCategories();
    if (tracked.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'border border-white/10 bg-[#13182a]/55 px-4 py-4';
        empty.innerHTML = `
            <p class="text-sm text-gray-300">未有追蹤主題</p>
            <p class="text-xs text-white/35 mt-1 leading-relaxed">可在下方輸入，或在搜尋結果直接按「追蹤」。</p>
        `;
        list.appendChild(empty);
        return;
    }

    tracked.forEach((cat) => {
        const keyword = normalizeTrackedKeyword(cat.query || cat.name);
        const row = document.createElement('div');
        row.className = 'flex justify-between items-center gap-3 bg-[#161a2e]/70 backdrop-blur-md px-4 py-3 mb-2 border border-white/10';

        const copy = document.createElement('div');
        copy.className = 'min-w-0';

        const title = document.createElement('span');
        title.className = 'block text-base font-light text-gray-100 truncate';
        title.textContent = keyword;

        const meta = document.createElement('span');
        meta.className = 'block text-[10px] uppercase tracking-widest text-cyan-300/60 mt-1';
        meta.textContent = '已加入新聞分類';

        copy.append(title, meta);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'shrink-0 text-xs tracking-wider text-red-300/80 hover:text-red-200 px-3 min-h-9 border border-red-400/25';
        remove.textContent = '取消';
        remove.setAttribute('aria-label', `取消追蹤 ${keyword}`);
        remove.addEventListener('click', () => {
            untrackKeyword(cat.id);
        });

        row.append(copy, remove);
        list.appendChild(row);
    });
}

export function initSettings({ onThemeChange, onCategoryUpdated, getCategories, saveVisibleCategories, saveCustomCategories, allBaseCats }) {
    installTrackingSettingChrome();

    const addTrackedTopic = () => {
        const input = document.getElementById('new-cat-input');
        const value = normalizeTrackedKeyword(input?.value);
        if (!value) {
            setTrackingStatus('請輸入要追蹤的主題。');
            input?.focus();
            return;
        }

        const result = trackKeyword(value);
        if (input) input.value = '';
        setTrackingStatus(result.reason === 'exists' ? `「${value}」已在追蹤中。` : `已追蹤「${value}」。`);
    };

    document.getElementById('btn-add-cat')?.addEventListener('click', addTrackedTopic);
    document.getElementById('new-cat-input')?.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addTrackedTopic();
    });

    window.addEventListener(TRACKING_CHANGED_EVENT, event => {
        onCategoryUpdated();
        renderCategoryManager(
            allBaseCats,
            getCategories,
            saveVisibleCategories,
            saveCustomCategories,
            onCategoryUpdated
        );

        const keyword = normalizeTrackedKeyword(event.detail?.keyword);
        if (keyword && event.detail?.action === 'untrack') {
            setTrackingStatus(`已取消追蹤「${keyword}」。`);
        }
    });

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

    let currentFontSizePercent = parseInt(localStorage.getItem('metro_font_size')) || 110;
    function updateFontSize() {
        const display = document.getElementById('font-size-display');
        if (display) display.innerText = currentFontSizePercent + '%';
        document.documentElement.style.fontSize = (16 * (currentFontSizePercent / 100)) + 'px';
        localStorage.setItem('metro_font_size', currentFontSizePercent);
    }

    document.getElementById('btn-font-minus')?.addEventListener('click', () => { if (currentFontSizePercent > 70) { currentFontSizePercent -= 10; updateFontSize(); } });
    document.getElementById('btn-font-plus')?.addEventListener('click', () => { if (currentFontSizePercent < 150) { currentFontSizePercent += 10; updateFontSize(); } });
    document.getElementById('btn-font-reset')?.addEventListener('click', () => { currentFontSizePercent = 110; updateFontSize(); });

    updateFontSize();
}
