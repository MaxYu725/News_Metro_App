let touchStartX = 0, touchStartY = 0, touchEndX = 0, touchEndY = 0;
let ptrStartY = 0, ptrCurrentY = 0, isPulling = false;

export function initGestures({ mainContainer, ptrIndicator, onSwipe, onRefresh }) {
    // 1. 全頁左右滑動切換板塊
    document.addEventListener('touchstart', e => { 
        touchStartX = e.changedTouches[0].screenX; 
        touchStartY = e.changedTouches[0].screenY; 
    }, { passive: true });

    document.addEventListener('touchend', e => { 
        if (e.target.closest('#nav-menu, .img-scroll-box, #lightbox-overlay, input, #category-visibility-list')) return;
        
        touchEndX = e.changedTouches[0].screenX; 
        touchEndY = e.changedTouches[0].screenY; 
        
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 60) {
            onSwipe(deltaX > 0 ? 'prev' : 'next');
        }
    }, { passive: true });

    // 2. 下拉刷新 (Pull To Refresh)
    mainContainer?.addEventListener('touchstart', e => {
        if (mainContainer.scrollTop === 0) { ptrStartY = e.touches[0].clientY; isPulling = true; }
    }, { passive: true });

    mainContainer?.addEventListener('touchmove', e => {
        if (!isPulling) return;
        ptrCurrentY = e.touches[0].clientY;
        const pullDist = ptrCurrentY - ptrStartY;
        if (pullDist > 0 && pullDist < 120 && ptrIndicator) {
            ptrIndicator.style.height = `${pullDist}px`;
            ptrIndicator.innerHTML = `<div class="loader-small" style="opacity: ${pullDist / 80};"></div>`;
        }
    }, { passive: true });

    mainContainer?.addEventListener('touchend', async () => {
        if (!isPulling) return;
        isPulling = false;
        if (ptrCurrentY - ptrStartY > 65) {
            if (ptrIndicator) ptrIndicator.style.height = '45px';
            await onRefresh();
        }
        if (ptrIndicator) { ptrIndicator.style.height = '0px'; ptrIndicator.innerHTML = ''; }
        ptrStartY = 0; ptrCurrentY = 0;
    }, { passive: true });
}
