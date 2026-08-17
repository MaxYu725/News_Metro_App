let currentScale = 1, posX = 0, posY = 0, startX = 0, startY = 0;
let isPanning = false, isPinching = false, initialDistance = 0, initialScale = 1, lastTapTime = 0;
let touchGestureStartedWithSingle = false, touchGestureMoved = false, pinchGestureOccurred = false;
let touchStartClientX = 0, touchStartClientY = 0;
export let isLightboxOpen = false;

let overlayEl = null;
let stageEl = null;
let imgEl = null;
let closeBtnEl = null;
let qualityBtnEl = null;
let hintEl = null;
let normalImageSrc = '';
let highQualitySrc = '';
let highQualityActive = false;
let qualitySwitchPending = false;
let qualityRequestToken = 0;
let mousePointerId = null;
let mouseDragging = false;
let mouseStartX = 0;
let mouseStartY = 0;
let restoreFocusTarget = null;
let inertTargets = [];

const DOUBLE_TAP_WINDOW_MS = 300;
const TAP_MOVE_THRESHOLD_PX = 10;

function updateTransform() {
    if (imgEl) {
        imgEl.style.transform = `translate3d(${posX}px, ${posY}px, 0) scale(${currentScale})`;
    }
}

function updatePointerUI() {
    if (!imgEl) return;
    if (mouseDragging) imgEl.style.cursor = 'grabbing';
    else if (currentScale > 1) imgEl.style.cursor = 'grab';
    else imgEl.style.cursor = 'zoom-in';
}

function setTouchInteraction(active) {
    if (!imgEl) return;
    imgEl.style.transition = active ? 'none' : '';
}

function resetTouchGestureState() {
    isPanning = false;
    isPinching = false;
    touchGestureStartedWithSingle = false;
    touchGestureMoved = false;
    pinchGestureOccurred = false;
    setTouchInteraction(false);
}

function resetView() {
    currentScale = 1;
    posX = 0;
    posY = 0;
    mouseDragging = false;
    mousePointerId = null;
    updateTransform();
    updatePointerUI();
}

function scaleAt(nextScale, clientX, clientY) {
    const clampedScale = Math.min(Math.max(nextScale, 1), 5);
    if (!stageEl || currentScale === clampedScale) return;

    const rect = stageEl.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const scaleRatio = clampedScale / currentScale;

    posX = (posX * scaleRatio) - (dx * (scaleRatio - 1));
    posY = (posY * scaleRatio) - (dy * (scaleRatio - 1));
    currentScale = clampedScale;

    if (currentScale === 1) {
        posX = 0;
        posY = 0;
    }

    updateTransform();
    updatePointerUI();
}

function updateHint() {
    if (!hintEl) return;
    hintEl.textContent = window.matchMedia?.('(pointer: fine)').matches
        ? '滾輪縮放 · 拖曳移動 · 雙擊還原'
        : '雙指縮放 · 雙擊還原';
}

function buildHk01HighQualityUrl(src) {
    try {
        const url = new URL(src, location.href);
        if (url.protocol !== 'https:' || url.hostname !== 'cdn.hk01.com') return '';
        if (!url.pathname.includes('/di/media/images/')) return '';
        url.searchParams.set('v', 'w1920');
        return url.toString();
    } catch {
        return '';
    }
}

function applyQualityVisual(active) {
    if (!qualityBtnEl) return;

    qualityBtnEl.style.backgroundColor = active ? '#38bdf8' : '';
    qualityBtnEl.style.borderColor = active ? '#38bdf8' : '';
    qualityBtnEl.style.color = active ? '#07111c' : '';
    qualityBtnEl.style.boxShadow = active ? '0 0 18px rgba(56, 189, 248, 0.28)' : '';
}

function hideQualityControl() {
    if (!qualityBtnEl) return;
    qualityBtnEl.classList.add('hidden');
    qualityBtnEl.disabled = false;
    qualityBtnEl.textContent = '高清';
    qualityBtnEl.setAttribute('aria-pressed', 'false');
    qualityBtnEl.setAttribute('aria-label', '載入高清圖片');
    applyQualityVisual(false);
}

function syncQualityControl() {
    if (!qualityBtnEl || !imgEl || !isLightboxOpen) return;

    if (qualitySwitchPending) {
        qualityBtnEl.classList.remove('hidden');
        qualityBtnEl.disabled = true;
        qualityBtnEl.textContent = '載入中…';
        applyQualityVisual(highQualityActive);
        return;
    }

    if (highQualityActive) {
        qualityBtnEl.classList.remove('hidden');
        qualityBtnEl.disabled = false;
        qualityBtnEl.textContent = '高清 ✓';
        qualityBtnEl.setAttribute('aria-pressed', 'true');
        qualityBtnEl.setAttribute('aria-label', '高清圖片已啟用，按下切回標準圖片');
        applyQualityVisual(true);
        return;
    }

    highQualitySrc = buildHk01HighQualityUrl(normalImageSrc);
    const canUpgrade = !!highQualitySrc
        && highQualitySrc !== normalImageSrc
        && imgEl.naturalWidth > 0
        && imgEl.naturalWidth < 1920;

    if (!canUpgrade) {
        hideQualityControl();
        return;
    }

    qualityBtnEl.classList.remove('hidden');
    qualityBtnEl.disabled = false;
    qualityBtnEl.textContent = '高清';
    qualityBtnEl.setAttribute('aria-pressed', 'false');
    qualityBtnEl.setAttribute('aria-label', '載入高清圖片');
    applyQualityVisual(false);
}

