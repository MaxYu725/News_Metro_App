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


// CDN feed variants must use the known HK01 width ladder. Invalid intermediate
// widths can be selected by srcset and fail the whole thumbnail request.
assert.doesNotMatch(feedSource, /\[160, 320, 480\]/);
assert.doesNotMatch(feedSource, /\[480, 960, 1440\]/);
assert.match(feedSource, /\[320, 640\]/);
assert.match(feedSource, /\[640, 1280, 1920\]/);
assert.match(feedSource, /addEventListener\('error'/);

assert.doesNotMatch(appSource, /\[160, 320, 480\]/);
assert.doesNotMatch(appSource, /\[480, 960, 1440\]/);
assert.match(appSource, /\[320, 640\]/);
assert.match(appSource, /\[640, 1280, 1920\]/);
