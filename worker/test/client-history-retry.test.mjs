import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchNewsData, fetchSearchData } from '../../api.js';

function response(data, ok = true) {
  return { ok, status: ok ? 200 : 503, json: async () => data };
}

test('tracked topic retries failed next page with the same historical cursor', async t => {
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  const urls = [];
  let calls = 0;
  globalThis.fetch = async url => {
    urls.push(String(url));
    calls += 1;
    if (calls === 1) return response({ success: true, data: [{ id: 'new' }], hasMore: true, nextCursor: 'c-first' });
    if (calls === 2) return response({ success: false, error: 'D1 quota reached' }, false);
    return response({ success: true, data: [{ id: 'older' }], hasMore: false, nextCursor: '' });
  };
  const query = 'test historical iphone duo ' + Date.now();
  const first = await fetchNewsData('search', 0, false, query);
  const failed = await fetchNewsData('search', 1, false, query);
  const retry = await fetchNewsData('search', 1, false, query);
  assert.equal(first.nextCursor, 'c-first');
  assert.equal(failed.success, false);
  assert.equal(retry.data[0].id, 'older');
  assert.ok(urls[0].includes('scope=all'));
  assert.ok(urls[1].includes('cursor=c-first'));
  assert.ok(urls[2].includes('cursor=c-first'));
});

test('cached first-page search retains explicit stale status after network errors', async t => {
  const oldFetch = globalThis.fetch;
  const oldLocalStorage = globalThis.localStorage;
  const cache = new Map();
  globalThis.localStorage = {
    getItem: key => cache.get(key) ?? null,
    setItem: (key, value) => cache.set(key, String(value)),
  };
  t.after(() => { globalThis.fetch = oldFetch; globalThis.localStorage = oldLocalStorage; });
  const query = 'historic cache test ' + Date.now();
  globalThis.fetch = async () => response({ success: true, data: [{ id: 'a', title: 'cached' }], hasMore: true, nextCursor: 'first' });
  const first = await fetchSearchData(query, { includeArchive: true });
  assert.equal(first.success, true);
  globalThis.fetch = async () => { throw Error('network down'); };
  const fallback = await fetchSearchData(query, { includeArchive: true });
  assert.equal(fallback.stale, true);
  assert.equal(fallback.hasMore, false);
  assert.deepEqual(fallback.data.map(row => row.id), ['a']);
});
