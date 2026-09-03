import './reader-image-stability.js';

/* v47 zero-motion baseline + Reader image decode isolation.
   Deliberately no MutationObserver/requestAnimationFrame motion controller,
   forced reflow, spotlight tracking, page transition classes or morphing
   indicator updates. Liquid Glass material stays enabled. */

function initLiquidGlassStaticBaseline() {
    document.documentElement.dataset.liquidReady = 'static';
    document.documentElement.dataset.liquidDebug = 'zero-motion-reader-decode';
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiquidGlassStaticBaseline, { once: true });
} else {
    initLiquidGlassStaticBaseline();
}
