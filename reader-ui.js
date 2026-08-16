import { openLightbox } from './lightbox.js';
import { timeAgo } from './utils.js';
import {
    getReaderArticle,
    getReaderArticleState,
    markReaderArticleRead,
    setArticleReaderActive,
    loadReaderArticle,
    summarizeReaderArticle,
    toggleReaderBookmark,
    syncReaderSourceTile,
    refreshReaderViewAfterClose
} from './app.js';

let overlay = null;
let sourceTile = null;
let currentArticle = null;
let savedScrollTop = 0;
let historyPushed = false;
let restoreFocusTarget = null;
let openSequence = 0;
let bookmarkChanged = false;

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
                    <button type="button" class="reader-toolbar-btn reader-ai-trigger" data-reader-action="ai" aria-label="AI 摘要">
                        <span aria-hidden="true">✦</span><span class="reader-ai-caption">AI</span>
                    </button>
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
    DOM.aiTrigger = overlay.querySelector('[data-reader-action="ai"]');
    DOM.content = overlay.querySelector('.reader-content');
    DOM.bookmark = overlay.querySelector('[data-reader-action="bookmark"]');

    DOM.close.addEventListener('click', () => closeReader());

    overlay.addEventListener('click', async event => {
        const action = event.target.closest('[data-reader-action]')?.dataset.readerAction;
        if (!action || !currentArticle) return;

        if (action === 'ai') {
            await handleAIAction();
        } else if (action === 'bookmark') {
            const saved = toggleReaderBookmark(currentArticle);
            bookmarkChanged = true;
            syncBookmarkState(saved);
            syncReaderSourceTile(sourceTile, currentArticle);
        } else if (action === 'share') {
            await shareCurrentArticle();
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
    if (target.closest('button, input, a, .gallery-img')) return false;
    return true;
}

function readerCategory(tile, article, state) {
    const fresh = tile.querySelector('.fresh-label')?.textContent?.trim();
    if (fresh) return `${fresh.replace(/^●\s*/, '')} · ${state.category}`;
    return state.category || article.category || '新聞';
}

function buildReaderMedia(article) {
    const imageUrls = Array.isArray(article?.images) && article.images.length > 0
        ? article.images.filter(Boolean)
        : (article?.imageUrl ? [article.imageUrl] : []);

    DOM.media.innerHTML = '';
    DOM.media.classList.toggle('hidden', imageUrls.length === 0);
    if (imageUrls.length === 0) return;

    const track = document.createElement('div');
    track.className = 'reader-media-track hide-scrollbar';

    imageUrls.forEach(src => {
        const img = document.createElement('img');
        img.className = 'reader-image';
        img.src = src;
        img.alt = '新聞圖片';
        img.loading = 'eager';
        img.referrerPolicy = 'no-referrer';
        img.dataset.readerLightbox = '1';
        img.dataset.full = src;
        track.appendChild(img);
    });

    DOM.media.appendChild(track);

    if (imageUrls.length > 1) {
        const count = document.createElement('div');
        count.className = 'reader-media-count';
        count.textContent = `${imageUrls.length} 圖 · 左右滑動`;
        DOM.media.appendChild(count);
    }
}

function appendParagraphs(container, text) {
    const paragraphs = String(text || '')
        .split('\n')
        .map(part => part.trim())
        .filter(Boolean);

    if (paragraphs.length === 0) {
        const p = document.createElement('p');
        p.textContent = '暫無詳細內文。';
        container.appendChild(p);
        return;
    }

    paragraphs.forEach(textPart => {
        const p = document.createElement('p');
        p.textContent = textPart;
        container.appendChild(p);
    });
}

function renderReaderContent(text, { loading = false, error = '' } = {}) {
    DOM.content.innerHTML = '';
    appendParagraphs(DOM.content, text);

    if (loading) {
        const skeleton = document.createElement('div');
        skeleton.className = 'article-skeleton-container';
        skeleton.innerHTML = `
            <div class="reader-content-status">
                <span class="loader-small"></span>
                <span>正在載入完整文章...</span>
            </div>
            <div class="space-y-3 opacity-50">
                <div class="w-full h-4 skeleton-pulse rounded-xs"></div>
                <div class="w-11/12 h-4 skeleton-pulse rounded-xs"></div>
                <div class="w-4/5 h-4 skeleton-pulse rounded-xs"></div>
                <div class="w-full h-4 skeleton-pulse rounded-xs"></div>
            </div>
        `;
        DOM.content.appendChild(skeleton);
    } else if (error) {
        const status = document.createElement('p');
        status.className = 'reader-content-status reader-content-error';
        status.textContent = '完整文章暫時未能載入，現顯示已有內容。';
        DOM.content.appendChild(status);
    }
}

function syncBookmarkState(saved) {
    DOM.bookmark.textContent = saved ? '★' : '☆';
    DOM.bookmark.setAttribute('aria-label', saved ? '取消收藏' : '收藏新聞');
    DOM.bookmark.classList.toggle('saved', saved);
}

function syncAIState(summary = '') {
    const visible = !!summary;
    DOM.ai.classList.toggle('hidden', !visible);
    DOM.ai.classList.remove('loading');
    DOM.aiTrigger?.classList.toggle('active', visible);
    if (visible) DOM.aiText.textContent = summary;
}

function showReaderAILoading() {
    DOM.ai.classList.remove('hidden');
    DOM.aiText.textContent = '正在整理新聞重點…';
    DOM.ai.classList.add('loading');
    DOM.aiTrigger?.classList.add('active');
}

async function handleAIAction() {
    if (!currentArticle) return;
    const articleAtStart = currentArticle;
    showReaderAILoading();

    const result = await summarizeReaderArticle(articleAtStart);
    if (currentArticle !== articleAtStart || !overlay?.classList.contains('open')) return;

    if (result.success && result.summary) {
        syncAIState(result.summary);
        syncReaderSourceTile(sourceTile, articleAtStart);
    } else {
        DOM.ai.classList.remove('hidden', 'loading');
        DOM.aiText.textContent = '⚠️ 總結失敗，請稍後再試。';
        DOM.aiTrigger?.classList.remove('active');
    }
}

async function shareCurrentArticle() {
    if (!currentArticle) return;

    if (navigator.share) {
        try {
            await navigator.share({
                title: currentArticle.title,
                text: '看看這則新聞！',
                url: currentArticle.link
            });
        } catch (err) {}
        return;
    }

    try {
        await navigator.clipboard.writeText(currentArticle.link);
        alert('已複製新聞連結！');
    } catch (err) {
        alert('未能複製新聞連結。');
    }
}

function fillReader(article, tile) {
    const state = getReaderArticleState(article);
    DOM.category.textContent = readerCategory(tile, article, state);
    DOM.time.textContent = article.pubDate ? timeAgo(article.pubDate) : '';
    DOM.title.textContent = article.title || '新聞';
    buildReaderMedia(article);
    syncBookmarkState(state.saved);
    syncAIState(state.aiSummary);
    renderReaderContent(article.description || '暫無詳細內文。', {
        loading: !article.isFullContentLoaded
    });
}

async function hydrateFullArticle(article, sequence) {
    if (article.isFullContentLoaded) return;

    const result = await loadReaderArticle(article);
    if (
        sequence !== openSequence
        || currentArticle !== article
        || !overlay?.classList.contains('open')
    ) return;

    renderReaderContent(result.content || article.description || '', {
        loading: false,
        error: result.success ? '' : result.error
    });
}

function openReader(tile, scrollTop) {
    if (!tile || overlay?.classList.contains('open')) return;

    const article = getReaderArticle(tile);
    if (!article) return;

    ensureOverlay();
    sourceTile = tile;
    currentArticle = article;
    savedScrollTop = scrollTop;
    restoreFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sequence = ++openSequence;
    bookmarkChanged = false;

    markReaderArticleRead(article, tile);
    fillReader(article, tile);

    DOM.scroll.scrollTop = 0;
    document.body.classList.add('reader-open');
    overlay.classList.add('open');
    setArticleReaderActive(true);

    if (!historyPushed) {
        history.pushState({ metroReader: true }, '', location.href);
        historyPushed = true;
    }

    hydrateFullArticle(article, sequence);
    requestAnimationFrame(() => DOM.close.focus({ preventScroll: true }));
}

function finalizeClose() {
    if (!overlay?.classList.contains('open')) return;

    const closingTile = sourceTile;
    const closingArticle = currentArticle;
    ++openSequence;

    if (closingTile && closingArticle) {
        refreshReaderViewAfterClose(closingTile, closingArticle, { bookmarkChanged });
    }

    overlay.classList.remove('open');
    document.body.classList.remove('reader-open');
    setArticleReaderActive(false);

    const main = document.getElementById('main-container');
    requestAnimationFrame(() => {
        if (main) main.scrollTop = savedScrollTop;
        if (restoreFocusTarget?.isConnected) {
            restoreFocusTarget.focus?.({ preventScroll: true });
        }
    });

    sourceTile = null;
    currentArticle = null;
    restoreFocusTarget = null;
    historyPushed = false;
    bookmarkChanged = false;
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
        if (!isReaderTrigger(event.target, tile)) return;
        openReader(tile, main.scrollTop);
    });

    window.addEventListener('popstate', event => {
        if (!overlay?.classList.contains('open')) return;

        // Lightbox close/back returns to the Reader history state. Only a pop
        // beyond that state exits the article Reader itself.
        if (event.state?.metroReader === true) return;
        closeReader({ fromPopState: true });
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
