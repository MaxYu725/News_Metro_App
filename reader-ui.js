import { openLightbox } from './lightbox.js';

let overlay = null;
let sourceTile = null;
let sourceObserver = null;
let savedScrollTop = 0;
let pendingOpen = null;
let historyPushed = false;
let closingProgrammatically = false;
let restoreFocusTarget = null;

const DOM = {};

function ensureOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'reader-overlay';
    overlay.className = 'reader-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '新聞閱讀器');
    overlay.innerHTML = `
        <div class="reader-shell">
            <header class="reader-toolbar">
                <button type="button" class="reader-close" aria-label="返回新聞列表">←</button>
                <div class="reader-toolbar-name">Metro News</div>
                <div class="reader-toolbar-actions">
                    <button type="button" class="reader-toolbar-btn reader-bookmark" data-reader-action="bookmark" aria-label="收藏新聞">☆</button>
                    <button type="button" class="reader-toolbar-btn" data-reader-action="share" aria-label="分享新聞">↗</button>
                </div>
            </header>

            <main class="reader-scroll" id="reader-scroll">
                <article class="reader-article">
                    <div class="reader-meta">
                        <span class="reader-category"></span>
                        <span class="reader-time"></span>
                    </div>
                    <h1 class="reader-title"></h1>
                    <div class="reader-media hidden"></div>

                    <div class="reader-command-row">
                        <button type="button" class="reader-command" data-reader-action="ai">✦ AI 摘要</button>
                        <button type="button" class="reader-command" data-reader-action="bookmark">☆ 收藏</button>
                        <button type="button" class="reader-command" data-reader-action="share">分享 ↗</button>
                    </div>

                    <section class="reader-ai hidden" aria-live="polite">
                        <div class="reader-ai-label">✦ AI 摘要</div>
                        <p class="reader-ai-text"></p>
                    </section>

                    <div class="reader-content"></div>
                </article>
            </main>
        </div>
    `;

    document.body.appendChild(overlay);

    DOM.close = overlay.querySelector('.reader-close');
    DOM.scroll = overlay.querySelector('.reader-scroll');
    DOM.category = overlay.querySelector('.reader-category');
    DOM.time = overlay.querySelector('.reader-time');
    DOM.title = overlay.querySelector('.reader-title');
    DOM.media = overlay.querySelector('.reader-media');
    DOM.ai = overlay.querySelector('.reader-ai');
    DOM.aiText = overlay.querySelector('.reader-ai-text');
    DOM.content = overlay.querySelector('.reader-content');
    DOM.bookmarkButtons = [...overlay.querySelectorAll('[data-reader-action="bookmark"]')];

    DOM.close.addEventListener('click', () => closeReader());

    overlay.addEventListener('click', event => {
        const action = event.target.closest('[data-reader-action]')?.dataset.readerAction;
        if (!action || !sourceTile) return;

        if (action === 'ai') {
            sourceTile.querySelector('.ai-btn')?.click();
            showReaderAILoading();
            queueSync();
        } else if (action === 'bookmark') {
            const sourceButton = sourceTile.querySelector('.bookmark-btn');
            const bookmarksActive = document.querySelector('.bottom-nav-btn[data-section="bookmarks"]')?.classList.contains('active');
            const removingFromBookmarks = !!bookmarksActive && !!sourceButton?.classList.contains('saved');

            if (removingFromBookmarks) {
                // The original bookmarks handler immediately re-renders the list. Collapse first
                // while the source tile is still attached so wake-lock/expanded state is cleared.
                collapseSourceTile();
                sourceButton?.click();
                closeReader();
                return;
            }

            sourceButton?.click();
            queueSync();
        } else if (action === 'share') {
            sourceTile.querySelector('.share-btn')?.click();
        }
    });

    overlay.addEventListener('click', event => {
        const image = event.target.closest('[data-reader-lightbox]');
        if (!image) return;
        const src = image.getAttribute('data-full') || image.currentSrc || image.src;
        if (src) openLightbox(src);
    });

    return overlay;
}

