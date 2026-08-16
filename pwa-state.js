const STATUS_HIDE_DELAY_MS = 2200;
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

let registration = null;
let waitingWorker = null;
let applyUpdateRequested = false;
let reloadInProgress = false;
let transientTimer = 0;
let transientMessage = '';
let lastUpdateCheckAt = 0;

const state = {
    online: navigator.onLine,
    updateReady: false
};

const CSS = `
.pwa-status-host {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 76px);
    z-index: 85;
    display: flex;
    justify-content: center;
    pointer-events: none;
}

.pwa-status-card {
    width: min(100%, 520px);
    min-height: 42px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 11px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(12, 16, 29, 0.96);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.26);
    color: rgba(255, 255, 255, 0.82);
    font-size: 0.72rem;
    letter-spacing: 0.03em;
    pointer-events: auto;
}

.pwa-status-card[hidden] {
    display: none !important;
}

.pwa-status-card.is-offline {
    border-color: rgba(251, 191, 36, 0.28);
}

.pwa-status-card.is-update {
    border-color: rgba(56, 189, 248, 0.34);
}

.pwa-status-action {
    flex: 0 0 auto;
    min-height: 34px;
    padding: 0 10px;
    border: 1px solid rgba(56, 189, 248, 0.38);
    background: rgba(14, 28, 44, 0.8);
    color: rgba(125, 211, 252, 0.98);
    font: inherit;
}

.pwa-status-action:focus-visible {
    outline: 2px solid rgba(56, 189, 248, 0.85);
    outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
    .pwa-status-card {
        scroll-behavior: auto;
    }
}
`;

function installStyles() {
    if (document.getElementById('pwa-state-styles')) return;
    const style = document.createElement('style');
    style.id = 'pwa-state-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
}

function ensureStatusUI() {
    let host = document.getElementById('pwa-status-host');
    if (host) return host;

    host = document.createElement('div');
    host.id = 'pwa-status-host';
    host.className = 'pwa-status-host';
    host.innerHTML = `
        <div class="pwa-status-card" data-pwa-status-card hidden role="status" aria-live="polite" aria-atomic="true">
            <span data-pwa-status-copy></span>
            <button type="button" class="pwa-status-action" data-pwa-update-action hidden>立即更新</button>
        </div>
    `;
    document.body.appendChild(host);

    host.querySelector('[data-pwa-update-action]')?.addEventListener('click', applyWaitingUpdate);
    return host;
}

function renderStatus() {
    const host = ensureStatusUI();
    const card = host.querySelector('[data-pwa-status-card]');
    const copy = host.querySelector('[data-pwa-status-copy]');
    const action = host.querySelector('[data-pwa-update-action]');
    if (!card || !copy || !action) return;

    card.classList.remove('is-offline', 'is-update');
    action.hidden = true;

    if (state.updateReady) {
        card.hidden = false;
        card.classList.add('is-update');
        copy.textContent = 'Metro News 已有更新';
        action.hidden = false;
        return;
    }

    if (!state.online) {
        card.hidden = false;
        card.classList.add('is-offline');
        copy.textContent = '離線中 · 新聞更新暫停';
        return;
    }

    if (transientMessage) {
        card.hidden = false;
        copy.textContent = transientMessage;
        return;
    }

    card.hidden = true;
    copy.textContent = '';
}

function showTransient(message) {
    transientMessage = message;
    if (transientTimer) window.clearTimeout(transientTimer);
    renderStatus();
    transientTimer = window.setTimeout(() => {
        transientMessage = '';
        transientTimer = 0;
        renderStatus();
    }, STATUS_HIDE_DELAY_MS);
}

function setUpdateReady(worker) {
    if (!worker) return;
    waitingWorker = worker;
    state.updateReady = true;
    renderStatus();
}

function applyWaitingUpdate() {
    const worker = registration?.waiting || waitingWorker;
    if (!worker) {
        registration?.update().catch(() => {});
        return;
    }

    applyUpdateRequested = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
}

function bindRegistration(nextRegistration) {
    registration = nextRegistration;

    if (registration.waiting && navigator.serviceWorker.controller) {
        setUpdateReady(registration.waiting);
    }

    registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener('statechange', () => {
            if (installing.state !== 'installed') return;
            if (!navigator.serviceWorker.controller) return;
            setUpdateReady(registration.waiting || installing);
        });
    });
}

async function checkForUpdate(force = false) {
    if (!registration) return;
    const now = Date.now();
    if (!force && now - lastUpdateCheckAt < UPDATE_CHECK_INTERVAL_MS) return;
    lastUpdateCheckAt = now;
    try {
        await registration.update();
    } catch (error) {}
}

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    try {
        const nextRegistration = await navigator.serviceWorker.register('./sw.js');
        bindRegistration(nextRegistration);
        await checkForUpdate(true);
    } catch (error) {
        showTransient('PWA 更新檢查暫時不可用');
    }
}

function installNetworkState() {
    window.addEventListener('offline', () => {
        state.online = false;
        transientMessage = '';
        if (transientTimer) {
            window.clearTimeout(transientTimer);
            transientTimer = 0;
        }
        renderStatus();
    });

    window.addEventListener('online', () => {
        const wasOffline = !state.online;
        state.online = true;
        renderStatus();
        if (wasOffline) showTransient('已重新連線');
        checkForUpdate(true);
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate(false);
    });
}

function installControllerChangeHandler() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!applyUpdateRequested || reloadInProgress) return;
        reloadInProgress = true;
        window.location.reload();
    });
}

function initPwaState() {
    installStyles();
    ensureStatusUI();
    installNetworkState();
    installControllerChangeHandler();
    renderStatus();
    registerServiceWorker();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPwaState, { once: true });
} else {
    initPwaState();
}
