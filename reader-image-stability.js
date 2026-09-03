/* v47 reader image decode stability.
   Keeps Reader images hidden until the browser has fully decoded them, so
   progressive JPEG/intermediate decode frames never appear as a flash. */

const stabilized = new WeakSet();

function revealDecodedImage(img) {
    if (!(img instanceof HTMLImageElement) || stabilized.has(img)) return;
    stabilized.add(img);

    img.style.visibility = 'hidden';
    img.decoding = 'async';

    let revealed = false;
    const reveal = () => {
        if (revealed) return;
        revealed = true;
        img.style.visibility = 'visible';
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