function isReaderTrigger(target, tile) {
    if (!tile?.querySelector('.tile-preview')) return false;
    if (target.closest('button, input, a, .lightbox-img, .gallery-img, .img-scroll-box')) return false;
    return true;
}

function visibleCategoryText(tile) {
    const fresh = tile.querySelector('.fresh-label')?.textContent?.trim();
    if (fresh) return fresh;

    const category = tile.querySelector('.tile-preview > div:first-child > div:first-child span');
    return category?.textContent?.trim() || '新聞';
}

function timeText(tile) {
    const spans = tile.querySelectorAll('.tile-preview span');
    for (const span of spans) {
        const text = span.textContent?.trim() || '';
        if (/^(\d+\s*(分鐘|小時|天)前)$/.test(text)) return text;
    }

    return tile.querySelector('.tile-details p.text-xs')?.textContent?.trim() || '';
}

function buildReaderMedia(tile) {
    const fullImages = [...tile.querySelectorAll('.img-scroll-box img')];
    const images = fullImages.length > 0
        ? fullImages
        : [...tile.querySelectorAll('.tile-preview img')].slice(0, 1);

    DOM.media.innerHTML = '';
    DOM.media.classList.toggle('hidden', images.length === 0);
    if (images.length === 0) return;

    const track = document.createElement('div');
    track.className = 'reader-media-track hide-scrollbar';

    images.forEach(source => {
        const img = document.createElement('img');
        img.className = 'reader-image';
        img.src = source.currentSrc || source.src;
        img.alt = source.alt || '新聞圖片';
        img.loading = 'eager';
        img.referrerPolicy = 'no-referrer';
        img.dataset.readerLightbox = '1';
        img.dataset.full = source.getAttribute('data-full') || source.currentSrc || source.src;
        track.appendChild(img);
    });

    DOM.media.appendChild(track);

    if (images.length > 1) {
        const count = document.createElement('div');
        count.className = 'reader-media-count';
        count.textContent = `${images.length} 圖 · 左右滑動`;
        DOM.media.appendChild(count);
    }
}

function normalizeAIText(text) {
    if (!text) return '';
    if (text.includes('Llama 3') || text.includes('引擎運算')) return '正在整理新聞重點…';
    return text;
}

function showReaderAILoading() {
    DOM.ai.classList.remove('hidden');
    DOM.aiText.textContent = '正在整理新聞重點…';
    DOM.ai.classList.add('loading');
}

function syncReaderAI() {
    if (!sourceTile) return;

    const aiBox = sourceTile.querySelector('.ai-box');
    const aiText = sourceTile.querySelector('.ai-summary-text');
    const text = normalizeAIText(aiText?.textContent?.trim() || '');
    const visible = !!aiBox && !aiBox.classList.contains('hidden') && !!text;

    DOM.ai.classList.toggle('hidden', !visible);
    DOM.ai.classList.toggle('loading', text === '正在整理新聞重點…');
    if (visible) DOM.aiText.textContent = text;
}

function syncReaderBookmark() {
    if (!sourceTile) return;

    const sourceButton = sourceTile.querySelector('.bookmark-btn');
    const saved = !!sourceButton?.classList.contains('saved') || sourceButton?.textContent?.includes('已收藏');

    DOM.bookmarkButtons.forEach((button, index) => {
        if (index === 0) {
            button.textContent = saved ? '★' : '☆';
            button.setAttribute('aria-label', saved ? '取消收藏' : '收藏新聞');
        } else {
            button.textContent = saved ? '★ 已收藏' : '☆ 收藏';
        }
        button.classList.toggle('saved', saved);
    });
}

