const PAGE_CONFIG = {
    news: {
        title: '新聞',
        subtitle: '最新新聞、分類與追蹤主題'
    },
    search: {
        title: '搜尋',
        subtitle: '搜尋新聞資料庫'
    },
    bookmarks: {
        title: '收藏',
        subtitle: '已收藏的新聞'
    },
    settings: {
        title: '設定',
        subtitle: '新聞分類、追蹤與外觀'
    },
    gallery: {
        title: '圖庫',
        subtitle: '圖片靈感搜尋'
    }
};

function activeSection() {
    const gallery = document.getElementById('gallery-view');
    if (gallery && !gallery.classList.contains('hidden')) return 'gallery';

    const activeButton = document.querySelector('#bottom-nav .bottom-nav-btn[aria-current="page"]');
    return activeButton?.dataset.section || 'news';
}

function bookmarkCount() {
    const sectionHeading = document.querySelector('#news-grid > .section-heading span');
    const text = sectionHeading?.textContent?.trim();
    if (text) return text;

    const emptyHeading = document.querySelector('#news-grid > .section-heading');
    if (emptyHeading) return '0 篇';
    return '';
}

function syncPageHeader() {
    const header = document.getElementById('app-header');
    const title = document.getElementById('page-title');
    const subtitle = document.getElementById('page-subtitle');
    const meta = document.getElementById('page-meta');
    const back = document.getElementById('page-header-back');
    const categoryStrip = document.getElementById('category-strip');
    if (!header || !title || !subtitle || !meta || !back || !categoryStrip) return;

    const section = activeSection();
    const config = PAGE_CONFIG[section] || PAGE_CONFIG.news;

    header.dataset.section = section;
    title.textContent = config.title;
    subtitle.textContent = config.subtitle;

    const count = section === 'bookmarks' ? bookmarkCount() : '';
    meta.textContent = count;
    meta.classList.toggle('hidden', !count);

    back.classList.toggle('hidden', section !== 'gallery');
    categoryStrip.classList.toggle('hidden', section !== 'news');
}

function installShellObservers() {
    const bottomNav = document.getElementById('bottom-nav');
    const newsGrid = document.getElementById('news-grid');
    const watchedViews = [
        document.getElementById('search-view'),
        document.getElementById('gallery-view'),
        document.getElementById('settings-view')
    ].filter(Boolean);

    const syncSoon = () => window.requestAnimationFrame(syncPageHeader);

    if (bottomNav) {
        new MutationObserver(syncSoon).observe(bottomNav, {
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'aria-current']
        });
    }

    watchedViews.forEach(view => {
        new MutationObserver(syncSoon).observe(view, {
            attributes: true,
            attributeFilter: ['class']
        });
    });

    if (newsGrid) {
        new MutationObserver(syncSoon).observe(newsGrid, {
            childList: true,
            subtree: true
        });
    }

    document.getElementById('page-header-back')?.addEventListener('click', () => {
        document.getElementById('gallery-back')?.click();
    });

    document.querySelectorAll('#bottom-nav .bottom-nav-btn').forEach(button => {
        button.addEventListener('click', syncSoon);
    });

    syncSoon();
    window.setTimeout(syncPageHeader, 120);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installShellObservers, { once: true });
} else {
    installShellObservers();
}
