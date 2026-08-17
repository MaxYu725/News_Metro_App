let touchStartX = 0, touchStartY = 0, touchEndX = 0, touchEndY = 0;
let ptrStartX = 0, ptrStartY = 0, ptrCurrentY = 0, isPulling = false;

const SWIPE_EXCLUSION_SELECTOR = [
    '#nav-menu',
    '.bottom-nav',
    '.img-scroll-box',
    '.reader-media-track',
    '#lightbox-overlay',
    '#search-view',
    '#settings-view',
    'input',
    'textarea',
    'select',
    'button',
    'a',
    '[contenteditable="true"]',
    '#category-visibility-list'
].join(', ');

const MOUSE_DRAG_THRESHOLD = 6;
const SWIPE_THRESHOLD = 60;
const REFRESH_THRESHOLD = 65;

function isPrimaryMousePointer(event) {
    return event.pointerType === 'mouse' && event.button === 0 && event.isPrimary !== false;
}

function closestElement(target, selector) {
    return target instanceof Element ? target.closest(selector) : null;
}

export function initGestures({
    mainContainer,
    ptrIndicator,
    onSwipe,
    onRefresh,
    canSwipe = () => true,
    canRefresh = () => true
}) {
    const navMenu = document.getElementById('nav-menu');

    // A hidden horizontal scrollbar is awkward on desktop. Convert the normal
    // vertical mouse-wheel gesture into horizontal category-strip scrolling only
    // while the strip actually overflows.
    navMenu?.addEventListener('wheel', event => {
        if (navMenu.scrollWidth <= navMenu.clientWidth) return;
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || event.deltaY === 0) return;
        event.preventDefault();
        navMenu.scrollLeft += event.deltaY;
    }, { passive: false });

    let suppressMouseClick = false;
    let mouseSwipePointerId = null;
    let mouseSwipeStartX = 0;
    let mouseSwipeStartY = 0;
    let mouseSwipeTarget = null;

    let mousePullPointerId = null;
    let mousePullStartX = 0;
    let mousePullStartY = 0;
    let mousePullCurrentY = 0;
    let mousePullLocked = false;

    const suppressNextMouseClick = () => {
        suppressMouseClick = true;
        window.setTimeout(() => {
            suppressMouseClick = false;
        }, 250);
    };

    document.addEventListener('click', event => {
        if (!suppressMouseClick) return;
        suppressMouseClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    // Native browser image dragging competes with swipe / pull gestures and
    // produces a ghost image. Images remain clickable; only drag-and-drop is disabled.
    mainContainer?.addEventListener('dragstart', event => {
        if (event.target instanceof HTMLImageElement) event.preventDefault();
    });

    document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    document.addEventListener('touchend', e => {
        if (closestElement(e.target, SWIPE_EXCLUSION_SELECTOR)) return;
        if (!canSwipe()) return;

        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;

        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > SWIPE_THRESHOLD) {
            onSwipe(deltaX > 0 ? 'prev' : 'next');
        }
    }, { passive: true });

    // Desktop category navigation mirrors the existing touch swipe without
    // interfering with normal wheel scrolling or interactive controls.
    document.addEventListener('pointerdown', event => {
        if (!isPrimaryMousePointer(event) || !canSwipe()) return;
        if (closestElement(event.target, SWIPE_EXCLUSION_SELECTOR)) return;

        mouseSwipePointerId = event.pointerId;
        mouseSwipeStartX = event.clientX;
        mouseSwipeStartY = event.clientY;
        mouseSwipeTarget = event.target;
    });

    document.addEventListener('pointerup', event => {
        if (event.pointerType !== 'mouse' || event.pointerId !== mouseSwipePointerId) return;

        const deltaX = event.clientX - mouseSwipeStartX;
        const deltaY = event.clientY - mouseSwipeStartY;
        const validTarget = !closestElement(mouseSwipeTarget, SWIPE_EXCLUSION_SELECTOR);

        mouseSwipePointerId = null;
        mouseSwipeTarget = null;

        if (
            validTarget
            && canSwipe()
            && Math.abs(deltaX) > Math.abs(deltaY)
            && Math.abs(deltaX) > SWIPE_THRESHOLD
        ) {
            suppressNextMouseClick();
            onSwipe(deltaX > 0 ? 'prev' : 'next');
        }
    });

    document.addEventListener('pointercancel', event => {
        if (event.pointerId === mouseSwipePointerId) {
            mouseSwipePointerId = null;
            mouseSwipeTarget = null;
        }
    });

    const clearIndicator = () => {
        if (!ptrIndicator) return;
        ptrIndicator.style.height = '0px';
        ptrIndicator.innerHTML = '';
    };

    const renderPullIndicator = pullDist => {
        if (!ptrIndicator) return;
        const visualPull = Math.min(Math.max(pullDist, 0), 110);
        ptrIndicator.style.height = `${visualPull}px`;
        ptrIndicator.innerHTML = `<div class="loader-small" style="opacity: ${Math.min(visualPull / 80, 1)};"></div>`;
    };

    const resetPullState = () => {
        isPulling = false;
        ptrStartX = 0;
        ptrStartY = 0;
        ptrCurrentY = 0;
        clearIndicator();
    };

    const resetMousePullState = ({ preserveIndicator = false } = {}) => {
        mousePullPointerId = null;
        mousePullStartX = 0;
        mousePullStartY = 0;
        mousePullCurrentY = 0;
        mousePullLocked = false;
        mainContainer?.classList.remove('mouse-pull-active');
        if (!preserveIndicator) clearIndicator();
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
        renderPullIndicator(pullDist);
    }, { passive: false });

    mainContainer?.addEventListener('touchend', async () => {
        if (!isPulling) return;
        isPulling = false;

        if (canRefresh() && ptrCurrentY - ptrStartY > REFRESH_THRESHOLD) {
            if (ptrIndicator) ptrIndicator.style.height = '45px';
            await onRefresh();
        }

        resetPullState();
    }, { passive: true });

    mainContainer?.addEventListener('touchcancel', resetPullState, { passive: true });

    // Mouse pull-to-refresh starts only at scrollTop=0. The drag is observed on
    // document so the pointer may travel into the header without losing state.
    mainContainer?.addEventListener('pointerdown', event => {
        if (!isPrimaryMousePointer(event) || !canRefresh() || mainContainer.scrollTop !== 0) return;
        if (closestElement(event.target, 'input, textarea, select, button, a, [contenteditable="true"]')) return;

        mousePullPointerId = event.pointerId;
        mousePullStartX = event.clientX;
        mousePullStartY = event.clientY;
        mousePullCurrentY = event.clientY;
        mousePullLocked = false;
    });

    document.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse' || event.pointerId !== mousePullPointerId) return;
        if (!canRefresh() || mainContainer?.scrollTop !== 0) {
            resetMousePullState();
            return;
        }

        const deltaX = event.clientX - mousePullStartX;
        const deltaY = event.clientY - mousePullStartY;
        mousePullCurrentY = event.clientY;

        if (!mousePullLocked) {
            if (Math.abs(deltaX) < MOUSE_DRAG_THRESHOLD && Math.abs(deltaY) < MOUSE_DRAG_THRESHOLD) return;
            if (deltaY <= 0 || Math.abs(deltaX) >= deltaY) {
                resetMousePullState();
                return;
            }
            mousePullLocked = true;
            mainContainer?.classList.add('mouse-pull-active');
        }

        if (deltaY <= 0) return;
        event.preventDefault();
        renderPullIndicator(deltaY);
    }, { passive: false });

    document.addEventListener('pointerup', async event => {
        if (event.pointerType !== 'mouse' || event.pointerId !== mousePullPointerId) return;

        const pullDist = mousePullCurrentY - mousePullStartY;
        const shouldRefresh = mousePullLocked && canRefresh() && pullDist > REFRESH_THRESHOLD;
        const shouldSuppressClick = mousePullLocked && pullDist > MOUSE_DRAG_THRESHOLD;

        resetMousePullState({ preserveIndicator: shouldRefresh });
        if (shouldSuppressClick) suppressNextMouseClick();

        if (shouldRefresh) {
            if (ptrIndicator) ptrIndicator.style.height = '45px';
            await onRefresh();
        }

        clearIndicator();
    });

    document.addEventListener('pointercancel', event => {
        if (event.pointerId === mousePullPointerId) resetMousePullState();
    });
}