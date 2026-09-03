/* v54 category selection indicator.
   One geometry sample is taken for the selected chip; no rAF loop,
   MutationObserver or continuous layout polling is used. */

function getNavMenu() {
    return document.getElementById('nav-menu');
}

function applyGeometry(link, { animate = true } = {}) {
    const nav = getNavMenu();
    if (!nav || !link || !nav.contains(link)) return;

    if (!animate) nav.classList.add('liquid-category-no-transition');

    nav.style.setProperty('--liquid-category-x', `${link.offsetLeft}px`);
    nav.style.setProperty('--liquid-category-y', `${link.offsetTop}px`);
    nav.style.setProperty('--liquid-category-w', `${link.offsetWidth}px`);
    nav.style.setProperty('--liquid-category-h', `${link.offsetHeight}px`);
    nav.dataset.liquidIndicator = 'ready';

    if (!animate) {
        window.setTimeout(() => nav.classList.remove('liquid-category-no-transition'), 0);
    }
}

function syncActive({ animate = false } = {}) {
    const nav = getNavMenu();
    if (!nav) return;
    const active = nav.querySelector('.nav-link.active');
    if (active) applyGeometry(active, { animate });
}

function installCategoryIndicator() {
    const nav = getNavMenu();
    if (!nav) return;

    syncActive({ animate: false });

    /* Capture pointerdown before app.js rebuilds the category links on click. */
    nav.addEventListener('pointerdown', event => {
        const link = event.target.closest('.nav-link');
        if (link && nav.contains(link)) applyGeometry(link, { animate: true });
    }, true);

    nav.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const link = event.target.closest('.nav-link');
        if (link && nav.contains(link)) applyGeometry(link, { animate: true });
    }, true);

    /* Returning from another bottom-nav section can recreate the category DOM. */
    document.getElementById('bottom-nav')?.addEventListener('click', event => {
        const button = event.target.closest('.bottom-nav-btn[data-section="news"]');
        if (!button) return;
        window.setTimeout(() => syncActive({ animate: false }), 0);
    });

    window.addEventListener('resize', () => syncActive({ animate: false }), { passive: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installCategoryIndicator, { once: true });
} else {
    installCategoryIndicator();
}
