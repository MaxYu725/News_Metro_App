/* v58 explicit Reader cue trigger.
   v57 tied animation start to the same .open state that makes the overlay visible.
   On Android/WebView that can be coalesced into the first Reader paint, making the
   cue effectively invisible. This module waits until the Reader is already open,
   then arms a separate cue class on the following frame. No forced reflow,
   MutationObserver, continuous rAF loop, or full-screen transform is used. */

const READER_CARD_SELECTOR = '#news-grid > .metro-tile.feed-card';
const INNER_INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [role="button"], .gallery-img';

function isReaderCardTap(target) {
    if (!(target instanceof Element)) return false;
    const card = target.closest(READER_CARD_SELECTOR);
    if (!card) return false;
    const innerInteractive = target.closest(INNER_INTERACTIVE_SELECTOR);
    return !(innerInteractive && innerInteractive !== card && card.contains(innerInteractive));
}

function armReaderCue() {
    const overlay = document.getElementById('reader-overlay');
    if (!overlay?.classList.contains('open')) return;

    overlay.classList.remove('reader-cue-active');

    // A second frame guarantees the Reader has had a stable visible paint before
    // the local chrome cue starts, so WebView cannot fold both states together.
    requestAnimationFrame(() => {
        if (overlay.classList.contains('open')) {
            overlay.classList.add('reader-cue-active');
        }
    });
}

function installReaderCueTrigger() {
    document.addEventListener('click', event => {
        if (!isReaderCardTap(event.target)) return;
        requestAnimationFrame(armReaderCue);
    });

    // Keep the class out of the hidden Reader state so every later open starts clean.
    document.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        if (!event.target.closest('.reader-close')) return;
        document.getElementById('reader-overlay')?.classList.remove('reader-cue-active');
    }, true);

    window.addEventListener('popstate', () => {
        if (!document.getElementById('reader-overlay')?.classList.contains('open')) {
            document.getElementById('reader-overlay')?.classList.remove('reader-cue-active');
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installReaderCueTrigger, { once: true });
} else {
    installReaderCueTrigger();
}
