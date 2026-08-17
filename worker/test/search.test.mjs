import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeSearchCursor,
  encodeSearchCursor,
  escapeLike,
  isArchiveEligibleQuery,
  quoteFtsPhrase,
  searchArticles,
  searchArticlesAcrossDatabases,
} from '../src/search.js';

function fakeDb(handlers) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, params: [] };
      calls.push(call);
      return {
        bind(...params) {
          call.params = params;
          return {
            all: async () => handlers.shift()(call),
          };
        },
      };
    },
  };
}

test('FTS phrase quoting neutralizes FTS syntax characters', () => {
  assert.equal(quoteFtsPhrase('香港 "01" - test'), '"香港 ""01"" - test"');
});

test('LIKE fallback escapes wildcard characters', () => {
  assert.equal(escapeLike('100%_香港\\'), '100\\%\\_香港\\\\');
});

test('three-codepoint query uses FTS5 trigram and limit+1 pagination', async () => {
  const rows = Array.from({ length: 21 }, (_, id) => ({ id: String(id) }));
  const db = fakeDb([() => ({ results: rows })]);
  const result = await searchArticles(db, '香港01', 2, 20);
  assert.equal(result.backend, 'fts5-trigram');
  assert.equal(result.rows.length, 20);
  assert.equal(result.hasMore, true);
  assert.match(db.calls[0].sql, /articles_fts MATCH \?/);
  assert.deepEqual(db.calls[0].params, ['"香港01"', 21, 40]);
});

test('short query uses escaped LIKE fallback', async () => {
  const db = fakeDb([() => ({ results: [{ id: 'a' }] })]);
  const result = await searchArticles(db, 'AI', 0, 20);
  assert.equal(result.backend, 'like-short-query');
  assert.equal(result.hasMore, false);
  assert.match(db.calls[0].sql, /LIKE \? ESCAPE/);
  assert.deepEqual(db.calls[0].params, ['%AI%', '%AI%', 21, 0]);
});

test('missing FTS table falls back during migration window only', async () => {
  const db = fakeDb([
    () => { throw new Error('D1_ERROR: no such table: articles_fts'); },
    () => ({ results: [{ id: 'fallback' }] }),
  ]);
  const result = await searchArticles(db, '香港新聞', 0, 20);
  assert.equal(result.backend, 'like-migration-fallback');
  assert.equal(result.rows[0].id, 'fallback');
  assert.equal(db.calls.length, 2);
});

test('unrelated FTS errors fail closed instead of triggering a table scan', async () => {
  const db = fakeDb([() => { throw new Error('D1_ERROR: database overloaded'); }]);
  await assert.rejects(() => searchArticles(db, '香港新聞', 0, 20), /database overloaded/);
  assert.equal(db.calls.length, 1);
});

test('search cursor round-trips Unicode article ids', () => {
  const id = 'https://example.test/香港新聞/測試文章';
  const cursor = encodeSearchCursor({ pubDate: '2026-07-18T12:08:38.000Z', id });
  assert.ok(cursor.length > 0);
  assert.deepEqual(decodeSearchCursor(cursor), {
    pubDate: '2026-07-18T12:08:38.000Z',
    id,
  });
  assert.throws(() => decodeSearchCursor('%%%'), /invalid search cursor/);
});

test('multi-D1 cursor search merges, de-duplicates and sorts globally', async () => {
  const live = fakeDb([() => ({ results: [
    { id: 'new', pubDate: '2026-08-17T10:00:00.000Z', title: 'new' },
    { id: 'dup', pubDate: '2026-08-16T10:00:00.000Z', title: 'dup-live' },
    { id: 'older-live', pubDate: '2026-08-14T10:00:00.000Z', title: 'older-live' },
  ] })]);
  const archive = fakeDb([() => ({ results: [
    { id: 'dup', pubDate: '2026-08-16T10:00:00.000Z', title: 'dup-archive' },
    { id: 'old', pubDate: '2026-07-18T10:00:00.000Z', title: 'old' },
  ] })]);

  const result = await searchArticlesAcrossDatabases([live, archive], '香港新聞', null, 2);
  assert.deepEqual(result.rows.map(row => row.id), ['new', 'dup']);
  assert.equal(result.hasMore, true);
  assert.deepEqual(decodeSearchCursor(result.nextCursor), {
    pubDate: '2026-08-16T10:00:00.000Z',
    id: 'dup',
  });
  assert.match(live.calls[0].sql, /a\.pubDate < \?/);
  assert.match(archive.calls[0].sql, /ORDER BY a\.pubDate DESC, a\.id DESC/);
});

test('multi-D1 next page binds decoded cursor boundary', async () => {
  const cursor = decodeSearchCursor(encodeSearchCursor({
    pubDate: '2026-08-16T10:00:00.000Z',
    id: 'https://example.test/香港新聞',
  }));
  const live = fakeDb([() => ({ results: [] })]);
  const archive = fakeDb([() => ({ results: [] })]);
  await searchArticlesAcrossDatabases([live, archive], '香港新聞', cursor, 20);
  assert.deepEqual(live.calls[0].params.slice(1, 5), [
    cursor.pubDate,
    cursor.pubDate,
    cursor.pubDate,
    cursor.id,
  ]);
  assert.deepEqual(archive.calls[0].params.slice(1, 5), [
    cursor.pubDate,
    cursor.pubDate,
    cursor.pubDate,
    cursor.id,
  ]);
});

test('archive fan-out is reserved for trigram-eligible queries', () => {
  assert.equal(isArchiveEligibleQuery('香港01'), true);
  assert.equal(isArchiveEligibleQuery('AI'), false);
});
