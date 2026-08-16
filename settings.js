import { LocalDB } from './utils.js';
import {
    TRACKING_CHANGED_EVENT,
    getTrackedCategories,
    trackKeyword,
    untrackKeyword,
    normalizeTrackedKeyword
} from './tracking.js';

const ACCENT_STORAGE_KEY = 'metro_accent_theme_v1';
const ACCENT_OPTIONS = {
    'bg-cyan-500': {
        border: 'border-l-cyan-400',
        text: 'text-cyan-400',
        color: '#22d3ee',
        rgb: '34, 211, 238'
    },
    'bg-blue-600': {
        border: 'border-l-blue-500',
        text: 'text-blue-400',
        color: '#60a5fa',
        rgb: '96, 165, 250'
    },
    'bg-purple-600': {
        border: 'border-l-purple-400',
        text: 'text-purple-400',
        color: '#c084fc',
        rgb: '192, 132, 252'
    },
    'bg-emerald-500': {
        border: 'border-l-emerald-400',
        text: 'text-emerald-400',
        color: '#34d399',
        rgb: '52, 211, 153'
    },
    'bg-orange-500': {
        border: 'border-l-orange-400',
        text: 'text-orange-400',
        color: '#fb923c',
        rgb: '251, 146, 60'
    }
};

let currentThemeBorder = 'border-l-cyan-400';
let currentThemeText = 'text-cyan-400';
let currentThemeBg = 'bg-cyan-500';
let trackingStatusTimer = 0;
let categoryStatusTimer = 0;

const THEME_CSS = `
:root {
    --metro-accent-color: #22d3ee;
    --metro-accent-rgb: 34, 211, 238;
}

.bottom-nav-btn.active::before {
    background: var(--metro-accent-color) !important;
}

.bottom-nav-btn.active .bottom-nav-icon {
    color: var(--metro-accent-color) !important;
}

.loader,
.loader-small {
    border-left-color: var(--metro-accent-color) !important;
}

#lightbox-close:focus-visible,
.subview-back:focus-visible,
.search-submit:focus-visible,
.metro-btn:focus-visible,
.bottom-nav-btn:focus-visible,
.nav-link:focus-visible,
#back-to-top:focus-visible,
.reader-close:focus-visible,
.reader-toolbar-btn:focus-visible,
.data-state-retry:focus-visible,
.pwa-status-action:focus-visible,
#search-view .search-follow-btn:focus-visible,
#search-view .search-chip:focus-visible,
#search-view .search-shortcut-clear:focus-visible,
#search-view .search-clear:focus-visible {
    outline-color: var(--metro-accent-color) !important;
}

.search-follow-btn:not(.is-tracked),
.search-chip.search-chip-tracked {
    border-color: rgba(var(--metro-accent-rgb), 0.30) !important;
    color: var(--metro-accent-color) !important;
}

.search-chip:active {
    border-color: rgba(var(--metro-accent-rgb), 0.46) !important;
}

.search-tracking-status,
[data-tracking-status],
[data-category-status] {
    color: rgba(var(--metro-accent-rgb), 0.78) !important;
}

.pwa-status-card.is-update,
.pwa-status-action {
    border-color: rgba(var(--metro-accent-rgb), 0.34) !important;
}

.pwa-status-action {
    color: var(--metro-accent-color) !important;
}

.settings-accent-control {
    accent-color: var(--metro-accent-color);
}

#settings-view button,
#settings-view input,
.subview-back {
    min-height: 44px;
}

#settings-view .color-btn {
    width: 44px !important;
    height: 44px !important;
    min-width: 44px;
}

#settings-view .settings-font-controls {
    display: grid !important;
    grid-template-columns: minmax(44px, 1fr) auto minmax(44px, 1fr);
    gap: 8px !important;
}

#settings-view .settings-font-controls #btn-font-reset {
    grid-column: 1 / -1;
}

#search-view .search-clear,
#search-view .search-follow-btn,
#search-view .search-shortcut-clear,
#search-view .search-chip {
    min-height: 44px !important;
}

@media (prefers-reduced-motion: reduce) {
    #settings-view * {
        transition: none !important;
    }
}
`;

export function getThemeClasses() {
    return { currentThemeBorder, currentThemeText, currentThemeBg };
}

