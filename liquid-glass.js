/* v46 zero-motion baseline.
   Deliberately no MutationObserver, requestAnimationFrame animation controller,
   forced reflow, spotlight tracking, page transition classes or morphing
   indicator updates. The Liquid Glass material stays in CSS so this build
   isolates motion/compositor orchestration from visual material. */

function initLiquidGlassStaticBaseline() {
    document.documentElement.dataset.liquidReady = 'static';
    document.documentElement.dataset.liquidDebug = 'zero-motion';
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiquidGlassStaticBaseline, { once: true });
} else {
    initLiquidGlassStaticBaseline();
}
