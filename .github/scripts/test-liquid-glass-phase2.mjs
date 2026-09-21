import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const liquid = await readFile(new URL('liquid-glass.css', root), 'utf8');
const eco = await readFile(new URL('performance-mode.css', root), 'utf8');
const polish = await readFile(new URL('liquid-static-polish.css', root), 'utf8');
const index = await readFile(new URL('index.html', root), 'utf8');
const sw = await readFile(new URL('sw.js', root), 'utf8');

// Phase 2 upgrades feed surfaces without reintroducing live backdrop blur.
assert.match(liquid, /v81 — Liquid Glass Phase 2/);
assert.match(liquid, /#news-grid > \.metro-tile\.feed-card[\s\S]*--feed-glass-rim:/);
assert.match(liquid, /#news-grid > \.metro-tile\.feed-card[\s\S]*linear-gradient\(180deg/);
assert.match(liquid, /#news-grid > \.metro-tile\.feed-card::before[\s\S]*var\(--feed-glass-highlight/);
assert.match(liquid, /#news-grid > \.metro-tile\.hero-tile[\s\S]*radial-gradient/);
assert.match(liquid, /#news-grid > \.metro-tile\.hero-tile[\s\S]*--hero-glass-highlight:/);
assert.match(liquid, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*feed-card:hover/);
assert.match(liquid, /feed-card:active[\s\S]*box-shadow/);
assert.doesNotMatch(liquid, /feed-card::before[\s\S]{0,500}filter:\s*drop-shadow/);

// The later polish layer must preserve Hero-specific depth rather than
// flattening it back to the general feed-card treatment.
assert.match(polish, /\.metro-tile\.hero-tile[\s\S]*--hero-glass-highlight/);
assert.match(polish, /\.metro-tile\.hero-tile::before[\s\S]*--hero-glass-highlight/);

// The compositor stability rule remains non-negotiable for scrolling/Reader.
assert.match(liquid, /#news-grid > \.metro-tile\.feed-card[\s\S]*backdrop-filter: none !important/);
assert.match(liquid, /#news-grid > \.metro-tile\.feed-card[\s\S]*-webkit-backdrop-filter: none !important/);

// Eco mode still strips the richer surface treatment.
assert.match(eco, /html\.low-end-mode \.metro-tile\.feed-card/);
assert.match(eco, /html\.low-end-mode \.metro-tile\.hero-tile/);
assert.match(eco, /box-shadow: none !important/);

// Cache bust the visual release.
assert.match(index, /liquid-glass\.css\?v=81/);
assert.match(sw, /metro-news-shell-v8[1-9]-liquid-glass-phase[2-4]/);
assert.match(sw, /liquid-glass\.css\?v=81/);

console.log('Liquid Glass phase 2 contract: PASS');
