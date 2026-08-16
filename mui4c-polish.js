import { TRACKING_CHANGED_EVENT } from './tracking.js';

let statusTimer = 0;

const CSS = `
#search-view .search-meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 32px;
    margin-top: 5px;
}

#search-view .search-meta-row .search-hint {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#search-view .search-meta-row .search-follow-row {
    flex: 0 0 auto;
    margin: 0;
}

#search-view .search-meta-row .search-follow-btn {
    min-height: 32px;
    padding: 0 10px;
    font-size: 0.68rem;
}

#search-view .search-shortcuts {
    margin-top: 2px;
}

#search-view .search-shortcut-group {
    margin-top: 8px;
}

#search-view .search-shortcut-heading {
    margin-bottom: 5px;
}

#search-view .search-shortcut-clear {
    min-height: 32px;
}

#search-view .search-chip {
    min-height: 32px;
    line-height: 30px;
    padding-inline: 10px;
}

#search-view .search-follow-btn:focus-visible,
#search-view .search-chip:focus-visible,
#search-view .search-shortcut-clear:focus-visible,
#search-view .search-clear:focus-visible,
#search-view .search-submit:focus-visible {
    outline: 2px solid rgba(56, 189, 248, 0.78);
    outline-offset: 2px;
}

#settings-view [data-tracking-help] {
    margin-top: -4px !important;
    line-height: 1.45;
}

#settings-view #category-manager-list {
    gap: 0 !important;
}

#settings-view #category-manager-list > div {
    margin-bottom: 6px !important;
    padding: 10px 12px !important;
}

#settings-view #category-manager-list button {
    min-height: 40px;
}

#settings-view #new-cat-input,
#settings-view #btn-add-cat {
    min-height: 44px;
}

#settings-view [data-tracking-status] {
    min-height: 0 !important;
    margin-top: -2px;
    transition: opacity 140ms ease;
}

#settings-view [data-tracking-status]:empty {
    display: none;
}

#settings-view #category-manager-list button:focus-visible,
#settings-view #new-cat-input:focus-visible,
#settings-view #btn-add-cat:focus-visible {
    outline: 2px solid rgba(56, 189, 248, 0.78);
    outline-offset: 2px;
}

@media (max-width: 420px) {
    #search-view .search-meta-row {
        gap: 8px;
    }

    #search-view .search-meta-row .search-follow-btn {
        padding-inline: 9px;
    }
}

@media (prefers-reduced-motion: reduce) {
    #settings-view [data-tracking-status] {
        transition: none;
    }
}
`;

function installStyles() {
    if (document.getElementById('mui4c-polish-styles')) return;
    const style = document.createElement('style');
    style.id = 'mui4c-polish-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
}

function compactFollowButton() {
    const button = document.querySelector('[data-search-follow]');
    if (!button) return;

    const next = button.classList.contains('is-tracked') ? '✓ 已追蹤' : '＋ 追蹤';
    if (button.textContent !== next) button.textContent = next;
}

function ensureSearchMetaRow() {
    const hint = document.getElementById('search-hint');
    const followRow = document.querySelector('[data-search-follow-row]');
    if (!hint || !followRow) return false;

    let metaRow = document.querySelector('#search-view .search-meta-row');
    if (!metaRow) {
        metaRow = document.createElement('div');
        metaRow.className = 'search-meta-row';
        hint.parentElement?.insertBefore(metaRow, hint);
        metaRow.append(hint, followRow);
    } else {
        if (hint.parentElement !== metaRow) metaRow.prepend(hint);
        if (followRow.parentElement !== metaRow) metaRow.append(followRow);
    }

    compactFollowButton();
    return true;
}

function polishTrackingSettings() {
    const help = document.querySelector('[data-tracking-help]');
    if (help) help.textContent = '追蹤後會加入新聞分類，也可在搜尋結果直接管理。';

    const list = document.getElementById('category-manager-list');
    if (list) {
        list.querySelectorAll('span').forEach(span => {
            if (span.textContent.trim() === '已加入新聞分類') span.hidden = true;
        });
    }

    const status = document.querySelector('[data-tracking-status]');
    if (status) {
        status.setAttribute('aria-live', 'polite');
        status.setAttribute('aria-atomic', 'true');
    }
}

function scheduleStatusClear() {
    const status = document.querySelector('[data-tracking-status]');
    if (!status || !status.textContent.trim()) return;

    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
        const current = document.querySelector('[data-tracking-status]');
        if (current) current.textContent = '';
        statusTimer = 0;
    }, 2200);
}

function installObservers() {
    const searchView = document.getElementById('search-view');
    if (searchView) {
        const searchObserver = new MutationObserver(() => {
            ensureSearchMetaRow();
            compactFollowButton();
        });
        searchObserver.observe(searchView, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'hidden']
        });
    }

    const settingsView = document.getElementById('settings-view');
    if (settingsView) {
        const settingsObserver = new MutationObserver(() => {
            polishTrackingSettings();
            scheduleStatusClear();
        });
        settingsObserver.observe(settingsView, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    window.addEventListener(TRACKING_CHANGED_EVENT, () => {
        requestAnimationFrame(() => {
            ensureSearchMetaRow();
            compactFollowButton();
            polishTrackingSettings();
            scheduleStatusClear();
        });
    });
}

function initMui4cPolish() {
    installStyles();
    ensureSearchMetaRow();
    polishTrackingSettings();
    scheduleStatusClear();
    installObservers();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMui4cPolish, { once: true });
} else {
    initMui4cPolish();
}
