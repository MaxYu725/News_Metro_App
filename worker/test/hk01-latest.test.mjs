import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';
import {
  HK01_LATEST_FEED_URL,
  HK01_LATEST_FALLBACK_FEED_URL,
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

test('HK01 latest fetch uses the dedicated first-party latest feed and validates final host', async () => {
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
    assert.equal(options.redirect, 'follow');
    assert.match(options.headers['User-Agent'], /Mozilla\/5\.0/);
    return {
      ok: true,
      status: 200,
      url: HK01_LATEST_FEED_URL,
      json: async () => payload,
    };
  });

  assert.equal(articles.length, 1);
  assert.equal(articles[0].category, 'tech');


  const requested = [];
  const fallbackArticles = await fetchHk01LatestFeed(async url => {
    requested.push(String(url));
    if (String(url) === HK01_LATEST_FEED_URL) {
      return {
        ok: false,
        status: 503,
        url: HK01_LATEST_FEED_URL,
        json: async () => ({}),
      };
    }
    return {
      ok: true,
      status: 200,
      url: HK01_LATEST_FALLBACK_FEED_URL,
      json: async () => payload,
    };
  });
  assert.deepEqual(requested, [HK01_LATEST_FEED_URL, HK01_LATEST_FALLBACK_FEED_URL]);
  assert.equal(fallbackArticles.length, 1);

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


test('three-minute scheduled latest sync preserves richer stored content and media', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  const prepared = [];
  let pending;

  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url) !== HK01_LATEST_FEED_URL) {
      throw new Error(`unexpected upstream: ${url}`);
    }
    return {
      ok: true,
      status: 200,
      url: HK01_LATEST_FEED_URL,
      json: async () => ({
        items: [{
          id: 61234570,
          data: {
            type: 'article',
            articleId: 61234570,
            title: '排程同步測試',
            description: '只是一段摘要',
            publishTime: 1790208180,
            canonicalUrl: 'https://www.hk01.com/港聞/61234570/排程同步測試',
            mainCategory: '港聞',
            mainImage: { cdnUrl: 'https://cdn.hk01.com/di/media/live.jpeg/example' },
          },
        }],
      }),
    };
  };

  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            const statement = { sql, args };
            prepared.push(statement);
            return statement;
          },
        };
      },
      async batch() {},
    },
  };

  const ctx = {
    waitUntil(promise) {
      pending = promise;
    },
  };

  try {
    worker.scheduled({ cron: '*/3 * * * *' }, env, ctx);
    assert.ok(pending);
    await pending;

    assert.deepEqual(requested, [HK01_LATEST_FEED_URL]);
    assert.equal(prepared.length, 1);
    assert.doesNotMatch(prepared[0].sql, /description\s*=\s*excluded\.description/);
    assert.doesNotMatch(prepared[0].sql, /images\s*=\s*excluded\.images/);
    assert.match(prepared[0].sql, /imageUrl = CASE/);
    assert.equal(prepared[0].args[8], '[]');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
