/* v53 controlled motion restoration: bottom-nav selection indicator only.
   Uses the fixed four-button layout and section identity; no geometry reads,
   requestAnimationFrame loop, MutationObserver, forced reflow or spotlight
   tracking is involved. */

const NAV_SHIFT = Object.freeze({
    news: '0%',
    search: '100%',
    bookmarks: '200%',
    settings: '300%'
});

function setNavIndicator(section) {
    const nav = document.getElementById('bottom-nav');
    const shift = NAV_SHIFT[section];
    if (!nav || shift === undefined) return;
    nav.style.setProperty('--liquid-nav-shift', shift);
}

function initNavIndicator() {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;

    const active = nav.querySelector('.bottom-nav-btn.active');
    setNavIndicator(active?.dataset.section || 'news');

    nav.addEventListener('click', event => {
        const button = event.target.closest('.bottom-nav-btn[data-section]');
        if (!button || !nav.contains(button)) return;
        setNavIndicator(button.dataset.section);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNavIndicator, { once: true });
} else {
    initNavIndicator();
}
