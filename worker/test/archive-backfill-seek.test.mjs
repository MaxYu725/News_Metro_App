import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASTILLE_SEEK_MAX_PAGE,
  seekBastillePageBeforeFloor,
} from '../src/archive-backfill.js';

test('Bastille initial backfill seeks near the archive floor instead of scanning from page 1', async () => {
  const calls = [];
  const base = Date.parse('2026-08-20T00:00:00.000Z');
  const fetchPage = async page => {
    calls.push(page);
    const pubDate = new Date(base - page * 86400000).toISOString();
    return {
      articles: [{ id: String(page), pubDate }],
      nextCursor: String(page + 1),
    };
  };

  const result = await seekBastillePageBeforeFloor('2026-08-12T00:00:00.000Z', fetchPage);
  assert.equal(result.page, 9);
  assert.equal(result.probes, calls.length);
  assert.ok(calls.includes(1));
  assert.ok(calls.includes(16));
  assert.ok(calls.length < 10, `seek used too many probes: ${calls.join(',')}`);
});

test('Bastille seek is a no-op when no archive floor exists', async () => {
  let calls = 0;
  const result = await seekBastillePageBeforeFloor('', async () => {
    calls += 1;
    return { articles: [] };
  });
  assert.deepEqual(result, { page: 1, probes: 0 });
  assert.equal(calls, 0);
});

test('Bastille seek keeps a bounded page search horizon', () => {
  assert.equal(BASTILLE_SEEK_MAX_PAGE, 4096);
});
