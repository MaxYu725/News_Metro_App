import assert from 'node:assert/strict';
import test from 'node:test';

import { hk01ContinuationFloor } from '../src/archive-backfill-policy.js';

test('HK01 bootstrap still uses archive publication floor before a cursor exists', () => {
  assert.equal(
    hk01ContinuationFloor(null, '2026-07-01T00:00:00.000Z'),
    '2026-07-01T00:00:00.000Z',
  );
  assert.equal(
    hk01ContinuationFloor({ cursor: '' }, '2026-07-01T00:00:00.000Z'),
    '2026-07-01T00:00:00.000Z',
  );
});

test('HK01 persisted nextOffset owns resume even when resurfaced article pubDate is much older', () => {
  const persisted = {
    cursor: '1779874241',
    last_pubDate: '2020-12-16T10:33:29.000Z',
  };

  assert.equal(
    hk01ContinuationFloor(persisted, '2020-12-16T10:33:29.000Z'),
    '',
  );
});
