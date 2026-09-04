import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message) {
  console.error(`liquid motion contract failed: ${message}`);
  process.exit(1);
}

const legacyRuntimeTokens = [
  'liquid-page-enter',
  'liquid-heading-enter',
  'liquid-reveal',
  'is-liquid-pressed',
  'data-liquid-direction',
];

const rootJsFiles = fs.readdirSync(root)
  .filter(name => name.endsWith('.js'))
  .sort();

for (const file of rootJsFiles) {
  const source = read(file);
  for (const token of legacyRuntimeTokens) {
    if (source.includes(token)) {
      fail(`${file} reintroduced legacy runtime token ${token}`);
    }
  }
}

const compositor = read('compositor-stability.css');
for (const token of legacyRuntimeTokens) {
  if (compositor.includes(token)) {
    fail(`compositor-stability.css still carries dead selector ${token}`);
  }
}

const liquidBaseCss = read('liquid-glass.css');
for (const token of legacyRuntimeTokens) {
  if (liquidBaseCss.includes(token)) {
    fail(`liquid-glass.css still carries retired runtime selector ${token}`);
  }
}

for (const retiredMotion of [
  'liquid-page-forward',
  'liquid-page-backward',
  'liquid-heading-in',
  'liquid-card-settle',
  'translateY(8px) scale(0.997)',
]) {
  if (liquidBaseCss.includes(retiredMotion)) {
    fail(`liquid-glass.css still carries retired motion primitive ${retiredMotion}`);
  }
}

const liquidRuntime = read('liquid-glass.js');
for (const required of [
  "import './reader-image-stability.js';",
  "import './liquid-nav-indicator.js?v=53';",
  "import './liquid-category-indicator.js?v=54';",
  "import './liquid-reader-cue.js?v=58';",
  "import './liquid-reader-tap.js?v=59';",
  'liquid-press-active',
]) {
  if (!liquidRuntime.includes(required)) {
    fail(`accepted runtime signal missing: ${required}`);
  }
}

if (liquidRuntime.includes('MutationObserver')) {
  fail('MutationObserver must not return to the accepted Liquid Glass runtime');
}

const acceptedLayerManifest = read('liquid-accepted-layers.css');
const acceptedLayerImports = [
  "@import url('./liquid-category-indicator.css?v=54');",
  "@import url('./liquid-nav-indicator.css?v=53');",
  "@import url('./liquid-reader-cue.css?v=58');",
  "@import url('./liquid-reader-tap.css?v=59');",
  "@import url('./liquid-static-polish.css?v=60');",
  "@import url('./liquid-top-island-unified.css?v=62');",
  "@import url('./liquid-settings-hierarchy.css?v=63');",
  "@import url('./liquid-search-hierarchy.css?v=64');",
  "@import url('./liquid-bookmarks-hierarchy.css?v=65');",
  "@import url('./liquid-gallery-hierarchy.css?v=66');",
];

let previousLayerIndex = -1;
for (const required of acceptedLayerImports) {
  const layerIndex = acceptedLayerManifest.indexOf(required);
  if (layerIndex === -1) {
    fail(`accepted CSS layer missing from manifest: ${required}`);
  }
  if (layerIndex <= previousLayerIndex) {
    fail(`accepted CSS layer order changed around: ${required}`);
  }
  previousLayerIndex = layerIndex;
}

const pressCss = read('liquid-press-feedback.css');
if (pressCss.includes('@import')) {
  fail('liquid-press-feedback.css must stay import-free; use liquid-accepted-layers.css');
}

const navIndicatorCss = read('liquid-nav-indicator.css');
if (navIndicatorCss.includes('@import')) {
  fail('liquid-nav-indicator.css must stay import-free; category layer belongs in the manifest');
}

const indexHtml = read('index.html');
const manifestLink = './liquid-accepted-layers.css?v=70';
const pressLink = './liquid-press-feedback.css?v=49';
const manifestLinkIndex = indexHtml.indexOf(manifestLink);
const pressLinkIndex = indexHtml.indexOf(pressLink);
if (manifestLinkIndex === -1 || pressLinkIndex === -1 || manifestLinkIndex >= pressLinkIndex) {
  fail('index.html must load the accepted layer manifest before press feedback');
}

const serviceWorker = read('sw.js');
if (!serviceWorker.includes("const SHELL_CACHE = 'metro-news-shell-v")) {
  fail('service worker shell cache declaration is missing');
}
if (!serviceWorker.includes("'./liquid-accepted-layers.css?v=70'")) {
  fail('service worker does not precache the accepted layer manifest');
}

for (const required of [
  '.liquid-glass .liquid-nav-indicator',
  '#nav-menu::before',
  '#news-grid > .metro-tile .tile-preview',
  'transition: none !important;',
  'will-change: auto !important;',
]) {
  if (!compositor.includes(required)) {
    fail(`stable compositor floor signal missing: ${required}`);
  }
}

console.log(`Liquid motion contract OK (${rootJsFiles.length} root JS files checked).`);
