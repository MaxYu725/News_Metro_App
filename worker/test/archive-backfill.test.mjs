import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARCHIVE_BACKFILL_MAX_LIMIT,
  ARCHIVE_SHARD_POST_WRITE_MAX_BYTES,
  ARCHIVE_SHARD_STOP_BYTES,
  HK01_HISTORICAL_ZONES,
  articleInsertSql,
  backfillStateUpsertSql,
  bastilleHistoricalPageUrl,
  fetchBastilleHistoricalPage,
  hk01HistoricalPageUrl,
  parseHk01HistoricalPage,
} from '../src/archive-backfill.js';

test('archive backfill limits preserve shard headroom', () => {
  assert.equal(ARCHIVE_BACKFILL_MAX_LIMIT, 1000);
  assert.equal(ARCHIVE_SHARD_STOP_BYTES, 300_000_000);
  assert.equal(ARCHIVE_SHARD_POST_WRITE_MAX_BYTES, 325_000_000);
  assert.equal(HK01_HISTORICAL_ZONES.length, 9);
  assert.equal(HK01_HISTORICAL_ZONES.some(zone => zone.category === 'video'), false);
});

test('HK01 historical URL uses explicit nextOffset cursor', () => {
  assert.equal(hk01HistoricalPageUrl(1), 'https://web-data.api.hk01.com/v2/feed/zone/1');
  assert.equal(
    hk01HistoricalPageUrl(1, '1786953829'),
    'https://web-data.api.hk01.com/v2/feed/zone/1?offset=1786953829',
  );
});

test('HK01 historical parser maps feed metadata into lean archive schema', () => {
  const payload = {
    nextOffset: 1786950000,
    items: [
      {
        id: 60380783,
        type: 'article',
        data: {
          type: 'article',
          articleId: 60380783,
          canonicalUrl: 'https://www.hk01.com/01論壇/60380783/測試文章',
          title: '歷史新聞測試',
          description: '只保存搜尋所需摘要',
          publishTime: 1786957208,
          mainImage: { cdnUrl: 'https://cdn.hk01.com/di/media/test.jpeg/example' },
        },
      },
    ],
  };

  const result = parseHk01HistoricalPage(payload, 'local');
  assert.equal(result.nextCursor, '1786950000');
  assert.equal(result.articles.length, 1);
  assert.deepEqual(result.articles[0], {
    id: 'https://www.hk01.com/01%E8%AB%96%E5%A3%87/60380783/%E6%B8%AC%E8%A9%A6%E6%96%87%E7%AB%A0',
    title: '歷史新聞測試',
    link: 'https://www.hk01.com/01%E8%AB%96%E5%A3%87/60380783/%E6%B8%AC%E8%A9%A6%E6%96%87%E7%AB%A0',
    pubDate: '2026-08-17T09:00:08.000Z',
    description: '只保存搜尋所需摘要',
    category: 'local',
    source: '香港01',
    imageUrl: 'https://cdn.hk01.com/di/media/test.jpeg/example',
  });
});

test('HK01 historical parser rejects non-publisher article URLs', () => {
  const result = parseHk01HistoricalPage({
    items: [{ data: { type: 'article', canonicalUrl: 'https://evil.example/article/1', title: 'x', publishTime: 1786957208 } }],
  }, 'local');
  assert.deepEqual(result.articles, []);
});

test('Bastille historical pagination keeps the verified RSS query contract', () => {
  assert.equal(
    bastilleHistoricalPageUrl(52),
    'https://www.bastillepost.com/hongkong/feed?paged=52',
  );
  assert.throws(() => bastilleHistoricalPageUrl(0), /invalid Bastille page/);
});

test('Bastille historical fetch validates final publisher host and reuses RSS parser', async () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <title><![CDATA[舊新聞]]></title>
    <link>https://www.bastillepost.com/hongkong/article/123-test</link>
    <pubDate>Fri, 17 Jul 2026 01:00:00 +0000</pubDate>
    <category><![CDATA[港聞]]></category>
    <content:encoded><![CDATA[<p>歷史全文</p><img src="https://example.test/a.jpg">]]></content:encoded>
  </item></channel></rss>`;
  const result = await fetchBastilleHistoricalPage(2, async () => ({
    ok: true,
    status: 200,
    url: 'https://www.bastillepost.com/hongkong/feed?paged=2',
    text: async () => xml,
  }));
  assert.equal(result.nextCursor, '3');
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].source, '巴士的報');
  assert.equal(result.articles[0].category, 'local');
  assert.equal(result.articles[0].description, '歷史全文');

  await assert.rejects(
    () => fetchBastilleHistoricalPage(2, async () => ({
      ok: true,
      status: 200,
      url: 'https://evil.example/feed',
      text: async () => xml,
    })),
    /escaped publisher host/,
  );
});

test('archive SQL remains lean, idempotent and quote-safe', () => {
  const sql = articleInsertSql({
    id: "https://example.test/o'hare",
    title: "O'Hare 新聞",
    link: "https://example.test/o'hare",
    pubDate: '2026-07-01T00:00:00.000Z',
    description: "記者：O'Hare",
    category: 'global',
    source: 'test',
    imageUrl: '',
  });
  assert.match(sql, /^INSERT OR IGNORE INTO articles/);
  assert.match(sql, /O''Hare/);
  assert.doesNotMatch(sql, /images/);
});

test('resume state SQL advances only through explicit upsert', () => {
  const sql = backfillStateUpsertSql({
    sourceKey: 'hk01:zone:1',
    cursor: '1786953829',
    pagesFetched: 12,
    rowsInserted: 80,
    lastPubDate: '2026-07-01T00:00:00.000Z',
    exhausted: false,
  });
  assert.match(sql, /archive_backfill_state/);
  assert.match(sql, /ON CONFLICT\(source_key\) DO UPDATE/);
  assert.match(sql, /1786953829/);
});
