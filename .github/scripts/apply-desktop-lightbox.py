#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# --- lightbox.js -----------------------------------------------------------
path = ROOT / 'lightbox.js'
text = path.read_text('utf-8')

text = text.replace(
    "let overlayEl = null;\nlet stageEl = null;\nlet imgEl = null;\nlet closeBtnEl = null;\n",
    "let overlayEl = null;\nlet stageEl = null;\nlet imgEl = null;\nlet closeBtnEl = null;\nlet hintEl = null;\nlet mousePointerId = null;\nlet mouseDragging = false;\nlet mouseStartX = 0;\nlet mouseStartY = 0;\n"
)

anchor = "function updateTransform() {\n    if (imgEl) {\n        imgEl.style.transform = `translate(${posX}px, ${posY}px) scale(${currentScale})`;\n    }\n}\n"
helper = r'''
function updatePointerUI() {
    if (!imgEl) return;
    if (mouseDragging) imgEl.style.cursor = 'grabbing';
    else if (currentScale > 1) imgEl.style.cursor = 'grab';
    else imgEl.style.cursor = 'zoom-in';
}

function resetView() {
    currentScale = 1;
    posX = 0;
    posY = 0;
    mouseDragging = false;
    mousePointerId = null;
    updateTransform();
    updatePointerUI();
}

function scaleAt(nextScale, clientX, clientY) {
    const clampedScale = Math.min(Math.max(nextScale, 1), 5);
    if (!stageEl || currentScale === clampedScale) return;

    const rect = stageEl.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const scaleRatio = clampedScale / currentScale;

    posX -= dx * (scaleRatio - 1);
    posY -= dy * (scaleRatio - 1);
    currentScale = clampedScale;

    if (currentScale === 1) {
        posX = 0;
        posY = 0;
    }

    updateTransform();
    updatePointerUI();
}

function updateHint() {
    if (!hintEl) return;
    hintEl.textContent = window.matchMedia?.('(pointer: fine)').matches
        ? '滾輪縮放 · 拖曳移動 · 雙擊還原'
        : '雙指縮放 · 雙擊還原';
}
'''
if helper.strip() not in text:
    text = text.replace(anchor, anchor + helper)

text = text.replace(
    "    imgEl.src = src;\n    currentScale = 1;\n    posX = 0;\n    posY = 0;\n    updateTransform();\n",
    "    imgEl.src = src;\n    resetView();\n    updateHint();\n"
)

text = text.replace(
    "    closeBtnEl = document.getElementById('lightbox-close');\n",
    "    closeBtnEl = document.getElementById('lightbox-close');\n    hintEl = document.getElementById('lightbox-hint');\n"
)

insert_anchor = "    document.addEventListener('keydown', event => {\n        if (!isLightboxOpen) return;\n        if (event.key === 'Escape') {\n            event.preventDefault();\n            closeLightbox(false);\n            return;\n        }\n        trapLightboxFocus(event);\n    });\n\n"
mouse_block = r'''    // Desktop lightbox interaction: wheel zoom, drag-to-pan and double-click.
    stageEl?.addEventListener('wheel', event => {
        if (!isLightboxOpen || event.ctrlKey) return;
        event.preventDefault();

        const factor = event.deltaY < 0 ? 1.12 : (1 / 1.12);
        scaleAt(currentScale * factor, event.clientX, event.clientY);
    }, { passive: false });

    imgEl.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'mouse' || event.button !== 0 || event.isPrimary === false) return;
        if (currentScale <= 1) return;

        mousePointerId = event.pointerId;
        mouseDragging = true;
        mouseStartX = event.clientX - posX;
        mouseStartY = event.clientY - posY;
        imgEl.setPointerCapture?.(mousePointerId);
        updatePointerUI();
        event.preventDefault();
    });

    imgEl.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse' || event.pointerId !== mousePointerId || !mouseDragging) return;
        posX = event.clientX - mouseStartX;
        posY = event.clientY - mouseStartY;
        updateTransform();
        event.preventDefault();
    });

    const finishMousePan = event => {
        if (event.pointerType !== 'mouse' || event.pointerId !== mousePointerId) return;
        const activePointerId = mousePointerId;
        mousePointerId = null;
        mouseDragging = false;
        if (imgEl.hasPointerCapture?.(activePointerId)) imgEl.releasePointerCapture(activePointerId);
        updatePointerUI();
    };

    imgEl.addEventListener('pointerup', finishMousePan);
    imgEl.addEventListener('pointercancel', finishMousePan);
    imgEl.addEventListener('dragstart', event => event.preventDefault());

    imgEl.addEventListener('dblclick', event => {
        if (!isLightboxOpen) return;
        event.preventDefault();
        event.stopPropagation();
        if (currentScale > 1.05) resetView();
        else scaleAt(2, event.clientX, event.clientY);
    });

'''
if mouse_block.strip() not in text:
    text = text.replace(insert_anchor, insert_anchor + mouse_block)

# Keep pointer cursor state synchronized when touch gestures alter scale.
text = text.replace(
    "            currentScale = newScale;\n            updateTransform();\n",
    "            currentScale = newScale;\n            updateTransform();\n            updatePointerUI();\n"
)
text = text.replace(
    "            currentScale = 1;\n            posX = 0;\n            posY = 0;\n            updateTransform();\n",
    "            resetView();\n"
)

path.write_text(text, 'utf-8')

# --- gestures.js -----------------------------------------------------------
path = ROOT / 'gestures.js'
text = path.read_text('utf-8')
anchor = "export function initGestures({\n    mainContainer,\n    ptrIndicator,\n    onSwipe,\n    onRefresh,\n    canSwipe = () => true,\n    canRefresh = () => true\n}) {\n"
block = r'''    const navMenu = document.getElementById('nav-menu');

    // A hidden horizontal scrollbar is awkward on desktop. Convert the normal
    // vertical mouse-wheel gesture into horizontal category-strip scrolling only
    // while the strip actually overflows.
    navMenu?.addEventListener('wheel', event => {
        if (navMenu.scrollWidth <= navMenu.clientWidth) return;
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || event.deltaY === 0) return;
        event.preventDefault();
        navMenu.scrollLeft += event.deltaY;
    }, { passive: false });

'''
if block.strip() not in text:
    text = text.replace(anchor, anchor + block)
path.write_text(text, 'utf-8')

# --- sw.js -----------------------------------------------------------------
path = ROOT / 'sw.js'
text = path.read_text('utf-8')
text = text.replace("const SHELL_CACHE = 'metro-news-shell-v23-pointer1';", "const SHELL_CACHE = 'metro-news-shell-v24-pointer2';")
path.write_text(text, 'utf-8')