function installThemeStyles() {
    if (document.getElementById('settings-theme-styles')) return;
    const style = document.createElement('style');
    style.id = 'settings-theme-styles';
    style.textContent = THEME_CSS;
    document.head.appendChild(style);
}

function storedAccentKey() {
    try {
        const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
        return ACCENT_OPTIONS[stored] ? stored : 'bg-cyan-500';
    } catch (error) {
        return 'bg-cyan-500';
    }
}

function syncAccentButtons() {
    document.querySelectorAll('.color-btn').forEach(button => {
        const selected = button.dataset.color === currentThemeBg;
        button.classList.toggle('border-white', selected);
        button.classList.toggle('border-transparent', !selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
}

function applyAccent(key, persist = false) {
    const option = ACCENT_OPTIONS[key] || ACCENT_OPTIONS['bg-cyan-500'];
    currentThemeBg = ACCENT_OPTIONS[key] ? key : 'bg-cyan-500';
    currentThemeBorder = option.border;
    currentThemeText = option.text;

    document.documentElement.style.setProperty('--metro-accent-color', option.color);
    document.documentElement.style.setProperty('--metro-accent-rgb', option.rgb);
    syncAccentButtons();

    if (persist) {
        try {
            localStorage.setItem(ACCENT_STORAGE_KEY, currentThemeBg);
        } catch (error) {}
    }
}

function localizeSettingsChrome() {
    const settings = document.getElementById('settings-view');
    if (!settings) return;

    settings.querySelectorAll('p').forEach(label => {
        const value = label.textContent.trim().toLowerCase();
        if (value === 'accent color') label.textContent = '主題色彩';
        if (value === 'typography size') label.textContent = '字體大小';
    });

    const minus = document.getElementById('btn-font-minus');
    const plus = document.getElementById('btn-font-plus');
    const reset = document.getElementById('btn-font-reset');
    const controls = minus?.parentElement;

    if (controls) controls.classList.add('settings-font-controls');
    if (minus) {
        minus.textContent = 'A−';
        minus.setAttribute('aria-label', '縮小字體');
    }
    if (plus) {
        plus.textContent = 'A＋';
        plus.setAttribute('aria-label', '放大字體');
    }
    if (reset) {
        reset.textContent = '重設字體大小';
        reset.setAttribute('aria-label', '重設字體大小');
    }
}

function ensureCategoryStatus() {
    const list = document.getElementById('category-visibility-list');
    const section = list?.parentElement;
    if (!list || !section) return null;

    let status = section.querySelector('[data-category-status]');
    if (status) return status;

    status = document.createElement('p');
    status.dataset.categoryStatus = '1';
    status.className = 'text-xs min-h-[18px] mt-2';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    section.appendChild(status);
    return status;
}

function setCategoryStatus(message = '') {
    const status = ensureCategoryStatus();
    if (!status) return;

    status.textContent = message;
    if (categoryStatusTimer) window.clearTimeout(categoryStatusTimer);
    categoryStatusTimer = 0;

    if (!message) return;
    categoryStatusTimer = window.setTimeout(() => {
        const current = document.querySelector('[data-category-status]');
        if (current) current.textContent = '';
        categoryStatusTimer = 0;
    }, 2200);
}

function installTrackingSettingChrome() {
    const list = document.getElementById('category-manager-list');
    const input = document.getElementById('new-cat-input');
    const button = document.getElementById('btn-add-cat');
    const section = list?.parentElement;
    if (!list || !input || !button || !section) return;

    const heading = section.querySelector(':scope > p');
    if (heading) heading.textContent = '追蹤主題';

    let help = section.querySelector('[data-tracking-help]');
    if (!help) {
        help = document.createElement('p');
        help.dataset.trackingHelp = '1';
        help.className = 'text-xs text-white/35 leading-relaxed -mt-1';
        heading?.insertAdjacentElement('afterend', help);
    }
    help.textContent = '追蹤後會加入新聞分類，也可在搜尋結果直接管理。';

    input.placeholder = '輸入主題，例如：天氣';
    input.setAttribute('aria-label', '輸入要追蹤的新聞主題');
    input.classList.add('min-h-11');
    button.textContent = '追蹤';
    button.classList.add('min-h-11');

    let status = section.querySelector('[data-tracking-status]');
    if (!status) {
        status = document.createElement('p');
        status.dataset.trackingStatus = '1';
        status.className = 'text-xs min-h-[18px]';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.setAttribute('aria-atomic', 'true');
        section.appendChild(status);
    }
}

function setTrackingStatus(message = '') {
    const status = document.querySelector('[data-tracking-status]');
    if (!status) return;

    status.textContent = message;
    if (trackingStatusTimer) window.clearTimeout(trackingStatusTimer);
    trackingStatusTimer = 0;

    if (!message) return;
    trackingStatusTimer = window.setTimeout(() => {
        const current = document.querySelector('[data-tracking-status]');
        if (current) current.textContent = '';
        trackingStatusTimer = 0;
    }, 2200);
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
                <input type="checkbox" class="settings-accent-control w-5 h-5 cursor-pointer" ${isVisible ? 'checked' : ''} data-id="${cat.id}">
            `;
            label.querySelector('input').addEventListener('change', (e) => {
                const targetId = e.target.getAttribute('data-id');
                let updatedVisible = LocalDB.getVisibleCategories();
                if (e.target.checked) {
                    if (!updatedVisible.includes(targetId)) updatedVisible.push(targetId);
                } else {
                    if (updatedVisible.length <= 1) {
                        e.target.checked = true;
                        setCategoryStatus('至少需保留一個新聞分類。');
                        return;
                    }
                    updatedVisible = updatedVisible.filter(id => id !== targetId);
                }
                saveVisibleCategories(updatedVisible);
                setCategoryStatus('新聞分類已更新。');
                onCategoryUpdated();
            });
            visibilityList.appendChild(label);
        });
        ensureCategoryStatus();
    }

    installTrackingSettingChrome();

    const list = document.getElementById('category-manager-list');
    if (!list) return;
    list.innerHTML = '';

    const tracked = getTrackedCategories();
    if (tracked.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'border border-white/10 bg-[#13182a]/55 px-3 py-3';
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
        row.className = 'flex justify-between items-center gap-3 bg-[#161a2e]/70 backdrop-blur-md px-3 py-2.5 mb-1.5 border border-white/10';

        const title = document.createElement('span');
        title.className = 'min-w-0 block text-base font-light text-gray-100 truncate';
        title.textContent = keyword;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'shrink-0 text-xs tracking-wider text-red-300/80 hover:text-red-200 px-3 min-h-11 border border-red-400/25';
        remove.textContent = '取消';
        remove.setAttribute('aria-label', `取消追蹤 ${keyword}`);
        remove.addEventListener('click', () => {
            untrackKeyword(cat.id);
        });

        row.append(title, remove);
        list.appendChild(row);
    });
}

export function initSettings({ onThemeChange, onCategoryUpdated, getCategories, saveVisibleCategories, saveCustomCategories, allBaseCats }) {
    installThemeStyles();
    localizeSettingsChrome();
    applyAccent(storedAccentKey(), false);
    installTrackingSettingChrome();
    ensureCategoryStatus();

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
        btn.addEventListener('click', event => {
            const target = event.currentTarget;
            const nextAccent = target?.getAttribute('data-color');
            if (!nextAccent || !ACCENT_OPTIONS[nextAccent]) return;
            applyAccent(nextAccent, true);
            onThemeChange();
        });
    });
    syncAccentButtons();

    let currentFontSizePercent = parseInt(localStorage.getItem('metro_font_size')) || 110;
    function updateFontSize() {
        const display = document.getElementById('font-size-display');
        if (display) display.innerText = currentFontSizePercent + '%';
        document.documentElement.style.fontSize = (16 * (currentFontSizePercent / 100)) + 'px';
        localStorage.setItem('metro_font_size', currentFontSizePercent);
    }

    document.getElementById('btn-font-minus')?.addEventListener('click', () => {
        if (currentFontSizePercent > 70) {
            currentFontSizePercent -= 10;
            updateFontSize();
        }
    });
    document.getElementById('btn-font-plus')?.addEventListener('click', () => {
        if (currentFontSizePercent < 150) {
            currentFontSizePercent += 10;
            updateFontSize();
        }
    });
    document.getElementById('btn-font-reset')?.addEventListener('click', () => {
        currentFontSizePercent = 110;
        updateFontSize();
    });

    updateFontSize();
}