function resetQualityState() {
    qualityRequestToken += 1;
    normalImageSrc = '';
    highQualitySrc = '';
    highQualityActive = false;
    qualitySwitchPending = false;
    hideQualityControl();
}

function loadImageOnDemand(src, token) {
    return new Promise((resolve, reject) => {
        const candidate = new Image();
        candidate.referrerPolicy = 'no-referrer';
        candidate.onload = () => {
            if (token !== qualityRequestToken || !isLightboxOpen) return reject(new Error('cancelled'));
            resolve(src);
        };
        candidate.onerror = () => reject(new Error('image-load-failed'));
        candidate.src = src;
    });
}

async function toggleImageQuality() {
    if (!imgEl || !qualityBtnEl || !isLightboxOpen || qualitySwitchPending) return;

    const targetHighQuality = !highQualityActive;
    const targetSrc = targetHighQuality ? highQualitySrc : normalImageSrc;
    if (!targetSrc) return;

    const token = ++qualityRequestToken;
    qualitySwitchPending = true;
    syncQualityControl();

    try {
        await loadImageOnDemand(targetSrc, token);
        if (token !== qualityRequestToken || !isLightboxOpen) return;

        highQualityActive = targetHighQuality;
        qualitySwitchPending = false;
        imgEl.src = targetSrc;
        resetView();
        syncQualityControl();
    } catch (error) {
        if (token !== qualityRequestToken || !isLightboxOpen || error?.message === 'cancelled') return;
        qualitySwitchPending = false;
        syncQualityControl();
        const fallbackLabel = qualityBtnEl.textContent;
        qualityBtnEl.textContent = '載入失敗';
        window.setTimeout(() => {
            if (!isLightboxOpen || qualitySwitchPending) return;
            qualityBtnEl.textContent = fallbackLabel;
        }, 1400);
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
    resetQualityState();
    resetTouchGestureState();
    lastTapTime = 0;
    normalImageSrc = src;
    imgEl.src = src;
    resetView();
    updateHint();

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
    resetQualityState();
    resetTouchGestureState();
    lastTapTime = 0;
    setUnderlyingInert(false);
    restoreFocus();

    window.setTimeout(() => {
        overlayEl.classList.add('hidden');
        if (imgEl) imgEl.src = '';
    }, 200);

    if (!fromHardwareBackBtn) history.back();
}

function trapLightboxFocus(event) {
    if (!isLightboxOpen || event.key !== 'Tab') return;

    const focusable = [qualityBtnEl, closeBtnEl].filter(element =>
        element && !element.classList.contains('hidden') && !element.disabled
    );
    if (focusable.length === 0) return;

    const currentIndex = focusable.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);

    event.preventDefault();
    focusable[nextIndex]?.focus({ preventScroll: true });
}

