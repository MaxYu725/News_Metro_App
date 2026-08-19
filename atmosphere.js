const SECONDARY_PALETTES = new Map([
    ['34,211,238', '99,102,241'],   // cyan -> indigo
    ['96,165,250', '168,85,247'],   // blue -> violet
    ['192,132,252', '59,130,246'],  // purple -> blue
    ['52,211,153', '34,211,238'],   // emerald -> cyan
    ['251,146,60', '124,58,237']    // orange -> deep violet
]);

function normalizeRgb(value = '') {
    return String(value)
        .split(',')
        .map(part => Number.parseInt(part.trim(), 10))
        .filter(Number.isFinite)
        .slice(0, 3)
        .join(',');
}

function atmosphereMarkup() {
    return `
        <div class="metro-atmosphere" aria-hidden="true">
            <div class="metro-atmosphere-base"></div>
            <div class="metro-atmosphere-glow metro-atmosphere-glow-primary"></div>
            <div class="metro-atmosphere-glow metro-atmosphere-glow-secondary"></div>
            <div class="metro-atmosphere-search-haze"></div>

            <svg class="metro-atmosphere-map" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" focusable="false">
                <defs>
                    <pattern id="metro-atmosphere-dots" width="34" height="34" patternUnits="userSpaceOnUse">
                        <circle class="metro-atmosphere-dot" cx="3" cy="3" r="1.05" />
                    </pattern>
                    <clipPath id="metro-atmosphere-viewport">
                        <rect width="1600" height="1000" />
                    </clipPath>
                </defs>

                <rect width="1600" height="1000" fill="url(#metro-atmosphere-dots)" />

                <g clip-path="url(#metro-atmosphere-viewport)">
                    <path class="metro-atmosphere-route metro-atmosphere-route-primary"
                        d="M -140 760 C 120 620 335 815 610 590 S 1080 260 1740 350" />
                    <path class="metro-atmosphere-route metro-atmosphere-route-secondary"
                        d="M 215 -120 C 420 175 500 255 760 330 S 1240 615 1640 990" />

                    <circle class="metro-atmosphere-arc" cx="1375" cy="140" r="430" />
                    <circle class="metro-atmosphere-arc metro-atmosphere-detail-tablet" cx="95" cy="1010" r="365" />

                    <g class="metro-atmosphere-detail-tablet">
                        <path class="metro-atmosphere-route metro-atmosphere-route-secondary"
                            d="M -70 255 C 255 160 520 270 720 430 S 1090 760 1510 675" />
                        <circle class="metro-atmosphere-node" cx="418" cy="708" r="8" />
                        <circle class="metro-atmosphere-node-core" cx="418" cy="708" r="2.2" />
                        <circle class="metro-atmosphere-node metro-atmosphere-node-secondary" cx="915" cy="404" r="7" />
                        <circle class="metro-atmosphere-node" cx="1262" cy="315" r="6" />
                    </g>

                    <g class="metro-atmosphere-detail-desktop">
                        <path class="metro-atmosphere-route metro-atmosphere-route-primary"
                            d="M 1550 -70 C 1360 145 1325 300 1195 455 S 965 690 800 1050" />
                        <path class="metro-atmosphere-route metro-atmosphere-route-secondary"
                            d="M 50 895 C 330 785 520 790 735 840 S 1180 1005 1605 835" />
                        <circle class="metro-atmosphere-node metro-atmosphere-node-secondary" cx="1198" cy="452" r="8" />
                        <circle class="metro-atmosphere-node-core" cx="1198" cy="452" r="2.4" />
                        <circle class="metro-atmosphere-node" cx="736" cy="840" r="6.5" />
                        <circle class="metro-atmosphere-node metro-atmosphere-node-secondary" cx="1452" cy="870" r="5.5" />
                    </g>
                </g>
            </svg>

            <div class="metro-atmosphere-mask"></div>
        </div>
    `;
}

function syncPalette() {
    const root = document.documentElement;
    const computed = getComputedStyle(root);
    const accentRgb = normalizeRgb(
        root.style.getPropertyValue('--metro-accent-rgb')
        || computed.getPropertyValue('--metro-accent-rgb')
        || '34, 211, 238'
    ) || '34,211,238';
    const secondaryRgb = SECONDARY_PALETTES.get(accentRgb) || '99,102,241';

    if (normalizeRgb(root.style.getPropertyValue('--metro-atmosphere-primary-rgb')) !== accentRgb) {
        root.style.setProperty('--metro-atmosphere-primary-rgb', accentRgb.split(',').join(', '));
    }
    if (normalizeRgb(root.style.getPropertyValue('--metro-atmosphere-secondary-rgb')) !== secondaryRgb) {
        root.style.setProperty('--metro-atmosphere-secondary-rgb', secondaryRgb.split(',').join(', '));
    }
}

function activeSection() {
    const gallery = document.getElementById('gallery-view');
    const settings = document.getElementById('settings-view');
    const search = document.getElementById('search-view');

    if (gallery && !gallery.classList.contains('hidden')) return 'gallery';
    if (settings && !settings.classList.contains('hidden')) return 'settings';
    if (search && !search.classList.contains('hidden')) return 'search';

    const activeButton = document.querySelector('.bottom-nav-btn.active');
    return activeButton?.dataset.section === 'bookmarks' ? 'bookmarks' : 'news';
}

function syncSection(container) {
    const section = activeSection();
    if (container.dataset.section !== section) container.dataset.section = section;
}

function observeSection(container) {
    const observer = new MutationObserver(() => syncSection(container));
    const targets = [
        document.getElementById('search-view'),
        document.getElementById('gallery-view'),
        document.getElementById('settings-view'),
        ...document.querySelectorAll('.bottom-nav-btn')
    ].filter(Boolean);

    targets.forEach(target => {
        observer.observe(target, { attributes: true, attributeFilter: ['class'] });
    });
}

function observeAccent() {
    let queued = false;
    const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            syncPalette();
        });
    });

    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style']
    });
}

function installAtmosphere() {
    const container = document.getElementById('app-bg-container');
    if (!container) return;

    container.innerHTML = atmosphereMarkup();
    container.classList.add('atmosphere-ready');
    syncPalette();
    syncSection(container);
    observeSection(container);
    observeAccent();
}

function installAfterAppBoot() {
    queueMicrotask(installAtmosphere);
}

if (document.readyState === 'complete') {
    installAfterAppBoot();
} else {
    document.addEventListener('DOMContentLoaded', installAfterAppBoot, { once: true });
}
