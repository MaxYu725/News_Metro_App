import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GAP_START,GAP_END,DAY_COUNT,MAX_CYCLES,FIRST_SLOT_UTC,
  advanceRecoveryState,validateRecoveryState,progressTableSql,
  progressInitialSql,progressAdvanceSql,shouldAttemptRecovery,verifiedDayResult,
} from '../scripts/hk01-gap-recovery.mjs';

test('delayed or dropped cron invocations do not skip a UTC day', () => {
  let state = { cycle: 1, next_date: GAP_START, completed_days: 0 };
  const seen = [];
  for (let n = 0; n < MAX_CYCLES * DAY_COUNT; n++) {
    const before = validateRecoveryState(state);
    seen.push(before.nextDate);
    const next = advanceRecoveryState(before);
    assert.equal(next.completedDays, n + 1);
    // Real clock time is intentionally absent from progression.
    state = { cycle: next.cycle, next_date: next.nextDate, completed_days: next.completedDays };
  }
  assert.equal(DAY_COUNT, 85);
  assert.equal(seen.length, 170);
  assert.equal(seen[0], '2026-08-17');
  assert.equal(seen[84], GAP_END);
  assert.equal(seen[85], GAP_START);
  assert.equal(seen[169], GAP_END);
  assert.deepEqual(validateRecoveryState(state), {
    cycle: 3, nextDate: '2026-11-10', completedDays: 170, done: true,
  });
  assert.equal(advanceRecoveryState(state), null);
});

test('state mismatch and improper movement fail closed', () => {
  for (const invalid of [
    null,
    { cycle: 1, next_date: '2026-08-18', completed_days: 0 },
    { cycle: 2, next_date: GAP_START, completed_days: 0 },
    { cycle: 1, next_date: '2026-09-99', completed_days: 44 },
    { cycle: 2, next_date: GAP_END, completed_days: 169 },
    { cycle: 3, next_date: GAP_END, completed_days: 170 },
    { cycle: 5, next_date: GAP_START, completed_days: 170 },
  ]) {
    assert.throws(() => validateRecoveryState(invalid));
  }
});

test('progress is stored in archive03 state table and advanced with CAS', () => {
  assert.match(progressTableSql(), /^CREATE TABLE IF NOT EXISTS hk01_gap_recovery_state/);
  assert.match(progressInitialSql('2026-11-11T00:00:00.000Z'), /^INSERT OR IGNORE INTO hk01_gap_recovery_state/);
  const state = { cycle: 1, next_date: GAP_START, completed_days: 0 };
  const next = advanceRecoveryState(state);
  const sql = progressAdvanceSql(state, next, '2026-11-11T00:00:00.000Z');
  assert.match(sql, /WHERE id='hk01-2026-aug-nov-v1'/);
  assert.match(sql, /AND cycle=1/);
  assert.match(sql, /AND next_date='2026-08-17'/);
  assert.match(sql, /AND completed_days=0/);
  assert.match(sql, /RETURNING cycle,next_date,completed_days$/);
  assert.doesNotMatch(sql, /archive_backfill_state|DELETE FROM|UPDATE articles/);
  assert.throws(() => progressAdvanceSql(state, { ...next, nextDate: GAP_END }));
});

test('day report must be post-write verified, for the requested date', () => {
  const sample = { utcDay: GAP_START,mode: 'run',verified: true,
    hk01Found: 550,archive03Identities: 500,remainingAfterWrite: 50,complete: false };
  assert.deepEqual(verifiedDayResult(sample,GAP_START), { complete: false, remaining: 50 });
  assert.deepEqual(verifiedDayResult({ ...sample,remainingAfterWrite: 0,complete: true },GAP_START),
    { complete: true, remaining: 0 });
  for (const invalid of [
    { ...sample, complete: true },
    { ...sample, verified: false },
    { ...sample, utcDay: '2026-08-18' },
    { ...sample, remainingAfterWrite: -1 },
    { ...sample, remainingAfterWrite: undefined },
  ]) assert.throws(() => verifiedDayResult(invalid,GAP_START));
});

test('only the start boundary uses wall clock time', () => {
  assert.equal(shouldAttemptRecovery(Date.parse(FIRST_SLOT_UTC) - 1),false);
  assert.equal(shouldAttemptRecovery(Date.parse(FIRST_SLOT_UTC)),true);
  assert.equal(shouldAttemptRecovery('2027-02-01T00:00:00Z'),true);
  assert.throws(() => shouldAttemptRecovery('bad'));
});