export function initLightbox() {
    overlayEl = document.getElementById('lightbox-overlay');
    stageEl = document.getElementById('lightbox-stage');
    imgEl = document.getElementById('lightbox-img');
    closeBtnEl = document.getElementById('lightbox-close');
    qualityBtnEl = document.getElementById('lightbox-quality');
    hintEl = document.getElementById('lightbox-hint');

    if (!overlayEl || !imgEl) return;

    if (stageEl) stageEl.style.touchAction = 'none';
    imgEl.style.touchAction = 'none';
    imgEl.style.willChange = 'transform';
    imgEl.style.backfaceVisibility = 'hidden';
    imgEl.style.webkitBackfaceVisibility = 'hidden';

    window.addEventListener('popstate', () => {
        if (isLightboxOpen) closeLightbox(true);
    });

    closeBtnEl?.addEventListener('click', () => closeLightbox(false));
    qualityBtnEl?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        toggleImageQuality();
    });
    imgEl.addEventListener('load', () => {
        if (!isLightboxOpen || qualitySwitchPending) return;
        syncQualityControl();
    });
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

    stageEl?.addEventListener('wheel', event => {
        if (!isLightboxOpen || event.ctrlKey) return;
        event.preventDefault();

        const factor = event.deltaY < 0 ? 1.12 : (1 / 1.12);
        scaleAt(currentScale * factor, event.clientX, event.clientY);
    }, { passive: false });

    imgEl.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'mouse' || event.button !== 0 || event.isPrimary === false) return;
        if (currentScale <= 1) return;

        mousePointerId = event.pointerId;
        mouseDragging = true;
        mouseStartX = event.clientX - posX;
        mouseStartY = event.clientY - posY;
        imgEl.setPointerCapture?.(mousePointerId);
        updatePointerUI();
        event.preventDefault();
    });

    imgEl.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse' || event.pointerId !== mousePointerId || !mouseDragging) return;
        posX = event.clientX - mouseStartX;
        posY = event.clientY - mouseStartY;
        updateTransform();
        event.preventDefault();
    });

    const finishMousePan = event => {
        if (event.pointerType !== 'mouse' || event.pointerId !== mousePointerId) return;
        const activePointerId = mousePointerId;
        mousePointerId = null;
        mouseDragging = false;
        if (imgEl.hasPointerCapture?.(activePointerId)) imgEl.releasePointerCapture(activePointerId);
        updatePointerUI();
    };

    imgEl.addEventListener('pointerup', finishMousePan);
    imgEl.addEventListener('pointercancel', finishMousePan);
    imgEl.addEventListener('dragstart', event => event.preventDefault());

    imgEl.addEventListener('dblclick', event => {
        if (!isLightboxOpen) return;
        event.preventDefault();
        event.stopPropagation();
        if (currentScale > 1.05) resetView();
        else scaleAt(2, event.clientX, event.clientY);
    });

    imgEl.addEventListener('touchstart', event => {
        if (!isLightboxOpen) return;
        event.preventDefault();

        if (event.touches.length === 1) {
            const touch = event.touches[0];
            touchGestureStartedWithSingle = true;
            touchGestureMoved = false;
            pinchGestureOccurred = false;
            touchStartClientX = touch.clientX;
            touchStartClientY = touch.clientY;
            isPinching = false;
            isPanning = currentScale > 1;
            startX = touch.clientX - posX;
            startY = touch.clientY - posY;
            setTouchInteraction(isPanning);
            return;
        }

        if (event.touches.length === 2) {
            touchGestureStartedWithSingle = false;
            pinchGestureOccurred = true;
            touchGestureMoved = true;
            isPanning = false;
            isPinching = true;
            initialDistance = Math.hypot(
                event.touches[0].clientX - event.touches[1].clientX,
                event.touches[0].clientY - event.touches[1].clientY
            );
            initialScale = currentScale;
            setTouchInteraction(true);
        }
    }, { passive: false });

    imgEl.addEventListener('touchmove', event => {
        if (!isLightboxOpen) return;
        event.preventDefault();

        if (isPinching && event.touches.length === 2 && stageEl) {
            const currentDistance = Math.hypot(
                event.touches[0].clientX - event.touches[1].clientX,
                event.touches[0].clientY - event.touches[1].clientY
            );
            if (!initialDistance) return;

            const newScale = Math.min(Math.max(1, initialScale * (currentDistance / initialDistance)), 5);
            const clientX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
            const clientY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
            const rect = stageEl.getBoundingClientRect();
            const dx = clientX - (rect.left + rect.width / 2);
            const dy = clientY - (rect.top + rect.height / 2);
            const scaleRatio = newScale / currentScale;

            posX = (posX * scaleRatio) - (dx * (scaleRatio - 1));
            posY = (posY * scaleRatio) - (dy * (scaleRatio - 1));
            currentScale = newScale;

            if (currentScale === 1) {
                posX = 0;
                posY = 0;
            }

            touchGestureMoved = true;
            updateTransform();
            updatePointerUI();
            return;
        }

        if (isPanning && event.touches.length === 1 && currentScale > 1) {
            const touch = event.touches[0];
            if (
                Math.abs(touch.clientX - touchStartClientX) > TAP_MOVE_THRESHOLD_PX
                || Math.abs(touch.clientY - touchStartClientY) > TAP_MOVE_THRESHOLD_PX
            ) {
                touchGestureMoved = true;
            }
            posX = touch.clientX - startX;
            posY = touch.clientY - startY;
            updateTransform();
        }
    }, { passive: false });

    imgEl.addEventListener('touchend', event => {
        if (!isLightboxOpen) return;
        event.preventDefault();

        if (event.touches.length === 1 && pinchGestureOccurred) {
            const touch = event.touches[0];
            isPinching = false;
            isPanning = currentScale > 1;
            startX = touch.clientX - posX;
            startY = touch.clientY - posY;
            touchStartClientX = touch.clientX;
            touchStartClientY = touch.clientY;
            setTouchInteraction(isPanning);
            return;
        }

        if (event.touches.length > 0) return;

        const wasSingleTap = touchGestureStartedWithSingle
            && !pinchGestureOccurred
            && !touchGestureMoved;

        isPanning = false;
        isPinching = false;
        setTouchInteraction(false);

        if (wasSingleTap) {
            const currentTime = Date.now();
            const isDoubleTap = lastTapTime > 0
                && currentTime - lastTapTime < DOUBLE_TAP_WINDOW_MS;

            if (isDoubleTap) {
                lastTapTime = 0;
                if (currentScale > 1.05) resetView();
            } else {
                lastTapTime = currentTime;
            }
        } else {
            lastTapTime = 0;
        }

        touchGestureStartedWithSingle = false;
        touchGestureMoved = false;
        pinchGestureOccurred = false;
    }, { passive: false });

    imgEl.addEventListener('touchcancel', () => {
        resetTouchGestureState();
        lastTapTime = 0;
    }, { passive: true });
}
