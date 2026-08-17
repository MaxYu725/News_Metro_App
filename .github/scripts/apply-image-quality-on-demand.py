#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# --- index.html -------------------------------------------------------------
path = ROOT / 'index.html'
text = path.read_text('utf-8')
old = '''        <button id="lightbox-close" type="button" class="absolute text-white text-4xl font-light hover:text-gray-400 z-10" aria-label="關閉圖片">&times;</button>\n        <div id="lightbox-stage" class="relative w-full h-full flex justify-center items-center overflow-hidden">'''
new = '''        <button id="lightbox-close" type="button" class="absolute text-white text-4xl font-light hover:text-gray-400 z-10" aria-label="關閉圖片">&times;</button>\n        <button id="lightbox-quality" type="button" class="lightbox-quality hidden" aria-label="載入高清圖片" aria-pressed="false">高清</button>\n        <div id="lightbox-stage" class="relative w-full h-full flex justify-center items-center overflow-hidden">'''
if old not in text:
    raise SystemExit('index lightbox anchor not found')
text = text.replace(old, new, 1)
path.write_text(text, 'utf-8')

# --- style.css --------------------------------------------------------------
path = ROOT / 'style.css'
text = path.read_text('utf-8')
anchor = '''#lightbox-close:focus-visible,\n.subview-back:focus-visible,'''
replacement = '''#lightbox-close:focus-visible,\n#lightbox-quality:focus-visible,\n.subview-back:focus-visible,'''
if anchor not in text:
    raise SystemExit('focus anchor not found')
text = text.replace(anchor, replacement, 1)

style_anchor = '''#lightbox-close {\n    top: calc(env(safe-area-inset-top, 0px) + 8px);\n    right: calc(env(safe-area-inset-right, 0px) + 8px);\n    min-width: 44px;\n    min-height: 44px;\n    padding: 0;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    border-radius: 2px;\n    background: rgba(8, 11, 18, 0.46);\n}\n'''
quality_style = style_anchor + '''\n#lightbox-quality {\n    position: absolute;\n    top: calc(env(safe-area-inset-top, 0px) + 10px);\n    left: calc(env(safe-area-inset-left, 0px) + 10px);\n    z-index: 11;\n    min-width: 58px;\n    min-height: 40px;\n    padding: 0 13px;\n    border: 1px solid rgba(255, 255, 255, 0.28);\n    border-radius: 2px;\n    background: rgba(8, 11, 18, 0.68);\n    color: rgba(255, 255, 255, 0.94);\n    font-size: 0.72rem;\n    font-weight: 700;\n    letter-spacing: 0.08em;\n    backdrop-filter: blur(10px);\n    -webkit-backdrop-filter: blur(10px);\n    transition: background-color 0.15s ease, opacity 0.15s ease;\n}\n\n#lightbox-quality:hover {\n    background: rgba(255, 255, 255, 0.14);\n}\n\n#lightbox-quality:active {\n    background: rgba(255, 255, 255, 0.20);\n}\n\n#lightbox-quality[aria-pressed="true"] {\n    background: rgba(255, 255, 255, 0.92);\n    color: #080b12;\n    border-color: rgba(255, 255, 255, 0.92);\n}\n\n#lightbox-quality:disabled {\n    opacity: 0.52;\n    cursor: wait;\n}\n\n#lightbox-quality.hidden {\n    display: none;\n}\n'''
if style_anchor not in text:
    raise SystemExit('lightbox close style anchor not found')
text = text.replace(style_anchor, quality_style, 1)
path.write_text(text, 'utf-8')

# --- lightbox.js ------------------------------------------------------------
path = ROOT / 'lightbox.js'
text = path.read_text('utf-8')

old = '''let closeBtnEl = null;\nlet hintEl = null;\nlet mousePointerId = null;'''
new = '''let closeBtnEl = null;\nlet qualityBtnEl = null;\nlet hintEl = null;\nlet normalImageSrc = '';\nlet highQualitySrc = '';\nlet highQualityActive = false;\nlet qualitySwitchPending = false;\nlet qualityRequestToken = 0;\nlet mousePointerId = null;'''
if old not in text:
    raise SystemExit('lightbox state anchor not found')
