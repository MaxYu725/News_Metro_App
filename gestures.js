let touchStartX = 0, touchStartY = 0, touchEndX = 0, touchEndY = 0;
let ptrStartY = 0, ptrCurrentY = 0, isPulling = false;

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

    mainContainer?.addEventListener('touchstart', e => {
        if (!canRefresh() || mainContainer.scrollTop !== 0) {
            isPulling = false;
            return;
        }
        ptrStartY = e.touches[0].clientY;
        ptrCurrentY = ptrStartY;
        isPulling = true;
    }, { passive: true });

    mainContainer?.addEventListener('touchmove', e => {
        if (!isPulling || !canRefresh()) return;
        ptrCurrentY = e.touches[0].clientY;
        const pullDist = ptrCurrentY - ptrStartY;
        if (pullDist > 0 && pullDist < 120 && ptrIndicator) {
            ptrIndicator.style.height = `${pullDist}px`;
            ptrIndicator.innerHTML = `<div class="loader-small" style="opacity: ${Math.min(pullDist / 80, 1)};"></div>`;
        }
    }, { passive: true });

    mainContainer?.addEventListener('touchend', async () => {
        if (!isPulling) return;
        isPulling = false;

        if (canRefresh() && ptrCurrentY - ptrStartY > 65) {
            if (ptrIndicator) ptrIndicator.style.height = '45px';
            await onRefresh();
        }

        if (ptrIndicator) {
            ptrIndicator.style.height = '0px';
            ptrIndicator.innerHTML = '';
        }
        ptrStartY = 0;
        ptrCurrentY = 0;
    }, { passive: true });
}
