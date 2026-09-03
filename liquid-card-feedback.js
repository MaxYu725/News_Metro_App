/* v55 feed-card press feedback.
   Event delegation keeps dynamically rendered cards covered without observers.
   Scrolling cancels the press state so vertical feed gestures stay natural. */

const CARD_SELECTOR = '#news-grid > .metro-tile.feed-card';
const INNER_INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [role="button"]';
const MIN_CARD_PRESS_MS = 55;
const SCROLL_CANCEL_DISTANCE = 12;

let activeCard = null;
let activePointerId = null;
let pressedAt = 0;
let startX = 0;
let startY = 0;
let releaseTimer = 0;

function clearReleaseTimer() {
    if (!releaseTimer) return;
    window.clearTimeout(releaseTimer);
    releaseTimer = 0;
}

function finishCardRelease() {
    clearReleaseTimer();
    activeCard?.classList.remove('liquid-card-press-active');
    activeCard = null;
    activePointerId = null;
    pressedAt = 0;
}

function releaseCard({ immediate = false } = {}) {
    if (!activeCard) return;
    const remaining = immediate
        ? 0
        : Math.max(0, MIN_CARD_PRESS_MS - (performance.now() - pressedAt));

    if (remaining === 0) {
        finishCardRelease();
        return;
    }

    clearReleaseTimer();
    releaseTimer = window.setTimeout(finishCardRelease, remaining);
}

function findCard(target) {
    if (!(target instanceof Element)) return null;
    const card = target.closest(CARD_SELECTOR);
    if (!card) return null;

    const innerInteractive = target.closest(INNER_INTERACTIVE_SELECTOR);
    if (innerInteractive && innerInteractive !== card && card.contains(innerInteractive)) return null;
    return card;
}

function initCardFeedback() {
    document.addEventListener('pointerdown', event => {
        if (event.button !== undefined && event.button !== 0) return;
        const card = findCard(event.target);
        if (!card) return;

        finishCardRelease();
        activeCard = card;
        activePointerId = event.pointerId;
        pressedAt = performance.now();
        startX = event.clientX;
        startY = event.clientY;
        card.classList.add('liquid-card-press-active');
    }, true);

    document.addEventListener('pointermove', event => {
        if (!activeCard || event.pointerId !== activePointerId) return;
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > SCROLL_CANCEL_DISTANCE) {
            releaseCard({ immediate: true });
        }
    }, true);

    document.addEventListener('pointerup', event => {
        if (activePointerId !== null && event.pointerId !== activePointerId) return;
        releaseCard();
    }, true);

    document.addEventListener('pointercancel', () => releaseCard({ immediate: true }), true);
    window.addEventListener('blur', () => releaseCard({ immediate: true }));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCardFeedback, { once: true });
} else {
    initCardFeedback();
}
