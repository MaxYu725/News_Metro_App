import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../../app.js', import.meta.url), 'utf8');
const feedSource = await readFile(new URL('../../feed-ui.js', import.meta.url), 'utf8');

// Feed cards must be rendered with their final material class on the first DOM
// insertion rather than waiting for MutationObserver -> requestAnimationFrame.
assert.match(
  appSource,
  /<article class="metro-tile feed-card \$\{isHeroTile \? 'hero-tile' : ''\} \$\{currentThemeBorder\}"/
);

// The Latest lead story must also have final hero geometry before first paint.
assert.match(
  appSource,
  /const isHeroTile = activeAppSection === 'news'[\s\S]*?categories\[currentIndex\]\?\.id === 'latest'[\s\S]*?index === 0;/
);

// The enhancer must be idempotent: do not remove the hero class and add it
// back on every decoration pass, which needlessly invalidates style/layout.
assert.doesNotMatch(feedSource, /tiles\.forEach\(tile => tile\.classList\.remove\('hero-tile'\)\)/);
assert.match(feedSource, /classList\.toggle\('hero-tile',\s*shouldBeHero\)/);

console.log('Feed first-paint contract: PASS');