text = text.replace(old, new, 1)

anchor = '''function updateHint() {\n    if (!hintEl) return;\n    hintEl.textContent = window.matchMedia?.('(pointer: fine)').matches\n        ? '滾輪縮放 · 拖曳移動 · 雙擊還原'\n        : '雙指縮放 · 雙擊還原';\n}\n'''
helpers = anchor + r'''

function buildHk01HighQualityUrl(src) {
    try {
        const url = new URL(src, location.href);
        if (url.protocol !== 'https:' || url.hostname !== 'cdn.hk01.com') return '';
        if (!url.pathname.includes('/di/media/images/')) return '';
        url.searchParams.set('v', 'w1920');
        return url.toString();
    } catch {
        return '';
    }
}

function hideQualityControl() {
    if (!qualityBtnEl) return;
    qualityBtnEl.classList.add('hidden');
    qualityBtnEl.disabled = false;
    qualityBtnEl.textContent = '高清';
    qualityBtnEl.setAttribute('aria-pressed', 'false');
    qualityBtnEl.setAttribute('aria-label', '載入高清圖片');
}

function syncQualityControl() {
    if (!qualityBtnEl || !imgEl || !isLightboxOpen) return;

    if (qualitySwitchPending) {
        qualityBtnEl.classList.remove('hidden');
        qualityBtnEl.disabled = true;
        qualityBtnEl.textContent = '載入中…';
        return;
    }

    if (highQualityActive) {
        qualityBtnEl.classList.remove('hidden');
        qualityBtnEl.disabled = false;
        qualityBtnEl.textContent = '一般';
        qualityBtnEl.setAttribute('aria-pressed', 'true');
        qualityBtnEl.setAttribute('aria-label', '切回一般圖片');
        return;
    }

    highQualitySrc = buildHk01HighQualityUrl(normalImageSrc);
    const canUpgrade = !!highQualitySrc
        && highQualitySrc !== normalImageSrc
        && imgEl.naturalWidth > 0
        && imgEl.naturalWidth < 1920;

    if (!canUpgrade) {
        hideQualityControl();
        return;
    }

    qualityBtnEl.classList.remove('hidden');
    qualityBtnEl.disabled = false;
    qualityBtnEl.textContent = '高清';
    qualityBtnEl.setAttribute('aria-pressed', 'false');
    qualityBtnEl.setAttribute('aria-label', '載入高清圖片');
}

function resetQualityState() {
    qualityRequestToken += 1;
    normalImageSrc = '';
    highQualitySrc = '';
    highQualityActive = false;
    qualitySwitchPending = false;
    hideQualityControl();
}

function loadImageOnDemand(src, token) {
    return new Promise((resolve, reject) => {
        const candidate = new Image();
        candidate.referrerPolicy = 'no-referrer';
        candidate.onload = () => {
            if (token !== qualityRequestToken || !isLightboxOpen) return reject(new Error('cancelled'));
            resolve(src);
        };
        candidate.onerror = () => reject(new Error('image-load-failed'));
        candidate.src = src;
    });
}

async function toggleImageQuality() {
    if (!imgEl || !qualityBtnEl || !isLightboxOpen || qualitySwitchPending) return;

    const targetHighQuality = !highQualityActive;
    const targetSrc = targetHighQuality ? highQualitySrc : normalImageSrc;
    if (!targetSrc) return;

    const token = ++qualityRequestToken;
    qualitySwitchPending = true;
    syncQualityControl();

    try {
        await loadImageOnDemand(targetSrc, token);
        if (token !== qualityRequestToken || !isLightboxOpen) return;

        highQualityActive = targetHighQuality;
        qualitySwitchPending = false;
        imgEl.src = targetSrc;
        resetView();
        syncQualityControl();
    } catch (error) {
        if (token !== qualityRequestToken || !isLightboxOpen || error?.message === 'cancelled') return;
        qualitySwitchPending = false;
        syncQualityControl();
        const fallbackLabel = qualityBtnEl.textContent;
        qualityBtnEl.textContent = '載入失敗';
        window.setTimeout(() => {
            if (!isLightboxOpen || qualitySwitchPending) return;
            qualityBtnEl.textContent = fallbackLabel;
        }, 1400);
    }
}
'''
if anchor not in text:
    raise SystemExit('updateHint anchor not found')
