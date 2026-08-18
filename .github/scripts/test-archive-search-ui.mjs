import assert from 'node:assert/strict';
import fs from 'node:fs';

const store = new Map();
globalThis.localStorage = {
  getItem(key) { return store.get(key) ?? null; },
  setItem(key, value) { store.set(key, String(value)); },
};

const requested = [];
globalThis.fetch = async url => {
  requested.push(String(url));
  return new Response(JSON.stringify({
    success: true,
    data: [{ id: 'test', link: 'https://example.test/test', title: 'test' }],
    hasMore: true,
    nextCursor: 'cursor-next',
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const { fetchSearchData } = await import('../../api.js');

let result = await fetchSearchData('婦人油麻地');
let url = new URL(requested.at(-1));
assert.equal(url.searchParams.get('scope'), 'all');
assert.equal(url.searchParams.get('page'), null);
assert.equal(url.searchParams.get('cursor'), null);
assert.equal(url.searchParams.get('sources'), 'hk01,bastille');
assert.equal(result.mode, 'archive');
assert.equal(result.nextCursor, 'cursor-next');

result = await fetchSearchData('婦人油麻地', { cursor: 'cursor-prev' });
url = new URL(requested.at(-1));
assert.equal(url.searchParams.get('scope'), 'all');
assert.equal(url.searchParams.get('cursor'), 'cursor-prev');
assert.equal(url.searchParams.get('sources'), 'hk01,bastille');
assert.equal(result.mode, 'archive');

result = await fetchSearchData('AI', { page: 2 });
url = new URL(requested.at(-1));
assert.equal(url.searchParams.get('scope'), null);
assert.equal(url.searchParams.get('page'), '2');
assert.equal(url.searchParams.get('cursor'), null);
assert.equal(url.searchParams.get('sources'), 'hk01,bastille');
assert.equal(result.mode, 'live');

const appSource = fs.readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
assert.match(appSource, /Array\.from\(query\)\.length >= 3/);
assert.match(appSource, /cursor: '',\s*mode: 'live'/);
assert.match(appSource, /fetchSearchData\(query, \{/);
assert.match(appSource, /loadNewsUI\('search', forceSync, isAppendMode, currentCat\.query\)/);
assert.match(appSource, /3 個字以上可搜尋歷史新聞/);

console.log('Explicit search archive/cursor/source frontend contract: PASS');
