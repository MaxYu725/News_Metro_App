import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { feedThumbnailUrl } from '../../utils.js';

assert.equal(
  feedThumbnailUrl('https://cdn.hk01.com/di/media/images/123/org/a.jpg/hash?v=w1920'),
  'https://cdn.hk01.com/di/media/images/123/org/a.jpg/hash?v=w320'
);
assert.equal(
  feedThumbnailUrl('https://cdn.hk01.com/di/media/images/123/org/a.jpg/hash?foo=1&v=w640'),
  'https://cdn.hk01.com/di/media/images/123/org/a.jpg/hash?foo=1&v=w320'
);
assert.equal(
  feedThumbnailUrl('https://example.com/photo.jpg'),
  'https://example.com/photo.jpg'
);
assert.equal(feedThumbnailUrl(''), '');

const appSource = await readFile(new URL('../../app.js', import.meta.url), 'utf8');
assert.match(appSource, /feedThumbnailUrl\(news\.imageUrl\)/);
assert.match(appSource, /decoding="async"/);
assert.match(appSource, /fetchpriority="low"/);
assert.match(appSource, /data-feed-original=/);

console.log('Feed image delivery contract: PASS');
