import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const perfUrl = new URL('../../liquid-performance.css', import.meta.url);
const accepted = readFileSync(new URL('../../liquid-accepted-layers.css', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const perfCss = existsSync(perfUrl) ? readFileSync(perfUrl, 'utf8') : '';

assert.match(accepted, /@import url\('\.\/liquid-performance\.css\?v=74'\);/);
assert.match(perfCss, /\.liquid-glass \.bottom-nav[\s\S]*?backdrop-filter:\s*none\s*!important/);
assert.match(perfCss, /\.liquid-glass #back-to-top[\s\S]*?backdrop-filter:\s*none\s*!important/);
assert.match(perfCss, /background:[\s\S]*?rgba\(13, 18, 31, 0\.9/);
assert.match(sw, /metro-news-shell-v74-fixed-glass-paint/);
assert.match(sw, /'\.\/liquid-performance\.css\?v=74'/);

console.log('Fixed glass paint contract: PASS');
