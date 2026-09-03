import './reader-image-stability.js';

/* v51 controlled motion restoration.
   The zero-motion baseline remains in force except for one effect family:
   local press feedback on small controls. v51 changes timing only: press-down
   snaps immediately, while release uses a short spring. No page/card/Reader
   transition, MutationObserver/rAF motion controller, forced reflow, spotlight
   tracking or morphing navigation indicator is restored. */

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

/* With the down-state now applied without transition, only a short hold is
   needed to guarantee several 90 Hz frames before spring release. */
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
    document.documentElement.dataset.liquidReady = 'static-press';
    document.documentElement.dataset.liquidDebug = 'zero-motion-plus-press-snap-release';
    installPressFeedback();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiquidGlassStaticBaseline, { once: true });
} else {
    initLiquidGlassStaticBaseline();
}
