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

const motion = await readText('liquid-motion-glass.css');
const index = await readFile(new URL('index.html', root), 'utf8');
const sw = await readFile(new URL('sw.js', root), 'utf8');
const eco = await readFile(new URL('performance-mode.css', root), 'utf8');

assert.match(motion, /v83 — Liquid Glass Phase 4/);
assert.match(motion, /\.liquid-nav-indicator[\s\S]*cubic-bezier/);
assert.match(motion, /#nav-menu\[data-liquid-indicator="ready"\]::before[\s\S]*cubic-bezier/);

assert.match(motion, /\.bottom-nav-btn\.liquid-press-active/);
assert.match(motion, /#nav-menu \.nav-link\.liquid-press-active/);
assert.match(motion, /\.reader-toolbar-btn\.liquid-press-active/);
assert.match(motion, /\.search-submit\.liquid-press-active/);
assert.match(motion, /\.density-btn\.liquid-press-active/);
assert.match(motion, /#lightbox-quality\.liquid-press-active/);
assert.match(motion, /transform:\s*scale\(0\.9[4-8]\)\s*!important/);
assert.match(motion, /box-shadow:[\s\S]*inset 0 1px 0 rgba\(255, 255, 255/);

assert.match(motion, /@media \(hover: hover\) and \(pointer: fine\)/);
assert.match(motion, /@media \(prefers-reduced-motion: reduce\)/);

// Phase 4 remains local-control-only.
assert.doesNotMatch(motion, /#news-grid[^\n{]*feed-card|\.metro-tile\.feed-card/);
assert.doesNotMatch(motion, /reader-shell/);
assert.doesNotMatch(motion, /requestAnimationFrame/);

const pressAt = index.indexOf('liquid-press-feedback.css?v=49');
const motionAt = index.indexOf('liquid-motion-glass.css?v=83');
const ecoAt = index.indexOf('performance-mode.css');
assert.ok(pressAt >= 0 && motionAt > pressAt && ecoAt > motionAt);

assert.match(eco, /transition-duration:\s*0\.01ms\s*!important/);
assert.match(sw, /metro-news-shell-v83-liquid-glass-phase4/);
assert.match(sw, /liquid-motion-glass\.css\?v=83/);

console.log('Liquid Glass phase 4 contract: PASS');
