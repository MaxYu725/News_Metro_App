(() => {
    const STORAGE_KEY = 'metro_performance_mode';
    const VALID_MODES = new Set(['auto', 'full', 'eco']);
    let runtimePressure = false;
    let longTaskObserver = null;

    function storedMode() {
        try {
            const value = localStorage.getItem(STORAGE_KEY) || 'auto';
            return VALID_MODES.has(value) ? value : 'auto';
        } catch {
            return 'auto';
        }
    }

    function hardwareNeedsEcoMode() {
        const cores = Number(navigator.hardwareConcurrency || 0);
        const memory = Number(navigator.deviceMemory || 0);
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
        const saveData = navigator.connection?.saveData === true;

        return reducedMotion
            || saveData
            || (cores > 0 && cores <= 4)
            || (memory > 0 && memory <= 4);
    }

    function effectiveEco(mode) {
        if (mode === 'eco') return true;
        if (mode === 'full') return false;
        return hardwareNeedsEcoMode() || runtimePressure;
    }

    function updateSettingButtons(mode) {
        document.querySelectorAll('[data-performance-mode]').forEach(button => {
            const active = button.dataset.performanceMode === mode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        const status = document.getElementById('performance-mode-status');
        if (status) {
            const effective = document.documentElement.classList.contains('low-end-mode');
            status.textContent = effective
                ? '目前：省資源（已關閉高成本模糊與背景特效）'
                : '目前：完整效果';
        }
    }

    function applyMode(mode = storedMode()) {
        const normalized = VALID_MODES.has(mode) ? mode : 'auto';
        const eco = effectiveEco(normalized);
        const root = document.documentElement;

        root.classList.toggle('low-end-mode', eco);
        root.dataset.performanceMode = normalized;
        root.dataset.performanceEffective = eco ? 'eco' : 'full';
        updateSettingButtons(normalized);
        return eco;
    }

    function setMode(mode) {
        const normalized = VALID_MODES.has(mode) ? mode : 'auto';
        try {
            localStorage.setItem(STORAGE_KEY, normalized);
        } catch {}
        runtimePressure = false;
        applyMode(normalized);
    }

    // Run before styles are parsed so obviously constrained devices never pay
    // for the first expensive glass/atmosphere paint.
    applyMode();

    function observeLongTasks() {
        if (storedMode() !== 'auto' || document.documentElement.classList.contains('low-end-mode')) return;
        if (!('PerformanceObserver' in window)) return;

        let count = 0;
        let totalDuration = 0;

        try {
            longTaskObserver = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    count += 1;
                    totalDuration += entry.duration || 0;
                }

                if (count >= 3 || totalDuration >= 240) {
                    runtimePressure = true;
                    applyMode('auto');
                    longTaskObserver?.disconnect();
                    longTaskObserver = null;
                }
            });
            longTaskObserver.observe({ type: 'longtask', buffered: true });
            window.setTimeout(() => {
                longTaskObserver?.disconnect();
                longTaskObserver = null;
            }, 7000);
        } catch {}
    }

    function sampleFramePressure() {
        if (storedMode() !== 'auto' || document.documentElement.classList.contains('low-end-mode')) return;
        if (!('requestAnimationFrame' in window)) return;

        let frames = 0;
        let slowFrames = 0;
        let last = 0;
        const started = performance.now();

        const sample = now => {
            if (document.hidden) return;
            if (last && now - last > 24) slowFrames += 1;
            last = now;
            frames += 1;

            if (frames < 72 && now - started < 1800) {
                requestAnimationFrame(sample);
                return;
            }

            if (frames >= 24 && slowFrames / frames >= 0.18) {
                runtimePressure = true;
                applyMode('auto');
            }
        };

        requestAnimationFrame(sample);
    }

    function installSetting() {
        const settings = document.getElementById('settings-view');
        if (!settings || document.getElementById('performance-mode-setting')) return;

        const section = document.createElement('div');
        section.id = 'performance-mode-setting';
        section.innerHTML = `
            <p class="text-xs text-gray-400 uppercase tracking-widest mb-3">效能模式</p>
            <div class="density-control" role="group" aria-label="效能模式">
                <button type="button" class="density-btn" data-performance-mode="auto" aria-pressed="false">
                    <span class="density-btn-title">自動</span>
                    <span class="density-btn-copy">低階裝置自動減少特效</span>
                </button>
                <button type="button" class="density-btn" data-performance-mode="full" aria-pressed="false">
                    <span class="density-btn-title">完整</span>
                    <span class="density-btn-copy">保留 Liquid Glass 全效果</span>
                </button>
                <button type="button" class="density-btn" data-performance-mode="eco" aria-pressed="false">
                    <span class="density-btn-title">省資源</span>
                    <span class="density-btn-copy">優先流暢度</span>
                </button>
            </div>
            <p id="performance-mode-status" class="text-xs text-white/35 mt-2"></p>
        `;

        const typographySection = settings.lastElementChild;
        if (typographySection) typographySection.before(section);
        else settings.appendChild(section);

        section.addEventListener('click', event => {
            const button = event.target.closest('[data-performance-mode]');
            if (!button) return;
            setMode(button.dataset.performanceMode);
        });

        updateSettingButtons(storedMode());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            installSetting();
            observeLongTasks();
            sampleFramePressure();
        }, { once: true });
    } else {
        installSetting();
        observeLongTasks();
        sampleFramePressure();
    }

    window.MetroPerformanceMode = {
        setMode,
        applyMode,
        getMode: storedMode
    };
})();
