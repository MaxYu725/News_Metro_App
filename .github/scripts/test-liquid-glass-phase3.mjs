import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

async function readText(path) {
    try {
        return await readFile(new URL(path, root), 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') return '';
        throw error;
    }
}

const phase3 = await readText('liquid-secondary-glass.css');
const eco = await readFile(new URL('performance-mode.css', root), 'utf8');
const gallery = await readFile(new URL('liquid-gallery-hierarchy.css', root), 'utf8');
const index = await readFile(new URL('index.html', root), 'utf8');
const sw = await readFile(new URL('sw.js', root), 'utf8');

// Phase 3: secondary tool surfaces become visually consistent with v80/v81.
assert.match(phase3, /v82 — Liquid Glass Phase 3/);
assert.match(phase3, /#search-view:not\(\.hidden\)/);
assert.match(phase3, /#gallery-view:not\(\.hidden\)/);
assert.match(phase3, /#settings-view:not\(\.hidden\) > div:not\(:first-child\)/);

assert.match(phase3, /#search-view \.search-form/);
assert.match(phase3, /#gallery-view \.search-form/);
assert.match(phase3, /:focus-within[\s\S]*metro-accent-rgb/);

assert.match(phase3, /#settings-view[\s\S]*#new-cat-input/);
assert.match(phase3, /#settings-view[\s\S]*\.settings-link-row/);
assert.match(phase3, /#settings-view[\s\S]*\.density-btn/);

assert.match(phase3, /#back-to-top/);
assert.match(phase3, /\.reader-feedback/);
assert.match(phase3, /\.reader-media-count/);
assert.match(phase3, /#lightbox-close/);
assert.match(phase3, /#lightbox-quality/);
assert.match(phase3, /#lightbox-hint/);

// Gallery result tiles stay cheap; Phase 3 is chrome-only.
assert.match(gallery, /#gallery-view:not\(\.hidden\) ~ #news-grid \.metro-tile[\s\S]*backdrop-filter: none !important/);
assert.doesNotMatch(phase3, /#gallery-view:not\(\.hidden\) ~ #news-grid \.metro-tile[\s\S]*backdrop-filter:\s*blur/);

// Eco mode remains the final fallback.
assert.match(eco, /html\.low-end-mode \.search-form,/);
assert.match(eco, /html\.low-end-mode body:not\(\.reader-open\) #settings-view:not\(\.hidden\) > div,/);
assert.match(eco, /html\.low-end-mode #lightbox-close,/);

// Phase 3 must load after accepted hierarchy layers and before Eco overrides.
const acceptedAt = index.indexOf('liquid-accepted-layers.css?v=70');
const phase3At = index.indexOf('liquid-secondary-glass.css?v=82');
const ecoAt = index.indexOf('performance-mode.css');
assert.ok(acceptedAt >= 0 && phase3At > acceptedAt && ecoAt > phase3At);

assert.match(sw, /metro-news-shell-v82-liquid-glass-phase3/);
assert.match(sw, /liquid-secondary-glass\.css\?v=82/);

console.log('Liquid Glass phase 3 contract: PASS');
