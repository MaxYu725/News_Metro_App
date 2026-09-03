# Zero-based flicker debug

## v46 hypothesis isolation

The recorded Search ↔ News transitions reproduce while both views are already cached in memory. `showSearchSection()` and the News `newsCache` fast path render synchronously and do not require a network fetch or skeleton loading on these return transitions. The captured blank frames therefore cannot be explained by network/data latency.

The v45 compositor hand-off made the visual flash stronger, so it is removed from the active experiment.

v46 isolates one variable only: **Liquid Glass motion/compositor orchestration**.

- Keep the Liquid Glass material, gradients, borders, rounded surfaces and backdrop blur.
- Disable the Liquid Glass MutationObserver / rAF motion controller.
- Disable full-page, card, Reader, nav and press transforms/animations/transitions on mobile.
- Hide the morphing nav indicator and use a static active glass island so navigation state remains clear.
- Remove `translateZ(0)`, `contain: content` and other card promotion hints from the active mobile feed baseline.
- Keep data flow, search state, news cache, Reader data fetching and application navigation logic unchanged.

### Decision tree

1. If v46 removes the flicker, the fault is in the motion/compositing layer. Reintroduce effects one family at a time: press feedback → nav indicator → card reveal → Reader transition.
2. If v46 still flickers, the next isolated variable is `backdrop-filter`. v47 will retain the same static layout/material colors but replace all backdrop blur with precomposed opaque/translucent gradients.
3. Only if the flat-material baseline still flickers do we investigate DOM/state rendering.
