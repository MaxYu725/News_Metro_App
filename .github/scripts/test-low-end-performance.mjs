import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const indexSource = await readFile(new URL('index.html', root), 'utf8');
const deploySource = await readFile(new URL('.github/workflows/static.yml', root), 'utf8');
const swSource = await readFile(new URL('sw.js', root), 'utf8');
const appSource = await readFile(new URL('app.js', root), 'utf8');
const perfJs = await readFile(new URL('performance-mode.js', root), 'utf8');
const perfCss = await readFile(new URL('performance-mode.css', root), 'utf8');
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

assert.doesNotMatch(indexSource, /cdn\.tailwindcss\.com/);
assert.match(indexSource, /tailwind-generated\.css/);
assert.match(indexSource, /performance-mode\.js/);
assert.match(indexSource, /performance-mode\.css/);

assert.equal(pkg.devDependencies?.tailwindcss, '3.4.17');
assert.match(pkg.scripts?.['build:css'] || '', /tailwindcss/);
assert.match(deploySource, /npm install --no-audit --no-fund/);
assert.match(deploySource, /npm run build:css/);

assert.match(perfJs, /navigator\.hardwareConcurrency/);
assert.match(perfJs, /navigator\.deviceMemory/);
assert.match(perfJs, /low-end-mode/);
assert.match(perfJs, /metro_performance_mode/);
assert.match(perfJs, /PerformanceObserver/);

assert.match(perfCss, /low-end-mode/);
assert.match(perfCss, /backdrop-filter:\s*none\s*!important/);
assert.match(perfCss, /metro-atmosphere-glow/);
assert.match(perfCss, /metro-atmosphere-map/);
assert.match(perfCss, /display:\s*none\s*!important/);

assert.doesNotMatch(appSource, /generateGeometricBackground/);
assert.doesNotMatch(appSource, /initRandomBackground/);

assert.match(swSource, /tailwind-generated\.css/);
assert.match(swSource, /performance-mode\.css/);
assert.match(swSource, /performance-mode\.js/);
assert.doesNotMatch(swSource, /cdn\.tailwindcss\.com/);

console.log('Low-end browser performance contract: PASS');
