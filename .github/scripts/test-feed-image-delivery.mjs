import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const feedSource = await readFile(new URL('../../feed-ui.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../../app.js', import.meta.url), 'utf8');

assert.match(feedSource, /function buildHk01FeedVariant\(/);
assert.match(feedSource, /url\.searchParams\.set\('v', `w\$\{width\}`\)/);
assert.match(feedSource, /function optimizeFeedImage\(/);
assert.match(feedSource, /image\.setAttribute\('srcset'/);
assert.match(feedSource, /image\.setAttribute\('sizes'/);
assert.match(feedSource, /image\.decoding = 'async'/);
assert.match(feedSource, /optimizeFeedImage\(tile, shouldBeHero\)/);

// Feed HTML must start with the sized CDN URL itself. Replacing src only from
// MutationObserver can be too late because the browser may already schedule the
// original large resource while parsing innerHTML.
assert.match(appSource, /function buildInitialFeedImageMarkup\(/);
assert.match(appSource, /buildInitialFeedImageMarkup\(news\.imageUrl, isHeroImage\)/);
assert.doesNotMatch(appSource, /<img src="\$\{news\.imageUrl\}"/);
assert.match(appSource, /data-feed-original-src=/);

console.log('Feed image delivery contract: PASS');
