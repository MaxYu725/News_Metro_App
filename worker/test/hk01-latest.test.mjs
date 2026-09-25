import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HK01_LATEST_FEED_URL,
  fetchHk01LatestFeed,
  parseHk01LatestFeed,
} from '../src/sources/hk01-latest.js';

test('HK01 latest parser maps first-party feed items and uses stable article IDs', () => {
  const result = parseHk01LatestFeed({
    items: [
      {
        id: 61234567,
        data: {
          type: 'article',
          articleId: 61234567,
          title: '即時新聞測試',
          description: '最新摘要',
          publishTime: 1790208000,
          canonicalUrl: 'https://www.hk01.com/國際/61234567/即時新聞測試',
          mainCategory: '國際',
          mainImage: { cdnUrl: 'https://cdn.hk01.com/di/media/test.jpeg/example' },
        },
      },
      {
        id: 61234568,
        data: {
          type: 'article',
          articleId: 61234568,
          title: '贊助內容',
          description: '不應收錄',
          publishTime: 1790208060,
          canonicalUrl: 'https://www.hk01.com/生活/61234568/贊助內容',
          mainCategory: '生活',
          isSponsored: true,
        },
      },
    ],
  });

  assert.deepEqual(result, [{
    id: 'https://hk01.com/sns/article/61234567',
    title: '即時新聞測試',
    link: 'https://www.hk01.com/%E5%9C%8B%E9%9A%9B/61234567/%E5%8D%B3%E6%99%82%E6%96%B0%E8%81%9E%E6%B8%AC%E8%A9%A6',
    pubDate: '2026-09-24T00:00:00.000Z',
    description: '最新摘要',
    category: 'global',
    source: '香港01',
    imageUrl: 'https://cdn.hk01.com/di/media/test.jpeg/example',
  }]);
});

test('HK01 latest parser rejects non-publisher URLs', () => {
  const result = parseHk01LatestFeed({
    items: [{
      id: 1,
      data: {
        type: 'article',
        articleId: 1,
        title: '錯誤來源',
        publishTime: 1790208000,
        canonicalUrl: 'https://evil.example/article/1',
        mainCategory: '港聞',
      },
    }],
  });
  assert.deepEqual(result, []);
});

test('HK01 latest fetch uses the first-party category feed and validates final host', async () => {
  const payload = {
    items: [{
      id: 61234569,
      data: {
        type: 'article',
        articleId: 61234569,
        title: '第一方 API',
        description: '',
        publishTime: 1790208120,
        canonicalUrl: 'https://www.hk01.com/科技/61234569/第一方-api',
        mainCategory: '科技',
      },
    }],
  };

  const articles = await fetchHk01LatestFeed(async (url, options) => {
    assert.equal(url, HK01_LATEST_FEED_URL);
    assert.equal(options.redirect, 'error');
    assert.match(options.headers['User-Agent'], /Metro-News-Live/);
    return {
      ok: true,
      status: 200,
      url: HK01_LATEST_FEED_URL,
      json: async () => payload,
    };
  });

  assert.equal(articles.length, 1);
  assert.equal(articles[0].category, 'tech');

  await assert.rejects(
    () => fetchHk01LatestFeed(async () => ({
      ok: true,
      status: 200,
      url: 'https://evil.example/feed',
      json: async () => payload,
    })),
    /escaped publisher API host/,
  );
});
