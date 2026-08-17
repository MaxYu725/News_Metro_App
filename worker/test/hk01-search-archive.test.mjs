import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HK01_SEARCH_EARLIEST_EPOCH,
  discoverHk01SearchConfig,
  fetchHk01SearchWindow,
  hk01ArticleNumericId,
  mapHk01SearchCategory,
  parseHk01SearchConfigFromBundle,
  parseHk01SearchHit,
} from '../src/sources/hk01-search.js';

test('HK01 universal search config is extracted without hard-coded credentials', () => {
  const config = parseHk01SearchConfigFromBundle(
    'REACT_APP_ALGOLIA_APP_ID:"APP12345",REACT_APP_ALGOLIA_API_KEY:"KEY_12345678",REACT_APP_HK01_ARTICLE_INDEX_NAME:"prod-writing"',
  );
  assert.deepEqual(config, {
    appId: 'APP12345',
    apiKey: 'KEY_12345678',
    index: 'prod-writing',
  });
});

test('HK01 universal search bootstrap stays on official publisher host', async () => {
  const responses = new Map([
    ['https://universal-search.hk01.com/', '<script src="/static/js/main.js"></script>'],
    ['https://universal-search.hk01.com/static/js/main.js', 'REACT_APP_ALGOLIA_APP_ID:"APP12345",REACT_APP_ALGOLIA_API_KEY:"KEY_12345678",REACT_APP_HK01_ARTICLE_INDEX_NAME:"prod-writing"'],
  ]);
  const config = await discoverHk01SearchConfig(async url => ({
    ok: true,
    status: 200,
    url,
    text: async () => responses.get(url) || '',
  }));
  assert.equal(config.index, 'prod-writing');
});

test('HK01 search hit maps to lean archive schema and stable article identity', () => {
  const article = parseHk01SearchHit({
    type: 'article',
    id: '29618',
    title: '歷史文章',
    url: 'https://www.hk01.com/01活動/29618/歷史文章',
    published_at_ts: 1467331200,
    main_category: '即時體育',
    lead: '搜尋摘要',
    main_image: 'https://cdn.hk01.com/di/media/test.jpg/example',
  }, 1467330000, 1467335000);

  assert.deepEqual(article, {
    id: 'https://www.hk01.com/01%E6%B4%BB%E5%8B%95/29618/%E6%AD%B7%E5%8F%B2%E6%96%87%E7%AB%A0',
    title: '歷史文章',
    link: 'https://www.hk01.com/01%E6%B4%BB%E5%8B%95/29618/%E6%AD%B7%E5%8F%B2%E6%96%87%E7%AB%A0',
    pubDate: '2016-07-01T00:00:00.000Z',
    description: '搜尋摘要',
    category: 'sports',
    source: '香港01',
    imageUrl: 'https://cdn.hk01.com/di/media/test.jpg/example',
  });
  assert.equal(hk01ArticleNumericId(article.link), '29618');
  assert.equal(hk01ArticleNumericId('https://evil.example/29618'), '');
});

test('HK01 category mapper keeps Metro category contract', () => {
  assert.equal(mapHk01SearchCategory('即時國際'), 'global');
  assert.equal(mapHk01SearchCategory('親子'), 'life');
  assert.equal(mapHk01SearchCategory('科技玩物'), 'tech');
  assert.equal(mapHk01SearchCategory('社論'), 'community');
  assert.equal(mapHk01SearchCategory('社會新聞'), 'local');
});

test('HK01 search time window retrieves and orders complete safe result set', async () => {
  const config = { appId: 'APP12345', apiKey: 'KEY_12345678', index: 'prod-writing' };
  let calls = 0;
  const result = await fetchHk01SearchWindow({
    startEpoch: 1467331200,
    endEpoch: 1467417600,
    config,
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.match(url, /^https:\/\/app12345-dsn\.algolia\.net\/1\/indexes\/prod-writing\/query$/);
      assert.equal(options.headers.Origin, 'https://universal-search.hk01.com');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          nbHits: 2,
          nbPages: 1,
          exhaustiveNbHits: true,
          hits: [
            {
              type: 'article',
              title: '較舊',
              url: 'https://www.hk01.com/社會新聞/100/較舊',
              published_at_ts: 1467331300,
              main_category: '社會新聞',
              lead: '',
              main_image: '',
            },
            {
              type: 'article',
              title: '較新',
              url: 'https://www.hk01.com/社會新聞/101/較新',
              published_at_ts: 1467417000,
              main_category: '社會新聞',
              lead: '',
              main_image: '',
            },
          ],
        }),
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.requests, 1);
  assert.deepEqual(result.articles.map(item => hk01ArticleNumericId(item.link)), ['101', '100']);
  assert.equal(HK01_SEARCH_EARLIEST_EPOCH, 1451606400);
});
