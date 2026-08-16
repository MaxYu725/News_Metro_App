let currentScale = 1, posX = 0, posY = 0, startX = 0, startY = 0;
let isPanning = false, isPinching = false, initialDistance = 0, initialScale = 1, lastTapTime = 0;
export let isLightboxOpen = false;

let overlayEl = null;
let imgEl = null;

function updateTransform() {
    if (imgEl) {
        imgEl.style.transform = `translate(${posX}px, ${posY}px) scale(${currentScale})`;
    }
}

export function openLightbox(src) {
    if (!imgEl || !overlayEl) return;
    imgEl.src = src;
    currentScale = 1; posX = 0; posY = 0;
    updateTransform();
    overlayEl.classList.remove('hidden');
    setTimeout(() => overlayEl.classList.remove('opacity-0'), 10);
    isLightboxOpen = true;
    history.pushState({ lightbox: true }, '');
}

export function closeLightbox(fromHardwareBackBtn = false) {
    if (!overlayEl || overlayEl.classList.contains('hidden')) return;
    overlayEl.classList.add('opacity-0');
    setTimeout(() => {
        overlayEl.classList.add('hidden');
        if (imgEl) imgEl.src = '';
    }, 200);
    isLightboxOpen = false;
    if (!fromHardwareBackBtn) history.back();
}

export function initLightbox() {
    overlayEl = document.getElementById('lightbox-overlay');
    imgEl = document.getElementById('lightbox-img');
    const closeBtn = document.getElementById('lightbox-close');

    if (!overlayEl || !imgEl) return;

    window.addEventListener('popstate', () => { if (isLightboxOpen) closeLightbox(true); });
    closeBtn?.addEventListener('click', () => closeLightbox(false));
    overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeLightbox(false); });

    imgEl.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            isPanning = true; startX = e.touches[0].clientX - posX; startY = e.touches[0].clientY - posY;
        } else if (e.touches.length === 2) {
            isPanning = false; isPinching = true;
            initialDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            initialScale = currentScale;
        }
    }, { passive: false });

    imgEl.addEventListener('touchmove', (e) => {
        e.preventDefault(); 
        if (isPinching && e.touches.length === 2) {
            const currentDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            const newScale = Math.min(Math.max(1, initialScale * (currentDistance / initialDistance)), 5);
            const clientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const clientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            const rect = imgEl.getBoundingClientRect();
            const dx = clientX - (rect.left + rect.width / 2);
            const dy = clientY - (rect.top + rect.height / 2);
            const scaleRatio = newScale / currentScale;
            posX -= dx * (scaleRatio - 1); posY -= dy * (scaleRatio - 1);
            currentScale = newScale;
            updateTransform();
        } else if (isPanning && e.touches.length === 1 && currentScale > 1) {
            posX = e.touches[0].clientX - startX; posY = e.touches[0].clientY - startY;
            updateTransform();
        }
    }, { passive: false });

    imgEl.addEventListener('touchend', (e) => {
        isPanning = false; isPinching = false;
        const currentTime = new Date().getTime();
        if (currentTime - lastTapTime < 300 && currentTime - lastTapTime > 0 && e.touches.length === 0) {
            currentScale = 1; posX = 0; posY = 0;
            updateTransform();
        }
        lastTapTime = currentTime;
    });
}
