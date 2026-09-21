import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const liquid = await readFile(new URL('liquid-glass.css', root), 'utf8');
const eco = await readFile(new URL('performance-mode.css', root), 'utf8');
const index = await readFile(new URL('index.html', root), 'utf8');
const sw = await readFile(new URL('sw.js', root), 'utf8');

// Phase 1: make the three small chrome surfaces visibly glassier without
// touching the feed-card material scheduled for Phase 2.
assert.match(liquid, /--liquid-glass-rim:/);
assert.match(liquid, /--liquid-glass-sheen:/);

assert.match(liquid, /#nav-menu::after/);
assert.match(liquid, /#nav-menu[\s\S]*inset 0 1px 0 rgba\(255, 255, 255, 0\.1[2-9]\)/);

assert.match(liquid, /\.bottom-nav::before/);
assert.match(liquid, /\.bottom-nav[\s\S]*saturate\(17[0-9]%\)/);
assert.match(liquid, /\.liquid-nav-indicator[\s\S]*rgba\(255, 255, 255, 0\.2[4-9]\)/);

assert.match(liquid, /\.reader-toolbar::before/);
assert.match(liquid, /\.reader-toolbar[\s\S]*saturate\(17[0-9]%\)/);
assert.match(liquid, /\.reader-close,[\s\S]*\.reader-toolbar-btn[\s\S]*background:/);

// Eco mode must still shut off the expensive live blur surfaces.
assert.match(eco, /html\.low-end-mode \.bottom-nav,/);
assert.match(eco, /html\.low-end-mode \.reader-toolbar,/);

// Bust both browser and service-worker CSS caches for the visual release.
assert.match(index, /liquid-glass\.css\?v=80/);
assert.match(sw, /metro-news-shell-v80-liquid-glass-phase1/);
assert.match(sw, /liquid-glass\.css\?v=80/);

// Feed cards remain outside Phase 1: do not re-enable backdrop blur here.
assert.match(liquid, /#news-grid > \.metro-tile\.feed-card[\s\S]*backdrop-filter: none !important/);

console.log('Liquid Glass phase 1 contract: PASS');
