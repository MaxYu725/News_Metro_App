export const DETAILED_SUMMARY_MIN_CHARS = 1200;
export const DETAILED_SUMMARY_INPUT_CHARS = 12000;
const DETAILED_SUMMARY_CACHE_KEY = 'metro_ai_detailed_summaries_v1';
const DETAILED_SUMMARY_CACHE_LIMIT = 50;

export function normalizeArticleSummaryText(text) {
    return String(text || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, DETAILED_SUMMARY_INPUT_CHARS);
}

export function articleSummaryTextLength(text) {
    return Array.from(normalizeArticleSummaryText(text).replace(/\s+/g, '')).length;
}

export function needsDetailedSummaryConfirmation(text) {
    return articleSummaryTextLength(text) < DETAILED_SUMMARY_MIN_CHARS;
}

function blockAISelectionDuringActiveRequest(event) {
    const actionTarget = event.target?.closest?.('[data-reader-action]');
    const action = actionTarget?.dataset?.readerAction;
    if (action !== 'ai' && action !== 'ai-mode') return;
    if (!document.querySelector('.reader-ai.loading')) return;

    event.preventDefault();
    event.stopImmediatePropagation();
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', blockAISelectionDuringActiveRequest, true);
}

function readDetailedSummaryCache(storage = globalThis.localStorage) {
    if (!storage) return {};
    try {
        const parsed = JSON.parse(storage.getItem(DETAILED_SUMMARY_CACHE_KEY) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

export function getDetailedAISummary(link, storage = globalThis.localStorage) {
    if (!link) return '';
    const entry = readDetailedSummaryCache(storage)[link];
    return typeof entry === 'string' ? entry : String(entry?.summary || '');
}

export function saveDetailedAISummary(link, summary, storage = globalThis.localStorage) {
    if (!link || !summary || !storage) return;
    try {
        const cache = readDetailedSummaryCache(storage);
        delete cache[link];
        cache[link] = { summary: String(summary), savedAt: Date.now() };
        const keys = Object.keys(cache);
        while (keys.length > DETAILED_SUMMARY_CACHE_LIMIT) {
            const oldest = keys.shift();
            if (oldest) delete cache[oldest];
        }
        storage.setItem(DETAILED_SUMMARY_CACHE_KEY, JSON.stringify(cache));
    } catch {}
}
