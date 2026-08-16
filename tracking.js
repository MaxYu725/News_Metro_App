import { LocalDB } from './utils.js';

export const TRACKING_CHANGED_EVENT = 'metro-news:tracking-changed';

export function normalizeTrackedKeyword(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

export function getTrackedCategories() {
    const categories = LocalDB.getCustomCategories();
    return Array.isArray(categories) ? categories : [];
}

export function getTrackedKeywords() {
    const seen = new Set();
    const keywords = [];

    for (const category of getTrackedCategories()) {
        const keyword = normalizeTrackedKeyword(category?.query || category?.name);
        const key = keyword.toLocaleLowerCase();
        if (!keyword || seen.has(key)) continue;
        seen.add(key);
        keywords.push(keyword);
    }

    return keywords;
}

export function findTrackedCategory(keyword) {
    const clean = normalizeTrackedKeyword(keyword);
    if (!clean) return null;
    const key = clean.toLocaleLowerCase();

    return getTrackedCategories().find(category => {
        const candidate = normalizeTrackedKeyword(category?.query || category?.name);
        return candidate.toLocaleLowerCase() === key;
    }) || null;
}

export function isTrackedKeyword(keyword) {
    return !!findTrackedCategory(keyword);
}

function emitTrackingChanged(action, keyword) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(TRACKING_CHANGED_EVENT, {
        detail: {
            action,
            keyword,
            categories: getTrackedCategories(),
            keywords: getTrackedKeywords()
        }
    }));
}

export function trackKeyword(keyword) {
    const clean = normalizeTrackedKeyword(keyword);
    if (!clean) return { changed: false, category: null, reason: 'empty' };

    const existing = findTrackedCategory(clean);
    if (existing) return { changed: false, category: existing, reason: 'exists' };

    const category = {
        id: `custom_${Date.now()}`,
        name: clean,
        isCustom: true,
        query: clean
    };

    const next = [...getTrackedCategories(), category];
    LocalDB.saveCustomCategories(next);
    emitTrackingChanged('track', clean);
    return { changed: true, category, reason: 'tracked' };
}

export function untrackKeyword(keywordOrId) {
    const raw = normalizeTrackedKeyword(keywordOrId);
    if (!raw) return { changed: false, category: null, reason: 'empty' };

    const key = raw.toLocaleLowerCase();
    const categories = getTrackedCategories();
    const target = categories.find(category => {
        if (category?.id === raw) return true;
        const candidate = normalizeTrackedKeyword(category?.query || category?.name);
        return candidate.toLocaleLowerCase() === key;
    }) || null;

    if (!target) return { changed: false, category: null, reason: 'missing' };

    LocalDB.saveCustomCategories(categories.filter(category => category?.id !== target.id));
    emitTrackingChanged('untrack', normalizeTrackedKeyword(target.query || target.name));
    return { changed: true, category: target, reason: 'untracked' };
}

export function toggleTrackedKeyword(keyword) {
    const existing = findTrackedCategory(keyword);
    return existing ? untrackKeyword(existing.id) : trackKeyword(keyword);
}
