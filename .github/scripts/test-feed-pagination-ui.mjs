import fs from 'node:fs';
import assert from 'node:assert/strict';

const apiSource = fs.readFileSync(new URL('../../api.js', import.meta.url), 'utf8');
const swSource = fs.readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');

assert.match(apiSource, /const newsCursorStates = new Map\(\)/);
assert.match(apiSource, /function articleIdentity\(item\)/);
assert.match(apiSource, /state\.pages\.set\(page \+ 1, nextCursor\)/);
assert.match(apiSource, /if \(page > 0 && cursor\) params\.set\('cursor', cursor\)/);
assert.match(apiSource, /if \(key && state\.seen\.has\(key\)\) continue/);
assert.match(apiSource, /pagination: result\.pagination \|\| \(nextCursor \? 'cursor' : 'legacy'\)/);
assert.match(swSource, /const SHELL_CACHE = 'metro-news-shell-v\d+-[^']+'/);

console.log('Feed cursor pagination + dedupe frontend contract: PASS');
