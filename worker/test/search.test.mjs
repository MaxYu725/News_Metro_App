import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeLike, quoteFtsPhrase, searchArticles } from '../src/search.js';

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
