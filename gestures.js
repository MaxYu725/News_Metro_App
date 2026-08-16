let touchStartX = 0, touchStartY = 0, touchEndX = 0, touchEndY = 0;
let ptrStartX = 0, ptrStartY = 0, ptrCurrentY = 0, isPulling = false;

export function initGestures({
    mainContainer,
    ptrIndicator,
    onSwipe,
    onRefresh,
    canSwipe = () => true,
    canRefresh = () => true
}) {
    document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    document.addEventListener('touchend', e => {
        if (e.target.closest('#nav-menu, .bottom-nav, .img-scroll-box, #lightbox-overlay, #search-view, #settings-view, input, button, #category-visibility-list')) return;
        if (!canSwipe()) return;

        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;

        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 60) {
            onSwipe(deltaX > 0 ? 'prev' : 'next');
        }
    }, { passive: true });

    const resetPullState = () => {
        isPulling = false;
        ptrStartX = 0;
        ptrStartY = 0;
        ptrCurrentY = 0;
        if (ptrIndicator) {
            ptrIndicator.style.height = '0px';
            ptrIndicator.innerHTML = '';
        }
    };

    mainContainer?.addEventListener('touchstart', e => {
        if (!canRefresh() || mainContainer.scrollTop !== 0) {
            isPulling = false;
            return;
        }
        ptrStartX = e.touches[0].clientX;
        ptrStartY = e.touches[0].clientY;
        ptrCurrentY = ptrStartY;
        isPulling = true;
    }, { passive: true });

    mainContainer?.addEventListener('touchmove', e => {
        if (!isPulling || !canRefresh()) return;

        const touch = e.touches[0];
        ptrCurrentY = touch.clientY;
        const pullDist = ptrCurrentY - ptrStartY;
        const horizontalDist = Math.abs(touch.clientX - ptrStartX);
        const isVerticalPull = pullDist > 0 && pullDist > horizontalDist;

        if (!isVerticalPull) return;

        // Custom pull-to-refresh owns this gesture. Prevent Android/Chromium from
        // starting its native PWA page-refresh overlay at the same time.
        e.preventDefault();

        if (ptrIndicator) {
            const visualPull = Math.min(pullDist, 110);
            ptrIndicator.style.height = `${visualPull}px`;
            ptrIndicator.innerHTML = `<div class="loader-small" style="opacity: ${Math.min(visualPull / 80, 1)};"></div>`;
        }
    }, { passive: false });

    mainContainer?.addEventListener('touchend', async () => {
        if (!isPulling) return;
        isPulling = false;

        if (canRefresh() && ptrCurrentY - ptrStartY > 65) {
            if (ptrIndicator) ptrIndicator.style.height = '45px';
            await onRefresh();
        }

        resetPullState();
    }, { passive: true });

    mainContainer?.addEventListener('touchcancel', resetPullState, { passive: true });
}
