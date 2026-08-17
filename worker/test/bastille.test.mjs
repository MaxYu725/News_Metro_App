import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASTILLE_FEED_URL,
  BASTILLE_SOURCE_NAME,
  extractBastilleCategories,
  fetchBastilleArticles,
  isBastilleSource,
  parseBastilleRss,
  resolveBastilleCategory,
} from '../src/sources/bastille.js';

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <item>
      <title><![CDATA[巴士的專訪｜測試新聞]]></title>
      <link>https://www.bastillepost.com/hongkong/article/123-test</link>
      <pubDate>Mon, 17 Aug 2026 07:08:47 +0000</pubDate>
      <category><![CDATA[社會事]]></category>
      <category><![CDATA[熱門]]></category>
      <content:encoded><![CDATA[
        <p>第一段完整正文。</p>
        <p>第二段包含更多資料。</p>
        <img src="https://example-cdn.invalid/a.jpg" />
        <img data-lazy-src="https://example-cdn.invalid/b.jpg" src="data:image/gif;base64,xxx" />
      ]]></content:encoded>
    </item>
    <item>
      <title>科技測試</title>
      <link>https://www.bastillepost.com/hongkong/article/456-tech</link>
      <pubDate>invalid</pubDate>
      <category><![CDATA[BasTech]]></category>
      <description><![CDATA[<p>只有 description 亦可以解析。</p>]]></description>
    </item>
  </channel>
</rss>`;

test('Bastille category resolver maps publisher sections into Metro categories', () => {
  assert.equal(resolveBastilleCategory(['社會事']), 'local');
  assert.equal(resolveBastilleCategory(['法庭事']), 'local');
  assert.equal(resolveBastilleCategory(['娛圈事']), 'ent');
  assert.equal(resolveBastilleCategory(['體育']), 'sports');
  assert.equal(resolveBastilleCategory(['兩岸']), 'china');
  assert.equal(resolveBastilleCategory(['亞太']), 'global');
  assert.equal(resolveBastilleCategory(['BasTech']), 'tech');
  assert.equal(resolveBastilleCategory(['生活事']), 'life');
  assert.equal(resolveBastilleCategory(['BP大平台']), 'community');
  assert.equal(resolveBastilleCategory(['錢財事']), 'hot');
  assert.equal(resolveBastilleCategory(['unknown-section']), 'hot');
});

test('Bastille category resolver prefers a specific news section over generic hot tags', () => {
  assert.equal(resolveBastilleCategory(['熱門', '社會事']), 'local');
  assert.equal(resolveBastilleCategory(['熱門', 'BasTech']), 'tech');
});

test('Bastille RSS parser preserves full text, images and source identity', () => {
  const rows = parseBastilleRss(SAMPLE_FEED, {
    now: () => new Date('2026-08-17T08:00:00.000Z'),
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, BASTILLE_SOURCE_NAME);
  assert.equal(rows[0].category, 'local');
  assert.equal(rows[0].description, '第一段完整正文。\n\n第二段包含更多資料。');
  assert.deepEqual(rows[0].images, [
    'https://example-cdn.invalid/a.jpg',
    'https://example-cdn.invalid/b.jpg',
  ]);
  assert.equal(rows[0].imageUrl, 'https://example-cdn.invalid/a.jpg');
  assert.deepEqual(rows[0].sourceCategories, ['社會事', '熱門']);
  assert.equal(rows[1].category, 'tech');
  assert.equal(rows[1].pubDate, '2026-08-17T08:00:00.000Z');
});

test('extractBastilleCategories handles CDATA and plain category nodes', () => {
  const categories = extractBastilleCategories(`
    <category><![CDATA[兩岸]]></category>
    <category>熱門</category>
  `);
  assert.deepEqual(categories, ['兩岸', '熱門']);
});

test('Bastille fetch owner uses the verified feed and fails closed on upstream errors', async () => {
  let requestedUrl = '';
  const rows = await fetchBastilleArticles(async (url, init) => {
    requestedUrl = url;
    assert.equal(init.redirect, 'error');
    assert.match(init.headers.Accept, /rss\+xml/);
    return new Response(SAMPLE_FEED, { status: 200 });
  });
  assert.equal(requestedUrl, BASTILLE_FEED_URL);
  assert.equal(rows.length, 2);
  assert.equal(isBastilleSource(rows[0].source), true);
  assert.equal(isBastilleSource('香港01'), false);

  const failed = await fetchBastilleArticles(async () => new Response('blocked', { status: 403 }));
  assert.deepEqual(failed, []);
});
