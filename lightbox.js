let currentScale = 1, posX = 0, posY = 0, startX = 0, startY = 0;
let isPanning = false, isPinching = false, initialDistance = 0, initialScale = 1, lastTapTime = 0;
export let isLightboxOpen = false;

let overlayEl = null;
let stageEl = null;
let imgEl = null;
let closeBtnEl = null;
let restoreFocusTarget = null;
let inertTargets = [];

function updateTransform() {
    if (imgEl) {
        imgEl.style.transform = `translate(${posX}px, ${posY}px) scale(${currentScale})`;
    }
}

function setUnderlyingInert(active) {
    if (!active) {
        inertTargets.forEach(element => {
            if (element?.isConnected) element.inert = false;
        });
        inertTargets = [];
        return;
    }

    const reader = document.getElementById('reader-overlay');
    const readerOpen = !!reader?.classList.contains('open');
    inertTargets = readerOpen
        ? [reader]
        : [
            document.getElementById('app-header'),
            document.getElementById('main-container'),
            document.getElementById('bottom-nav')
        ].filter(Boolean);

    inertTargets.forEach(element => { element.inert = true; });
}

function restoreFocus() {
    if (restoreFocusTarget?.isConnected && typeof restoreFocusTarget.focus === 'function') {
        restoreFocusTarget.focus({ preventScroll: true });
    }
    restoreFocusTarget = null;
}

export function openLightbox(src) {
    if (!imgEl || !overlayEl || !src || isLightboxOpen) return;

    restoreFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    imgEl.src = src;
    currentScale = 1;
    posX = 0;
    posY = 0;
    updateTransform();

    setUnderlyingInert(true);
    overlayEl.classList.remove('hidden');
    overlayEl.setAttribute('aria-hidden', 'false');
    window.setTimeout(() => overlayEl.classList.remove('opacity-0'), 10);
    isLightboxOpen = true;
    history.pushState({ lightbox: true }, '', location.href);

    requestAnimationFrame(() => closeBtnEl?.focus({ preventScroll: true }));
}

export function closeLightbox(fromHardwareBackBtn = false) {
    if (!overlayEl || overlayEl.classList.contains('hidden')) return;

    overlayEl.classList.add('opacity-0');
    overlayEl.setAttribute('aria-hidden', 'true');
    isLightboxOpen = false;
    setUnderlyingInert(false);

    window.setTimeout(() => {
        overlayEl.classList.add('hidden');
        if (imgEl) imgEl.src = '';
        restoreFocus();
    }, 200);

    if (!fromHardwareBackBtn) history.back();
}

function trapLightboxFocus(event) {
    if (!isLightboxOpen || event.key !== 'Tab') return;
    event.preventDefault();
    closeBtnEl?.focus({ preventScroll: true });
}

export function initLightbox() {
    overlayEl = document.getElementById('lightbox-overlay');
    stageEl = document.getElementById('lightbox-stage');
    imgEl = document.getElementById('lightbox-img');
    closeBtnEl = document.getElementById('lightbox-close');

    if (!overlayEl || !imgEl) return;

    window.addEventListener('popstate', () => {
        if (isLightboxOpen) closeLightbox(true);
    });

    closeBtnEl?.addEventListener('click', () => closeLightbox(false));
    overlayEl.addEventListener('click', event => {
        if (event.target === overlayEl || event.target === stageEl) closeLightbox(false);
    });

    document.addEventListener('keydown', event => {
        if (!isLightboxOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeLightbox(false);
            return;
        }
        trapLightboxFocus(event);
    });

    imgEl.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            isPanning = true;
            startX = e.touches[0].clientX - posX;
            startY = e.touches[0].clientY - posY;
        } else if (e.touches.length === 2) {
            isPanning = false;
            isPinching = true;
            initialDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            initialScale = currentScale;
        }
    }, { passive: false });

    imgEl.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (isPinching && e.touches.length === 2) {
            const currentDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const newScale = Math.min(Math.max(1, initialScale * (currentDistance / initialDistance)), 5);
            const clientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const clientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            const rect = imgEl.getBoundingClientRect();
            const dx = clientX - (rect.left + rect.width / 2);
            const dy = clientY - (rect.top + rect.height / 2);
            const scaleRatio = newScale / currentScale;
            posX -= dx * (scaleRatio - 1);
            posY -= dy * (scaleRatio - 1);
            currentScale = newScale;
            updateTransform();
        } else if (isPanning && e.touches.length === 1 && currentScale > 1) {
            posX = e.touches[0].clientX - startX;
            posY = e.touches[0].clientY - startY;
            updateTransform();
        }
    }, { passive: false });

    imgEl.addEventListener('touchend', (e) => {
        isPanning = false;
        isPinching = false;
        const currentTime = Date.now();
        if (currentTime - lastTapTime < 300 && currentTime - lastTapTime > 0 && e.touches.length === 0) {
            currentScale = 1;
            posX = 0;
            posY = 0;
            updateTransform();
        }
        lastTapTime = currentTime;
    });
}
