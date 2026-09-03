import './reader-image-stability.js';
import './liquid-nav-indicator.js?v=53';
import './liquid-category-indicator.js?v=54';
import './liquid-reader-cue.js?v=58';

/* v58 controlled motion restoration.
   Accepted motion remains limited to local control feedback, Bottom Nav island,
   category island, and an explicit post-paint Reader chrome cue. Feed-card
   transforms, full-page motion and full Reader-shell transitions remain disabled. */

const PRESSABLE_SELECTOR = [
    '.bottom-nav-btn',
    '.nav-link',
    '.metro-btn',
    '.density-btn',
    '.color-btn',
    '.settings-link-row',
    '.search-submit',
    '.search-chip',
    '.search-follow-btn',
    '.subview-back',
    '.page-header-back',
    '#back-to-top',
    '#lightbox-close',
    '#lightbox-quality',
    '.reader-close',
    '.reader-toolbar-btn'
].join(',');

const MIN_PRESS_VISIBLE_MS = 66;
let pressedControl = null;
let pressedAt = 0;
let releaseTimer = 0;

function findPressable(target) {
    if (!(target instanceof Element)) return null;
    const control = target.closest(PRESSABLE_SELECTOR);
    if (!control || control.matches(':disabled, [aria-disabled="true"]')) return null;
    return control;
}

function clearReleaseTimer() {
    if (!releaseTimer) return;
    window.clearTimeout(releaseTimer);
    releaseTimer = 0;
}

function finishRelease() {
    clearReleaseTimer();
    if (!pressedControl) return;
    pressedControl.classList.remove('liquid-press-active');
    pressedControl = null;
    pressedAt = 0;
}

function releasePressedControl({ immediate = false } = {}) {
    if (!pressedControl) return;

    const elapsed = performance.now() - pressedAt;
    const remaining = Math.max(0, MIN_PRESS_VISIBLE_MS - elapsed);

    if (immediate || remaining === 0) {
        finishRelease();
        return;
    }

    clearReleaseTimer();
    releaseTimer = window.setTimeout(finishRelease, remaining);
}

function pressControl(control) {
    if (!control) return;

    finishRelease();
    pressedControl = control;
    pressedAt = performance.now();
    control.classList.add('liquid-press-active');
}

function installPressFeedback() {
    document.addEventListener('pointerdown', event => {
        pressControl(findPressable(event.target));
    }, true);

    document.addEventListener('pointerup', () => releasePressedControl(), true);
    document.addEventListener('pointercancel', () => releasePressedControl({ immediate: true }), true);
    window.addEventListener('blur', () => releasePressedControl({ immediate: true }));
}

function initLiquidGlassStaticBaseline() {
    document.documentElement.dataset.liquidReady = 'static-press-nav-category-reader-chrome';
    document.documentElement.dataset.liquidDebug = 'zero-motion-plus-press-plus-nav-plus-category-plus-reader-chrome-v58';
    installPressFeedback();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiquidGlassStaticBaseline, { once: true });
} else {
    initLiquidGlassStaticBaseline();
}
