import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const feedSource = await readFile(new URL('../../feed-ui.js', import.meta.url), 'utf8');

// MutationObserver already runs at the pre-paint microtask checkpoint. Do not
// defer feed-card / hero geometry to requestAnimationFrame, where it can miss
// the current frame and cause a second style/layout/paint pass.
const scheduleStart = feedSource.indexOf('function scheduleDecorate()');
const scheduleEnd = feedSource.indexOf('function installFeedKeyboardInteraction', scheduleStart);
assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart, 'scheduleDecorate() must exist');
const scheduleSource = feedSource.slice(scheduleStart, scheduleEnd);
assert.match(scheduleSource, /queueMicrotask\(decorateFeed\)/);
assert.doesNotMatch(scheduleSource, /requestAnimationFrame\(decorateFeed\)/);

// Hero state updates must be idempotent; avoid remove-then-add on every pass.
assert.doesNotMatch(feedSource, /tiles\.forEach\(tile => tile\.classList\.remove\('hero-tile'\)\)/);
assert.match(feedSource, /classList\.toggle\('hero-tile',\s*shouldBeHero\)/);

console.log('Feed first-paint contract: PASS');
