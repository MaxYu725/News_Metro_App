import { fetchSourceStats } from './api.js';
import { LocalDB } from './utils.js';

const SOURCE_OPTIONS = [
    { id: 'hk01', name: '香港01' },
    { id: 'bastille', name: '巴士的報' }
];
const REOPEN_KEY = 'metro_news_reopen_settings_after_source_change';

function formatCount(value) {
    const count = Number(value);
    return Number.isFinite(count) ? `${new Intl.NumberFormat('zh-HK').format(count)} 篇` : '—';
}

function initSourceSettings() {
    const list = document.getElementById('source-visibility-list');
    const apply = document.getElementById('btn-apply-sources');
    const status = document.getElementById('source-visibility-status');
    const settingsButton = document.querySelector('.bottom-nav-btn[data-section="settings"]');
    if (!list || !apply || !status) return;

    const saved = new Set(LocalDB.getVisibleSources());
    const pending = new Set(saved);
    const counts = new Map();
    let statsLoaded = false;
    let statsLoading = false;

    const setStatus = (message = '') => {
        status.textContent = message;
    };

    const syncApplyState = () => {
        const savedKey = [...saved].sort().join(',');
        const pendingKey = [...pending].sort().join(',');
        apply.disabled = savedKey === pendingKey;
        apply.classList.toggle('opacity-45', apply.disabled);
    };

    const render = () => {
        list.innerHTML = '';
        SOURCE_OPTIONS.forEach(source => {
            const label = document.createElement('label');
            label.className = 'flex items-center justify-between gap-4 bg-[#161a2e]/70 backdrop-blur-md px-4 py-3 border border-white/10 cursor-pointer';

            const main = document.createElement('span');
            main.className = 'min-w-0';
            main.innerHTML = `
                <span class="block text-base font-light text-gray-100">${source.name}</span>
                <span class="block text-xs text-white/35 mt-1" data-source-count="${source.id}">${formatCount(counts.get(source.id))}</span>
            `;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'settings-accent-control w-5 h-5 cursor-pointer shrink-0';
            checkbox.checked = pending.has(source.id);
            checkbox.setAttribute('aria-label', `顯示${source.name}`);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    pending.add(source.id);
                } else {
                    if (pending.size <= 1) {
                        checkbox.checked = true;
                        setStatus('至少需保留一個新聞來源。');
                        return;
                    }
                    pending.delete(source.id);
                }
                setStatus('按「套用」更新新聞來源。');
                syncApplyState();
            });

            label.append(main, checkbox);
            list.appendChild(label);
        });
        syncApplyState();
    };

    // The archive count query is deferred until Settings is opened to avoid a D1 read on every app launch.
    const loadStats = async () => {
        if (statsLoaded || statsLoading) return;
        statsLoading = true;
        setStatus('正在讀取新聞量…');
        const result = await fetchSourceStats();
        statsLoading = false;
        if (!result.success) {
            setStatus('新聞量暫時無法讀取；來源選擇仍可使用。');
            return;
        }
        result.data.forEach(item => counts.set(item.id, Number(item.count || 0)));
        statsLoaded = true;
        render();
        setStatus('');
    };

    apply.addEventListener('click', () => {
        if (pending.size === 0 || apply.disabled) return;
        LocalDB.saveVisibleSources([...pending]);
        try { sessionStorage.setItem(REOPEN_KEY, '1'); } catch (error) {}
        setStatus('正在套用新聞來源…');
        window.location.reload();
    });

    settingsButton?.addEventListener('click', () => {
        loadStats();
    });

    render();

    let shouldReopen = false;
    try {
        shouldReopen = sessionStorage.getItem(REOPEN_KEY) === '1';
        if (shouldReopen) sessionStorage.removeItem(REOPEN_KEY);
    } catch (error) {}
    if (shouldReopen) {
        window.setTimeout(() => {
            settingsButton?.click();
        }, 0);
    }
}

window.addEventListener('DOMContentLoaded', initSourceSettings);
