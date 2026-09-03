// v59: confirmed-tap Reader press cue.
// The visual press starts only after a real click has been confirmed, so a
// vertical feed swipe never transforms the card while gesture intent is unknown.

const GRID_SELECTOR = '#news-grid';
const TILE_SELECTOR = '.metro-tile.feed-card';
const INNER_INTERACTIVE_SELECTOR = 'button, input, a, .gallery-img, [role="button"]';
const READER_PRESS_HOLD_MS = 66;

const replayingTiles = new WeakSet();
let pendingTile = null;
let pendingTimer = 0;

function clearPendingPress() {
    if (pendingTimer) {
        window.clearTimeout(pendingTimer);
        pendingTimer = 0;
    }
    pendingTile?.classList.remove('reader-tap-confirmed');
    pendingTile = null;
}

function installReaderTapCue() {
    document.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        const grid = event.target.closest(GRID_SELECTOR);
        if (!grid) return;

        const tile = event.target.closest(TILE_SELECTOR);
        if (!tile || !grid.contains(tile) || !tile.querySelector('.tile-preview')) return;

        // The synthetic replay is allowed through to reader-ui.js unchanged.
        if (replayingTiles.has(tile)) {
            replayingTiles.delete(tile);
            return;
        }

        if (event.target.closest(INNER_INTERACTIVE_SELECTOR)) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        clearPendingPress();
        pendingTile = tile;
        tile.classList.add('reader-tap-confirmed');

        pendingTimer = window.setTimeout(() => {
            pendingTimer = 0;
            const target = pendingTile;
            if (!target || !target.isConnected) {
                clearPendingPress();
                return;
            }

            replayingTiles.add(target);
            target.click();
            target.classList.remove('reader-tap-confirmed');
            pendingTile = null;
        }, READER_PRESS_HOLD_MS);
    }, true);

    window.addEventListener('blur', clearPendingPress);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installReaderTapCue, { once: true });
} else {
    installReaderTapCue();
}
