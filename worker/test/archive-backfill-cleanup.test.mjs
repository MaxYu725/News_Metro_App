import assert from 'node:assert/strict';
import test from 'node:test';

import { backfillMarkCompletedSql } from '../src/archive-backfill.js';

test('completed archive batches discard bulky replay payloads but keep the run ledger', () => {
  const sql = backfillMarkCompletedSql('ns2c3-001', '2026-08-17T02:00:00.000Z');
  assert.match(sql, /UPDATE archive_backfill_runs SET status='completed'/);
  assert.match(sql, /DELETE FROM archive_backfill_run_items WHERE batch_id='ns2c3-001'/);
  assert.match(sql, /DELETE FROM archive_backfill_run_state WHERE batch_id='ns2c3-001'/);
  assert.doesNotMatch(sql, /DELETE FROM archive_backfill_runs/);
  assert.doesNotMatch(sql, /DELETE FROM articles/);
});
