#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
reader = ROOT / 'reader-ui.js'
text = reader.read_text('utf-8')

anchor = "function buildReaderMedia(article) {\n"
helper = r'''function enableMouseDragScroll(track) {
    if (!track || track.children.length < 2) return;

    let pointerId = null;
    let startX = 0;
    let startScrollLeft = 0;
    let dragging = false;
    let suppressNextClick = false;

    track.style.cursor = 'grab';

    const restoreTrackBehavior = () => {
        track.style.cursor = 'grab';
        track.style.scrollBehavior = '';
        track.style.scrollSnapType = '';
    };

    track.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'mouse' || event.button !== 0 || event.isPrimary === false) return;

        pointerId = event.pointerId;
        startX = event.clientX;
        startScrollLeft = track.scrollLeft;
        dragging = false;
    });

    track.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse' || event.pointerId !== pointerId) return;

        const deltaX = event.clientX - startX;
        if (!dragging && Math.abs(deltaX) < 5) return;

        if (!dragging) {
            dragging = true;
            track.setPointerCapture?.(pointerId);
            track.style.cursor = 'grabbing';
            track.style.scrollBehavior = 'auto';
            track.style.scrollSnapType = 'none';
        }

        event.preventDefault();
        track.scrollLeft = startScrollLeft - deltaX;
    });

    const finishDrag = (event, cancelled = false) => {
        if (event.pointerType !== 'mouse' || event.pointerId !== pointerId) return;

        const activePointerId = pointerId;
        const wasDragging = dragging;
        pointerId = null;
        dragging = false;

        if (track.hasPointerCapture?.(activePointerId)) {
            track.releasePointerCapture(activePointerId);
        }
        restoreTrackBehavior();

        if (!wasDragging) return;
        suppressNextClick = true;

        if (!cancelled && track.clientWidth > 0) {
            const page = Math.round(track.scrollLeft / track.clientWidth);
            requestAnimationFrame(() => {
                track.scrollTo({ left: page * track.clientWidth, behavior: 'smooth' });
            });
        }
    };

    track.addEventListener('pointerup', event => finishDrag(event));
    track.addEventListener('pointercancel', event => finishDrag(event, true));
    track.addEventListener('dragstart', event => event.preventDefault());

    track.addEventListener('click', event => {
        if (!suppressNextClick) return;
        suppressNextClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
}

'''
if anchor not in text:
    raise SystemExit('reader buildReaderMedia anchor missing')
if 'function enableMouseDragScroll(track)' not in text:
    text = text.replace(anchor, helper + anchor, 1)

old_img = """        img.referrerPolicy = 'no-referrer';\n        img.dataset.readerLightbox = '1';"""
new_img = """        img.referrerPolicy = 'no-referrer';\n        img.draggable = false;\n        img.dataset.readerLightbox = '1';"""
if old_img not in text:
    raise SystemExit('reader image anchor missing')
text = text.replace(old_img, new_img, 1)

old_append = """    DOM.media.appendChild(track);\n\n    if (imageUrls.length > 1) {"""
new_append = """    DOM.media.appendChild(track);\n    enableMouseDragScroll(track);\n\n    if (imageUrls.length > 1) {"""
if old_append not in text:
    raise SystemExit('reader append anchor missing')
text = text.replace(old_append, new_append, 1)
text = text.replace("count.textContent = `${imageUrls.length} 圖 · 左右滑動`;", "count.textContent = `${imageUrls.length} 圖 · 左右滑動／拖曳`;", 1)
reader.write_text(text, 'utf-8')

sw = ROOT / 'sw.js'
sw_text = sw.read_text('utf-8')
old_cache = "const SHELL_CACHE = 'metro-news-shell-v22-mui6d';"
new_cache = "const SHELL_CACHE = 'metro-news-shell-v23-pointer1';"
if old_cache not in sw_text:
    raise SystemExit('service worker cache anchor missing')
sw.write_text(sw_text.replace(old_cache, new_cache, 1), 'utf-8')
