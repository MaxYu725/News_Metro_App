let currentScale = 1, posX = 0, posY = 0, startX = 0, startY = 0;
let isPanning = false, isPinching = false, initialDistance = 0, initialScale = 1, lastTapTime = 0;
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

function updateTransform() {
    if (imgEl) {
        imgEl.style.transform = `translate(${posX}px, ${posY}px) scale(${currentScale})`;
    }
}

function updatePointerUI() {
    if (!imgEl) return;
    if (mouseDragging) imgEl.style.cursor = 'grabbing';
    else if (currentScale > 1) imgEl.style.cursor = 'grab';
    else imgEl.style.cursor = 'zoom-in';
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

    // Preserve the content point under the mouse cursor even after the image
    // has already been panned away from the stage centre.
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

function hideQualityControl() {
    if (!qualityBtnEl) return;
    qualityBtnEl.classList.add('hidden');
    qualityBtnEl.disabled = false;
    qualityBtnEl.textContent = '高清';
    qualityBtnEl.setAttribute('aria-pressed', 'false');
    qualityBtnEl.setAttribute('aria-label', '載入高清圖片');
}

function syncQualityControl() {
    if (!qualityBtnEl || !imgEl || !isLightboxOpen) return;

    if (qualitySwitchPending) {
        qualityBtnEl.classList.remove('hidden');
        qualityBtnEl.disabled = true;
        qualityBtnEl.textContent = '載入中…';
        return;
    }

    if (highQualityActive) {
        qualityBtnEl.classList.remove('hidden');
        qualityBtnEl.disabled = false;
        qualityBtnEl.textContent = '一般';
        qualityBtnEl.setAttribute('aria-pressed', 'true');
        qualityBtnEl.setAttribute('aria-label', '切回一般圖片');
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

    // Desktop lightbox interaction: wheel zoom, drag-to-pan and double-click.
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
            updatePointerUI();
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
            resetView();
        }
        lastTapTime = currentTime;
    });
}