function syncReaderContent() {
    if (!sourceTile) return;

    const sourceContent = sourceTile.querySelector('.article-content-body');
    if (!sourceContent) return;

    DOM.content.innerHTML = sourceContent.innerHTML;
    DOM.content.querySelectorAll('.lightbox-img').forEach(image => {
        image.dataset.readerLightbox = '1';
    });
}

function syncReader() {
    if (!sourceTile || !overlay?.classList.contains('open')) return;
    syncReaderAI();
    syncReaderBookmark();
    syncReaderContent();
}

function queueSync() {
    queueMicrotask(syncReader);
    setTimeout(syncReader, 80);
}

function observeSourceTile() {
    sourceObserver?.disconnect();
    if (!sourceTile) return;

    sourceObserver = new MutationObserver(() => queueSync());
    sourceObserver.observe(sourceTile, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class']
    });
}

function fillReaderHeader(tile) {
    DOM.category.textContent = visibleCategoryText(tile);
    DOM.time.textContent = timeText(tile);
    DOM.title.textContent = tile.querySelector('.news-title')?.textContent?.trim()
        || tile.querySelector('.tile-details h3')?.textContent?.trim()
        || '新聞';
}

function openReader(tile, scrollTop) {
    if (!tile || overlay?.classList.contains('open')) return;

    ensureOverlay();
    sourceTile = tile;
    savedScrollTop = scrollTop;
    restoreFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    fillReaderHeader(tile);
    buildReaderMedia(tile);
    syncReaderAI();
    syncReaderBookmark();
    syncReaderContent();
    observeSourceTile();

    DOM.scroll.scrollTop = 0;
    document.body.classList.add('reader-open');
    overlay.classList.add('open');

    if (!historyPushed) {
        history.pushState({ metroReader: true }, '', location.href);
        historyPushed = true;
    }

    requestAnimationFrame(() => DOM.close.focus({ preventScroll: true }));
}

function collapseSourceTile() {
    if (!sourceTile?.classList.contains('expanded')) return;

    closingProgrammatically = true;
    sourceTile.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
    }));
    closingProgrammatically = false;
}

function finalizeClose() {
    if (!overlay?.classList.contains('open')) return;

    overlay.classList.remove('open');
    document.body.classList.remove('reader-open');
    sourceObserver?.disconnect();
    sourceObserver = null;

    collapseSourceTile();

    const main = document.getElementById('main-container');
    requestAnimationFrame(() => {
        if (main) main.scrollTop = savedScrollTop;
        restoreFocusTarget?.focus?.({ preventScroll: true });
    });

    sourceTile = null;
    restoreFocusTarget = null;
    historyPushed = false;
}

function closeReader({ fromPopState = false } = {}) {
    if (!overlay?.classList.contains('open')) return;

    if (!fromPopState && historyPushed) {
        history.back();
        return;
    }

    finalizeClose();
}

function initReader() {
    const grid = document.getElementById('news-grid');
    const main = document.getElementById('main-container');
    if (!grid || !main) return;

    ensureOverlay();

    grid.addEventListener('click', event => {
        const tile = event.target.closest('.metro-tile');
        if (!isReaderTrigger(event.target, tile)) {
            pendingOpen = null;
            return;
        }

        pendingOpen = {
            tile,
            scrollTop: main.scrollTop
        };
    }, true);

    grid.addEventListener('click', event => {
        if (closingProgrammatically) return;

        const tile = event.target.closest('.metro-tile');
        if (!isReaderTrigger(event.target, tile)) return;
        if (!tile.classList.contains('expanded')) return;

        const scrollTop = pendingOpen?.tile === tile ? pendingOpen.scrollTop : main.scrollTop;
        pendingOpen = null;
        openReader(tile, scrollTop);
    });

    window.addEventListener('popstate', () => {
        if (overlay?.classList.contains('open')) {
            closeReader({ fromPopState: true });
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && overlay?.classList.contains('open')) {
            closeReader();
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReader, { once: true });
} else {
    initReader();
}
