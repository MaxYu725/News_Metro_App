import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/entry.js';
import { APP_ORIGIN } from '../src/security.js';

function limiter(success = true) {
  return { limit: async () => ({ success }) };
}

function env(overrides = {}) {
  return {
    FETCH_RATE_LIMITER: limiter(true),
    AI_RATE_LIMITER: limiter(true),
    SYNC_RATE_LIMITER: limiter(true),
    API_KEY: 'test-key',
    ...overrides,
  };
}

function ctx() {
  return { waitUntil() {} };
}

test('gallery route uses Cloudflare-safe redirect follow and returns Pixabay results', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.match(String(url), /^https:\/\/pixabay\.com\/api\//);
    assert.equal(init.redirect, 'follow');
    assert.equal(init.headers.Accept, 'application/json');
    assert.equal(init.headers['User-Agent'], 'MetroNews/1.0');

    return new Response(JSON.stringify({
      totalHits: 21,
      hits: [{
        id: 123,
        largeImageURL: 'https://cdn.pixabay.com/photo/large.jpg',
        webformatURL: 'https://cdn.pixabay.com/photo/thumb.jpg',
        tags: 'tokyo, japan',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/images?q=tokyo&page=1', {
        headers: { Origin: APP_ORIGIN, 'CF-Connecting-IP': '203.0.113.30' },
      }),
      env(),
      ctx(),
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.hasMore, true);
    assert.deepEqual(payload.data, [{
      id: '123',
      imageUrl: 'https://cdn.pixabay.com/photo/large.jpg',
      thumbUrl: 'https://cdn.pixabay.com/photo/thumb.jpg',
      tags: 'tokyo, japan',
      source: 'Pixabay',
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('gallery route still rate-limits before calling upstream', async () => {
  const originalFetch = globalThis.fetch;
  let outboundCalled = false;
  globalThis.fetch = async () => {
    outboundCalled = true;
    throw new Error('unexpected outbound fetch');
  };

  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/images?q=tokyo&page=1', {
        headers: { Origin: APP_ORIGIN, 'CF-Connecting-IP': '203.0.113.31' },
      }),
      env({ FETCH_RATE_LIMITER: limiter(false) }),
      ctx(),
    );

    assert.equal(response.status, 429);
    assert.equal(outboundCalled, false);
    assert.equal(response.headers.get('Retry-After'), '60');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
