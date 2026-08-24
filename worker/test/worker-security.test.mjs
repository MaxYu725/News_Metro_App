import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { APP_ORIGIN } from '../src/security.js';

function limiter(success = true) {
  return { limit: async () => ({ success }) };
}

function baseEnv(overrides = {}) {
  return {
    FETCH_RATE_LIMITER: limiter(true),
    AI_RATE_LIMITER: limiter(true),
    SYNC_RATE_LIMITER: limiter(true),
    AI: { run: async () => ({ response: '摘要' }) },
    API_KEY: 'test-key',
    DB: {
      prepare() {
        throw new Error('DB should not be touched by this test');
      },
    },
    ...overrides,
  };
}

function ctx() {
  return { waitUntil() {} };
}

test('preflight rejects unrelated origins and allows the production app origin', async () => {
  const hostile = await worker.fetch(
    new Request('https://worker.example/api/summarize', {
      method: 'OPTIONS',
      headers: { Origin: 'https://audit.invalid' },
    }),
    baseEnv(),
    ctx(),
  );
  assert.equal(hostile.status, 403);
  assert.equal(hostile.headers.get('Access-Control-Allow-Origin'), null);

  const trusted = await worker.fetch(
    new Request('https://worker.example/api/summarize', {
      method: 'OPTIONS',
      headers: { Origin: APP_ORIGIN },
    }),
    baseEnv(),
    ctx(),
  );
  assert.equal(trusted.status, 204);
  assert.equal(trusted.headers.get('Access-Control-Allow-Origin'), APP_ORIGIN);
});

test('article-full rejects missing browser origin before outbound fetch', async () => {
  const originalFetch = globalThis.fetch;
  let outboundCalled = false;
  globalThis.fetch = async () => {
    outboundCalled = true;
    throw new Error('unexpected outbound fetch');
  };

  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/article-full?url=https%3A%2F%2Fwww.hk01.com%2F123'),
      baseEnv(),
      ctx(),
    );
    assert.equal(response.status, 403);
    assert.equal(outboundCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('article-full blocks hostname substring bypass without outbound fetch', async () => {
  const originalFetch = globalThis.fetch;
  let outboundCalled = false;
  globalThis.fetch = async () => {
    outboundCalled = true;
    throw new Error('unexpected outbound fetch');
  };

  try {
    const target = encodeURIComponent('https://example.com/?ref=https://www.hk01.com/123');
    const response = await worker.fetch(
      new Request(`https://worker.example/api/article-full?url=${target}`, {
        headers: { Origin: APP_ORIGIN, 'CF-Connecting-IP': '203.0.113.2' },
      }),
      baseEnv(),
      ctx(),
    );
    assert.equal(response.status, 400);
    assert.equal(outboundCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('article-full reads the current HK01 payload shape and returns captions separately', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), 'https://web-data.api.hk01.com/v2/page/article/123');
    return Response.json({
      article: {
        originalImage: { cdnUrl: 'https://cdn.example/hero.jpg', caption: '' },
        blocks: [
          { blockType: 'text', htmlTokens: [[{ type: 'text', content: '完整正文。' }]] },
          {
            blockType: 'image',
            image: { cdnUrl: 'https://cdn.example/chart.jpg', caption: '圖片說明。' },
          },
        ],
      },
    });
  };

  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/article-full?url=https%3A%2F%2Fwww.hk01.com%2F123', {
        headers: { Origin: APP_ORIGIN, 'CF-Connecting-IP': '203.0.113.20' },
      }),
      baseEnv(),
      ctx(),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      content: '完整正文。',
      media: [
        { url: 'https://cdn.example/hero.jpg', caption: '' },
        { url: 'https://cdn.example/chart.jpg', caption: '圖片說明。' },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('article-full falls back to the cleaned live D1 row when publisher fetch is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  let outboundCalls = 0;
  globalThis.fetch = async () => {
    outboundCalls += 1;
    return new Response('unavailable', { status: 503 });
  };

  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/article-full?url=https%3A%2F%2Fhk01.com%2Fsns%2Farticle%2F60383003', {
        headers: { Origin: APP_ORIGIN, 'CF-Connecting-IP': '203.0.113.21' },
      }),
      baseEnv({
        DB: {
          prepare(sql) {
            assert.match(sql, /SELECT description, images FROM articles/);
            return {
              bind(...params) {
                assert.deepEqual(params, [
                  'https://hk01.com/sns/article/60383003',
                  'https://hk01.com/sns/article/60383003',
                  'https://hk01.com/sns/article/60383003',
                  'https://hk01.com/sns/article/60383003',
                ]);
                return {
                  all: async () => ({
                    results: [{
                      description: '已清理的完整正文。',
                      images: JSON.stringify({
                        version: 2,
                        items: [{ url: 'https://cdn.example/chart.jpg', caption: '圖片說明。' }],
                      }),
                    }],
                  }),
                };
              },
            };
          },
        },
      }),
      ctx(),
    );

    assert.equal(outboundCalls, 1);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      content: '已清理的完整正文。',
      media: [{ url: 'https://cdn.example/chart.jpg', caption: '圖片說明。' }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI route returns 429 before invoking Workers AI when rate limit rejects', async () => {
  let aiCalled = false;
  const response = await worker.fetch(
    new Request('https://worker.example/api/summarize', {
      method: 'POST',
      headers: {
        Origin: APP_ORIGIN,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.3',
      },
      body: JSON.stringify({ text: '新聞內文' }),
    }),
    baseEnv({
      AI_RATE_LIMITER: limiter(false),
      AI: {
        run: async () => {
          aiCalled = true;
          return { response: 'unexpected' };
        },
      },
    }),
    ctx(),
  );

  assert.equal(response.status, 429);
  assert.equal(aiCalled, false);
  assert.equal(response.headers.get('Retry-After'), '60');
});

test('image route returns 429 before calling Pixabay when rate limit rejects', async () => {
  const originalFetch = globalThis.fetch;
  let outboundCalled = false;
  globalThis.fetch = async () => {
    outboundCalled = true;
    throw new Error('unexpected outbound fetch');
  };

  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/images?q=hong%20kong&page=1', {
        headers: { Origin: APP_ORIGIN, 'CF-Connecting-IP': '203.0.113.4' },
      }),
      baseEnv({ FETCH_RATE_LIMITER: limiter(false) }),
      ctx(),
    );
    assert.equal(response.status, 429);
    assert.equal(outboundCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('forced news sync returns 429 before touching D1 when sync limiter rejects', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/api/news/latest?page=0&sync=1', {
      headers: { Origin: APP_ORIGIN, 'CF-Connecting-IP': '203.0.113.5' },
    }),
    baseEnv({ SYNC_RATE_LIMITER: limiter(false) }),
    ctx(),
  );
  assert.equal(response.status, 429);
});
