import './reader-image-stability.js';

/* v49 controlled motion restoration.
   The v46 zero-motion baseline remains in force except for one effect family:
   local press feedback on small controls. No MutationObserver/rAF motion
   controller, forced reflow, spotlight tracking, page/card/Reader transition,
   or morphing navigation indicator is restored. */

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

let pressedControl = null;

function findPressable(target) {
    if (!(target instanceof Element)) return null;
    const control = target.closest(PRESSABLE_SELECTOR);
    if (!control || control.matches(':disabled, [aria-disabled="true"]')) return null;
    return control;
}

function releasePressedControl() {
    if (!pressedControl) return;
    pressedControl.classList.remove('liquid-press-active');
    pressedControl = null;
}

function installPressFeedback() {
    document.addEventListener('pointerdown', event => {
        const control = findPressable(event.target);
        if (!control) return;
        releasePressedControl();
        pressedControl = control;
        control.classList.add('liquid-press-active');
    }, true);

    document.addEventListener('pointerup', releasePressedControl, true);
    document.addEventListener('pointercancel', releasePressedControl, true);
    window.addEventListener('blur', releasePressedControl);
}

function initLiquidGlassStaticBaseline() {
    document.documentElement.dataset.liquidReady = 'static-press';
    document.documentElement.dataset.liquidDebug = 'zero-motion-plus-press';
    installPressFeedback();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiquidGlassStaticBaseline, { once: true });
} else {
    initLiquidGlassStaticBaseline();
}