text = text.replace(anchor, helpers, 1)

old_open = '''    restoreFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;\n    imgEl.src = src;\n    resetView();\n    updateHint();'''
new_open = '''    restoreFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;\n    resetQualityState();\n    normalImageSrc = src;\n    imgEl.src = src;\n    resetView();\n    updateHint();'''
if old_open not in text:
    raise SystemExit('openLightbox anchor not found')
text = text.replace(old_open, new_open, 1)

old_close = '''    overlayEl.classList.add('opacity-0');\n    overlayEl.setAttribute('aria-hidden', 'true');\n    isLightboxOpen = false;\n    setUnderlyingInert(false);'''
new_close = '''    overlayEl.classList.add('opacity-0');\n    overlayEl.setAttribute('aria-hidden', 'true');\n    isLightboxOpen = false;\n    resetQualityState();\n    setUnderlyingInert(false);'''
if old_close not in text:
    raise SystemExit('closeLightbox anchor not found')
text = text.replace(old_close, new_close, 1)

old_trap = '''function trapLightboxFocus(event) {\n    if (!isLightboxOpen || event.key !== 'Tab') return;\n    event.preventDefault();\n    closeBtnEl?.focus({ preventScroll: true });\n}\n'''
new_trap = '''function trapLightboxFocus(event) {\n    if (!isLightboxOpen || event.key !== 'Tab') return;\n\n    const focusable = [qualityBtnEl, closeBtnEl].filter(element =>\n        element && !element.classList.contains('hidden') && !element.disabled\n    );\n    if (focusable.length === 0) return;\n\n    const currentIndex = focusable.indexOf(document.activeElement);\n    const nextIndex = event.shiftKey\n        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)\n        : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);\n\n    event.preventDefault();\n    focusable[nextIndex]?.focus({ preventScroll: true });\n}\n'''
if old_trap not in text:
    raise SystemExit('focus trap anchor not found')
text = text.replace(old_trap, new_trap, 1)

old_refs = '''    imgEl = document.getElementById('lightbox-img');\n    closeBtnEl = document.getElementById('lightbox-close');\n    hintEl = document.getElementById('lightbox-hint');'''
new_refs = '''    imgEl = document.getElementById('lightbox-img');\n    closeBtnEl = document.getElementById('lightbox-close');\n    qualityBtnEl = document.getElementById('lightbox-quality');\n    hintEl = document.getElementById('lightbox-hint');'''
if old_refs not in text:
    raise SystemExit('lightbox refs anchor not found')
text = text.replace(old_refs, new_refs, 1)

old_click = '''    closeBtnEl?.addEventListener('click', () => closeLightbox(false));\n    overlayEl.addEventListener('click', event => {'''
new_click = '''    closeBtnEl?.addEventListener('click', () => closeLightbox(false));\n    qualityBtnEl?.addEventListener('click', event => {\n        event.preventDefault();\n        event.stopPropagation();\n        toggleImageQuality();\n    });\n    imgEl.addEventListener('load', () => {\n        if (!isLightboxOpen || qualitySwitchPending) return;\n        syncQualityControl();\n    });\n    overlayEl.addEventListener('click', event => {'''
if old_click not in text:
    raise SystemExit('lightbox event anchor not found')
text = text.replace(old_click, new_click, 1)

path.write_text(text, 'utf-8')

# --- sw.js -----------------------------------------------------------------
path = ROOT / 'sw.js'
text = path.read_text('utf-8')
old = "const SHELL_CACHE = 'metro-news-shell-v24-pointer2';"
new = "const SHELL_CACHE = 'metro-news-shell-v25-image-quality';"
if old not in text:
    raise SystemExit('service worker cache anchor not found')
path.write_text(text.replace(old, new, 1), 'utf-8')
