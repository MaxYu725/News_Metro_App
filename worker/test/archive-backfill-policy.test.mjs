import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allSourceBastilleTarget,
  allSourceHk01Target,
  hk01ContinuationFloor,
} from '../src/archive-backfill-policy.js';

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

test('all-source batches start balanced and spill genuine HK01 shortfall to Bastille', () => {
  assert.equal(allSourceHk01Target(1000), 500);
  assert.equal(allSourceBastilleTarget(1000, 500), 500);
  assert.equal(allSourceBastilleTarget(1000, 41), 959);
  assert.equal(allSourceBastilleTarget(500, 0), 500);
});

test('all-source allocation rejects impossible generated counts', () => {
  assert.throws(() => allSourceHk01Target(0), /invalid all-source limit/);
  assert.throws(() => allSourceBastilleTarget(1000, 1001), /invalid HK01 generated count/);
});
