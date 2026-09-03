const NAV_ORDER = ['news', 'search', 'bookmarks', 'settings'];
const PRESSABLE_SELECTOR = [
    '.metro-tile',
    '.bottom-nav-btn',
    '.nav-link',
    '.metro-btn',
    '.density-btn',
    '.color-btn',
    '.settings-link-row',
    '.search-submit',
    '.search-chip',
    '.search-follow-btn',
    '.subview-back',
    '.page-header-back',
    '#back-to-top',
    '#lightbox-close',
    '#lightbox-quality',
    '.reader-close',
    '.reader-toolbar-btn'
].join(',');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let lastSection = 'news';
let lastCategory = '';
let indicatorFrame = 0;
let pointerFrame = 0;
let pointerEvent = null;

function activeSection() {
    const gallery = document.getElementById('gallery-view');
    if (gallery && !gallery.classList.contains('hidden')) return 'gallery';
    return document.querySelector('#bottom-nav .bottom-nav-btn[aria-current="page"]')?.dataset.section || 'news';
}

function setNavigationDirection(nextSection) {
    const visualNext = nextSection === 'gallery' ? 'settings' : nextSection;
    const visualCurrent = lastSection === 'gallery' ? 'settings' : lastSection;
    const currentIndex = NAV_ORDER.indexOf(visualCurrent);
    const nextIndex = NAV_ORDER.indexOf(visualNext);
    if (currentIndex >= 0 && nextIndex >= 0 && currentIndex !== nextIndex) {
        document.documentElement.dataset.liquidDirection = nextIndex > currentIndex ? 'forward' : 'backward';
    }
}

function restartClass(element, className, duration = 440) {
    if (!element || reducedMotion.matches) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    window.setTimeout(() => element.classList.remove(className), duration);
}

function animatePageChange() {
    restartClass(document.getElementById('main-container'), 'liquid-page-enter');
    restartClass(document.querySelector('.page-heading-copy'), 'liquid-heading-enter', 360);
}

function syncBottomIndicator() {
    const nav = document.getElementById('bottom-nav');
    const indicator = nav?.querySelector('.liquid-nav-indicator');
    const active = nav?.querySelector('.bottom-nav-btn.active');
    if (!nav || !indicator || !active) return;

    const navRect = nav.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    nav.style.setProperty('--liquid-nav-x', `${activeRect.left - navRect.left}px`);
    nav.style.setProperty('--liquid-nav-y', `${activeRect.top - navRect.top}px`);
    nav.style.setProperty('--liquid-nav-w', `${activeRect.width}px`);
    nav.style.setProperty('--liquid-nav-h', `${activeRect.height}px`);
    nav.dataset.liquidIndicator = 'ready';
}

function syncCategoryIndicator({ animate = true } = {}) {
    const menu = document.getElementById('nav-menu');
    const active = menu?.querySelector('.nav-link.active');
    if (!menu || !active) return;

    menu.style.setProperty('--liquid-category-x', `${active.offsetLeft}px`);
    menu.style.setProperty('--liquid-category-y', `${active.offsetTop}px`);
    menu.style.setProperty('--liquid-category-w', `${active.offsetWidth}px`);
    menu.style.setProperty('--liquid-category-h', `${active.offsetHeight}px`);
    menu.dataset.liquidIndicator = 'ready';

    const category = active.dataset.categoryId || active.textContent?.trim() || '';
    if (animate && lastCategory && category && category !== lastCategory && activeSection() === 'news') {
        const links = [...menu.querySelectorAll('.nav-link')];
        const previousIndex = links.findIndex(link => (
            link.dataset.categoryId || link.textContent?.trim()
        ) === lastCategory);
        const nextIndex = links.indexOf(active);
        if (previousIndex >= 0 && nextIndex >= 0) {
            document.documentElement.dataset.liquidDirection = nextIndex > previousIndex ? 'forward' : 'backward';
        }
        animatePageChange();
    }
    lastCategory = category;
}

function queueIndicatorSync({ animateCategory = false } = {}) {
    if (indicatorFrame) cancelAnimationFrame(indicatorFrame);
    indicatorFrame = requestAnimationFrame(() => {
        indicatorFrame = 0;
        syncBottomIndicator();
        syncCategoryIndicator({ animate: animateCategory });
    });
}

