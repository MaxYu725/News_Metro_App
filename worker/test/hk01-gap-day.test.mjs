import assert from 'node:assert/strict';
import test from 'node:test';
import { dayWindow, dayIdentityQuery, missingArticles, insertArticleSql } from '../scripts/hk01-gap-day.mjs';

const article = id => ({
  id: 'https://www.hk01.com/tech/' + id + '/test',
  link: 'https://www.hk01.com/tech/' + id + '/test',
  title: '新聞 ' + id, pubDate: '2026-10-01T14:00:00.000Z',
  description: '', category: 'tech', source: '香港01', imageUrl: '',
});

test('target is exactly one UTC day and date is validated', () => {
  const range = dayWindow('2026-10-01', '2026-11-10');
  assert.equal(range.start, '2026-10-01T00:00:00.000Z');
  assert.equal(range.end, '2026-10-02T00:00:00.000Z');
  const sql = dayIdentityQuery(range);
  assert.match(sql, /source='香港01'/);
  assert.match(sql, /pubDate >= '2026-10-01T00:00:00.000Z'/);
  assert.match(sql, /pubDate < '2026-10-02T00:00:00.000Z'/);
  assert.match(sql, /LIMIT 2001/);
  for (const date of ['2026-02-01', '2026-10-32', '2026-11-11', '2026-13-01', 'abc']) {
    assert.throws(() => dayWindow(date, '2026-11-10'));
  }
});

test('cross-shard existing article IDs are not planned again', () => {
  const [a, b, c] = [article(101), article(102), article(103)];
  const result = missingArticles([a, b, c, c], [
    [{ id: a.id, link: a.link }], [],
    [{ id: b.id, link: b.link }], [],
  ], 100);
  assert.equal(result.missing, 1);
  assert.deepEqual(result.selected.map(row => row.id), [c.id]);
});

test('HK01 numeric article IDs suppress alternate links and obey limit', () => {
  const original = article(303);
  const alias = { ...original, id: 'https://hk01.com/other/303/alias', link: 'https://hk01.com/other/303/alias' };
  assert.deepEqual(missingArticles([alias], [[{ id: original.id, link: original.link }]], 100).selected, []);
  const articles = Array.from({ length: 105 }, (_, index) => article(index + 1000));
  const result = missingArticles(articles, [[], [], [], []], 100);
  assert.equal(result.selected.length, 100);
  assert.equal(result.missing, 105);
  assert.throws(() => missingArticles(articles, [], 501));
});

test('writes are insert-only and SQL strings are escaped', () => {
  const sql = insertArticleSql({ ...article(104), title: "Joe's phone" });
  assert.match(sql, /^INSERT OR IGNORE INTO articles/);
  assert.match(sql, /Joe''s phone/);
  assert.doesNotMatch(sql, /DELETE|UPDATE|archive_backfill_state/);
});
