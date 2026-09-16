import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const feedSource = await readFile(new URL('../../feed-ui.js', import.meta.url), 'utf8');

assert.match(feedSource, /function buildHk01FeedVariant\(/);
assert.match(feedSource, /url\.searchParams\.set\('v', `w\$\{width\}`\)/);
assert.match(feedSource, /function optimizeFeedImage\(/);
assert.match(feedSource, /image\.setAttribute\('srcset'/);
assert.match(feedSource, /image\.setAttribute\('sizes'/);
assert.match(feedSource, /image\.decoding = 'async'/);
assert.match(feedSource, /optimizeFeedImage\(tile, shouldBeHero\)/);

console.log('Feed image delivery contract: PASS');
