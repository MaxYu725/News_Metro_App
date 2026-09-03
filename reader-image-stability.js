/* v48 Reader image decode stability.
   Keep Reader images transparent until decoding finishes. Do NOT override
   `visibility`: the Reader overlay itself closes via `visibility: hidden`, and
   a child with inline `visibility: visible` can escape that hidden ancestor. */

const stabilized = new WeakSet();

function revealDecodedImage(img) {
    if (!(img instanceof HTMLImageElement) || stabilized.has(img)) return;
    stabilized.add(img);

    // Clear any v47 inline visibility override and isolate decode gating to
    // opacity only. Parent Reader visibility therefore always remains authoritative.
    img.style.removeProperty('visibility');
    img.style.opacity = '0';
    img.style.transition = 'none';
    img.decoding = 'async';

    let revealed = false;
    const reveal = () => {
        if (revealed) return;
        revealed = true;
        img.style.opacity = '1';
    };

    const decodeThenReveal = () => {
        if (typeof img.decode === 'function') {
            img.decode().catch(() => {}).finally(reveal);
        } else {
            reveal();
        }
    };

    if (img.complete) {
        if (img.naturalWidth > 0) decodeThenReveal();
        else reveal();
        return;
    }

    img.addEventListener('load', decodeThenReveal, { once: true });
    img.addEventListener('error', reveal, { once: true });
}

function scanReaderImages(root) {
    if (!(root instanceof Element)) return;
    if (root.matches('img.reader-image')) revealDecodedImage(root);
    root.querySelectorAll?.('img.reader-image').forEach(revealDecodedImage);
}

function initReaderImageStability() {
    document.querySelectorAll('img.reader-image').forEach(revealDecodedImage);

    new MutationObserver(records => {
        records.forEach(record => {
            record.addedNodes.forEach(node => scanReaderImages(node));
        });
    }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReaderImageStability, { once: true });
} else {
    initReaderImageStability();
}
