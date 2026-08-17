import './search-ui.js';

const DENSITY_KEY = 'metro_feed_density';
const DEFAULT_DENSITY = 'comfortable';

let decorateQueued = false;

function getDensity() {
    const saved = localStorage.getItem(DENSITY_KEY);
    return saved === 'compact' ? 'compact' : DEFAULT_DENSITY;
}

function applyDensity(value) {
    const density = value === 'compact' ? 'compact' : DEFAULT_DENSITY;
    document.body.dataset.feedDensity = density;
    localStorage.setItem(DENSITY_KEY, density);

    document.querySelectorAll('[data-feed-density]').forEach(button => {
        const active = button.dataset.feedDensity === density;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function installDensitySetting() {
    const settingsView = document.getElementById('settings-view');
    if (!settingsView || document.getElementById('feed-density-setting')) return;

    const section = document.createElement('div');
    section.id = 'feed-density-setting';
    section.innerHTML = `
        <p class="text-xs text-gray-400 uppercase tracking-widest mb-3">顯示密度</p>
        <div class="density-control" role="group" aria-label="新聞列表顯示密度">
            <button type="button" class="density-btn" data-feed-density="comfortable" aria-pressed="false">
                <span class="density-btn-title">舒適</span>
                <span class="density-btn-copy">標題＋短摘要</span>
            </button>
            <button type="button" class="density-btn" data-feed-density="compact" aria-pressed="false">
                <span class="density-btn-title">緊湊</span>
                <span class="density-btn-copy">顯示更多新聞</span>
            </button>
        </div>
    `;

    const typographySection = settingsView.lastElementChild;
    if (typographySection) typographySection.before(section);
    else settingsView.appendChild(section);

    section.addEventListener('click', event => {
        const button = event.target.closest('[data-feed-density]');
        if (!button) return;
        applyDensity(button.dataset.feedDensity);
        scheduleDecorate();
    });
}

function isNewsSection() {
    const newsButton = document.querySelector('.bottom-nav-btn[data-section="news"]');
    const categoryStrip = document.getElementById('category-strip');
    return !!newsButton?.classList.contains('active') && !categoryStrip?.classList.contains('hidden');
}

function activeCategoryId() {
    return document.querySelector('#nav-menu .nav-link.active')?.dataset.categoryId || '';
}

function extractMinutesAgo(tile) {
    const spans = tile.querySelectorAll('.tile-preview span');
    for (const span of spans) {
        const text = span.textContent?.trim() || '';
        const match = text.match(/^(\d+)\s*分鐘前$/);
        if (match) return Number(match[1]);
    }
    return null;
}

function createDeck(tile) {
    const preview = tile.querySelector('.tile-preview');
    const title = preview?.querySelector('.news-title');
    const content = tile.querySelector('.article-content-body');
    if (!preview || !title || !content || preview.querySelector('.feed-deck')) return;

    const raw = (content.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!raw) return;

    const titleText = (title.textContent || '').trim();
    let deckText = raw;
    if (titleText && deckText.startsWith(titleText)) {
        deckText = deckText.slice(titleText.length).trim();
    }

    if (!deckText) return;
    if (deckText.length > 110) deckText = `${deckText.slice(0, 110).trim()}…`;

    const deck = document.createElement('p');
    deck.className = 'feed-deck';
    deck.textContent = deckText;
    title.insertAdjacentElement('afterend', deck);
}

function decorateFreshState(tile) {
    if (tile.dataset.freshDecorated === '1') return;
    tile.dataset.freshDecorated = '1';

    const minutes = extractMinutesAgo(tile);
    if (minutes === null || minutes > 15) return;

    tile.classList.add('fresh-tile');

    const metaLeft = tile.querySelector('.tile-preview > div:first-child > div:first-child');
    if (!metaLeft || metaLeft.querySelector('.fresh-label')) return;

    const categoryLabel = metaLeft.querySelector('span');
    if (categoryLabel) categoryLabel.classList.add('feed-category-label');

    const freshLabel = document.createElement('span');
    freshLabel.className = 'fresh-label';
    freshLabel.textContent = '● 即時更新';
    metaLeft.prepend(freshLabel);

    if ((categoryLabel?.textContent || '').trim() === '即時') {
        categoryLabel.classList.add('fresh-category-hidden');
    }
}

function decorateTile(tile) {
    if (!tile.querySelector('.tile-preview')) return false;

    tile.classList.add('feed-card');
    tile.style.setProperty('border-left-color', 'var(--metro-accent-color, #22d3ee)', 'important');
    tile.style.setProperty('border-left-width', '3px', 'important');

    const titleText = tile.querySelector('.news-title')?.textContent?.trim() || '新聞';
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.setAttribute('aria-label', `閱讀新聞：${titleText}`);

    createDeck(tile);
    decorateFreshState(tile);
    return true;
}

function decorateFeed() {
    decorateQueued = false;
    const grid = document.getElementById('news-grid');
    if (!grid) return;

    const tiles = [...grid.querySelectorAll(':scope > .metro-tile')]
        .filter(decorateTile);

    tiles.forEach(tile => tile.classList.remove('hero-tile'));

    if (isNewsSection() && activeCategoryId() === 'latest' && tiles.length > 0) {
        tiles[0].classList.add('hero-tile');
    }
}

function scheduleDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(decorateFeed);
}

function installFeedKeyboardInteraction(grid) {
    if (!grid || grid.dataset.feedKeyboardReady === '1') return;
    grid.dataset.feedKeyboardReady = '1';

    grid.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const tile = event.target.closest('.metro-tile.feed-card');
        if (!tile || event.target !== tile) return;

        event.preventDefault();
        tile.click();
    });
}

function observeFeed() {
    const grid = document.getElementById('news-grid');
    const navMenu = document.getElementById('nav-menu');
    const bottomNav = document.getElementById('bottom-nav');
    if (!grid) return;

    installFeedKeyboardInteraction(grid);

    const gridObserver = new MutationObserver(scheduleDecorate);
    gridObserver.observe(grid, { childList: true, subtree: true });

    const navObserver = new MutationObserver(scheduleDecorate);
    if (navMenu) navObserver.observe(navMenu, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    if (bottomNav) navObserver.observe(bottomNav, { subtree: true, attributes: true, attributeFilter: ['class'] });
}

function initFeedUI() {
    applyDensity(getDensity());
    installDensitySetting();
    observeFeed();
    scheduleDecorate();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeedUI, { once: true });
} else {
    initFeedUI();
}