function revealTiles(nodes) {
    if (reducedMotion.matches) return;
    const tiles = [];
    nodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches('.metro-tile')) tiles.push(node);
        tiles.push(...node.querySelectorAll('.metro-tile'));
    });

    tiles.slice(0, 12).forEach((tile, index) => {
        const delay = Math.min(index, 4) * 18;
        tile.style.setProperty('--liquid-reveal-delay', `${delay}ms`);
        // MutationObserver runs before paint. Apply the class immediately so a
        // card can never paint once, disappear, and then animate back in.
        tile.classList.add('liquid-reveal');
        window.setTimeout(() => tile.classList.remove('liquid-reveal'), 420 + delay);
    });
}

function installObservers() {
    const bottomNav = document.getElementById('bottom-nav');
    const menu = document.getElementById('nav-menu');
    const grid = document.getElementById('news-grid');
    const views = ['search-view', 'gallery-view', 'settings-view']
        .map(id => document.getElementById(id))
        .filter(Boolean);

    const syncSection = () => {
        const section = activeSection();
        if (section !== lastSection) {
            setNavigationDirection(section);
            lastSection = section;
            animatePageChange();
        }
        queueIndicatorSync();
    };

    if (bottomNav) {
        new MutationObserver(syncSection).observe(bottomNav, {
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'aria-current']
        });
    }

    if (menu) {
        new MutationObserver(() => queueIndicatorSync({ animateCategory: true })).observe(menu, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
        menu.addEventListener('scroll', () => queueIndicatorSync(), { passive: true });
    }

    if (grid) {
        new MutationObserver(records => {
            // A full list replacement already receives the page-level motion.
            // Re-animating every child used to leave visible glass shells while
            // their text and images were temporarily transparent.
            const replacesExistingList = records.some(record => record.removedNodes.length > 0);
            if (replacesExistingList) return;
            const added = records.flatMap(record => [...record.addedNodes]);
            revealTiles(added);
        }).observe(grid, { childList: true });
    }

    views.forEach(view => {
        new MutationObserver(syncSection).observe(view, {
            attributes: true,
            attributeFilter: ['class']
        });
    });

    if ('ResizeObserver' in window) {
        const resizeObserver = new ResizeObserver(() => queueIndicatorSync());
        if (bottomNav) resizeObserver.observe(bottomNav);
        if (menu) resizeObserver.observe(menu);
    } else {
        window.addEventListener('resize', queueIndicatorSync, { passive: true });
    }
}

function pressableFrom(target) {
    if (!(target instanceof Element)) return null;
    const element = target.closest(PRESSABLE_SELECTOR);
    if (!element || element.matches(':disabled, [aria-disabled="true"]')) return null;
    return element;
}

function updateSpotlight(event) {
    const element = pressableFrom(event.target);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.setProperty('--liquid-x', `${event.clientX - rect.left}px`);
    element.style.setProperty('--liquid-y', `${event.clientY - rect.top}px`);
}

function flushPointerMove() {
    pointerFrame = 0;
    if (!pointerEvent) return;
    updateSpotlight(pointerEvent);
    pointerEvent = null;
}

function installSoftFeedback() {
    document.addEventListener('pointerdown', event => {
        const element = pressableFrom(event.target);
        if (!element) return;
        updateSpotlight(event);
        element.classList.add('is-liquid-pressed');
    }, true);

    const release = () => {
        document.querySelectorAll('.is-liquid-pressed')
            .forEach(element => element.classList.remove('is-liquid-pressed'));
    };

    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', release);

    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        document.addEventListener('pointermove', event => {
            pointerEvent = event;
            if (!pointerFrame) pointerFrame = requestAnimationFrame(flushPointerMove);
        }, { passive: true });
    }
}

function installDirectionHints() {
    document.getElementById('bottom-nav')?.addEventListener('click', event => {
        const next = event.target.closest('.bottom-nav-btn')?.dataset.section;
        if (next) setNavigationDirection(next);
    }, true);

    document.getElementById('btn-open-gallery')?.addEventListener('click', () => {
        document.documentElement.dataset.liquidDirection = 'forward';
    }, true);
    document.getElementById('gallery-back')?.addEventListener('click', () => {
        document.documentElement.dataset.liquidDirection = 'backward';
    }, true);
}

function initLiquidGlass() {
    document.documentElement.dataset.liquidReady = 'true';
    lastSection = activeSection();
    lastCategory = document.querySelector('#nav-menu .nav-link.active')?.dataset.categoryId || '';
    installDirectionHints();
    installSoftFeedback();
    installObservers();
    queueIndicatorSync();
    window.setTimeout(() => queueIndicatorSync(), 160);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiquidGlass, { once: true });
} else {
    initLiquidGlass();
}
