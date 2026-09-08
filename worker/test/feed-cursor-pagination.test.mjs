import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/entry.js';
import { encodeSearchCursor } from '../src/search.js';
import { APP_ORIGIN } from '../src/security.js';

function ctx() {
  return { waitUntil() {} };
}

function article(index, pubDate = '2026-09-07T12:00:00.000Z') {
  const id = `https://example.com/article/${String(index).padStart(3, '0')}`;
  return {
    id,
    link: id,
    title: `Article ${index}`,
    pubDate,
    description: `Description ${index}`,
    category: 'local',
    source: '香港01',
    imageUrl: '',
    images: '[]',
  };
}

test('news feed cursor route uses deterministic keyset pagination instead of OFFSET', async () => {
  const cursor = encodeSearchCursor({
    pubDate: '2026-09-07T13:00:00.000Z',
    id: 'https://example.com/article/anchor',
  });
  const rows = Array.from({ length: 21 }, (_, index) => article(100 - index));
  let capturedSql = '';
  let capturedParams = [];

  const env = {
    DB: {
      prepare(sql) {
        capturedSql = sql;
        return {
          bind(...params) {
            capturedParams = params;
            return {
              async all() {
                return { results: rows };
              },
            };
          },
        };
      },
    },
  };

  const response = await worker.fetch(
    new Request(`https://worker.example/api/news/local?page=1&sources=hk01&cursor=${encodeURIComponent(cursor)}`, {
      headers: { Origin: APP_ORIGIN },
    }),
    env,
    ctx(),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.pagination, 'cursor');
  assert.equal(payload.count, 20);
  assert.equal(payload.data.length, 20);
  assert.equal(payload.hasMore, true);
  assert.ok(payload.nextCursor);

  assert.match(capturedSql, /pubDate < \?/);
  assert.match(capturedSql, /pubDate = \? AND id < \?/);
  assert.match(capturedSql, /ORDER BY pubDate DESC, id DESC/);
  assert.doesNotMatch(capturedSql, /OFFSET/i);
  assert.equal(capturedParams.at(-1), 21);
  assert.equal(capturedParams[0], 'local');
  assert.equal(capturedParams[1], '香港01');
});

test('news feed rejects malformed cursor before querying D1', async () => {
  let queried = false;
  const env = {
    DB: {
      prepare() {
        queried = true;
        throw new Error('unexpected query');
      },
    },
  };

  const response = await worker.fetch(
    new Request('https://worker.example/api/news/latest?page=1&cursor=%25%25bad&sources=hk01', {
      headers: { Origin: APP_ORIGIN },
    }),
    env,
    ctx(),
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.success, false);
  assert.equal(payload.error, '新聞游標無效');
  assert.equal(queried, false);
});
